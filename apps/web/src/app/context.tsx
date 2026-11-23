import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import {
  countBySector,
  filterBySource,
  filterOrdered,
  groupBySource,
  NO_SECTOR,
  orderLibrary,
  type FileSystemAdapter,
  type HasherFactory,
  type OrderedLibrary,
  type PhotoGroup,
  type PhotoId,
  type FilteredSection,
  type StatusCounts,
  type ThumbnailAdapter,
} from '@curador/core';
import type { SessionState, SessionStore } from './store';

/** Adaptadores de plataforma inyectados en la interfaz (hoy: navegador). */
export interface Platform {
  readonly fileSystem: FileSystemAdapter;
  readonly thumbnails: ThumbnailAdapter;
  readonly createHasher: HasherFactory;
  readonly clearCaches: () => Promise<void>;
}

interface Ctx {
  platform: Platform;
  store: SessionStore;
}

const AppContext = createContext<Ctx | null>(null);

export function AppProvider({ platform, store, children }: Ctx & { children: ReactNode }) {
  const value = useMemo(() => ({ platform, store }), [platform, store]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function useCtx(): Ctx {
  const c = useContext(AppContext);
  if (!c) throw new Error('AppProvider no encontrado');
  return c;
}

export const usePlatform = () => useCtx().platform;
export const useStoreApi = () => useCtx().store;

export function useSession<T>(selector: (s: SessionState) => T): T {
  const store = useStoreApi();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

// ------------------------------------------------------------------ derivados memorizados

function memo<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | null = null;
  let last: R;
  return (...args: A) => {
    if (lastArgs && args.length === lastArgs.length && args.every((a, i) => a === lastArgs![i])) return last;
    lastArgs = args;
    last = fn(...args);
    return last;
  };
}

export interface Derived {
  /** Orden final por sector (lo que se exporta). */
  ordered: OrderedLibrary;
  /**
   * Fotos en pantalla según la etapa:
   * - clasificar: por carpeta de origen (no se mueven al asignarles sector);
   * - validar: por sector, en el orden de exportación.
   */
  sections: FilteredSection[];
  visible: PhotoId[];
  /** Contadores de estado por sector (incluye «Sin clasificar»). */
  counts: { bySector: Map<string, StatusCounts>; total: StatusCounts };
  /** Por carpeta de origen: total de fotos y cuántas ya tienen sector. */
  folderStats: Map<string, { total: number; classified: number }>;
  /** Sectores a los que se puede asignar una foto, en orden (las teclas 1–9 usan este orden). */
  sectorNames: string[];
  /** Fotos sin sector. */
  unclassified: number;
}

const orderedSel = memo(orderLibrary);
const orderedFilterSel = memo(orderLibrary);
const sourceSel = memo(groupBySource);
const classifySectionsSel = memo(filterBySource);
const validateSectionsSel = memo(
  (ordered: OrderedLibrary, byId: SessionState['byId'], library: SessionState['history']['present'], filter: SessionState['filter'], sector: string | null, dups: ReadonlySet<PhotoId>) =>
    filterOrdered(ordered, byId, library, { ...filter, folder: null, sector }, dups).filter((s) => s.sector !== NO_SECTOR),
);
const visibleSel = memo((sections: FilteredSection[]) => sections.flatMap((s) => s.photoIds));
const countsSel = memo(countBySector);
const folderStatsSel = memo((groups: readonly PhotoGroup[], ordered: OrderedLibrary) => {
  const m = new Map<string, { total: number; classified: number }>();
  for (const g of groups) {
    let classified = 0;
    for (const id of g.photoIds) if (ordered.sectorById.get(id) !== NO_SECTOR) classified++;
    m.set(g.name, { total: g.photoIds.length, classified });
  }
  return m;
});
const sectorNamesSel = memo((ordered: OrderedLibrary) => ordered.sectors.filter((s) => s.name !== NO_SECTOR).map((s) => s.name));

function compute(s: SessionState): Derived {
  const library = s.history.present;
  const ordered = orderedSel(s.photos, library, s.cameras);
  const source: PhotoGroup[] = sourceSel(s.photos, s.cameras);
  // Al revisar a pantalla completa, el filtro se evalúa con la biblioteca del momento en que se abrió,
  // para que las fotos no desaparezcan mientras se trabaja.
  const filterLib = s.reviewFilterLibrary ?? library;
  const filterOrder = s.reviewFilterLibrary ? orderedFilterSel(s.photos, filterLib, s.cameras) : ordered;
  const sections =
    s.stage === 'classify'
      ? classifySectionsSel(source, s.byId, filterLib, s.filter, s.duplicates.ids, filterOrder.sectorById)
      : validateSectionsSel(filterOrder, s.byId, filterLib, s.filter, s.validateSector, s.duplicates.ids);
  const counts = countsSel(ordered, library);
  return {
    ordered,
    sections,
    visible: visibleSel(sections),
    counts,
    folderStats: folderStatsSel(source, ordered),
    sectorNames: sectorNamesSel(ordered),
    unclassified: counts.bySector.get(NO_SECTOR)?.total ?? 0,
  };
}

export function derive(s: SessionState): Derived {
  return compute(s);
}

export function useDerived(): Derived {
  // Las funciones memorizadas devuelven la misma referencia si nada cambió.
  const ordered = useSession((s) => compute(s).ordered);
  const sections = useSession((s) => compute(s).sections);
  const counts = useSession((s) => compute(s).counts);
  const folderStats = useSession((s) => compute(s).folderStats);
  const sectorNames = useSession((s) => compute(s).sectorNames);
  const unclassified = useSession((s) => compute(s).unclassified);
  return { ordered, sections, visible: visibleSel(sections), counts, folderStats, sectorNames, unclassified };
}
