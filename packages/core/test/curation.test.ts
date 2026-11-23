import { describe, expect, it } from 'vitest';
import {
  assignSector,
  commit,
  countBySector,
  createHistory,
  DEFAULT_FILTER,
  detectFormat,
  duplicateCandidates,
  emptyLibraryState,
  exactDuplicateGroups,
  filterOrdered,
  isIgnoredName,
  moveInSector,
  normalizeRelativePath,
  nudgeInSector,
  orderLibrary,
  reconcileRecords,
  redo,
  setStatus,
  statusOf,
  toggleStatus,
  undo,
} from '../src';
import { makePhoto } from './helpers';

describe('formatos y nombres', () => {
  it('detecta formatos soportados, incluidos RAW', () => {
    expect(detectFormat('IMG_1.JPG')).toBe('jpeg');
    expect(detectFormat('IMG_1.HEIC')).toBe('heic');
    expect(detectFormat('DSC_1.NEF')).toBe('raw');
    expect(detectFormat('a.CR3')).toBe('raw');
    expect(detectFormat('a.tif')).toBe('tiff');
    expect(detectFormat('video.MOV')).toBeUndefined();
  });

  it('ignora archivos ocultos y AppleDouble de tarjetas', () => {
    expect(isIgnoredName('._IMG_0001.JPG')).toBe(true);
    expect(isIgnoredName('.DS_Store')).toBe(true);
    expect(isIgnoredName('IMG_0001.JPG')).toBe(false);
  });

  it('normaliza rutas a NFC con "/"', () => {
    const nfd = 'Séctor 1\\foto.jpg';
    expect(normalizeRelativePath(nfd)).toBe('Séctor 1/foto.jpg');
  });
});

describe('estados de curación', () => {
  const a = makePhoto('S1/a.jpg');
  const b = makePhoto('S1/b.jpg');

  it('marca, descarta y vuelve a pendiente', () => {
    let lib = setStatus(emptyLibraryState(), [a], 'marked', 1);
    expect(statusOf(lib, a.id)).toBe('marked');
    lib = setStatus(lib, [a], 'discarded', 2);
    expect(statusOf(lib, a.id)).toBe('discarded');
    lib = setStatus(lib, [a], 'pending', 3);
    expect(statusOf(lib, a.id)).toBe('pending');
    expect(lib.records[a.id]).toBeUndefined(); // no guarda registros vacíos
  });

  it('pulsar marcar dos veces desmarca', () => {
    let lib = toggleStatus(emptyLibraryState(), [a, b], 'marked');
    expect(statusOf(lib, b.id)).toBe('marked');
    lib = toggleStatus(lib, [a, b], 'marked');
    expect(statusOf(lib, a.id)).toBe('pending');
  });

  it('guarda una huella (nombre + tamaño + fecha) para reconocer el archivo', () => {
    const lib = setStatus(emptyLibraryState(), [a], 'marked', 1);
    expect(lib.records[a.id]?.fingerprint).toEqual({ fileName: 'a.jpg', size: 1000, lastModified: 0 });
  });

  it('deshacer y rehacer', () => {
    let h = createHistory(emptyLibraryState());
    h = commit(h, setStatus(h.present, [a], 'marked'));
    h = commit(h, setStatus(h.present, [a], 'discarded'));
    expect(statusOf(h.present, a.id)).toBe('discarded');
    h = undo(h);
    expect(statusOf(h.present, a.id)).toBe('marked');
    h = undo(h);
    expect(statusOf(h.present, a.id)).toBe('pending');
    h = undo(h); // sin efecto
    h = redo(h);
    expect(statusOf(h.present, a.id)).toBe('marked');
  });
});

