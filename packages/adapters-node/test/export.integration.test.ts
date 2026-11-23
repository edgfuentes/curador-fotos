/**
 * Prueba de integración de la exportación: archivos reales en disco, copia byte
 * a byte, verificación SHA-256, manifest.json y garantía de que los originales
 * no cambian.
 */
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildExportPlan,
  DEFAULT_EXPORT_OPTIONS,
  detectFormat,
  emptyLibraryState,
  extensionOf,
  orderLibrary,
  parseExifDateTime,
  runExport,
  setStatus,
  statusOf,
  type DestinationDirectory,
  type ExportManifest,
  type LibraryState,
  type Photo,
} from '@curador/core';
import { NodeDestinationDirectory, NodeSourceDirectory, nodeHasher } from '../src';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

let tmp: string;
let srcDir: string;
let dstDir: string;

const FILES: Record<string, { bytes: number; time: string }> = {
  'Sector 1/IMG_0002.JPG': { bytes: 300_000, time: '2026:11:21 10:00:02' },
  'Sector 1/IMG_0001.JPG': { bytes: 2_500_000, time: '2026:11:21 10:00:01' },
  'Sector 1/canon/IMG_0001.JPG': { bytes: 1234, time: '2026:11:21 10:00:03' }, // mismo nombre, otra cámara
  'Sector 2/DSC_0100.NEF': { bytes: 5_000_000, time: '2026:11:21 09:00:00' },
  'Sector 2/descartada.heic': { bytes: 1000, time: '2026:11:21 09:30:00' },
};

async function scanPhotos(source: NodeSourceDirectory): Promise<Photo[]> {
  const entries = await source.scan({ includeFile: (n) => !!detectFormat(n) });
  return entries.map((e) => {
    const capture = parseExifDateTime(FILES[e.relativePath]?.time);
    return {
      id: e.relativePath,
      relativePath: e.relativePath,
      fileName: e.fileName,
      folder: e.folder,
      size: e.size,
      lastModified: e.lastModified,
      format: detectFormat(e.fileName)!,
      extension: extensionOf(e.fileName),
      ...(capture ? { capture } : {}),
    };
  });
}

async function snapshotOriginals(): Promise<Record<string, { hash: string; mtime: number }>> {
  const out: Record<string, { hash: string; mtime: number }> = {};
  for (const rel of Object.keys(FILES)) {
    const p = path.join(srcDir, rel);
    out[rel] = { hash: sha(await fs.readFile(p)), mtime: (await fs.stat(p)).mtimeMs };
  }
  return out;
}

