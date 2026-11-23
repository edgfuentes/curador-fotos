import { effectiveCaptureMs } from './capture';
import { naturalCompare } from './files';
import type { CameraSettings, LibraryState, Photo, PhotoId } from './model';

/** Grupo de las fotos que todavía no tienen sector (etapa 1: clasificar). */
export const NO_SECTOR = 'Sin clasificar';

/** Nombre del grupo de fotos que están directamente en la carpeta de origen. */
export const ROOT_FOLDER = 'Carpeta principal';

/** Sectores con los que empieza la app; el fotógrafo puede agregar más. */
export const DEFAULT_SECTORS: readonly string[] = ['Entrada', 'Banda', 'Congregación', 'Otros'];

/** Carpeta de origen de una foto: su primera subcarpeta (solo para agrupar en pantalla). */
export function folderSector(photo: Pick<Photo, 'folder'>): string {
  if (!photo.folder) return ROOT_FOLDER;
  const first = photo.folder.split('/')[0];
  return first && first.trim() ? first : ROOT_FOLDER;
}

/** Sector de una foto: el que le asignó el fotógrafo, o «Sin clasificar». */
export function sectorOf(photo: Pick<Photo, 'id'>, library: LibraryState): string {
  return library.records[photo.id]?.sector ?? NO_SECTOR;
}

/** Orden natural ("Sector 2" < "Sector 10"); «Sin clasificar» y la carpeta principal al final. */
export function compareSectors(a: string, b: string): number {
  if (a === b) return 0;
  for (const last of [NO_SECTOR, ROOT_FOLDER]) {
    if (a === last) return 1;
    if (b === last) return -1;
  }
  return naturalCompare(a, b);
}

/** Orden de los sectores: el de la lista de sectores; los demás en orden natural; «Sin clasificar» al final. */
export function sectorComparator(list: readonly string[]): (a: string, b: string) => number {
  return (a, b) => {
    const ia = list.indexOf(a);
    const ib = list.indexOf(b);
    if (a !== NO_SECTOR && b !== NO_SECTOR && (ia >= 0 || ib >= 0)) {
      if (ia < 0) return 1;
      if (ib < 0) return -1;
      return ia - ib;
    }
    return compareSectors(a, b);
  };
}

export type TimeLookup = (id: PhotoId) => number | undefined;

/**
 * Comparador automático: por hora efectiva de captura (EXIF + desfase de cámara).
 * Las fotos sin fecha EXIF van después, en orden natural por nombre.
 * Nunca se usa la fecha de modificación del archivo.
 */
export function makeAutoComparator(
  byId: ReadonlyMap<PhotoId, Photo>,
  time: TimeLookup,
): (a: PhotoId, b: PhotoId) => number {
  return (a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (ta !== undefined && tb !== undefined && ta !== tb) return ta - tb;
    if (ta !== undefined && tb === undefined) return -1;
    if (ta === undefined && tb !== undefined) return 1;
    const pa = byId.get(a);
    const pb = byId.get(b);
    const byName = naturalCompare(pa?.fileName ?? a, pb?.fileName ?? b);
    return byName !== 0 ? byName : naturalCompare(a, b);
  };
}

/**
 * Combina el orden manual guardado con las fotos que no están en él.
 * El orden manual se respeta siempre; las fotos nuevas se intercalan según el
 * comparador automático (como en una mezcla de dos listas).
 */
export function mergeManualOrder(
  autoSorted: readonly PhotoId[],
  manual: readonly PhotoId[] | undefined,
  compare: (a: PhotoId, b: PhotoId) => number,
): PhotoId[] {
  if (!manual || manual.length === 0) return [...autoSorted];
  const present = new Set(autoSorted);
  const seen = new Set<PhotoId>();
  const fixed: PhotoId[] = [];
  for (const id of manual) {
    if (present.has(id) && !seen.has(id)) {
      fixed.push(id);
      seen.add(id);
    }
  }
  const rest = autoSorted.filter((id) => !seen.has(id));
  const out: PhotoId[] = [];
  let i = 0;
  let j = 0;
  while (i < fixed.length && j < rest.length) {
    if (compare(rest[j]!, fixed[i]!) < 0) out.push(rest[j++]!);
    else out.push(fixed[i++]!);
  }
  while (i < fixed.length) out.push(fixed[i++]!);
  while (j < rest.length) out.push(rest[j++]!);
  return out;
}

/** Grupo con nombre y fotos en orden. */
export interface PhotoGroup {
  readonly name: string;
  readonly photoIds: readonly PhotoId[];
}

export interface SectorGroup extends PhotoGroup {
  /** true si el sector tiene un orden manual guardado. */
  readonly hasManualOrder: boolean;
}

export interface OrderedLibrary {
  readonly sectors: readonly SectorGroup[];
  /** Todas las fotos en el orden final (sector por sector). */
  readonly flat: readonly PhotoId[];
  readonly sectorById: ReadonlyMap<PhotoId, string>;
  readonly timeById: ReadonlyMap<PhotoId, number | undefined>;
}

/** Calcula el orden final de toda la biblioteca, agrupado por sector. */
export function orderLibrary(
  photos: readonly Photo[],
  library: LibraryState,
  cameraSettings: Readonly<Record<string, CameraSettings>>,
): OrderedLibrary {
  const byId = new Map<PhotoId, Photo>();
  const timeById = new Map<PhotoId, number | undefined>();
  const sectorById = new Map<PhotoId, string>();
  const groups = new Map<string, PhotoId[]>();
  for (const p of photos) {
    byId.set(p.id, p);
    timeById.set(p.id, effectiveCaptureMs(p, cameraSettings));
    const sector = sectorOf(p, library);
    sectorById.set(p.id, sector);
    let g = groups.get(sector);
    if (!g) groups.set(sector, (g = []));
    g.push(p.id);
  }
  for (const s of library.extraSectors) if (!groups.has(s)) groups.set(s, []);

  const compare = makeAutoComparator(byId, (id) => timeById.get(id));
  const names = [...groups.keys()].sort(sectorComparator(library.extraSectors));
  const sectors: SectorGroup[] = names.map((name) => {
    const auto = [...groups.get(name)!].sort(compare);
    const manual = library.manualOrder[name];
    return {
      name,
      photoIds: mergeManualOrder(auto, manual, compare),
      hasManualOrder: !!manual && manual.length > 0,
    };
  });
  return { sectors, flat: sectors.flatMap((s) => s.photoIds), sectorById, timeById };
}

/**
 * Fotos agrupadas por su carpeta de origen (primera subcarpeta), cada grupo por hora de captura.
 * No depende de las marcas ni del sector asignado: es la vista estable para curar,
 * donde las fotos no cambian de lugar al asignarlas a un sector.
 */
export function groupBySource(
  photos: readonly Photo[],
  cameraSettings: Readonly<Record<string, CameraSettings>>,
): PhotoGroup[] {
  const byId = new Map<PhotoId, Photo>();
  const timeById = new Map<PhotoId, number | undefined>();
  const groups = new Map<string, PhotoId[]>();
  for (const p of photos) {
    byId.set(p.id, p);
    timeById.set(p.id, effectiveCaptureMs(p, cameraSettings));
    const name = folderSector(p);
    let g = groups.get(name);
    if (!g) groups.set(name, (g = []));
    g.push(p.id);
  }
  const compare = makeAutoComparator(byId, (id) => timeById.get(id));
  return [...groups.keys()].sort(compareSectors).map((name) => ({ name, photoIds: [...groups.get(name)!].sort(compare) }));
}