describe('sectores y orden manual', () => {
  const p1 = makePhoto('Sector 1/1.jpg', { time: '2026:11:21 10:00:01' });
  const p2 = makePhoto('Sector 1/2.jpg', { time: '2026:11:21 10:00:02' });
  const p3 = makePhoto('Sector 1/3.jpg', { time: '2026:11:21 10:00:03' });
  const q1 = makePhoto('Sector 2/1.jpg', { time: '2026:11:21 09:00:00' });
  const all = [p1, p2, p3, q1];

  it('asignación manual de sector', () => {
    const lib = assignSector(emptyLibraryState(), [q1], 'Sector 1');
    const order = orderLibrary(all, lib, {});
    expect(order.sectors.find((s) => s.name === 'Sector 1')?.photoIds).toEqual([q1.id, p1.id, p2.id, p3.id]);
    // Volver al sector de su carpeta
    const back = assignSector(lib, [q1], null);
    expect(back.records[q1.id]).toBeUndefined();
  });

  it('arrastrar y soltar fija el orden manual', () => {
    const current = [p1.id, p2.id, p3.id];
    const lib = moveInSector(emptyLibraryState(), 'Sector 1', current, [p3.id], p1.id, 'before');
    expect(lib.manualOrder['Sector 1']).toEqual([p3.id, p1.id, p2.id]);
    const lib2 = moveInSector(lib, 'Sector 1', lib.manualOrder['Sector 1']!, [p3.id], p2.id, 'after');
    expect(lib2.manualOrder['Sector 1']).toEqual([p1.id, p2.id, p3.id]);
  });

  it('mover varias fotos conserva su orden relativo', () => {
    const current = [p1.id, p2.id, p3.id, 'x'];
    const lib = moveInSector(emptyLibraryState(), 'S', current, [p3.id, p1.id], 'x', 'after');
    expect(lib.manualOrder['S']).toEqual([p2.id, 'x', p1.id, p3.id]);
  });

  it('Alt+flecha desplaza una posición', () => {
    const current = [p1.id, p2.id, p3.id];
    const lib = nudgeInSector(emptyLibraryState(), 'S', current, [p2.id], -1);
    expect(lib.manualOrder['S']).toEqual([p2.id, p1.id, p3.id]);
    const same = nudgeInSector(lib, 'S', lib.manualOrder['S']!, [p2.id], -1);
    expect(same).toBe(lib); // ya está primera
  });

  it('filtros y contador de marcadas por sector', () => {
    const lib = setStatus(setStatus(emptyLibraryState(), [p1, p3], 'marked'), [q1], 'discarded');
    const order = orderLibrary(all, lib, {});
    const counts = countBySector(order, lib);
    expect(counts.bySector.get('Sector 1')).toEqual({ total: 3, pending: 1, marked: 2, discarded: 0 });
    expect(counts.total.marked).toBe(2);
    const byId = new Map(all.map((p) => [p.id, p]));
    const marked = filterOrdered(order, byId, lib, { ...DEFAULT_FILTER, status: 'marked' });
    expect(marked.flatMap((s) => s.photoIds)).toEqual([p1.id, p3.id]);
  });
});

describe('reconciliación de marcas y duplicados', () => {
  it('recupera la marca de un archivo renombrado/movido por su huella', () => {
    const old = makePhoto('Viejo/IMG_1.jpg', { size: 42, lastModified: 7 });
    const moved = makePhoto('Nuevo/IMG_1.jpg', { size: 42, lastModified: 7 });
    const lib = setStatus(emptyLibraryState(), [old], 'marked');
    const r = reconcileRecords(lib, [moved]);
    expect(r.relinked).toBe(1);
    expect(statusOf(r.library, moved.id)).toBe('marked');
  });

  it('usa el SHA-256 si está disponible', () => {
    const old = makePhoto('a.jpg', { sha256: 'abc', size: 1 });
    const renamed = makePhoto('b.jpg', { sha256: 'abc', size: 1, lastModified: 99 });
    const r = reconcileRecords(setStatus(emptyLibraryState(), [old], 'discarded'), [renamed]);
    expect(statusOf(r.library, renamed.id)).toBe('discarded');
  });

  it('solo hashea candidatos con tamaño repetido y agrupa duplicados exactos', () => {
    const photos = [
      makePhoto('a.jpg', { size: 10, sha256: 'h1' }),
      makePhoto('b.jpg', { size: 10, sha256: 'h1' }),
      makePhoto('c.jpg', { size: 10, sha256: 'h2' }),
      makePhoto('d.jpg', { size: 11 }),
    ];
    expect(duplicateCandidates(photos).map((p) => p.id)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(exactDuplicateGroups(photos)).toEqual([['a.jpg', 'b.jpg']]);
  });
});
