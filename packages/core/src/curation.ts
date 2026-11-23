import { naturalCompare } from './files';
import { folderSector, NO_SECTOR, ROOT_FOLDER } from './ordering';
import type { CurationRecord, CurationStatus, LibraryState, Photo, PhotoId } from './model';

export function statusOf(library: LibraryState, id: PhotoId): CurationStatus {
  return library.records[id]?.status ?? 'pending';
}

function fingerprintOf(photo: Photo): CurationRecord['fingerprint'] {
  return photo.sha256
    ? { fileName: photo.fileName, size: photo.size, lastModified: photo.lastModified, sha256: photo.sha256 }
    : { fileName: photo.fileName, size: photo.size, lastModified: photo.lastModified };
}

/** Escribe (o elimina, si queda vacío) el registro de una foto. */
function upsert(
  records: Record<PhotoId, CurationRecord>,
  photo: Photo,
  patch: { status?: CurationStatus; sector?: string | null },
  now: number,
): void {
  const prev = records[photo.id];
  const status = patch.status ?? prev?.status ?? 'pending';
  const sector = patch.sector === null ? undefined : (patch.sector ?? prev?.sector);
  if (status === 'pending' && sector === undefined) {
    delete records[photo.id];
    return;
  }
  const rec: CurationRecord = { status, fingerprint: fingerprintOf(photo), updatedAt: now };
  records[photo.id] = sector === undefined ? rec : { ...rec, sector };
}

/** Fija el estado de varias fotos. */
export function setStatus(
  library: LibraryState,
  photos: readonly Photo[],
  status: CurationStatus,
  now = Date.now(),
): LibraryState {
  if (photos.length === 0) return library;
  const records = { ...library.records };
  for (const p of photos) upsert(records, p, { status }, now);
  return { ...library, records };
}

/**
 * Alterna un estado: si TODAS las fotos ya lo tienen, vuelven a "pendiente";
 * si no, todas pasan a ese estado. (Pulsar "P" dos veces desmarca.)
 */
export function toggleStatus(
  library: LibraryState,
  photos: readonly Photo[],
  status: Exclude<CurationStatus, 'pending'>,
  now = Date.now(),
): LibraryState {
  const all = photos.length > 0 && photos.every((p) => statusOf(library, p.id) === status);
  return setStatus(library, photos, all ? 'pending' : status, now);
}

/**
 * Asigna un sector (o `null` para dejarla «sin clasificar»).
 * Las fotos se quitan del orden manual de su sector anterior.
 */
export function assignSector(
  library: LibraryState,
  photos: readonly Photo[],
  sector: string | null,
  now = Date.now(),
): LibraryState {
  if (photos.length === 0) return library;
  const records = { ...library.records };
  const moving = new Set(photos.map((p) => p.id));
  for (const p of photos) {
    upsert(records, p, { sector }, now);
  }
  const manualOrder: Record<string, readonly PhotoId[]> = {};
  for (const [name, ids] of Object.entries(library.manualOrder)) {
    if (name === sector) {
      manualOrder[name] = ids;
      continue;
    }
    const kept = ids.filter((id) => !moving.has(id));
    if (kept.length) manualOrder[name] = kept;
  }
  const extraSectors =
    sector !== null && !library.extraSectors.includes(sector) ? [...library.extraSectors, sector] : library.extraSectors;
  return { ...library, records, manualOrder, extraSectors };
}

/**
 * Etapa 1 (clasificar): asigna el sector. Si una foto cambia de sector, su
 * validación anterior deja de valer y vuelve a «por validar».
 */
export function classify(
  library: LibraryState,
  photos: readonly Photo[],
  sector: string | null,
  now = Date.now(),
): LibraryState {
  if (photos.length === 0) return library;
  const changed = photos.filter((p) => (library.records[p.id]?.sector ?? null) !== sector);
  if (changed.length === 0) return library;
  return setStatus(assignSector(library, changed, sector, now), changed, 'pending', now);
}

/**
 * Clasifica por subcarpeta: cada foto sin sector recibe el nombre de su primera
 * subcarpeta (útil si las fotos ya vienen separadas en «Entrada/», «Banda/»…).
 */
