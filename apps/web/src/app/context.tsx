import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import {
  countBySector,
  filterOrdered,
  orderLibrary,
  type FileSystemAdapter,
  type HasherFactory,
  type OrderedLibrary,
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
  ordered: OrderedLibrary;
  sections: FilteredSection[];
  visible: PhotoId[];
  counts: { bySector: Map<string, StatusCounts>; total: StatusCounts };
}

const orderedSel = memo(orderLibrary);
const sectionsSel = memo(filterOrdered);
const visibleSel = memo((sections: FilteredSection[]) => sections.flatMap((s) => s.photoIds));
const countsSel = memo(countBySector);

export function derive(s: SessionState): Derived {
  const library = s.history.present;
  const ordered = orderedSel(s.photos, library, s.cameras);
  const sections = sectionsSel(ordered, s.byId, s.reviewFilterLibrary ?? library, s.filter, s.duplicates.ids);
  return { ordered, sections, visible: visibleSel(sections), counts: countsSel(ordered, library) };
}

export function useDerived(): Derived {
  // Las funciones memorizadas devuelven la misma referencia si nada cambió.
  const ordered = useSession((s) => orderedSel(s.photos, s.history.present, s.cameras));
  const sections = useSession((s) =>
    sectionsSel(orderedSel(s.photos, s.history.present, s.cameras), s.byId, s.reviewFilterLibrary ?? s.history.present, s.filter, s.duplicates.ids),
  );
  const counts = useSession((s) => countsSel(orderedSel(s.photos, s.history.present, s.cameras), s.history.present));
  return { ordered, sections, visible: visibleSel(sections), counts };
}
