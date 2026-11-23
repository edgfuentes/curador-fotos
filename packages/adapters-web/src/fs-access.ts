/**
 * FileSystemAdapter para Chrome/Edge usando la File System Access API.
 *
 * - La carpeta de origen se abre con permiso de SOLO LECTURA ({ mode: 'read' }).
 *   WebSourceDirectory no tiene métodos de escritura.
 * - La carpeta de destino se abre con lectura/escritura y la app crea dentro
 *   "Para subir a redes" y las subcarpetas por sector (getDirectoryHandle create:true).
 */
import {
  CancelledError,
  isIgnoredName,
  normalizeRelativePath,
  splitPath,
  type ByteSource,
  type CancelSignal,
  type DestinationDirectory,
  type FileSystemAdapter,
  type RememberedSource,
  type ScanOptions,
  type SourceDirectory,
  type SourceFileEntry,
} from '@curador/core';
import type { HandleStore } from './storage';

// Tipos de la File System Access API que no todas las versiones de lib.dom incluyen.
type PermissionMode = 'read' | 'readwrite';
interface PermissionCapable {
  queryPermission?(d: { mode: PermissionMode }): Promise<PermissionState>;
  requestPermission?(d: { mode: PermissionMode }): Promise<PermissionState>;
}
interface DirectoryPickerHost {
  showDirectoryPicker?(options?: { id?: string; mode?: PermissionMode; startIn?: string }): Promise<FileSystemDirectoryHandle>;
}
type IterableDir = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
};

export function isFileSystemAccessSupported(): boolean {
  return typeof (globalThis as DirectoryPickerHost).showDirectoryPicker === 'function' && globalThis.isSecureContext;
}

/** ByteSource sobre un Blob/File: lectura en streaming y aleatoria. */
export function blobSource(blob: Blob): ByteSource & { readonly blob: Blob } {
  return {
    blob,
    size: blob.size,
    async *stream() {
      const reader = blob.stream().getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
    async read(offset, length) {
      const start = Math.max(0, offset);
      return new Uint8Array(await blob.slice(start, Math.min(blob.size, start + length)).arrayBuffer());
    },
  };
}

async function ensurePermission(handle: FileSystemHandle, mode: PermissionMode, request: boolean): Promise<boolean> {
  const h = handle as FileSystemHandle & PermissionCapable;
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode })) === 'granted') return true;
  if (!request || !h.requestPermission) return false;
  return (await h.requestPermission({ mode })) === 'granted';
}

const SCAN_CONCURRENCY = 16;

export class WebSourceDirectory implements SourceDirectory {
  readonly name: string;
  private readonly files = new Map<string, FileSystemFileHandle>();

  constructor(readonly handle: FileSystemDirectoryHandle) {
    this.name = handle.name;
  }

  async scan(options: ScanOptions = {}): Promise<SourceFileEntry[]> {
    this.files.clear();
    const out: SourceFileEntry[] = [];
    const pending: { handle: FileSystemFileHandle; rel: string }[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, rel: string): Promise<void> => {
      if (options.signal?.aborted) throw new CancelledError();
      for await (const entry of (dir as IterableDir).values()) {
        if (isIgnoredName(entry.name)) continue;
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') {
          if (options.includeDirectory && !options.includeDirectory(entry.name, childRel)) continue;
          await walk(entry as FileSystemDirectoryHandle, childRel);
        } else {
          if (options.includeFile && !options.includeFile(entry.name)) continue;
          pending.push({ handle: entry as FileSystemFileHandle, rel: childRel });
        }
      }
    };
    await walk(this.handle, '');

    // Tamaño y fecha de modificación (necesarios para la caché), en paralelo.
    let next = 0;
    const worker = async () => {
      while (next < pending.length) {
        if (options.signal?.aborted) throw new CancelledError();
        const { handle, rel } = pending[next++]!;
        try {
          const file = await handle.getFile();
          const relativePath = normalizeRelativePath(rel);
          this.files.set(relativePath, handle);
          out.push({ relativePath, ...splitPath(relativePath), size: file.size, lastModified: file.lastModified });
          if (out.length % 50 === 0) options.onProgress?.(out.length);
        } catch {
          // Archivo ilegible (permisos, desconectado): se omite.
        }
      }
    };
    await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
    options.onProgress?.(out.length);
    return out;
  }

  /** Obtiene el File original (solo lectura). */
  async getFile(relativePath: string): Promise<File> {
    let handle = this.files.get(relativePath);
    if (!handle) {
      const parts = relativePath.split('/');
      let dir = this.handle;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      handle = await dir.getFileHandle(parts[parts.length - 1]!);
      this.files.set(relativePath, handle);
    }
    return handle.getFile();
  }

  async openFile(relativePath: string): Promise<ByteSource> {
    return blobSource(await this.getFile(relativePath));
  }
}

