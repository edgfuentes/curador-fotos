/// <reference lib="webworker" />
/**
 * Web Worker: lee metadatos, genera vistas y calcula SHA-256 fuera del hilo
 * principal para que la interfaz no se trabe con miles de fotos.
 */
import { createSHA256 } from 'hash-wasm';
import { generateView, readMetadata, UnsupportedPreviewError } from './decoders';
import type { WorkerRequest, WorkerResponse } from './worker-protocol';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  let res: WorkerResponse;
  try {
    switch (req.kind) {
      case 'meta':
        res = { id: req.id, ok: true, meta: await readMetadata(req.file, req.format, req.extension) };
        break;
      case 'view': {
        const v = await generateView(req.file, req.format, req.extension, req.size, req.orientation);
        res = { id: req.id, ok: true, view: v };
        break;
      }
      case 'hash': {
        const hasher = await createSHA256();
        hasher.init();
        const reader = req.file.stream().getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          hasher.update(value);
        }
        res = { id: req.id, ok: true, hash: hasher.digest('hex') };
        break;
      }
    }
  } catch (err) {
    res = {
      id: req.id,
      ok: false,
      unsupported: err instanceof UnsupportedPreviewError,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  self.postMessage(res);
};
