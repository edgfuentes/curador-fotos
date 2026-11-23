/**
 * Escritor TIFF/EXIF mínimo. Se usa SOLO para generar archivos de prueba
 * (pruebas automáticas y "modo demostración"); la app nunca escribe en los
 * originales.
 */

export interface ExifFields {
  make?: string;
  model?: string;
  serial?: string;
  orientation?: number;
  dateTimeOriginal?: string;
  subSec?: string;
  offsetTime?: string;
}

type Entry = { tag: number; type: 2 | 3 | 4 | 7; count: number; data: Uint8Array };

class Writer {
  bytes: number[] = [];
  get offset(): number {
    return this.bytes.length;
  }
  u16(v: number) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff);
  }
  u32(v: number) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  }
  raw(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.bytes.push(b[i]!);
  }
  align() {
    if (this.bytes.length % 2) this.bytes.push(0);
  }
  patchU32(at: number, v: number) {
    this.bytes[at] = v & 0xff;
    this.bytes[at + 1] = (v >> 8) & 0xff;
    this.bytes[at + 2] = (v >> 16) & 0xff;
    this.bytes[at + 3] = (v >>> 24) & 0xff;
  }
}

const asciiEntry = (tag: number, s: string): Entry => {
  const data = new Uint8Array(s.length + 1);
  for (let i = 0; i < s.length; i++) data[i] = s.charCodeAt(i) & 0x7f;
  return { tag, type: 2, count: data.length, data };
};
const shortEntry = (tag: number, v: number): Entry => ({ tag, type: 3, count: 1, data: new Uint8Array([v & 0xff, v >> 8, 0, 0]) });
const longEntry = (tag: number, v: number): Entry => ({
  tag,
  type: 4,
  count: 1,
  data: new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]),
});

/** Escribe un IFD y devuelve su offset. Los valores de más de 4 bytes van después. */
function writeIfd(w: Writer, entries: Entry[], next = 0): number {
  entries.sort((a, b) => a.tag - b.tag);
  w.align();
  const start = w.offset;
  w.u16(entries.length);
  const dataPatches: { at: number; data: Uint8Array }[] = [];
  for (const e of entries) {
    w.u16(e.tag);
    w.u16(e.type);
    w.u32(e.count);
    if (e.data.length <= 4) {
      const pad = new Uint8Array(4);
      pad.set(e.data);
      w.raw(pad);
    } else {
      dataPatches.push({ at: w.offset, data: e.data });
      w.u32(0);
    }
  }
  w.u32(next);
  for (const p of dataPatches) {
    w.align();
    w.patchU32(p.at, w.offset);
    w.raw(p.data);
  }
  return start;
}

function exifEntries(f: ExifFields): { ifd0: Entry[]; exif: Entry[] } {
  const ifd0: Entry[] = [];
  if (f.make) ifd0.push(asciiEntry(0x10f, f.make));
  if (f.model) ifd0.push(asciiEntry(0x110, f.model));
  if (f.orientation) ifd0.push(shortEntry(0x112, f.orientation));
  const exif: Entry[] = [];
  if (f.dateTimeOriginal) exif.push(asciiEntry(0x9003, f.dateTimeOriginal));
  if (f.subSec) exif.push(asciiEntry(0x9291, f.subSec));
  if (f.offsetTime) exif.push(asciiEntry(0x9011, f.offsetTime));
  if (f.serial) exif.push(asciiEntry(0xa431, f.serial));
  return { ifd0, exif };
}

/** TIFF (little endian) con IFD0 + Exif IFD y, opcionalmente, un JPEG de vista previa en un SubIFD (estilo NEF/DNG). */
export function buildTiff(fields: ExifFields, preview?: Uint8Array, opts: { magic?: number } = {}): Uint8Array {
  const w = new Writer();
  w.raw([0x49, 0x49]);
  w.u16(opts.magic ?? 42);
  w.u32(0); // offset IFD0, se corrige al final
  const { ifd0, exif } = exifEntries(fields);
  let jpegOffset = 0;
  if (preview) {
    w.align();
    jpegOffset = w.offset;
    w.raw(preview);
  }
  const exifOffset = exif.length ? writeIfd(w, exif) : 0;
  let subOffset = 0;
  if (preview) {
    subOffset = writeIfd(w, [shortEntry(0xfe, 0), longEntry(0x201, jpegOffset), longEntry(0x202, preview.length)]);
  }
  if (exifOffset) ifd0.push(longEntry(0x8769, exifOffset));
  if (subOffset) ifd0.push(longEntry(0x14a, subOffset));
  const ifd0Offset = writeIfd(w, ifd0);
  w.patchU32(4, ifd0Offset);
  return Uint8Array.from(w.bytes);
}

/** Inserta un bloque EXIF (APP1) justo después del SOI de un JPEG. */
export function withExif(jpeg: Uint8Array, fields: ExifFields): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('No es un JPEG');
  const tiff = buildTiff(fields);
  const len = tiff.length + 8;
  const app1 = new Uint8Array(4 + 6 + tiff.length);
  app1.set([0xff, 0xe1, len >> 8, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  app1.set(tiff, 10);
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, 2));
  out.set(app1, 2);
  out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
}