function prepare(photos: Photo[]): { lib: LibraryState; ids: string[]; sectorById: ReadonlyMap<string, string> } {
  let lib = setStatus(emptyLibraryState(), photos, 'marked');
  lib = setStatus(lib, photos.filter((p) => p.fileName === 'descartada.heic'), 'discarded');
  const ordered = orderLibrary(photos, lib, {});
  return { lib, ids: ordered.flat.filter((id) => statusOf(lib, id) === 'marked'), sectorById: ordered.sectorById };
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'curador-'));
  srcDir = path.join(tmp, 'origen');
  dstDir = path.join(tmp, 'destino');
  await fs.mkdir(dstDir, { recursive: true });
  for (const [rel, { bytes }] of Object.entries(FILES)) {
    const p = path.join(srcDir, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, randomBytes(bytes));
  }
  // Archivo AppleDouble que debe ignorarse
  await fs.writeFile(path.join(srcDir, 'Sector 1', '._IMG_0001.JPG'), 'basura');
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('exportación (integración)', () => {
  it('copia los originales byte a byte, verificados con SHA-256, en orden y con manifest', async () => {
    const before = await snapshotOriginals();
    const source = new NodeSourceDirectory(srcDir);
    const photos = await scanPhotos(source);
    expect(photos).toHaveLength(5); // el archivo ._ se ignoró
    const { ids, sectorById } = prepare(photos);
    const plan = buildExportPlan(ids, new Map(photos.map((p) => [p.id, p])), sectorById, DEFAULT_EXPORT_OPTIONS);

    const progress: number[] = [];
    const summary = await runExport({
      plan,
      source,
      destination: new NodeDestinationDirectory(dstDir),
      createHasher: nodeHasher,
      photos: new Map(photos.map((p) => [p.id, p])),
      cameraSettings: {},
      onProgress: (p) => progress.push(p.bytesDone),
      now: () => new Date('2026-11-23T12:00:00Z'),
    });

    expect(summary).toMatchObject({ total: 4, copied: 4, verified: 4, failed: 0, cancelled: false, manifestWritten: true });
    expect(summary.folderName).toBe('Para subir a redes');

    const out = path.join(dstDir, 'Para subir a redes');
    expect((await fs.readdir(path.join(out, 'Sector 1'))).sort()).toEqual([
      '001_IMG_0001.JPG',
      '002_IMG_0002.JPG',
      '003_IMG_0001.JPG',
    ]);
    expect(await fs.readdir(path.join(out, 'Sector 2'))).toEqual(['001_DSC_0100.NEF']);

    // Cada copia es idéntica al original (verificación independiente).
    const pairs: [string, string][] = [
      ['Sector 1/001_IMG_0001.JPG', 'Sector 1/IMG_0001.JPG'],
      ['Sector 1/002_IMG_0002.JPG', 'Sector 1/IMG_0002.JPG'],
      ['Sector 1/003_IMG_0001.JPG', 'Sector 1/canon/IMG_0001.JPG'],
      ['Sector 2/001_DSC_0100.NEF', 'Sector 2/DSC_0100.NEF'],
    ];
    for (const [copy, original] of pairs) {
      const a = await fs.readFile(path.join(out, copy));
      const b = await fs.readFile(path.join(srcDir, original));
      expect(Buffer.compare(a, b)).toBe(0);
    }

    // manifest.json
    const manifest = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf8')) as ExportManifest;
    expect(manifest.exportedAt).toBe('2026-11-23T12:00:00.000Z');
    expect(manifest.items.map((i) => [i.order, i.exportedPath, i.originalPath])).toEqual([
      [1, 'Sector 1/001_IMG_0001.JPG', 'Sector 1/IMG_0001.JPG'],
      [2, 'Sector 1/002_IMG_0002.JPG', 'Sector 1/IMG_0002.JPG'],
      [3, 'Sector 1/003_IMG_0001.JPG', 'Sector 1/canon/IMG_0001.JPG'],
      [4, 'Sector 2/001_DSC_0100.NEF', 'Sector 2/DSC_0100.NEF'],
    ]);
    for (const item of manifest.items) {
      expect(item.status).toBe('verified');
      expect(item.sha256).toBe(before[item.originalPath]!.hash);
    }

    // Los originales no cambiaron (contenido ni fecha de modificación).
    expect(await snapshotOriginals()).toEqual(before);
    // El progreso es monótono y termina en el total (copiar + verificar).
    expect(progress.at(-1)).toBe(plan.totalBytes * 2);
    expect(progress.every((v, i) => i === 0 || v >= progress[i - 1]!)).toBe(true);
  });

  it('nunca sobrescribe una exportación anterior: crea "Para subir a redes (2)"', async () => {
    const source = new NodeSourceDirectory(srcDir);
    const photos = await scanPhotos(source);
    const { ids, sectorById } = prepare(photos);
    const plan = buildExportPlan(ids, new Map(photos.map((p) => [p.id, p])), sectorById, {
      ...DEFAULT_EXPORT_OPTIONS,
      bySector: false,
    });
    const args = {
      plan,
      source,
      destination: new NodeDestinationDirectory(dstDir),
      createHasher: nodeHasher,
      photos: new Map(photos.map((p) => [p.id, p])),
      cameraSettings: {},
    };
    await runExport(args);
    const second = await runExport(args);
    expect(second.folderName).toBe('Para subir a redes (2)');
    expect((await fs.readdir(dstDir)).sort()).toEqual(['Para subir a redes', 'Para subir a redes (2)']);
  });

  it('detecta una copia corrupta, la elimina y la informa como error', async () => {
    const source = new NodeSourceDirectory(srcDir);
    const photos = await scanPhotos(source);
    const { ids, sectorById } = prepare(photos);
    const plan = buildExportPlan(ids, new Map(photos.map((p) => [p.id, p])), sectorById, DEFAULT_EXPORT_OPTIONS);

    // Destino defectuoso: altera un byte de cada archivo .NEF al escribirlo.
    const corrupt = (dir: DestinationDirectory): DestinationDirectory => ({
      name: dir.name,
      getDirectory: async (n, o) => corrupt(await dir.getDirectory(n, o)),
      listEntryNames: () => dir.listEntryNames(),
      openFile: (n) => dir.openFile(n),
      removeEntry: (n) => dir.removeEntry(n),
      writeFile: (n, data, s) =>
        dir.writeFile(
          n,
          (async function* () {
            let first = true;
            for await (const c of data) {
              if (first && n.endsWith('.NEF')) {
                const copy = new Uint8Array(c);
                copy[10] = copy[10]! ^ 0xff;
                yield copy;
              } else yield c;
              first = false;
            }
          })(),
          s,
        ),
    });

    const summary = await runExport({
      plan,
      source,
      destination: corrupt(new NodeDestinationDirectory(dstDir)),
      createHasher: nodeHasher,
      photos: new Map(photos.map((p) => [p.id, p])),
      cameraSettings: {},
    });
    expect(summary.verified).toBe(3);
    expect(summary.failed).toBe(1);
    const failed = summary.results.find((r) => r.outcome.status === 'failed');
    expect(failed?.item.sourcePath).toBe('Sector 2/DSC_0100.NEF');
    expect(await fs.readdir(path.join(dstDir, 'Para subir a redes', 'Sector 2'))).toEqual([]);
  });

  it('permite cancelar: no deja archivos a medio copiar', async () => {
    const source = new NodeSourceDirectory(srcDir);
    const photos = await scanPhotos(source);
    const { ids, sectorById } = prepare(photos);
    const plan = buildExportPlan(ids, new Map(photos.map((p) => [p.id, p])), sectorById, DEFAULT_EXPORT_OPTIONS);
    const controller = new AbortController();
    const summary = await runExport({
      plan,
      source,
      destination: new NodeDestinationDirectory(dstDir),
      createHasher: nodeHasher,
      photos: new Map(photos.map((p) => [p.id, p])),
      cameraSettings: {},
      signal: controller.signal,
      onProgress: (p) => {
        // Cancelar en mitad del segundo archivo (2,5 MB → varios bloques).
        if (p.phase === 'copying' && p.index === 1 && p.bytesDone > 1_000_000) controller.abort();
      },
    });
    expect(summary.cancelled).toBe(true);
    expect(summary.verified).toBe(0);
    expect(summary.skipped).toBe(4);
    const files = await fs.readdir(path.join(dstDir, 'Para subir a redes', 'Sector 1'));
    expect(files).toEqual([]); // ni el archivo parcial ni temporales
  });
});
