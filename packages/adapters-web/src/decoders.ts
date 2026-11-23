/**
 * Decodificación y generación de vistas (se ejecuta dentro de Web Workers).
 * Nunca modifica el archivo original: solo lo lee.
 */
import exifr from 'exifr';
import { buildCameraInfo, parseExifDateTime, type PhotoFormat, type PhotoMetadata, type ViewSize } from '@curador/core';
import { choosePreview, findRawPreviews, readRawExif } from './parsers/raw';
import { readTiffExif, TiffReader, type ReadAt, type TiffExif } from './parsers/tiff';

export const VIEW_LONG_SIDE: Record<ViewSize, number> = { grid: 512, preview: 2560, full: Number.POSITIVE_INFINITY };

const readerFor =
  (blob: Blob): ReadAt =>
  async (offset, length) => {
    const start = Math.max(0, offset);
    return new Uint8Array(await blob.slice(start, Math.min(blob.size, start + length)).arrayBuffer());
  };

// ------------------------------------------------------------------ metadatos

function toMetadata(e: TiffExif): PhotoMetadata {
  const capture = parseExifDateTime(e.dateTimeOriginal, e.subSecTimeOriginal, e.offsetTimeOriginal);
  const camera = buildCameraInfo(e.make, e.model, e.serial);
  return {
    ...(capture ? { capture } : {}),
    ...(camera ? { camera } : {}),
    ...(e.orientation ? { orientation: e.orientation } : {}),
    ...(e.width ? { width: e.width } : {}),
    ...(e.height ? { height: e.height } : {}),
    ...(e.lens ? { lens: e.lens } : {}),
  };
}

const str = (v: unknown): string | undefined =>
  v == null ? undefined : v instanceof Date ? undefined : String(v).replace(/\0/g, '').trim() || undefined;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

async function exifrMetadata(file: Blob): Promise<TiffExif | null> {
  const out = (await exifr.parse(file, {
    tiff: true,
    exif: true,
    ifd0: {},
    gps: false,
    interop: false,
    ifd1: false,
    xmp: false,
    icc: false,
    iptc: false,
    jfif: false,
    ihdr: false,
    makerNote: false,
    userComment: false,
    reviveValues: false,
    translateValues: false,
    mergeOutput: true,
  } as never)) as Record<string, unknown> | undefined;
  if (!out) return null;
  return {
    make: str(out.Make),
    model: str(out.Model),
    orientation: num(out.Orientation),
    dateTimeOriginal: str(out.DateTimeOriginal) ?? str(out.CreateDate),
    subSecTimeOriginal: str(out.SubSecTimeOriginal),
    offsetTimeOriginal: str(out.OffsetTimeOriginal),
    serial: str(out.BodySerialNumber) ?? str(out.SerialNumber) ?? str(out.CameraSerialNumber),
    lens: str(out.LensModel),
    width: num(out.ExifImageWidth) ?? num(out.ImageWidth),
    height: num(out.ExifImageHeight) ?? num(out.ImageHeight),
  };
}

/** Respaldo: busca un encabezado TIFF (EXIF) en los primeros bytes (útil para WebP y archivos raros). */
async function scanTiffExif(file: Blob): Promise<TiffExif | null> {
  const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  const read = readerFor(file);
  for (let i = 0; i + 8 < head.length; i++) {
    const le = head[i] === 0x49 && head[i + 1] === 0x49 && head[i + 2] === 0x2a && head[i + 3] === 0;
    const be = head[i] === 0x4d && head[i + 1] === 0x4d && head[i + 2] === 0 && head[i + 3] === 0x2a;
    if (!le && !be) continue;
    const t = await TiffReader.open(read, i).catch(() => null);
    if (!t) continue;
    const e = await readTiffExif(t).catch(() => null);
    if (e && (e.dateTimeOriginal || e.make)) return e;
  }
  return null;
}

