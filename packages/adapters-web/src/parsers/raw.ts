/**
 * Vistas previas y metadatos de archivos RAW. Los navegadores no decodifican
 * RAW, pero casi todas las cámaras guardan dentro un JPEG de vista previa
 * (a veces a tamaño completo). Aquí se localiza sin leer el archivo entero.
 */
import { isBrowserDecodable, parseJpegHeader, scanForJpegs } from './jpeg';
import { readTiffExif, TAG, TiffReader, type ReadAt, type TiffExif } from './tiff';

export interface PreviewCandidate {
  readonly offset: number;
  readonly length: number;
  readonly width: number;
  readonly height: number;
}

const FALLBACK_SCAN_BYTES = 8 * 1024 * 1024;
const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

async function validate(read: ReadAt, fileSize: number, offset: number, length: number): Promise<PreviewCandidate | null> {
  if (offset <= 0 || length < 100 || offset + length > fileSize) return null;
  const head = await read(offset, Math.min(length, 128 * 1024));
  const info = parseJpegHeader(head);
  if (!info || !isBrowserDecodable(info)) return null;
  return { offset, length, width: info.width, height: info.height };
}

function dedupe(c: PreviewCandidate[]): PreviewCandidate[] {
  const seen = new Set<number>();
  return c.filter((x) => (seen.has(x.offset) ? false : (seen.add(x.offset), true)));
}

async function tiffCandidates(read: ReadAt, fileSize: number, tiff: TiffReader): Promise<PreviewCandidate[]> {
  const out: PreviewCandidate[] = [];
  for (const ifd of await tiff.allImageIfds()) {
    const e = ifd.entries;
    const jo = await tiff.number(e.get(TAG.JpegOffset));
    const jl = await tiff.number(e.get(TAG.JpegLength));
    if (jo && jl) {
      const c = await validate(read, fileSize, tiff.base + jo, jl);
      if (c) out.push(c);
    }
    const rw2 = e.get(TAG.Rw2JpgFromRaw);
    if (rw2) {
      const c = await validate(read, fileSize, rw2.valueOffset, rw2.byteLength);
      if (c) out.push(c);
    }
    const compression = await tiff.number(e.get(TAG.Compression));
    if (compression === 6 || compression === 7) {
      const offs = await tiff.numbers(e.get(TAG.StripOffsets), 2);
      const lens = await tiff.numbers(e.get(TAG.StripByteCounts), 2);
      if (offs.length === 1 && lens.length === 1) {
        const c = await validate(read, fileSize, tiff.base + offs[0]!, lens[0]!);
        if (c) out.push(c);
      }
    }
  }
  return out;
}

async function fallbackScan(read: ReadAt, fileSize: number): Promise<PreviewCandidate[]> {
  const bytes = await read(0, Math.min(fileSize, FALLBACK_SCAN_BYTES));
  return scanForJpegs(bytes).map(({ offset, length, width, height }) => ({ offset, length, width, height }));
}

// ------------------------------------------------------------------ Fujifilm RAF

async function rafJpeg(read: ReadAt, fileSize: number): Promise<PreviewCandidate | null> {
  const h = await read(0, 100);
  if (ascii(h, 0, 15) !== 'FUJIFILMCCD-RAW') return null;
  const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
  return validate(read, fileSize, dv.getUint32(84, false), dv.getUint32(88, false));
}

/** Busca el bloque EXIF (APP1 "Exif\0\0") de un JPEG y abre su TIFF. */
async function exifInJpeg(read: ReadAt, jpegOffset: number): Promise<TiffReader | null> {
  const head = await read(jpegOffset, 64 * 1024);
  let p = 2;
  while (p + 4 < head.length && head[p] === 0xff) {
    const marker = head[p + 1]!;
    const len = (head[p + 2]! << 8) | head[p + 3]!;
    if (marker === 0xe1 && ascii(head, p + 4, 4) === 'Exif') return TiffReader.open(read, jpegOffset + p + 10);
    if (marker === 0xda) break;
    p += 2 + len;
  }
  return null;
}

// ------------------------------------------------------------------ Canon CR3 (ISO BMFF)

interface Box {
  type: string;
  start: number;
  headerSize: number;
  size: number;
}

