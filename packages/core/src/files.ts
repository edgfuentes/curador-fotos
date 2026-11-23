import type { PhotoFormat } from './model';

const EXTENSIONS: Readonly<Record<string, PhotoFormat>> = {
  jpg: 'jpeg',
  jpeg: 'jpeg',
  jpe: 'jpeg',
  png: 'png',
  heic: 'heic',
  heif: 'heic',
  hif: 'heic',
  tif: 'tiff',
  tiff: 'tiff',
  webp: 'webp',
  // RAW comunes
  cr2: 'raw',
  cr3: 'raw',
  crw: 'raw',
  nef: 'raw',
  nrw: 'raw',
  arw: 'raw',
  srf: 'raw',
  sr2: 'raw',
  dng: 'raw',
  raf: 'raw',
  orf: 'raw',
  rw2: 'raw',
  rwl: 'raw',
  pef: 'raw',
  srw: 'raw',
  x3f: 'raw',
  '3fr': 'raw',
  iiq: 'raw',
  erf: 'raw',
  mef: 'raw',
  mos: 'raw',
  kdc: 'raw',
};

export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(EXTENSIONS);

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

export function detectFormat(fileName: string): PhotoFormat | undefined {
  return EXTENSIONS[extensionOf(fileName)];
}

/**
 * Archivos y carpetas a ignorar al escanear: ocultos (".DS_Store",
 * "._IMG_0001.JPG" que macOS crea en tarjetas exFAT, ".Spotlight-V100"…).
 */
export function isIgnoredName(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~$') || name === 'Thumbs.db' || name === 'desktop.ini';
}

/** Normaliza una ruta relativa: separador "/", forma Unicode NFC, sin "/" extremos. */
export function normalizeRelativePath(path: string): string {
  return path
    .normalize('NFC')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

export function splitPath(relativePath: string): { folder: string; fileName: string } {
  const i = relativePath.lastIndexOf('/');
  return i < 0
    ? { folder: '', fileName: relativePath }
    : { folder: relativePath.slice(0, i), fileName: relativePath.slice(i + 1) };
}

/** Clave de caché que cambia si el archivo cambia (ruta + tamaño + fecha de modificación). */
export function fileCacheKey(relativePath: string, size: number, lastModified: number): string {
  return `${relativePath}|${size}|${lastModified}`;
}

const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

/** Orden natural: "IMG_2" < "IMG_10". Desempata por comparación exacta para ser determinista. */
export function naturalCompare(a: string, b: string): number {
  const c = collator.compare(a, b);
  if (c !== 0) return c;
  return a < b ? -1 : a > b ? 1 : 0;
}
