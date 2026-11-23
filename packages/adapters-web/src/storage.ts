/**
 * StorageAdapter sobre IndexedDB. Todo queda en este navegador, en este Mac.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CameraSettings, LibraryState, PhotoMetadata, StorageAdapter } from '@curador/core';

interface CuradorDB extends DBSchema {
  libraries: { key: string; value: LibraryState };
  cameras: { key: string; value: CameraSettings };
  prefs: { key: string; value: unknown };
  metadata: { key: string; value: PhotoMetadata };
  hashes: { key: string; value: string };
  /** Vistas generadas (miniaturas y vistas medias), por clave de archivo + tamaño. */
  views: { key: string; value: { blob: Blob; width: number; height: number; createdAt: number } };
  handles: { key: string; value: FileSystemHandle };
}

const DB_NAME = 'curador-fotos';
const DB_VERSION = 1;

export interface HandleStore {
  getHandle(key: string): Promise<FileSystemHandle | undefined>;
  putHandle(key: string, handle: FileSystemHandle): Promise<void>;
}

export interface ViewCache {
  getView(key: string): Promise<{ blob: Blob; width: number; height: number } | undefined>;
  putView(key: string, value: { blob: Blob; width: number; height: number }): Promise<void>;
}

export class IndexedDbStorage implements StorageAdapter, HandleStore, ViewCache {
  private dbPromise: Promise<IDBPDatabase<CuradorDB>> | null = null;

  private db(): Promise<IDBPDatabase<CuradorDB>> {
    this.dbPromise ??= openDB<CuradorDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const name of ['libraries', 'cameras', 'prefs', 'metadata', 'hashes', 'views', 'handles'] as const) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        }
      },
    });
    return this.dbPromise;
  }

  async loadLibrary(libraryId: string) {
    return (await this.db()).get('libraries', libraryId);
  }
  async saveLibrary(libraryId: string, state: LibraryState) {
    await (await this.db()).put('libraries', state, libraryId);
  }
  async loadCameraSettings() {
    return (await this.db()).getAll('cameras');
  }
  async saveCameraSettings(settings: CameraSettings) {
    await (await this.db()).put('cameras', settings, settings.cameraId);
  }
  async loadPreference<T>(key: string) {
    return (await (await this.db()).get('prefs', key)) as T | undefined;
  }
  async savePreference<T>(key: string, value: T) {
    await (await this.db()).put('prefs', value, key);
  }

  async getCachedMetadata(keys: readonly string[]) {
    const tx = (await this.db()).transaction('metadata');
    const values = await Promise.all(keys.map((k) => tx.store.get(k)));
    const out = new Map<string, PhotoMetadata>();
    keys.forEach((k, i) => {
      const v = values[i];
      if (v) out.set(k, v);
    });
    return out;
  }
  async putCachedMetadata(entries: ReadonlyMap<string, PhotoMetadata>) {
    if (entries.size === 0) return;
    const tx = (await this.db()).transaction('metadata', 'readwrite');
    await Promise.all([...[...entries].map(([k, v]) => tx.store.put(v, k)), tx.done]);
  }
  async getCachedHashes(keys: readonly string[]) {
    const tx = (await this.db()).transaction('hashes');
    const values = await Promise.all(keys.map((k) => tx.store.get(k)));
    const out = new Map<string, string>();
    keys.forEach((k, i) => {
      const v = values[i];
      if (v) out.set(k, v);
    });
    return out;
  }
  async putCachedHash(key: string, sha256: string) {
    await (await this.db()).put('hashes', sha256, key);
  }

  async getView(key: string) {
    return (await this.db()).get('views', key);
  }
  async putView(key: string, value: { blob: Blob; width: number; height: number }) {
    await (await this.db()).put('views', { ...value, createdAt: Date.now() }, key);
  }

  async getHandle(key: string) {
    return (await this.db()).get('handles', key);
  }
  async putHandle(key: string, handle: FileSystemHandle) {
    await (await this.db()).put('handles', handle, key);
  }

  /** Borra cachés regenerables (miniaturas, metadatos, hashes). Nunca borra marcas ni ajustes. */
  async clearCaches() {
    const db = await this.db();
    await Promise.all([db.clear('views'), db.clear('metadata'), db.clear('hashes')]);
  }

  async estimateUsage(): Promise<{ usage: number; quota: number } | null> {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  }
}
