import { UNKNOWN_CAMERA_ID } from './capture';
import { statusOf } from './curation';
import type { OrderedLibrary } from './ordering';
import type { CurationStatus, LibraryState, Photo, PhotoId } from './model';

export interface PhotoFilter {
  /** null = todos los sectores. */
  readonly sector: string | null;
  /** null = todas las cámaras. UNKNOWN_CAMERA_ID = fotos sin datos de cámara. */
  readonly cameraId: string | null;
  readonly status: CurationStatus | 'all';
  readonly duplicatesOnly: boolean;
}

export const DEFAULT_FILTER: PhotoFilter = { sector: null, cameraId: null, status: 'all', duplicatesOnly: false };

export function cameraIdOf(photo: Photo): string {
  return photo.camera?.id ?? UNKNOWN_CAMERA_ID;
}

export interface FilteredSection {
  readonly sector: string;
  readonly photoIds: readonly PhotoId[];
}

/** Aplica el filtro manteniendo el orden final y la agrupación por sector. */
export function filterOrdered(
  ordered: OrderedLibrary,
  byId: ReadonlyMap<PhotoId, Photo>,
  library: LibraryState,
  filter: PhotoFilter,
  duplicates?: ReadonlySet<PhotoId>,
): FilteredSection[] {
  const out: FilteredSection[] = [];
  for (const group of ordered.sectors) {
    if (filter.sector !== null && group.name !== filter.sector) continue;
    const ids = group.photoIds.filter((id) => {
      const p = byId.get(id);
      if (!p) return false;
      if (filter.cameraId !== null && cameraIdOf(p) !== filter.cameraId) return false;
      if (filter.status !== 'all' && statusOf(library, id) !== filter.status) return false;
      if (filter.duplicatesOnly && !duplicates?.has(id)) return false;
      return true;
    });
    if (ids.length > 0 || filter.sector === group.name) out.push({ sector: group.name, photoIds: ids });
  }
  return out;
}

export interface StatusCounts {
  total: number;
  pending: number;
  marked: number;
  discarded: number;
}

const emptyCounts = (): StatusCounts => ({ total: 0, pending: 0, marked: 0, discarded: 0 });

/** Contadores por sector y totales. */
export function countBySector(
  ordered: OrderedLibrary,
  library: LibraryState,
): { bySector: Map<string, StatusCounts>; total: StatusCounts } {
  const bySector = new Map<string, StatusCounts>();
  const total = emptyCounts();
  for (const g of ordered.sectors) {
    const c = emptyCounts();
    for (const id of g.photoIds) {
      const s = statusOf(library, id);
      c.total++;
      c[s]++;
      total.total++;
      total[s]++;
    }
    bySector.set(g.name, c);
  }
  return { bySector, total };
}

export interface CameraGroup {
  readonly cameraId: string;
  readonly camera?: Photo['camera'];
  readonly count: number;
  /** Primera y última hora de reloj (sin desfase) para ayudar a calibrar. */
  readonly firstMs?: number;
  readonly lastMs?: number;
  readonly samplePhotoId: PhotoId;
}

export function groupByCamera(photos: readonly Photo[]): CameraGroup[] {
  const map = new Map<string, { camera?: Photo['camera']; count: number; first?: number; last?: number; sample: PhotoId }>();
  for (const p of photos) {
    const id = cameraIdOf(p);
    let g = map.get(id);
    if (!g) map.set(id, (g = p.camera ? { camera: p.camera, count: 0, sample: p.id } : { count: 0, sample: p.id }));
    g.count++;
    const t = p.capture?.wallClockMs;
    if (t !== undefined) {
      if (g.first === undefined || t < g.first) g.first = t;
      if (g.last === undefined || t > g.last) g.last = t;
    }
  }
  return [...map.entries()]
    .map(([cameraId, g]) => {
      const base: CameraGroup = { cameraId, count: g.count, samplePhotoId: g.sample };
      return {
        ...base,
        ...(g.camera ? { camera: g.camera } : {}),
        ...(g.first !== undefined ? { firstMs: g.first } : {}),
        ...(g.last !== undefined ? { lastMs: g.last } : {}),
      };
    })
    .sort((a, b) => b.count - a.count);
}

// -------------------------------------------------------------- duplicados

/** Solo archivos con el mismo tamaño pueden ser duplicados exactos: estos son los que vale la pena hashear. */
export function duplicateCandidates(photos: readonly Photo[]): Photo[] {
  const bySize = new Map<number, Photo[]>();
  for (const p of photos) {
    const list = bySize.get(p.size);
    if (list) list.push(p);
    else bySize.set(p.size, [p]);
  }
  return [...bySize.values()].filter((l) => l.length > 1).flat();
}

/** Grupos de duplicados exactos (mismo SHA-256), solo los que tienen 2 o más archivos. */
export function exactDuplicateGroups(photos: readonly Photo[]): PhotoId[][] {
  const byHash = new Map<string, PhotoId[]>();
  for (const p of photos) {
    if (!p.sha256) continue;
    const list = byHash.get(p.sha256);
    if (list) list.push(p.id);
    else byHash.set(p.sha256, [p.id]);
  }
  return [...byHash.values()].filter((g) => g.length > 1);
}
