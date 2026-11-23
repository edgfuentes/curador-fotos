import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import {
  countBySector,
  countGroups,
  filterBySource,
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
  /** Vista de curación: fotos por carpeta de origen, filtradas. No cambian de lugar al asignarlas. */
  sections: FilteredSection[];
  visible: PhotoId[];
  /** Contadores por sector asignado (panel derecho y exportación). */
  counts: { bySector: Map<string, StatusCounts>; total: StatusCounts };
  /** Contadores por carpeta de origen (cuadrícula y filtro lateral). */
  folderCounts: { bySector: Map<string, StatusCounts>; total: StatusCounts };
  /** Sectores a los que se puede asignar una foto, en orden (las teclas 1–9 usan este orden). */
  sectorNames: string[];
}

const orderedSel = memo(orderLibrary);
const sourceSel = memo(groupBySource);
const sectionsSel = memo(filterBySource);
const visibleSel = memo((sections: FilteredSection[]) => sections.flatMap((s) => s.photoIds));
const countsSel = memo(countBySector);
const folderCountsSel = memo(countGroups);
const sectorNamesSel = memo((ordered: OrderedLibrary, counts: { bySector: Map<string, StatusCounts> }) =>
  ordered.sectors.filter((s) => s.name !== NO_SECTOR || (counts.bySector.get(s.name)?.marked ?? 0) > 0).map((s) => s.name),
);

function compute(s: SessionState) {
  const library = s.history.present;
  const ordered = orderedSel(s.photos, library, s.cameras);
  const source: PhotoGroup[] = sourceSel(s.photos, s.cameras);
  const sections = sectionsSel(source, s.byId, s.reviewFilterLibrary ?? library, s.filter, s.duplicates.ids);
  const counts = countsSel(ordered, library);
  return {
    ordered,
    sections,
    visible: visibleSel(sections),
    counts,
    folderCounts: folderCountsSel(source, library),
    sectorNames: sectorNamesSel(ordered, counts),
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
  const folderCounts = useSession((s) => compute(s).folderCounts);
  const sectorNames = useSession((s) => compute(s).sectorNames);
  return { ordered, sections, visible: visibleSel(sections), counts, folderCounts, sectorNames };
}