export function classifyByFolder(library: LibraryState, photos: readonly Photo[], now = Date.now()): LibraryState {
  const groups = new Map<string, Photo[]>();
  for (const p of photos) {
    if (library.records[p.id]?.sector !== undefined) continue;
    const folder = folderSector(p);
    if (folder === ROOT_FOLDER) continue;
    const list = groups.get(folder);
    if (list) list.push(p);
    else groups.set(folder, [p]);
  }
  let lib = library;
  const names = [...groups.keys()].sort(naturalCompare);
  for (const sector of names) lib = classify(lib, groups.get(sector)!, sector, now);
  return lib;
}

/** Asegura que la biblioteca tenga los sectores de la lista (en ese orden, al principio). */
export function withSectors(library: LibraryState, list: readonly string[]): LibraryState {
  const merged = [...list, ...library.extraSectors.filter((s) => !list.includes(s))];
  if (merged.length === library.extraSectors.length && merged.every((s, i) => s === library.extraSectors[i])) return library;
  return { ...library, extraSectors: merged };
}

/**
 * Cambia el nombre de un sector (p. ej. para corregir un error al escribirlo).
 * Las fotos conservan su validación y su orden manual: es el mismo sector.
 * Devuelve la misma biblioteca si el nombre nuevo está vacío o ya existe.
 */
export function renameSector(library: LibraryState, from: string, to: string): LibraryState {
  const name = to.trim();
  if (!name || name === from || from === NO_SECTOR || name === NO_SECTOR) return library;
  if (!library.extraSectors.includes(from) || library.extraSectors.includes(name)) return library;
  const records: Record<PhotoId, CurationRecord> = {};
  for (const [id, r] of Object.entries(library.records)) records[id] = r.sector === from ? { ...r, sector: name } : r;
  const manualOrder: Record<string, readonly PhotoId[]> = {};
  for (const [k, v] of Object.entries(library.manualOrder)) manualOrder[k === from ? name : k] = v;
  return {
    ...library,
    records,
    manualOrder,
    extraSectors: library.extraSectors.map((s) => (s === from ? name : s)),
  };
}

export function addSector(library: LibraryState, name: string): LibraryState {
  const clean = name.trim();
  if (!clean || library.extraSectors.includes(clean)) return library;
  return { ...library, extraSectors: [...library.extraSectors, clean] };
}

/**
 * Mueve fotos dentro del orden de un sector, antes o después de `targetId`.
 * `currentOrder` es el orden visible del sector (ya combinado manual + automático);
 * el resultado se guarda completo como orden manual, que desde ese momento prevalece.
 */
export function moveInSector(
  library: LibraryState,
  sector: string,
  currentOrder: readonly PhotoId[],
  movingIds: readonly PhotoId[],
  targetId: PhotoId | null,
  position: 'before' | 'after',
): LibraryState {
  const moving = new Set(movingIds);
  // Mantener el orden relativo de las fotos movidas según el orden actual.
  const movingOrdered = [
    ...currentOrder.filter((id) => moving.has(id)),
    ...movingIds.filter((id) => !currentOrder.includes(id)),
  ];
  const rest = currentOrder.filter((id) => !moving.has(id));
  let index: number;
  if (targetId === null || moving.has(targetId)) {
    index = targetId === null ? (position === 'before' ? 0 : rest.length) : findAnchor(currentOrder, moving, targetId, rest);
  } else {
    const t = rest.indexOf(targetId);
    index = t < 0 ? rest.length : position === 'before' ? t : t + 1;
  }
  const next = [...rest.slice(0, index), ...movingOrdered, ...rest.slice(index)];
  if (sameOrder(next, currentOrder)) return library;
  return { ...library, manualOrder: { ...library.manualOrder, [sector]: next } };
}

function findAnchor(order: readonly PhotoId[], moving: Set<PhotoId>, target: PhotoId, rest: PhotoId[]): number {
  // Soltar sobre una foto que también se mueve: dejar el bloque donde estaba su primera foto.
  const at = order.indexOf(target);
  for (let i = at - 1; i >= 0; i--) {
    const id = order[i]!;
    if (!moving.has(id)) return rest.indexOf(id) + 1;
  }
  return 0;
}