export async function readMetadata(file: Blob, format: PhotoFormat, extension: string): Promise<PhotoMetadata> {
  let e: TiffExif | null = null;
  if (format === 'raw') e = await readRawExif(readerFor(file), file.size, extension).catch(() => null);
  if (!e?.dateTimeOriginal) {
    const viaExifr = await exifrMetadata(file).catch(() => null);
    if (viaExifr && (viaExifr.dateTimeOriginal || !e)) e = { ...e, ...stripUndefined(viaExifr) };
  }
  if (!e?.dateTimeOriginal) {
    const scanned = await scanTiffExif(file).catch(() => null);
    if (scanned) e = { ...stripUndefined(scanned), ...stripUndefined(e ?? {}) };
  }
  return e ? toMetadata(e) : {};
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ------------------------------------------------------------------ vistas

export interface ViewResult {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

export class UnsupportedPreviewError extends Error {
  constructor(message = 'Formato sin vista previa') {
    super(message);
    this.name = 'UnsupportedPreviewError';
  }
}

interface Decoded {
  readonly bitmap: ImageBitmap;
  /** Orientación EXIF que falta aplicar (1 = ninguna). */
  readonly orientation: number;
  /** Si se puede entregar tal cual para "full" (sin recodificar). */
  readonly passthrough?: Blob;
}

async function decodeRaw(file: Blob, extension: string, size: ViewSize, orientation: number): Promise<Decoded> {
  const candidates = await findRawPreviews(readerFor(file), file.size, extension);
  const chosen = choosePreview(candidates, VIEW_LONG_SIDE[size] === Infinity ? 1e9 : VIEW_LONG_SIDE[size]);
  if (!chosen) throw new UnsupportedPreviewError('Este RAW no tiene una vista previa JPEG incrustada');
  const jpeg = file.slice(chosen.offset, chosen.offset + chosen.length, 'image/jpeg');
  // La orientación correcta está en el RAW, no en el JPEG incrustado.
  const bitmap = await createImageBitmap(jpeg, { imageOrientation: 'none' });
  return { bitmap, orientation, passthrough: orientation <= 1 ? jpeg : undefined };
}

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(target: ImageData, cb: (result: ImageData | null) => void): void;
  free?(): void;
}
interface LibHeif {
  HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] };
}
let libheifPromise: Promise<LibHeif> | null = null;
function loadLibheif(): Promise<LibHeif> {
  libheifPromise ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then(async (m) => {
    const factory = (m as { default: (opts?: object) => LibHeif | Promise<LibHeif> }).default;
    const lib = await factory();
    const ready = (lib as unknown as { ready?: Promise<unknown> }).ready;
    if (ready) await ready;
    return lib;
  });
  return libheifPromise;
}

async function decodeHeic(file: Blob, size: ViewSize): Promise<Decoded> {
  if (size === 'grid') {
    // Si el HEIC trae una miniatura JPEG en su EXIF, es instantánea.
    const thumb = await exifr.thumbnail(file).catch(() => undefined);
    if (thumb && thumb.length > 1000) {
      const bitmap = await createImageBitmap(new Blob([thumb as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })).catch(
        () => null,
      );
      if (bitmap && Math.max(bitmap.width, bitmap.height) >= 320) return { bitmap, orientation: 1 };
      bitmap?.close();
    }
  }
  const lib = await loadLibheif();
  const decoder = new lib.HeifDecoder();
  const images = decoder.decode(new Uint8Array(await file.arrayBuffer()));
  const image = images[0];
  if (!image) throw new UnsupportedPreviewError('No se pudo leer la imagen HEIC');
  const w = image.get_width();
  const h = image.get_height();
  const target = new ImageData(w, h);
  await new Promise<void>((resolve, reject) =>
    image.display(target, (r) => (r ? resolve() : reject(new Error('Error al decodificar HEIC')))),
  );
  for (const im of images) im.free?.();
  // libheif ya aplica la rotación (irot/imir) del contenedor.
  return { bitmap: await createImageBitmap(target), orientation: 1 };
}

