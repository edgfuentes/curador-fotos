/**
 * Estado de la sesión de curación. Solo usa el core y los puertos (interfaces):
 * no sabe si los archivos vienen del navegador, de Capacitor o de Electron.
 */
import {
  assignSector,
  CancelledError,
  clampOffsetSeconds,
  commit,
  createHistory,
  DEFAULT_EXPORT_FOLDER,
  DEFAULT_FILTER,
  detectFormat,
  duplicateCandidates,
  emptyLibraryState,
  exactDuplicateGroups,
  extensionOf,
  fileCacheKey,
  classify,
  DEFAULT_SECTORS,
  NO_SECTOR,
  withSectors,
  moveInSector,
  nudgeInSector,
  orderLibrary,
  reconcileRecords,
  redo,
  resetManualOrder,
  setStatus,
  statusOf,
  toggleStatus,
  undo,
  addSector,
  type CameraSettings,
  type CurationStatus,
  type History,
  type LibraryState,
  type MetadataReader,
  type Photo,
  type PhotoFilter,
  type PhotoId,
  type PhotoMetadata,
  type SourceDirectory,
  type StorageAdapter,
} from '@curador/core';
import { derive } from './context';

export type Phase = 'home' | 'scanning' | 'ready';
/** Etapas del flujo: 1 el fotógrafo clasifica por sector, 2 un validador aprueba o rechaza. (3 exportar es un diálogo.) */
export type Stage = 'classify' | 'validate';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
}

export interface ScanProgress {
  step: 'files' | 'metadata' | 'library';
  found: number;
  done: number;
  total: number;
}

export interface DuplicateState {
  status: 'idle' | 'running' | 'done';
  checked: number;
  total: number;
  groups: PhotoId[][];
  ids: ReadonlySet<PhotoId>;
}

export interface SessionState {
  phase: Phase;
  stage: Stage;
  /** Sector que se está validando (null = todos). */
  validateSector: string | null;
  source: SourceDirectory | null;
  libraryId: string;
  scan: ScanProgress;
  photos: readonly Photo[];
  byId: ReadonlyMap<PhotoId, Photo>;
  history: History<LibraryState>;
  cameras: Readonly<Record<string, CameraSettings>>;
  filter: PhotoFilter;
  selection: ReadonlySet<PhotoId>;
  anchorId: PhotoId | null;
  focusId: PhotoId | null;
  view: 'grid' | 'review';
  zoom: boolean;
  /** Biblioteca al abrir la revisión: el filtro por estado se evalúa con ella para que las fotos no "desaparezcan" mientras se revisa. */
  reviewFilterLibrary: LibraryState | null;
  autoAdvance: boolean;
  tileSize: number;
  columns: number;
  duplicates: DuplicateState;
  dialog: null | 'help' | 'cameras' | 'export' | 'new-sector';
  /** Fotos que esperan el nombre del sector nuevo (diálogo «Nuevo sector»). */
  pendingAssign: readonly PhotoId[];
  /** Sectores abiertos en una ventana aparte. */
  sectorWindows: readonly string[];
  toasts: Toast[];
  demo: boolean;
  error: string | null;
}

const initialState = (): SessionState => ({
  phase: 'home',
  stage: 'classify',
  validateSector: null,
  source: null,
  libraryId: '',
  scan: { step: 'files', found: 0, done: 0, total: 0 },
  photos: [],
  byId: new Map(),
  history: createHistory(emptyLibraryState()),
  cameras: {},
  filter: DEFAULT_FILTER,
  selection: new Set(),
  anchorId: null,
  focusId: null,
  view: 'grid',
  zoom: false,
  reviewFilterLibrary: null,
  autoAdvance: true,
  tileSize: 200,
  columns: 1,
  duplicates: { status: 'idle', checked: 0, total: 0, groups: [], ids: new Set() },
  dialog: null,
  pendingAssign: [],
  sectorWindows: [],
  toasts: [],
  demo: false,
  error: null,
});

