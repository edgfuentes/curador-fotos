import { describe, expect, it } from 'vitest';
import {
  buildExportPlan,
  DEFAULT_EXPORT_OPTIONS,
  classify,
  classifyByFolder,
  DEFAULT_SECTORS,
  withSectors,
  emptyLibraryState,
  orderLibrary,
  prefixedName,
  prefixWidth,
  resolveCollision,
  sanitizeFolderName,
  setStatus,
  statusOf,
  utf8Encode,
} from '../src';
import { makePhoto } from './helpers';

describe('prefijo numérico', () => {
  it('usa 3 dígitos y crece si hay 1000 o más', () => {
    expect(prefixedName(1, 12, 'IMG_1234.HEIC')).toBe('001_IMG_1234.HEIC');
    expect(prefixedName(42, 999, 'a.jpg')).toBe('042_a.jpg');
    expect(prefixWidth(1000)).toBe(4);
    expect(prefixedName(7, 1500, 'a.jpg')).toBe('0007_a.jpg');
  });

  it('conserva el nombre original completo', () => {
    expect(prefixedName(3, 3, 'Foto final (editada).tiff')).toBe('003_Foto final (editada).tiff');
  });
});

describe('colisiones de nombres', () => {
  it('agrega (2), (3)… antes de la extensión', () => {
    const taken = new Set<string>();
    expect(resolveCollision('IMG_1.jpg', taken)).toBe('IMG_1.jpg');
    expect(resolveCollision('IMG_1.jpg', taken)).toBe('IMG_1 (2).jpg');
    expect(resolveCollision('IMG_1.jpg', taken)).toBe('IMG_1 (3).jpg');
  });

  it('no distingue mayúsculas ni formas Unicode (como macOS)', () => {
    const taken = new Set<string>();
    resolveCollision('Árbol.JPG', taken);
    expect(resolveCollision('Árbol.jpg', taken)).toBe('Árbol (2).jpg');
  });

  it('funciona con nombres sin extensión', () => {
    const taken = new Set<string>(['leeme']);
    expect(resolveCollision('LEEME', taken)).toBe('LEEME (2)');
  });

  it('limpia nombres de carpeta peligrosos', () => {
    expect(sanitizeFolderName('Sector 1/Norte: zona')).toBe('Sector 1-Norte- zona');
    expect(sanitizeFolderName('...')).toBe('Sin nombre');
  });
});

describe('plan de exportación', () => {
  const photos = [
    makePhoto('Sector 1/cam1/IMG_1.jpg', { time: '2026:11:21 10:00:01' }),
    makePhoto('Sector 1/cam2/IMG_1.jpg', { time: '2026:11:21 10:00:02' }),
    makePhoto('Sector 2/DSC_5.NEF', { time: '2026:11:21 09:00:00' }),
    makePhoto('Sector 2/DSC_6.NEF', { time: '2026:11:21 09:00:01' }),
  ];
  const byId = new Map(photos.map((p) => [p.id, p]));
  const lib = setStatus(classifyByFolder(emptyLibraryState(), photos), photos, 'marked');
  const ordered = orderLibrary(photos, lib, {});
  const ids = ordered.flat.filter((id) => statusOf(lib, id) === 'marked');

  it('por sector: subcarpetas y numeración que se reinicia en cada sector', () => {
    const plan = buildExportPlan(ids, byId, ordered.sectorById, DEFAULT_EXPORT_OPTIONS);
    expect(plan.items.map((i) => `${i.subfolder}/${i.targetName}`)).toEqual([
      'Sector 1/001_IMG_1.jpg',
      'Sector 1/002_IMG_1.jpg',
      'Sector 2/001_DSC_5.NEF',
      'Sector 2/002_DSC_6.NEF',
    ]);
    expect(plan.items.map((i) => i.order)).toEqual([1, 2, 3, 4]);
    expect(plan.subfolders).toEqual(['Sector 1', 'Sector 2']);
  });

  it('las carpetas siguen el orden de la lista de sectores y solo van las aprobadas', () => {
    const a = makePhoto('x/a.jpg', { time: '2026:11:21 10:00:00' });
    const b = makePhoto('x/b.jpg', { time: '2026:11:21 09:00:00' });
    const c = makePhoto('x/c.jpg', { time: '2026:11:21 08:00:00' });
    const all = [a, b, c];
    let l = withSectors(emptyLibraryState(), DEFAULT_SECTORS);
    l = classify(l, [a], 'Entrada');
    l = classify(l, [b, c], 'Banda');
    l = setStatus(setStatus(l, [a, b], 'marked'), [c], 'discarded');
    const o = orderLibrary(all, l, {});
    const approved = o.flat.filter((id) => statusOf(l, id) === 'marked');
    const plan = buildExportPlan(approved, new Map(all.map((p) => [p.id, p])), o.sectorById, DEFAULT_EXPORT_OPTIONS);
    expect(plan.items.map((i) => `${i.subfolder}/${i.targetName}`)).toEqual(['Entrada/001_a.jpg', 'Banda/001_b.jpg']);
  });

  it('sin prefijo: resuelve el choque de dos IMG_1.jpg de distintas cámaras', () => {
    const plan = buildExportPlan(ids, byId, ordered.sectorById, { ...DEFAULT_EXPORT_OPTIONS, numberPrefix: false });
    expect(plan.items.slice(0, 2).map((i) => i.targetName)).toEqual(['IMG_1.jpg', 'IMG_1 (2).jpg']);
  });

  it('sin subcarpetas: una sola secuencia global', () => {
    const plan = buildExportPlan(ids, byId, ordered.sectorById, { ...DEFAULT_EXPORT_OPTIONS, bySector: false });
    expect(plan.items.map((i) => i.targetName)).toEqual([
      '001_IMG_1.jpg',
      '002_IMG_1.jpg',
      '003_DSC_5.NEF',
      '004_DSC_6.NEF',
    ]);
    expect(plan.subfolders).toEqual([]);
  });

  it('nunca usa el nombre reservado manifest.json', () => {
    const m = makePhoto('manifest.json.jpg');
    const odd = { ...m, id: 'x/manifest.json', relativePath: 'x/manifest.json', fileName: 'manifest.json' };
    const plan = buildExportPlan([odd.id], new Map([[odd.id, odd]]), new Map(), {
      ...DEFAULT_EXPORT_OPTIONS,
      numberPrefix: false,
      bySector: false,
    });
    expect(plan.items[0]?.targetName).toBe('manifest (2).json');
  });
});

describe('utf8Encode', () => {
  it('codifica igual que TextEncoder', () => {
    const s = 'Sector Ñuñoa · 📷 ok';
    expect(Array.from(utf8Encode(s))).toEqual(Array.from(new TextEncoder().encode(s)));
  });
});