async function decodeTiff(file: Blob, orientation: number): Promise<Decoded> {
  const UTIF = (await import('utif2')).default as typeof import('utif2');
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  // La imagen principal suele ser la de mayor tamaño.
  const main = ifds
    .filter((i) => Number((i as Record<string, unknown>).t256 ?? 0) > 0)
    .sort((a, b) => Number((b as Record<string, number[]>).t256?.[0] ?? 0) - Number((a as Record<string, number[]>).t256?.[0] ?? 0))[0];
  if (!main) throw new UnsupportedPreviewError('TIFF sin imagen legible');
  UTIF.decodeImage(buf, main);
  const rgba = UTIF.toRGBA8(main);
  const w = (main as { width?: number }).width ?? 0;
  const h = (main as { height?: number }).height ?? 0;
  if (!w || !h || rgba.length < w * h * 4) throw new UnsupportedPreviewError('TIFF con un formato de píxel no soportado');
  const data = new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, w * h * 4), w, h);
  return { bitmap: await createImageBitmap(data), orientation };
}

async function decode(file: Blob, format: PhotoFormat, extension: string, size: ViewSize, orientation: number): Promise<Decoded> {
  switch (format) {
    case 'jpeg':
    case 'png':
    case 'webp':
      // Chrome aplica la orientación EXIF al decodificar (imageOrientation: 'from-image').
      return { bitmap: await createImageBitmap(file), orientation: 1, passthrough: file };
    case 'raw':
      return decodeRaw(file, extension, size, orientation);
    case 'heic':
      return decodeHeic(file, size);
    case 'tiff':
      return decodeTiff(file, orientation);
  }
}

/** Dibuja con la orientación EXIF aplicada y escala al lado largo indicado. */
async function render(d: Decoded, maxLong: number, type: string, quality: number): Promise<ViewResult> {
  const swap = d.orientation >= 5 && d.orientation <= 8;
  const srcW = d.bitmap.width;
  const srcH = d.bitmap.height;
  const scale = Math.min(1, maxLong / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  let bmp = d.bitmap;
  if (scale < 1) {
    bmp = await createImageBitmap(d.bitmap, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    d.bitmap.close();
  }
  const outW = swap ? h : w;
  const outH = swap ? w : h;
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas no disponible');
  applyOrientation(ctx, d.orientation, w, h);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const blob = await canvas.convertToBlob({ type, quality });
  return { blob, width: outW, height: outH };
}

function applyOrientation(ctx: OffscreenCanvasRenderingContext2D, o: number, w: number, h: number): void {
  switch (o) {
    case 2:
      ctx.setTransform(-1, 0, 0, 1, w, 0);
      break;
    case 3:
      ctx.setTransform(-1, 0, 0, -1, w, h);
      break;
    case 4:
      ctx.setTransform(1, 0, 0, -1, 0, h);
      break;
    case 5:
      ctx.setTransform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      ctx.setTransform(0, 1, -1, 0, h, 0);
      break;
    case 7:
      ctx.setTransform(0, -1, -1, 0, h, w);
      break;
    case 8:
      ctx.setTransform(0, -1, 1, 0, 0, w);
      break;
    default:
      ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

/** Genera una vista (miniatura, media o completa) a partir del original. */
export async function generateView(
  file: Blob,
  format: PhotoFormat,
  extension: string,
  size: ViewSize,
  orientation = 1,
): Promise<ViewResult> {
  const d = await decode(file, format, extension, size, orientation);
  if (size === 'full' && d.passthrough && d.orientation <= 1) {
    const result = { blob: d.passthrough, width: d.bitmap.width, height: d.bitmap.height };
    d.bitmap.close();
    return result;
  }
  return size === 'full'
    ? render(d, Number.POSITIVE_INFINITY, 'image/jpeg', 0.95)
    : render(d, VIEW_LONG_SIDE[size], 'image/webp', size === 'grid' ? 0.8 : 0.88);
}
