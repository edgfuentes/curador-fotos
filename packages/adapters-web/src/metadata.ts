import type { CancelSignal, HasherFactory, MetadataReader, Photo, PhotoMetadata, SourceDirectory } from '@curador/core';
import { createSHA256 } from 'hash-wasm';
import { WebSourceDirectory } from './fs-access';
import type { WorkerPool } from './worker-pool';

/** Lee EXIF en Web Workers. */
export class WebMetadataReader implements MetadataReader {
  constructor(private readonly pool: WorkerPool) {}

  async read(source: SourceDirectory, photo: Pick<Photo, 'relativePath' | 'format' | 'extension'>): Promise<PhotoMetadata> {
    if (!(source instanceof WebSourceDirectory)) throw new Error('Se requiere una carpeta del navegador');
    const file = await source.getFile(photo.relativePath);
    const res = await this.pool.run({ kind: 'meta', file, format: photo.format, extension: photo.extension }, { priority: 5 });
    return res.meta ?? {};
  }

  /** SHA-256 de un original, calculado en un worker con prioridad baja (detección de duplicados). */
  async hash(source: SourceDirectory, relativePath: string, signal?: CancelSignal): Promise<string> {
    if (!(source instanceof WebSourceDirectory)) throw new Error('Se requiere una carpeta del navegador');
    const file = await source.getFile(relativePath);
    const res = await this.pool.run({ kind: 'hash', file }, { priority: -10, ...(signal ? { signal } : {}) });
    return res.hash!;
  }
}

/** SHA-256 incremental (WebAssembly) para la exportación: no carga archivos enteros en memoria. */
export const wasmSha256: HasherFactory = async () => {
  const h = await createSHA256();
  h.init();
  return {
    update: (chunk) => void h.update(chunk),
    digestHex: () => h.digest('hex'),
  };
};
