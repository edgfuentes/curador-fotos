/**
 * Adaptadores de navegador (Chrome/Edge). Para otra plataforma (Capacitor,
 * React Native, Electron) se crea un paquete hermano que implemente los mismos
 * puertos de @curador/core y una función equivalente a createWebAdapters().
 */
import { WebFileSystemAdapter } from './fs-access';
import { WebMetadataReader, wasmSha256 } from './metadata';
import { IndexedDbStorage } from './storage';
import { WebThumbnailAdapter } from './thumbnails';
import { WorkerPool } from './worker-pool';

export { isFileSystemAccessSupported, WebFileSystemAdapter, WebSourceDirectory, WebDestinationDirectory, blobSource } from './fs-access';
export { IndexedDbStorage } from './storage';
export { WebThumbnailAdapter } from './thumbnails';
export { WebMetadataReader, wasmSha256 } from './metadata';
export { WorkerPool } from './worker-pool';
export { buildTiff, withExif, type ExifFields } from './demo/exif-writer';

export interface WebAdapters {
  readonly fileSystem: WebFileSystemAdapter;
  readonly storage: IndexedDbStorage;
  readonly thumbnails: WebThumbnailAdapter;
  readonly metadata: WebMetadataReader;
  readonly createHasher: typeof wasmSha256;
  dispose(): void;
}

export function createWebAdapters(): WebAdapters {
  const storage = new IndexedDbStorage();
  const pool = new WorkerPool(() => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'curador-worker' }));
  return {
    fileSystem: new WebFileSystemAdapter(storage),
    storage,
    thumbnails: new WebThumbnailAdapter(pool, storage),
    metadata: new WebMetadataReader(pool),
    createHasher: wasmSha256,
    dispose: () => pool.terminate(),
  };
}