export class WebDestinationDirectory implements DestinationDirectory {
  readonly name: string;
  constructor(readonly handle: FileSystemDirectoryHandle) {
    this.name = handle.name;
  }

  async getDirectory(name: string, options: { create: boolean }): Promise<DestinationDirectory> {
    return new WebDestinationDirectory(await this.handle.getDirectoryHandle(name, { create: options.create }));
  }

  async listEntryNames(): Promise<string[]> {
    const names: string[] = [];
    for await (const entry of (this.handle as IterableDir).values()) {
      if (!isIgnoredName(entry.name) && !entry.name.endsWith('.crswap')) names.push(entry.name);
    }
    return names;
  }

  /**
   * createWritable() escribe en un archivo temporal (.crswap) y solo lo
   * reemplaza al llamar close(): si algo falla se llama abort() y se borra
   * el archivo vacío creado por getFileHandle.
   */
  async writeFile(name: string, data: AsyncIterable<Uint8Array>, signal?: CancelSignal): Promise<void> {
    const fileHandle = await this.handle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable({ keepExistingData: false });
    try {
      for await (const chunk of data) {
        if (signal?.aborted) throw new CancelledError();
        await writable.write(chunk as Uint8Array<ArrayBuffer>);
      }
      await writable.close();
    } catch (err) {
      await writable.abort().catch(() => undefined);
      await this.handle.removeEntry(name).catch(() => undefined);
      throw err;
    }
  }

  async openFile(name: string): Promise<ByteSource> {
    return blobSource(await (await this.handle.getFileHandle(name)).getFile());
  }

  async removeEntry(name: string): Promise<void> {
    await this.handle.removeEntry(name);
  }
}

export class WebFileSystemAdapter implements FileSystemAdapter {
  readonly platform = 'web-file-system-access';

  constructor(private readonly handles: HandleStore) {}

  isSupported(): boolean {
    return isFileSystemAccessSupported();
  }

  async pickSourceDirectory(): Promise<SourceDirectory | null> {
    const handle = await this.pick({ id: 'curador-origen', mode: 'read', startIn: 'pictures' });
    if (!handle) return null;
    await this.handles.putHandle('lastSource', handle).catch(() => undefined);
    return new WebSourceDirectory(handle);
  }

  async getRememberedSource(): Promise<RememberedSource | null> {
    const handle = await this.handles.getHandle('lastSource').catch(() => undefined);
    if (!handle || handle.kind !== 'directory') return null;
    const dir = handle as FileSystemDirectoryHandle;
    return {
      name: dir.name,
      reopen: async () => ((await ensurePermission(dir, 'read', true)) ? new WebSourceDirectory(dir) : null),
    };
  }

  async pickDestinationDirectory(): Promise<DestinationDirectory | null> {
    const handle = await this.pick({ id: 'curador-destino', mode: 'readwrite', startIn: 'desktop' });
    if (!handle) return null;
    if (!(await ensurePermission(handle, 'readwrite', true))) return null;
    return new WebDestinationDirectory(handle);
  }

  async isInside(source: SourceDirectory, destination: DestinationDirectory): Promise<boolean> {
    if (!(source instanceof WebSourceDirectory) || !(destination instanceof WebDestinationDirectory)) return false;
    if (await source.handle.isSameEntry(destination.handle)) return true;
    return (await source.handle.resolve(destination.handle)) !== null;
  }

  private async pick(options: { id: string; mode: PermissionMode; startIn: string }): Promise<FileSystemDirectoryHandle | null> {
    const picker = (globalThis as DirectoryPickerHost).showDirectoryPicker;
    if (!picker) throw new Error('Este navegador no permite elegir carpetas. Usa Google Chrome o Microsoft Edge.');
    try {
      return await picker.call(globalThis, options);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      throw err;
    }
  }
}