export interface Services {
  storage: StorageAdapter;
  metadata: MetadataReader & { hash(source: SourceDirectory, path: string, signal?: AbortSignal): Promise<string> };
}

type Listener = () => void;

export class SessionStore {
  private state: SessionState = initialState();
  private readonly listeners = new Set<Listener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dupAbort: AbortController | null = null;
  private scanAbort: AbortController | null = null;
  private toastId = 0;

  constructor(private readonly services: Services) {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => void this.flush());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.flush();
      });
    }
    void this.services.storage.loadPreference<Partial<Pick<SessionState, 'autoAdvance' | 'tileSize'>>>('ui').then((p) => {
      if (p) this.set({ ...(p.autoAdvance !== undefined ? { autoAdvance: p.autoAdvance } : {}), ...(p.tileSize ? { tileSize: p.tileSize } : {}) });
    });
  }

  // ------------------------------------------------------------ suscripción
  getState = (): SessionState => this.state;
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private set(patch: Partial<SessionState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  get library(): LibraryState {
    return this.state.history.present;
  }

  // ------------------------------------------------------------ avisos
  toast(text: string, tone: Toast['tone'] = 'info', ms = 3500): void {
    const id = ++this.toastId;
    this.set({ toasts: [...this.state.toasts, { id, text, tone }] });
    setTimeout(() => this.set({ toasts: this.state.toasts.filter((t) => t.id !== id) }), ms);
  }

  // ------------------------------------------------------------ apertura y escaneo
  async openSource(source: SourceDirectory, opts: { demo?: boolean } = {}): Promise<void> {
    await this.flush();
    this.dupAbort?.abort();
    this.scanAbort?.abort();
    const abort = new AbortController();
    this.scanAbort = abort;
    this.set({
      ...initialState(),
      autoAdvance: this.state.autoAdvance,
      tileSize: this.state.tileSize,
      phase: 'scanning',
      source,
      libraryId: source.name,
      demo: !!opts.demo,
    });
    try {
      const entries = await source.scan({
        signal: abort.signal,
        includeFile: (name) => detectFormat(name) !== undefined,
        // No volver a leer exportaciones anteriores que estén dentro del origen.
        includeDirectory: (name) => !name.startsWith(DEFAULT_EXPORT_FOLDER),
        onProgress: (found) => this.set({ scan: { step: 'files', found, done: 0, total: 0 } }),
      });
      const base: Photo[] = entries.map((e) => ({
        id: e.relativePath,
        relativePath: e.relativePath,
        fileName: e.fileName,
        folder: e.folder,
        size: e.size,
        lastModified: e.lastModified,
        format: detectFormat(e.fileName)!,
        extension: extensionOf(e.fileName),
      }));
      const keys = base.map((p) => fileCacheKey(p.relativePath, p.size, p.lastModified));
      const [cachedMeta, cachedHashes] = await Promise.all([
        this.services.storage.getCachedMetadata(keys).catch(() => new Map<string, PhotoMetadata>()),
        this.services.storage.getCachedHashes(keys).catch(() => new Map<string, string>()),
      ]);
      const metas: (PhotoMetadata | undefined)[] = keys.map((k) => cachedMeta.get(k));
      const missing = metas.map((m, i) => (m ? -1 : i)).filter((i) => i >= 0);
      let done = base.length - missing.length;
      this.set({ scan: { step: 'metadata', found: base.length, done, total: base.length } });

      const fresh = new Map<string, PhotoMetadata>();
      let lastEmit = 0;
      let next = 0;
      const worker = async () => {
        while (next < missing.length) {
          if (abort.signal.aborted) throw new CancelledError();
          const i = missing[next++]!;
          const p = base[i]!;
          const meta = await this.services.metadata.read(source, p).catch(() => ({}) as PhotoMetadata);
          metas[i] = meta;
          fresh.set(keys[i]!, meta);
          done++;
          if (fresh.size >= 200) {
            const batch = new Map(fresh);
            fresh.clear();
            void this.services.storage.putCachedMetadata(batch).catch(() => undefined);
          }
          const now = performance.now();
          if (now - lastEmit > 120) {
            lastEmit = now;
            this.set({ scan: { step: 'metadata', found: base.length, done, total: base.length } });
          }
        }
      };
      await Promise.all(Array.from({ length: 12 }, worker));
      if (fresh.size) void this.services.storage.putCachedMetadata(fresh).catch(() => undefined);

      const photos: Photo[] = base.map((p, i) => {
        const sha = cachedHashes.get(keys[i]!);
        return { ...p, ...(metas[i] ?? {}), ...(sha ? { sha256: sha } : {}) };
      });

      this.set({ scan: { step: 'library', found: photos.length, done: photos.length, total: photos.length } });
      const stored = (await this.services.storage.loadLibrary(source.name).catch(() => undefined)) ?? emptyLibraryState();
      const reconciled = reconcileRecords(stored, photos);
      const relinked = reconciled.relinked;
      const sectorList = (await this.services.storage.loadPreference<string[]>('sectors').catch(() => undefined)) ?? [...DEFAULT_SECTORS];
      const library = withSectors(reconciled.library, sectorList);
      const cameraList = await this.services.storage.loadCameraSettings().catch(() => [] as CameraSettings[]);
      const cameras = Object.fromEntries(cameraList.map((c) => [c.cameraId, c]));
      const first = orderLibrary(photos, library, cameras).flat[0] ?? null;
      this.set({
        phase: 'ready',
        photos,
        byId: new Map(photos.map((p) => [p.id, p])),
        history: createHistory(library),
        cameras,
        focusId: first,
        anchorId: first,
      });
      if (relinked > 0) {
        this.toast(`Se recuperaron ${relinked} marcas de fotos renombradas o movidas.`, 'info', 6000);
        this.scheduleSave();
      }
      if (photos.length === 0) this.toast('No se encontraron fotos compatibles en esta carpeta.', 'error', 6000);
      void this.detectDuplicates();
    } catch (err) {
      if (err instanceof CancelledError) return;
      console.error(err);
      this.set({ phase: 'home', error: `No se pudo leer la carpeta: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  closeSource(): void {
    void this.flush();
    this.dupAbort?.abort();
    this.scanAbort?.abort();
    this.set({ ...initialState(), autoAdvance: this.state.autoAdvance, tileSize: this.state.tileSize });
  }


  /** Duplicados exactos: solo se hashean archivos que comparten tamaño. */
  private async detectDuplicates(): Promise<void> {
    const source = this.state.source;
    if (!source) return;
    const abort = new AbortController();
    this.dupAbort = abort;
    const todo = duplicateCandidates(this.state.photos).filter((p) => !p.sha256);
    const finish = () => {
      const groups = exactDuplicateGroups(this.state.photos);
      this.set({
        duplicates: { status: 'done', checked: todo.length, total: todo.length, groups, ids: new Set(groups.flat()) },
      });
    };
    if (todo.length === 0) return finish();
    this.set({ duplicates: { ...this.state.duplicates, status: 'running', checked: 0, total: todo.length } });
    const hashes = new Map<PhotoId, string>();
    let checked = 0;
    let next = 0;
    const worker = async () => {
      while (next < todo.length && !abort.signal.aborted) {
        const p = todo[next++]!;
        try {
          const h = await this.services.metadata.hash(source, p.relativePath, abort.signal);
          hashes.set(p.id, h);
          void this.services.storage.putCachedHash(fileCacheKey(p.relativePath, p.size, p.lastModified), h);
        } catch {
          /* cancelado o ilegible */
        }
        checked++;
        if (checked % 10 === 0) this.set({ duplicates: { ...this.state.duplicates, checked } });
      }
    };
    await Promise.all([worker(), worker()]);
    if (abort.signal.aborted || this.state.source !== source) return;
    const photos = this.state.photos.map((p) => {
      const h = hashes.get(p.id);
      return h ? { ...p, sha256: h } : p;
    });
    this.set({ photos, byId: new Map(photos.map((p) => [p.id, p])) });
    finish();
  }

  // ------------------------------------------------------------ persistencia
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), 400);
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const { libraryId, phase } = this.state;
    if (!libraryId || phase !== 'ready') return;
    try {
      await this.services.storage.saveLibrary(libraryId, this.library);
    } catch (err) {
      console.error(err);
      this.toast('No se pudieron guardar las marcas en este navegador.', 'error');
    }
  }

  private apply(next: LibraryState): void {
    if (next === this.library) return;
    this.set({ history: commit(this.state.history, next) });
    this.scheduleSave();
  }

  undo(): void {
    if (!this.state.history.past.length) return this.toast('Nada que deshacer');
    this.set({ history: undo(this.state.history) });
    this.scheduleSave();
    this.toast('Deshecho');
  }

  redo(): void {
    if (!this.state.history.future.length) return;
    this.set({ history: redo(this.state.history) });
    this.scheduleSave();
    this.toast('Rehecho');
  }

  // ------------------------------------------------------------ curación
  /** Fotos sobre las que actúa un atajo: la selección en la cuadrícula o la foto enfocada. */
  targets(): Photo[] {
    const { selection, focusId, byId, view } = this.state;
    const ids = view === 'grid' && selection.size > 1 ? [...selection] : focusId ? [focusId] : [];
    return ids.map((id) => byId.get(id)).filter((p): p is Photo => !!p);
  }

  mark(status: Exclude<CurationStatus, 'pending'>, next?: PhotoId | null): void {
    const targets = this.targets();
    if (!targets.length) return;
    this.apply(toggleStatus(this.library, targets, status));
    if (next) this.focus(next);
  }

  setStatusFor(ids: readonly PhotoId[], status: CurationStatus): void {
    const photos = ids.map((id) => this.state.byId.get(id)).filter((p): p is Photo => !!p);
    this.apply(setStatus(this.library, photos, status));
  }

  resetStatus(): void {
    this.apply(setStatus(this.library, this.targets(), 'pending'));
  }

  statusOf(id: PhotoId): CurationStatus {
    return statusOf(this.library, id);
  }



  addSector(name: string): void {
    const clean = name.trim();
    if (!clean) return;
    this.apply(addSector(this.library, clean));
    // La lista de sectores se recuerda para las próximas carpetas.
    void this.services.storage.loadPreference<string[]>('sectors').then((list) => {
      const base = list ?? [...DEFAULT_SECTORS];
      if (!base.includes(clean)) void this.services.storage.savePreference('sectors', [...base, clean]);
    });
  }

  private photosOf(ids: readonly PhotoId[]): Photo[] {
    return ids.map((id) => this.state.byId.get(id)).filter((p): p is Photo => !!p);
  }

  /** Fotos sobre las que actúa la lista desplegable de una miniatura: toda la selección si la incluye. */
  targetsFor(id: PhotoId): PhotoId[] {
    const { selection } = this.state;
    return selection.size > 1 && selection.has(id) ? [...selection] : [id];
  }

  /** Etapa 1: asigna el sector (o lo quita con null). Cambiar de sector anula la validación anterior. */
  classify(sector: string | null, ids: readonly PhotoId[] = this.targets().map((p) => p.id), next?: PhotoId | null): void {
    const photos = this.photosOf(ids);
    if (!photos.length) return;
    const clean = sector?.trim() || null;
    if (clean && !this.library.extraSectors.includes(clean)) this.addSector(clean);
    this.apply(classify(this.library, photos, clean));
    if (photos.length > 1) this.toast(clean ? `${photos.length} fotos clasificadas en «${clean}»` : `${photos.length} fotos sin clasificar`, 'success');
    if (next) this.focus(next);
  }

  /** Etapa 2: aprueba (marked), rechaza (discarded) o devuelve a «por validar» (pending). */
  validate(status: CurationStatus, ids: readonly PhotoId[] = this.targets().map((p) => p.id), next?: PhotoId | null): void {
    const photos = this.photosOf(ids).filter((p) => this.sectorOfId(p.id) !== NO_SECTOR);
    if (!photos.length) return this.toast('Esta foto no tiene sector: clasifícala primero (etapa 1).');
    this.apply(setStatus(this.library, photos, status));
    if (next) this.focus(next);
  }

  private sectorOfId(id: PhotoId): string {
    return this.library.records[id]?.sector ?? NO_SECTOR;
  }

  /** Elección desde la lista desplegable de sector. */
  choose(ids: readonly PhotoId[], choice: { sector: string } | 'unclassified'): void {
    this.classify(choice === 'unclassified' ? null : choice.sector, ids);
  }

  /** Abre el diálogo para crear un sector y clasificar en él `ids` al confirmar. */
  askNewSector(ids: readonly PhotoId[]): void {
    this.set({ dialog: 'new-sector', pendingAssign: ids });
  }

  createSectorAndAssign(name: string): void {
    const clean = name.trim();
    const ids = this.state.pendingAssign;
    this.set({ dialog: null, pendingAssign: [] });
    if (!clean) return;
    if (ids.length) this.classify(clean, ids);
    else this.addSector(clean);
  }

  /** Quita fotos de su sector (vuelven a «sin clasificar»). */
  unclassify(ids: readonly PhotoId[]): void {
    this.classify(null, ids);
  }

  // ------------------------------------------------------------ etapas
  setStage(stage: Stage): void {
    if (stage === this.state.stage) return;
    this.set({
      stage,
      view: 'grid',
      zoom: false,
      reviewFilterLibrary: null,
      filter: DEFAULT_FILTER,
      selection: new Set(),
    });
    const first = derive(this.state).visible[0] ?? null;
    this.set({ focusId: first, anchorId: first, selection: first ? new Set([first]) : new Set() });
  }

  setValidateSector(sector: string | null): void {
    this.set({ validateSector: sector, filter: { ...this.state.filter, sector: null } });
    const first = derive(this.state).visible[0] ?? null;
    this.set({ focusId: first, anchorId: first, selection: first ? new Set([first]) : new Set() });
  }

  /** Etapa 2: abre un sector a pantalla completa en su primera foto por validar. */
  startValidation(sector: string | null): void {
    this.set({ stage: 'validate', validateSector: sector, filter: DEFAULT_FILTER, view: 'grid' });
    const { visible } = derive(this.state);
    const first = visible.find((id) => this.statusOf(id) === 'pending') ?? visible[0];
    if (!first) return this.toast('Este sector no tiene fotos clasificadas.');
    this.openReview(first);
  }

  openSectorWindow(sector: string): void {
    if (!this.state.sectorWindows.includes(sector)) this.set({ sectorWindows: [...this.state.sectorWindows, sector] });
  }

  closeSectorWindow(sector: string): void {
    this.set({ sectorWindows: this.state.sectorWindows.filter((s) => s !== sector) });
  }

  private sectorOrder(library: LibraryState, sector: string): readonly PhotoId[] {
    return orderLibrary(this.state.photos, library, this.state.cameras).sectors.find((s) => s.name === sector)?.photoIds ?? [];
  }

  /** Arrastrar y soltar: mueve `ids` antes/después de `targetId` (puede cambiar de sector). */
  moveTo(ids: readonly PhotoId[], targetId: PhotoId, position: 'before' | 'after'): void {
    const order = orderLibrary(this.state.photos, this.library, this.state.cameras);
    const targetSector = order.sectorById.get(targetId);
    if (!targetSector || ids.length === 0) return;
    let lib = this.library;
    const foreign = ids.filter((id) => order.sectorById.get(id) !== targetSector);
    if (foreign.length) {
      lib = assignSector(lib, foreign.map((id) => this.state.byId.get(id)!).filter(Boolean), targetSector);
    }
    lib = moveInSector(lib, targetSector, this.sectorOrder(lib, targetSector), ids, targetId, position);
    this.apply(lib);
  }

  nudge(delta: -1 | 1, ids: readonly PhotoId[] = this.targets().map((p) => p.id)): void {
    if (!ids.length) return;
    const order = orderLibrary(this.state.photos, this.library, this.state.cameras);
    const sector = order.sectorById.get(ids[0]!);
    if (!sector) return;
    const sameSector = ids.filter((id) => order.sectorById.get(id) === sector);
    const current = order.sectors.find((s) => s.name === sector)?.photoIds ?? [];
    this.apply(nudgeInSector(this.library, sector, current, sameSector, delta));
  }

  resetOrder(sector: string): void {
    this.apply(resetManualOrder(this.library, sector));
    this.toast(`Orden de «${sector}» restablecido por fecha de captura`);
  }

  // ------------------------------------------------------------ cámaras
  async updateCamera(cameraId: string, patch: { label?: string; offsetSeconds?: number }): Promise<void> {
    const prev = this.state.cameras[cameraId] ?? { cameraId, offsetSeconds: 0 };
    const next: CameraSettings = {
      ...prev,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.offsetSeconds !== undefined ? { offsetSeconds: clampOffsetSeconds(patch.offsetSeconds) } : {}),
    };
    this.set({ cameras: { ...this.state.cameras, [cameraId]: next } });
    await this.services.storage.saveCameraSettings(next).catch(() => this.toast('No se pudo guardar el ajuste', 'error'));
  }

  // ------------------------------------------------------------ navegación y selección
  focus(id: PhotoId | null, opts: { select?: 'replace' | 'toggle' | 'range' | 'keep'; visible?: readonly PhotoId[] } = {}): void {
    if (!id) return;
    const mode = opts.select ?? 'replace';
    let selection = this.state.selection;
    let anchorId = this.state.anchorId;
    if (mode === 'replace') {
      selection = new Set([id]);
      anchorId = id;
    } else if (mode === 'toggle') {
      const s = new Set(selection);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      selection = s;
      anchorId = id;
    } else if (mode === 'range' && opts.visible) {
      const a = opts.visible.indexOf(anchorId ?? id);
      const b = opts.visible.indexOf(id);
      if (a >= 0 && b >= 0) selection = new Set(opts.visible.slice(Math.min(a, b), Math.max(a, b) + 1));
    }
    this.set({ focusId: id, selection, anchorId });
  }

  selectAll(ids: readonly PhotoId[]): void {
    this.set({ selection: new Set(ids) });
  }

  clearSelection(): void {
    const { focusId } = this.state;
    this.set({ selection: focusId ? new Set([focusId]) : new Set() });
  }

  openReview(id?: PhotoId, zoom = false): void {
    const focusId = id ?? this.state.focusId;
    if (!focusId) return;
    this.set({ view: 'review', focusId, zoom, reviewFilterLibrary: this.library, selection: new Set([focusId]), anchorId: focusId });
  }

  closeReview(): void {
    this.set({ view: 'grid', zoom: false, reviewFilterLibrary: null });
  }

  setZoom(zoom: boolean): void {
    this.set({ zoom });
  }

  setFilter(patch: Partial<PhotoFilter>): void {
    this.set({ filter: { ...this.state.filter, ...patch } });
  }

  setDialog(dialog: SessionState['dialog']): void {
    this.set({ dialog });
  }

  setColumns(columns: number): void {
    if (columns !== this.state.columns) this.set({ columns });
  }

  setUi(patch: Partial<Pick<SessionState, 'autoAdvance' | 'tileSize'>>): void {
    this.set(patch);
    void this.services.storage.savePreference('ui', { autoAdvance: this.state.autoAdvance, tileSize: this.state.tileSize });
  }

  loadPreference<T>(key: string): Promise<T | undefined> {
    return this.services.storage.loadPreference<T>(key).catch(() => undefined);
  }

  savePreference<T>(key: string, value: T): Promise<void> {
    return this.services.storage.savePreference(key, value).catch(() => undefined);
  }

  setError(error: string | null): void {
    this.set({ error });
  }
}
