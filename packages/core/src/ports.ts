/**
 * Puertos (interfaces) que cada plataforma implementa con sus adaptadores.
 * Hoy: navegador (File System Access API + IndexedDB + Web Workers) y Node (pruebas).
 * Mañana: Capacitor, React Native, Electron… sin tocar el core ni las pantallas.
 */
import type { CameraSettings, LibraryState, Photo, PhotoMetadata } from './model';

/** Subconjunto de AbortSignal (compatible con navegador y Node) para no depender de la plataforma. */
export interface CancelSignal {
  readonly aborted: boolean;
  addEventListener?(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener?(type: 'abort', listener: () => void): void;
}

export class CancelledError extends Error {
  constructor() {
    super('Operación cancelada');
    this.name = 'CancelledError';
  }
}

export function throwIfCancelled(signal?: CancelSignal): void {
  if (signal?.aborted) throw new CancelledError();
}

/** Acceso de SOLO LECTURA al contenido de un archivo. */
export interface ByteSource {
  readonly size: number;
  stream(): AsyncIterable<Uint8Array>;
  /** Lectura aleatoria (para metadatos o vistas previas incrustadas). */
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface SourceFileEntry {
  /** Ruta relativa con "/" en forma NFC. */
  readonly relativePath: string;
  readonly fileName: string;
  readonly folder: string;
  readonly size: number;
  readonly lastModified: number;
}

export interface ScanOptions {
  readonly signal?: CancelSignal;
  /** Se llama periódicamente con el número de archivos encontrados. */
  readonly onProgress?: (found: number) => void;
  /** Devuelve false para no entrar en una carpeta (p. ej. la carpeta de exportación). */
  readonly includeDirectory?: (name: string, relativePath: string) => boolean;
  /** Devuelve false para ignorar un archivo. */
  readonly includeFile?: (name: string) => boolean;
}

/**
 * Carpeta de origen. A propósito NO expone ningún método de escritura:
 * los originales jamás se modifican, mueven ni borran.
 */
export interface SourceDirectory {
  readonly name: string;
  scan(options?: ScanOptions): Promise<SourceFileEntry[]>;
  openFile(relativePath: string): Promise<ByteSource>;
}

/** Carpeta de destino (donde se crea "Para subir a redes"). */
export interface DestinationDirectory {
  readonly name: string;
  /** Obtiene o crea una subcarpeta. */
  getDirectory(name: string, options: { create: boolean }): Promise<DestinationDirectory>;
  listEntryNames(): Promise<string[]>;
  /**
   * Escribe un archivo nuevo de forma atómica: si falla o se cancela,
   * no debe quedar un archivo a medio escribir.
   */
  writeFile(name: string, data: AsyncIterable<Uint8Array>, signal?: CancelSignal): Promise<void>;
  openFile(name: string): Promise<ByteSource>;
  removeEntry(name: string): Promise<void>;
}

/** Referencia a la última carpeta usada (para "Continuar con la última carpeta"). */
export interface RememberedSource {
  readonly name: string;
  /** Pide permiso de nuevo (requiere un gesto del usuario en el navegador). */
  reopen(): Promise<SourceDirectory | null>;
}

export interface FileSystemAdapter {
  readonly platform: string;
  isSupported(): boolean;
  /** Abre el selector de carpeta de origen (solo lectura). null si el usuario cancela. */
  pickSourceDirectory(): Promise<SourceDirectory | null>;
  getRememberedSource(): Promise<RememberedSource | null>;
  /** Abre el selector de carpeta de destino (lectura/escritura). */
  pickDestinationDirectory(): Promise<DestinationDirectory | null>;
  /** true si `destination` está dentro de `source` (evita mezclar exportaciones con originales). */
  isInside(source: SourceDirectory, destination: DestinationDirectory): Promise<boolean>;
}

export interface IncrementalHasher {
  update(chunk: Uint8Array): void;
  /** SHA-256 en hexadecimal minúsculas. */
  digestHex(): string;
}

export type HasherFactory = () => Promise<IncrementalHasher>;

/** Persistencia local de marcas, ajustes y cachés. */
export interface StorageAdapter {
  loadLibrary(libraryId: string): Promise<LibraryState | undefined>;
  saveLibrary(libraryId: string, state: LibraryState): Promise<void>;
  loadCameraSettings(): Promise<CameraSettings[]>;
  saveCameraSettings(settings: CameraSettings): Promise<void>;
  loadPreference<T>(key: string): Promise<T | undefined>;
  savePreference<T>(key: string, value: T): Promise<void>;
  /** Caché de metadatos por clave de archivo (ruta + tamaño + fecha de modificación). */
  getCachedMetadata(keys: readonly string[]): Promise<Map<string, PhotoMetadata>>;
  putCachedMetadata(entries: ReadonlyMap<string, PhotoMetadata>): Promise<void>;
  getCachedHashes(keys: readonly string[]): Promise<Map<string, string>>;
  putCachedHash(key: string, sha256: string): Promise<void>;
  clearCaches(): Promise<void>;
}

export interface MetadataReader {
  read(source: SourceDirectory, photo: Pick<Photo, 'relativePath' | 'format' | 'extension'>): Promise<PhotoMetadata>;
}

/** Tamaños de vista: miniatura (cuadrícula), media (revisión) y completa (zoom 100 %). */
export type ViewSize = 'grid' | 'preview' | 'full';

export interface ImageRef {
  /** URL utilizable por la interfaz (object URL en navegador, file:// en nativo). */
  readonly url: string;
  readonly width: number;
  readonly height: number;
  release(): void;
}

export interface ThumbnailRequest {
  readonly signal?: CancelSignal;
  /** Mayor = antes. */
  readonly priority?: number;
}

export interface ThumbnailAdapter {
  /** Devuelve una vista generada localmente, o null si el formato no se puede previsualizar. */
  get(source: SourceDirectory, photo: Photo, size: ViewSize, request?: ThumbnailRequest): Promise<ImageRef | null>;
  clearCache(): Promise<void>;
}
