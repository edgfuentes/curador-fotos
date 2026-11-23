/**
 * Carreras en iPhone/iPad: las fotos elegidas desde Fotos se copian (byte a byte,
 * sin recomprimir) al almacenamiento privado de la app (OPFS), una carpeta por
 * carrera. Así sobreviven si Safari recarga la página y se pueden abrir como
 * cualquier carpeta de origen. Las fotos de la fototeca no se tocan.
 */
import { detectFormat, isIgnoredName } from '@curador/core';
import { WebSourceDirectory } from '@curador/adapters-web';

const ROOT = 'Carreras';

export interface Carrera {
  name: string;
  count: number;
  bytes: number;
}

type IterableDir = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemFileHandle | FileSystemDirectoryHandle>;
};

export function isOpfsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

async function rootDir(): Promise<FileSystemDirectoryHandle> {
  if (!isOpfsSupported()) throw new Error('Este navegador no permite guardar fotos en la app.');
  return (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT, {
    create: true,
  });
}

/** Nombre válido para una carpeta (sin "/" ni caracteres de control). */
export function cleanCarreraName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function defaultCarreraName(now = new Date()): string {
  const d = now
    .toLocaleDateString('es', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    .replace(/\//g, '-');
  return `Carrera ${d}`;
}

export async function listCarreras(): Promise<Carrera[]> {
  const root = await rootDir();
  const out: Carrera[] = [];
  for await (const entry of (root as IterableDir).values()) {
    if (entry.kind !== 'directory') continue;
    let count = 0;
    let bytes = 0;
    for await (const f of (entry as IterableDir).values()) {
      if (f.kind !== 'file' || isIgnoredName(f.name) || !detectFormat(f.name)) continue;
      count++;
      bytes += (await (f as FileSystemFileHandle).getFile()).size;
    }
    out.push({ name: entry.name, count, bytes });
  }
  return out.sort((a, b) => b.name.localeCompare(a.name, 'es', { numeric: true }));
}

/** Devuelve un nombre que no esté en uso: «Carrera 23-11-2026 (2)». */
export async function uniqueCarreraName(name: string): Promise<string> {
  const base = cleanCarreraName(name) || defaultCarreraName();
  const taken = new Set((await listCarreras()).map((c) => c.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} (${i})`)) return `${base} (${i})`;
}

export async function openCarrera(name: string): Promise<WebSourceDirectory> {
  return new WebSourceDirectory(await (await rootDir()).getDirectoryHandle(name));
}

export async function deleteCarrera(name: string): Promise<void> {
  await (await rootDir()).removeEntry(name, { recursive: true });
}

// ------------------------------------------------------------------ escritura

let writer: Worker | null = null;
let writerSeq = 0;
const writerJobs = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();

/** Safari antiguo no tiene createWritable en el hilo principal: se escribe desde un worker. */
function writeInWorker(dir: string, name: string, file: File): Promise<void> {
  if (!writer) {
    writer = new Worker(new URL('./opfs-writer.ts', import.meta.url), {
      type: 'module',
      name: 'curador-opfs',
    });
    writer.onmessage = (e: MessageEvent<{ id: number; error?: string }>) => {
      const job = writerJobs.get(e.data.id);
      writerJobs.delete(e.data.id);
      if (e.data.error) job?.reject(new Error(e.data.error));
      else job?.resolve();
    };
  }
  const id = ++writerSeq;
  return new Promise((resolve, reject) => {
    writerJobs.set(id, { resolve, reject });
    writer!.postMessage({ id, path: [ROOT, dir], name, file });
  });
}

const canWriteOnMainThread = () =>
  typeof FileSystemFileHandle !== 'undefined' &&
  typeof (FileSystemFileHandle.prototype as { createWritable?: unknown }).createWritable === 'function';

async function writeCopy(dirHandle: FileSystemDirectoryHandle, dir: string, name: string, file: File): Promise<void> {
  if (!canWriteOnMainThread()) return writeInWorker(dir, name, file);
  const fh = await dirHandle.getFileHandle(name, { create: true });
  const w = await fh.createWritable({ keepExistingData: false });
  try {
    await w.write(file);
    await w.close();
  } catch (err) {
    await w.abort().catch(() => undefined);
    await dirHandle.removeEntry(name).catch(() => undefined);
    throw err;
  }
}

function withSuffix(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

export interface ImportResult {
  source: WebSourceDirectory;
  added: number;
  skipped: number;
}

/**
 * Copia las fotos elegidas a la carrera `name` (la crea si no existe).
 * Una foto con el mismo nombre y tamaño que otra ya copiada se omite.
 */
export async function importPhotos(
  name: string,
  files: readonly File[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const root = await rootDir();
  const dir = await root.getDirectoryHandle(name, { create: true });
  const existing = new Map<string, number>();
  for await (const f of (dir as IterableDir).values()) {
    if (f.kind === 'file') existing.set(f.name, (await (f as FileSystemFileHandle).getFile()).size);
  }
  const photos = files.filter((f) => detectFormat(f.name) && !isIgnoredName(f.name));
  let added = 0;
  let skipped = files.length - photos.length;
  onProgress?.(0, photos.length);
  for (const [i, file] of photos.entries()) {
    const base = file.name.normalize('NFC').replace(/[\\/]/g, '_') || `foto_${i + 1}.jpg`;
    if (existing.get(base) === file.size) {
      skipped++;
    } else {
      let target = base;
      for (let n = 2; existing.has(target); n++) target = withSuffix(base, n);
      await writeCopy(dir, name, target, file);
      existing.set(target, file.size);
      added++;
    }
    onProgress?.(i + 1, photos.length);
  }
  return { source: new WebSourceDirectory(dir), added, skipped };
}
