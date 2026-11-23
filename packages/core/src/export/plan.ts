import { compareSectors } from '../ordering';
import type { Photo, PhotoId } from '../model';
import { prefixedName, resolveCollision, sanitizeFolderName } from './naming';

export const DEFAULT_EXPORT_FOLDER = 'Para subir a redes';

export interface ExportOptions {
  /** Nombre de la carpeta principal que se crea en el destino. */
  readonly baseFolderName: string;
  /** Agrega 001_, 002_… al inicio del nombre original. */
  readonly numberPrefix: boolean;
  /** Crea una subcarpeta por sector. La numeración se reinicia en cada subcarpeta. */
  readonly bySector: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  baseFolderName: DEFAULT_EXPORT_FOLDER,
  numberPrefix: true,
  bySector: true,
};

export interface ExportPlanItem {
  readonly photoId: PhotoId;
  readonly sourcePath: string;
  readonly sector: string;
  /** Subcarpeta dentro de la carpeta de exportación ("" = raíz de la exportación). */
  readonly subfolder: string;
  readonly targetName: string;
  /** Posición global (1…n) en el orden final. */
  readonly order: number;
  /** Posición dentro de su carpeta (1…n), la que lleva el prefijo. */
  readonly orderInFolder: number;
  readonly size: number;
}

export interface ExportPlan {
  readonly options: ExportOptions;
  readonly items: readonly ExportPlanItem[];
  readonly subfolders: readonly string[];
  readonly totalBytes: number;
}

/**
 * Construye el plan de exportación a partir de las fotos ya ordenadas.
 * `orderedIds` debe venir en el orden final (sector por sector) y contener
 * solo lo que se va a exportar.
 */
export function buildExportPlan(
  orderedIds: readonly PhotoId[],
  byId: ReadonlyMap<PhotoId, Photo>,
  sectorById: ReadonlyMap<PhotoId, string>,
  options: ExportOptions,
): ExportPlan {
  const photos = orderedIds.map((id) => {
    const p = byId.get(id);
    if (!p) throw new Error(`Foto desconocida en el plan de exportación: ${id}`);
    return p;
  });

  // Agrupar por carpeta destino conservando el orden.
  const folders = new Map<string, { sector: string; photos: Photo[] }>();
  const folderNameBySector = new Map<string, string>();
  const takenFolders = new Set<string>();
  for (const p of photos) {
    const sector = sectorById.get(p.id) ?? '';
    let folder = '';
    if (options.bySector) {
      folder = folderNameBySector.get(sector) ?? '';
      if (!folderNameBySector.has(sector)) {
        folder = resolveCollision(sanitizeFolderName(sector), takenFolders);
        folderNameBySector.set(sector, folder);
      }
    }
    let f = folders.get(folder);
    if (!f) folders.set(folder, (f = { sector, photos: [] }));
    f.photos.push(p);
  }

  const items: ExportPlanItem[] = [];
  let order = 0;
  const orderedFolders = [...folders.entries()];
  if (options.bySector) orderedFolders.sort((a, b) => compareSectors(a[1].sector, b[1].sector));
  for (const [subfolder, group] of orderedFolders) {
    const taken = new Set<string>(['manifest.json']);
    const count = group.photos.length;
    group.photos.forEach((p, i) => {
      const base = options.numberPrefix ? prefixedName(i + 1, count, p.fileName) : p.fileName;
      items.push({
        photoId: p.id,
        sourcePath: p.relativePath,
        sector: sectorById.get(p.id) ?? '',
        subfolder,
        targetName: resolveCollision(base, taken),
        order: ++order,
        orderInFolder: i + 1,
        size: p.size,
      });
    });
  }
  return {
    options,
    items,
    subfolders: orderedFolders.map(([f]) => f).filter(Boolean),
    totalBytes: items.reduce((s, it) => s + it.size, 0),
  };
}