async function readBoxes(read: ReadAt, start: number, end: number, limit = 64): Promise<Box[]> {
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end && out.length < limit) {
    const h = await read(p, 16);
    if (h.length < 8) break;
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    let size = dv.getUint32(0, false);
    let headerSize = 8;
    if (size === 1 && h.length >= 16) {
      size = Number(dv.getBigUint64(8, false));
      headerSize = 16;
    } else if (size === 0) size = end - p;
    if (size < headerSize) break;
    out.push({ type: ascii(h, 4, 4), start: p, headerSize, size });
    p += size;
  }
  return out;
}

function findTag(bytes: Uint8Array, tag: string, from = 0): number {
  const t = [...tag].map((c) => c.charCodeAt(0));
  outer: for (let i = from; i + t.length <= bytes.length; i++) {
    for (let k = 0; k < t.length; k++) if (bytes[i + k] !== t[k]) continue outer;
    return i;
  }
  return -1;
}

async function cr3Info(read: ReadAt, fileSize: number): Promise<{ exif: TiffExif | null; previews: PreviewCandidate[] }> {
  const top = await readBoxes(read, 0, fileSize);
  if (top[0]?.type !== 'ftyp') return { exif: null, previews: [] };
  let exif: TiffExif | null = null;
  const previews: PreviewCandidate[] = [];
  for (const box of top) {
    if (box.type === 'moov' && box.size < 4 * 1024 * 1024) {
      const bytes = await read(box.start, box.size);
      const at = (tag: string) => {
        const i = findTag(bytes, tag);
        return i >= 4 ? box.start + i + 4 : -1;
      };
      const cmt1 = at('CMT1');
      const cmt2 = at('CMT2');
      if (cmt1 > 0) {
        const ifd0 = await TiffReader.open(read, cmt1);
        const exifR = cmt2 > 0 ? await TiffReader.open(read, cmt2) : null;
        if (ifd0) exif = await readTiffExif(ifd0, exifR ?? undefined);
      }
      // THMB: miniatura pequeña dentro de moov.
      for (const f of scanForJpegs(bytes, box.start, 100)) previews.push(f);
    } else if (box.type === 'uuid' && box.size < 16 * 1024 * 1024) {
      const bytes = await read(box.start, box.size);
      if (findTag(bytes, 'PRVW') >= 0) for (const f of scanForJpegs(bytes, box.start)) previews.push(f);
    }
    if (box.type === 'mdat') break;
  }
  return { exif, previews: previews.map(({ offset, length, width, height }) => ({ offset, length, width, height })) };
}

// ------------------------------------------------------------------ API pública

/** Lista las vistas previas JPEG decodificables dentro de un RAW. */
export async function findRawPreviews(read: ReadAt, fileSize: number, extension: string): Promise<PreviewCandidate[]> {
  let out: PreviewCandidate[] = [];
  if (extension === 'raf') {
    const c = await rafJpeg(read, fileSize);
    if (c) out.push(c);
  } else if (extension === 'cr3') {
    out = (await cr3Info(read, fileSize)).previews;
  } else {
    const tiff = await TiffReader.open(read, 0).catch(() => null);
    if (tiff) out = await tiffCandidates(read, fileSize, tiff).catch(() => []);
  }
  if (out.length === 0) out = await fallbackScan(read, fileSize);
  return dedupe(out);
}

/** Lee EXIF de un RAW (fecha, cámara, número de serie, orientación). */
export async function readRawExif(read: ReadAt, fileSize: number, extension: string): Promise<TiffExif | null> {
  if (extension === 'cr3') return (await cr3Info(read, fileSize)).exif;
  if (extension === 'raf') {
    const jpeg = await rafJpeg(read, fileSize);
    const t = jpeg ? await exifInJpeg(read, jpeg.offset) : null;
    return t ? readTiffExif(t) : null;
  }
  const tiff = await TiffReader.open(read, 0).catch(() => null);
  if (tiff) return readTiffExif(tiff);
  return null;
}

/**
 * Elige la vista previa adecuada: para la cuadrícula, la más pequeña que sea
 * suficiente (más rápida de decodificar); para revisión y zoom, la más grande.
 */
export function choosePreview(candidates: readonly PreviewCandidate[], minLongSide: number): PreviewCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => a.width * a.height - b.width * b.height);
  return sorted.find((c) => Math.max(c.width, c.height) >= minLongSide) ?? sorted[sorted.length - 1]!;
}

