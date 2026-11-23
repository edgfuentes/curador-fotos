/**
 * Modelo de datos del dominio. Sin dependencias de plataforma.
 *
 * Una `Photo` describe un archivo ORIGINAL de la carpeta de origen. La app
 * nunca modifica ese archivo: solo lo lee para generar vistas y para copiarlo
 * byte a byte al exportar.
 */

/** Identificador estable de una foto: su ruta relativa (NFC, separada por "/"). */
export type PhotoId = string;

export type PhotoFormat = 'jpeg' | 'png' | 'heic' | 'tiff' | 'webp' | 'raw';

export type CurationStatus = 'pending' | 'marked' | 'discarded';

export const CURATION_STATUSES: readonly CurationStatus[] = ['pending', 'marked', 'discarded'];

/** Datos de cámara leídos del EXIF. */
export interface CameraInfo {
  /** Identificador estable: marca + modelo + número de serie (si existe). */
  readonly id: string;
  readonly make: string;
  readonly model: string;
  readonly serial?: string;
}

/** Fecha/hora de captura tal como la registró la cámara. */
export interface CaptureInfo {
  /**
   * Hora "de reloj" local sin zona, en milisegundos tratados como UTC
   * (pseudo-UTC). Permite comparar cámaras que usan la misma hora local
   * aunque unas registren zona horaria y otras no.
   */
  readonly wallClockMs: number;
  /** Texto original EXIF (p. ej. "2026:11:21 10:32:05"). */
  readonly raw: string;
  /** Desfase de zona horaria registrado por la cámara, si existe (minutos). */
  readonly tzOffsetMinutes?: number;
}

/** Metadatos extraídos de un archivo (cacheables por huella del archivo). */
export interface PhotoMetadata {
  readonly capture?: CaptureInfo;
  readonly camera?: CameraInfo;
  readonly width?: number;
  readonly height?: number;
  /** Orientación EXIF (1–8). */
  readonly orientation?: number;
  readonly lens?: string;
}

/** Estado de sincronización en la nube (previsto, no implementado). */
export type CloudSyncState = 'local-only' | 'pending' | 'synced' | 'error';

export interface CloudSyncInfo {
  readonly state: CloudSyncState;
  readonly remoteId?: string;
  readonly updatedAt?: string;
}

/** Puntuación de calidad por IA (prevista, no implementada). */
export interface AiQualityScore {
  /** 0–1 */
  readonly score: number;
  readonly model: string;
  readonly computedAt: string;
}

export interface Photo extends PhotoMetadata {
  readonly id: PhotoId;
  readonly relativePath: string;
  readonly fileName: string;
  /** Carpeta relativa que contiene el archivo ("" si está en la raíz). */
  readonly folder: string;
  readonly size: number;
  readonly lastModified: number;
  readonly format: PhotoFormat;
  /** Extensión en minúsculas sin punto (p. ej. "nef"). */
  readonly extension: string;
  /** SHA-256 del original (hex), si ya se calculó. */
  readonly sha256?: string;

  // --- Campos previstos para fases futuras (no implementados aún) ---
  /** ID del fotógrafo autor (colaboración entre fotógrafos). */
  readonly photographerId?: string | null;
  /** Puntuación de calidad por IA. */
  readonly aiQuality?: AiQualityScore | null;
  /** Estado de sincronización con la nube. */
  readonly cloudSync?: CloudSyncInfo;
}

/** Ajustes persistidos por cámara. */
export interface CameraSettings {
  readonly cameraId: string;
  /** Nombre del fotógrafo o etiqueta libre. */
  readonly label?: string;
  /** Desfase de reloj a sumar a la hora de captura (segundos, +/-). */
  readonly offsetSeconds: number;
  /** Previsto: vínculo con un fotógrafo en un futuro modo colaborativo. */
  readonly photographerId?: string | null;
}

/** Huella para reconocer un archivo aunque cambie de ruta. */
export interface FileFingerprint {
  readonly fileName: string;
  readonly size: number;
  readonly lastModified: number;
  readonly sha256?: string;
}

/** Decisión de curación persistida para una foto. */
export interface CurationRecord {
  readonly status: CurationStatus;
  /** Sector asignado manualmente (si no, se usa el de la carpeta). */
  readonly sector?: string;
  readonly fingerprint: FileFingerprint;
  readonly updatedAt: number;
}

/** Estado persistido de una "biblioteca" (una carpeta de origen). */
export interface LibraryState {
  readonly schemaVersion: 1;
  readonly records: Readonly<Record<PhotoId, CurationRecord>>;
  /** Orden manual por sector: lista de IDs. Prevalece sobre el orden automático. */
  readonly manualOrder: Readonly<Record<string, readonly PhotoId[]>>;
  /** Sectores creados a mano (además de los derivados de las carpetas). */
  readonly extraSectors: readonly string[];
}

export const emptyLibraryState = (): LibraryState => ({
  schemaVersion: 1,
  records: {},
  manualOrder: {},
  extraSectors: [],
});
