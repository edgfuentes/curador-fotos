/**
 * Adaptadores para Node.js. Se usan en las pruebas de integración y sirven de
 * referencia para una futura app de escritorio (Electron/Tauri).
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  CancelledError,
  isIgnoredName,
  normalizeRelativePath,
  splitPath,
  type ByteSource,
  type CancelSignal,
  type DestinationDirectory,
  type HasherFactory,
  type ScanOptions,
  type SourceDirectory,
  type SourceFileEntry,
} from '@curador/core';

export const nodeHasher: HasherFactory = async () => {
  const h = createHash('sha256');
  return {
    update: (chunk) => void h.update(chunk),
    digestHex: () => h.digest('hex'),
  };
};

function fileSource(absPath: string, size: number): ByteSource {
  return {
    size,
    async *stream() {
      for await (const chunk of createReadStream(absPath, { highWaterMark: 1 << 20 })) {
        yield chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer);
      }
    },
    async read(offset, length) {
      const fh = await fs.open(absPath, 'r');
      try {
        const buf = new Uint8Array(Math.max(0, Math.min(length, size - offset)));
        await fh.read(buf, 0, buf.length, offset);
        return buf;
      } finally {
        await fh.close();
      }
    },
  };
}

export class NodeSourceDirectory implements SourceDirectory {
  readonly name: string;
  constructor(private readonly root: string) {
    this.name = path.basename(root);
  }

  async scan(options: ScanOptions = {}): Promise<SourceFileEntry[]> {
    const out: SourceFileEntry[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      if (options.signal?.aborted) throw new CancelledError();
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (isIgnoredName(e.name)) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (options.includeDirectory && !options.includeDirectory(e.name, childRel)) continue;
          await walk(path.join(dir, e.name), childRel);
        } else if (e.isFile()) {
          if (options.includeFile && !options.includeFile(e.name)) continue;
          const st = await fs.stat(path.join(dir, e.name));
          const relativePath = normalizeRelativePath(childRel);
          out.push({ relativePath, ...splitPath(relativePath), size: st.size, lastModified: Math.round(st.mtimeMs) });
          options.onProgress?.(out.length);
        }
      }
    };
    await walk(this.root, '');
    return out;
  }

  async openFile(relativePath: string): Promise<ByteSource> {
    const abs = path.join(this.root, ...relativePath.split('/'));
    const st = await fs.stat(abs);
    return fileSource(abs, st.size);
  }
}

export class NodeDestinationDirectory implements DestinationDirectory {
  readonly name: string;
  constructor(readonly absPath: string) {
    this.name = path.basename(absPath);
  }

  async getDirectory(name: string, options: { create: boolean }): Promise<DestinationDirectory> {
    const p = path.join(this.absPath, name);
    if (options.create) await fs.mkdir(p, { recursive: true });
    else if (!(await fs.stat(p)).isDirectory()) throw new Error(`${name} no es una carpeta`);
    return new NodeDestinationDirectory(p);
  }

  async listEntryNames(): Promise<string[]> {
    return (await fs.readdir(this.absPath)).filter((n) => !isIgnoredName(n));
  }

  /** Escritura atómica: se escribe un temporal y se renombra al final. */
  async writeFile(name: string, data: AsyncIterable<Uint8Array>, signal?: CancelSignal): Promise<void> {
    const finalPath = path.join(this.absPath, name);
    const tmp = path.join(this.absPath, `.${randomUUID()}.part`);
    const fh = await fs.open(tmp, 'wx');
    try {
      for await (const chunk of data) {
        if (signal?.aborted) throw new CancelledError();
        await fh.write(chunk);
      }
      await fh.close();
      await fs.rename(tmp, finalPath);
    } catch (err) {
      await fh.close().catch(() => undefined);
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  async openFile(name: string): Promise<ByteSource> {
    const p = path.join(this.absPath, name);
    return fileSource(p, (await fs.stat(p)).size);
  }

  async removeEntry(name: string): Promise<void> {
    await fs.rm(path.join(this.absPath, name), { force: true });
  }
}
