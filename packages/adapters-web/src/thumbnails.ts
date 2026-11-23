/**
 * ThumbnailAdapter para navegador: genera vistas en Web Workers y las cachea en
 * IndexedDB. La clave incluye tamaño y fecha de modificación del archivo, así
 * que si el original cambia, la vista se regenera sola.
 */
import {
  CancelledError,
  fileCacheKey,
  type ImageRef,
  type Photo,
  type SourceDirectory,
  type ThumbnailAdapter,
  type ThumbnailRequest,
  type ViewSize,
} from '@curador/core';
import { WebSourceDirectory } from './fs-access';
import type { ViewCache } from './storage';
import { WorkerTaskError, type WorkerPool } from './worker-pool';

interface Live {
  url: string;
  width: number;
  height: number;
  refs: number;
}

interface Inflight {
  controller: AbortController;
  waiters: number;
  promise: Promise<Live | null>;
}

/** Vistas sin usar que se mantienen en memoria antes de liberar su URL. */
const IDLE_LIMIT = 600;

export class WebThumbnailAdapter implements ThumbnailAdapter {
  private readonly live = new Map<string, Live>();
  /** Claves con refs = 0, en orden de uso (LRU). */
  private readonly idle = new Map<string, true>();
  private readonly inflight = new Map<string, Inflight>();
  private readonly unsupported = new Set<string>();

  constructor(
    private readonly pool: WorkerPool,
    private readonly cache: ViewCache & { clearCaches(): Promise<void> },
  ) {}

  async get(source: SourceDirectory, photo: Photo, size: ViewSize, request: ThumbnailRequest = {}): Promise<ImageRef | null> {
    const key = `${fileCacheKey(photo.relativePath, photo.size, photo.lastModified)}|${size}`;
    if (this.unsupported.has(key)) return null;
    const existing = this.live.get(key);
    if (existing) return this.ref(key, existing);
    if (request.signal?.aborted) throw new CancelledError();

    // Varias vistas pueden esperar la misma imagen: la carga solo se cancela si TODAS se cancelan.
    let entry = this.inflight.get(key);
    if (!entry || entry.controller.signal.aborted) {
      const controller = new AbortController();
      const created: Inflight = { controller, waiters: 0, promise: Promise.resolve(null) };
      created.promise = this.load(key, source, photo, size, request.priority, controller.signal).finally(() => {
        if (this.inflight.get(key) === created) this.inflight.delete(key);
      });
      this.inflight.set(key, created);
      entry = created;
    }
    const current = entry;
    current.waiters++;
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => {
        current.waiters--;
        if (current.waiters <= 0) current.controller.abort();
        reject(new CancelledError());
      };
      request.signal?.addEventListener?.('abort', onAbort, { once: true });
    });
    aborted.catch(() => undefined);
    try {
      const live = await Promise.race([current.promise, aborted]);
      if (!live) return null;
      return this.ref(key, live);
    } finally {
      if (onAbort && !request.signal?.aborted) {
        current.waiters--;
        request.signal?.removeEventListener?.('abort', onAbort);
      }
    }
  }

  private async load(
    key: string,
    source: SourceDirectory,
    photo: Photo,
    size: ViewSize,
    priority: number | undefined,
    signal: AbortSignal,
  ): Promise<Live | null> {
    if (!(source instanceof WebSourceDirectory)) throw new Error('WebThumbnailAdapter requiere una carpeta del navegador');
    // Zoom 100 %: JPEG/PNG/WebP se muestran directamente desde el original (solo lectura).
    if (size === 'full' && (photo.format === 'jpeg' || photo.format === 'png' || photo.format === 'webp')) {
      const file = await source.getFile(photo.relativePath);
      return this.store(key, URL.createObjectURL(file), photo.width ?? 0, photo.height ?? 0);
    }
    if (size !== 'full') {
      const cached = await this.cache.getView(key).catch(() => undefined);
      if (cached) return this.store(key, URL.createObjectURL(cached.blob), cached.width, cached.height);
    }
    const file = await source.getFile(photo.relativePath);
    try {
      const res = await this.pool.run(
        { kind: 'view', file, format: photo.format, extension: photo.extension, size, orientation: photo.orientation ?? 1 },
        { priority: priority ?? (size === 'grid' ? 1 : 10), signal },
      );
      const view = res.view!;
      if (size !== 'full') void this.cache.putView(key, view).catch(() => undefined);
      return this.store(key, URL.createObjectURL(view.blob), view.width, view.height);
    } catch (err) {
      if (err instanceof WorkerTaskError) {
        this.unsupported.add(key);
        if (!err.unsupported) console.warn(`No se pudo generar la vista de ${photo.relativePath}:`, err.message);
        return null;
      }
      throw err;
    }
  }

  private store(key: string, url: string, width: number, height: number): Live {
    const live: Live = { url, width, height, refs: 0 };
    this.live.set(key, live);
    this.idle.set(key, true);
    this.trim();
    return live;
  }

  private ref(key: string, live: Live): ImageRef {
    live.refs++;
    this.idle.delete(key);
    let released = false;
    return {
      url: live.url,
      width: live.width,
      height: live.height,
      release: () => {
        if (released) return;
        released = true;
        live.refs--;
        if (live.refs <= 0) {
          this.idle.delete(key);
          this.idle.set(key, true);
          this.trim();
        }
      },
    };
  }

  private trim(): void {
    while (this.idle.size > IDLE_LIMIT) {
      const oldest = this.idle.keys().next().value as string;
      this.idle.delete(oldest);
      const live = this.live.get(oldest);
      if (live && live.refs <= 0) {
        URL.revokeObjectURL(live.url);
        this.live.delete(oldest);
      }
    }
  }

  async clearCache(): Promise<void> {
    this.unsupported.clear();
    await this.cache.clearCaches();
  }
}
