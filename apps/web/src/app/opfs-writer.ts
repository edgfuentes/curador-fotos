/// <reference lib="webworker" />
/**
 * Escribe una copia exacta de un archivo en el almacenamiento privado (OPFS)
 * con createSyncAccessHandle, que Safari ofrece en workers.
 */
interface Job {
  id: number;
  path: string[];
  name: string;
  file: File;
}

interface SyncHandle {
  write(buffer: Uint8Array, options: { at: number }): number;
  truncate(size: number): void;
  flush(): void;
  close(): void;
}

self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, path, name, file } = e.data;
  let dir: FileSystemDirectoryHandle | null = null;
  try {
    dir = await navigator.storage.getDirectory();
    for (const p of path) dir = await dir.getDirectoryHandle(p, { create: true });
    const fh = await dir.getFileHandle(name, { create: true });
    const h = (await (
      fh as FileSystemFileHandle & {
        createSyncAccessHandle(): Promise<SyncHandle>;
      }
    ).createSyncAccessHandle()) as SyncHandle;
    try {
      h.truncate(0);
      let at = 0;
      const reader = file.stream().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        at += h.write(value, { at });
      }
      h.flush();
    } finally {
      h.close();
    }
    self.postMessage({ id });
  } catch (err) {
    await dir?.removeEntry(name).catch(() => undefined);
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