/** Desplaza fotos una posición (Alt+← / Alt+→). */
export function nudgeInSector(
  library: LibraryState,
  sector: string,
  currentOrder: readonly PhotoId[],
  ids: readonly PhotoId[],
  delta: -1 | 1,
): LibraryState {
  const moving = new Set(ids);
  const positions = currentOrder.map((id, i) => (moving.has(id) ? i : -1)).filter((i) => i >= 0);
  if (positions.length === 0) return library;
  if (delta < 0) {
    const first = positions[0]!;
    if (first === 0) return library;
    return moveInSector(library, sector, currentOrder, ids, currentOrder[first - 1]!, 'before');
  }
  const last = positions[positions.length - 1]!;
  if (last === currentOrder.length - 1) return library;
  return moveInSector(library, sector, currentOrder, ids, currentOrder[last + 1]!, 'after');
}

/** Borra el orden manual de un sector (vuelve al orden por fecha EXIF). */
export function resetManualOrder(library: LibraryState, sector: string): LibraryState {
  if (!library.manualOrder[sector]) return library;
  const manualOrder = { ...library.manualOrder };
  delete manualOrder[sector];
  return { ...library, manualOrder };
}

function sameOrder(a: readonly PhotoId[], b: readonly PhotoId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

// ------------------------------------------------------------------ historial

export interface History<T> {
  readonly present: T;
  readonly past: readonly T[];
  readonly future: readonly T[];
}

export const HISTORY_LIMIT = 200;

export function createHistory<T>(present: T): History<T> {
  return { present, past: [], future: [] };
}

/** Registra un nuevo estado (si cambió). */
export function commit<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  return { present: next, past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return h;
  return { present: prev, past: h.past.slice(0, -1), future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (next === undefined) return h;
  return { present: next, past: [...h.past, h.present], future: h.future.slice(1) };
}

// ------------------------------------------------------------- reconciliación

/**
 * Al reabrir una carpeta, recupera marcas de fotos cuya ruta cambió (renombradas
 * o movidas): busca registros huérfanos con el mismo SHA-256 o, si no hay hash,
 * con el mismo nombre + tamaño + fecha de modificación (coincidencia única).
 */
export function reconcileRecords(
  library: LibraryState,
  photos: readonly Photo[],
): { library: LibraryState; relinked: number; orphaned: number } {
  const ids = new Set(photos.map((p) => p.id));
  const orphans = Object.entries(library.records).filter(([id]) => !ids.has(id));
  if (orphans.length === 0) return { library, relinked: 0, orphaned: 0 };

  const byHash = new Map<string, string[]>();
  const byFp = new Map<string, string[]>();
  const fpKey = (f: { fileName: string; size: number; lastModified: number }) =>
    `${f.fileName.normalize('NFC')}|${f.size}|${f.lastModified}`;
  for (const [id, rec] of orphans) {
    if (rec.fingerprint.sha256) push(byHash, rec.fingerprint.sha256, id);
    push(byFp, fpKey(rec.fingerprint), id);
  }
  const records = { ...library.records };
  const renames = new Map<PhotoId, PhotoId>();
  const used = new Set<string>();
  for (const p of photos) {
    if (records[p.id]) continue;
    const candidates = (p.sha256 && byHash.get(p.sha256)) || byFp.get(fpKey(p));
    if (!candidates) continue;
    const free = candidates.filter((c) => !used.has(c));
    if (free.length !== 1) continue;
    const old = free[0]!;
    used.add(old);
    records[p.id] = records[old]!;
    delete records[old];
    renames.set(old, p.id);
  }
  if (renames.size === 0) return { library, relinked: 0, orphaned: orphans.length };
  const manualOrder: Record<string, readonly PhotoId[]> = {};
  for (const [s, list] of Object.entries(library.manualOrder)) manualOrder[s] = list.map((id) => renames.get(id) ?? id);
  return {
    library: { ...library, records, manualOrder },
    relinked: renames.size,
    orphaned: orphans.length - renames.size,
  };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
