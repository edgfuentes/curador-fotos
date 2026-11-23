/**
 * Lector TIFF mínimo con acceso aleatorio asíncrono. Sirve para leer EXIF y
 * localizar vistas previas JPEG dentro de archivos RAW (CR2, NEF, ARW, DNG,
 * ORF, RW2, PEF…) sin cargar el archivo completo en memoria.
 * No depende del navegador: se prueba en Node.
 */

export type ReadAt = (offset: number, length: number) => Promise<Uint8Array>;

export interface IfdEntry {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  /** Offset absoluto (en el archivo) del valor. */
  readonly valueOffset: number;
  readonly byteLength: number;
}

export interface Ifd {
  readonly offset: number;
  readonly entries: ReadonlyMap<number, IfdEntry>;
  readonly next: number;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

/** Números mágicos aceptados: 42 (TIFF), "RO"/"SR" (Olympus ORF), 0x55 (Panasonic RW2). */
const MAGICS = new Set([42, 0x4f52, 0x5352, 0x55]);

export const TAG = {
  NewSubfileType: 0xfe,
  ImageWidth: 0x100,
  ImageLength: 0x101,
  Compression: 0x103,
  Make: 0x10f,
  Model: 0x110,
  StripOffsets: 0x111,
  Orientation: 0x112,
  StripByteCounts: 0x117,
  SubIFDs: 0x14a,
  JpegOffset: 0x201,
  JpegLength: 0x202,
  Rw2JpgFromRaw: 0x2e,
  ExifIFD: 0x8769,
  DateTimeOriginal: 0x9003,
  CreateDate: 0x9004,
  OffsetTimeOriginal: 0x9011,
  SubSecTimeOriginal: 0x9291,
  PixelXDimension: 0xa002,
  PixelYDimension: 0xa003,
  BodySerialNumber: 0xa431,
  LensModel: 0xa434,
  CameraSerialNumber: 0xc62f,
} as const;

export class TiffReader {
  private constructor(
    private readonly read: ReadAt,
    /** Offset absoluto del encabezado TIFF (los offsets internos son relativos a él). */
    readonly base: number,
    readonly littleEndian: boolean,
    readonly firstIfd: number,
  ) {}

  /** Abre un TIFF que empieza en `base`. Devuelve null si no es TIFF. */
  static async open(read: ReadAt, base = 0): Promise<TiffReader | null> {
    const h = await read(base, 8);
    if (h.length < 8) return null;
    const le = h[0] === 0x49 && h[1] === 0x49;
    const be = h[0] === 0x4d && h[1] === 0x4d;
    if (!le && !be) return null;
    const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
    const magic = dv.getUint16(2, le);
    if (!MAGICS.has(magic)) return null;
    return new TiffReader(read, base, le, dv.getUint32(4, le));
  }

  async readIfd(relOffset: number): Promise<Ifd | null> {
    if (relOffset <= 0) return null;
    const abs = this.base + relOffset;
    const head = await this.read(abs, 2);
    if (head.length < 2) return null;
    const count = new DataView(head.buffer, head.byteOffset).getUint16(0, this.littleEndian);
    if (count === 0 || count > 1000) return null;
    const body = await this.read(abs + 2, count * 12 + 4);
    if (body.length < count * 12) return null;
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    const entries = new Map<number, IfdEntry>();
    for (let i = 0; i < count; i++) {
      const p = i * 12;
      const tag = dv.getUint16(p, this.littleEndian);
      const type = dv.getUint16(p + 2, this.littleEndian);
      const n = dv.getUint32(p + 4, this.littleEndian);
      const size = (TYPE_SIZE[type] ?? 1) * n;
      const valueOffset = size <= 4 ? abs + 2 + p + 8 : this.base + dv.getUint32(p + 8, this.littleEndian);
      entries.set(tag, { tag, type, count: n, valueOffset, byteLength: size });
    }
    const next = body.length >= count * 12 + 4 ? dv.getUint32(count * 12, this.littleEndian) : 0;
    return { offset: relOffset, entries, next };
  }

  async numbers(entry: IfdEntry | undefined, max = 64): Promise<number[]> {
    if (!entry) return [];
    const n = Math.min(entry.count, max);
    const size = TYPE_SIZE[entry.type] ?? 1;
    const bytes = await this.read(entry.valueOffset, n * size);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const le = this.littleEndian;
    const out: number[] = [];
    for (let i = 0; i < n && (i + 1) * size <= bytes.length; i++) {
      const o = i * size;
      switch (entry.type) {
        case 1:
        case 7:
          out.push(dv.getUint8(o));
          break;
        case 6:
          out.push(dv.getInt8(o));
          break;
        case 3:
          out.push(dv.getUint16(o, le));
          break;
        case 8:
          out.push(dv.getInt16(o, le));
          break;
        case 4:
        case 13:
          out.push(dv.getUint32(o, le));
          break;
        case 9:
          out.push(dv.getInt32(o, le));
          break;
        case 5: {
          const d = dv.getUint32(o + 4, le);
          out.push(d ? dv.getUint32(o, le) / d : 0);
          break;
        }
        case 10: {
          const d = dv.getInt32(o + 4, le);
          out.push(d ? dv.getInt32(o, le) / d : 0);
          break;
        }
        case 11:
          out.push(dv.getFloat32(o, le));
          break;
        case 12:
          out.push(dv.getFloat64(o, le));
          break;
        default:
          out.push(dv.getUint8(o));
      }
    }
    return out;
  }

  async number(entry: IfdEntry | undefined): Promise<number | undefined> {
    return (await this.numbers(entry, 1))[0];
  }

  async string(entry: IfdEntry | undefined): Promise<string | undefined> {
    if (!entry || entry.count === 0) return undefined;
    const bytes = await this.read(entry.valueOffset, Math.min(entry.count, 256));
    let s = '';
    for (const b of bytes) {
      if (b === 0) break;
      s += String.fromCharCode(b);
    }
    s = s.trim();
    return s || undefined;
  }

  /**
   * Recorre IFD0, la cadena de IFD siguientes y los SubIFDs (donde los RAW
   * suelen guardar la vista previa a tamaño completo).
   */
  async allImageIfds(limit = 32): Promise<Ifd[]> {
    const out: Ifd[] = [];
    const seen = new Set<number>();
    const queue: number[] = [this.firstIfd];
    while (queue.length && out.length < limit) {
      const off = queue.shift()!;
      if (seen.has(off)) continue;
      seen.add(off);
      const ifd = await this.readIfd(off).catch(() => null);
      if (!ifd) continue;
      out.push(ifd);
      if (ifd.next) queue.push(ifd.next);
      const subs = ifd.entries.get(TAG.SubIFDs);
      if (subs) {
        // Los SubIFDs se guardan como offsets relativos al encabezado TIFF.
        for (const s of await this.numbers({ ...subs, type: subs.type === 13 ? 4 : subs.type }, 8)) queue.push(s);
      }
    }
    return out;
  }
}

export interface TiffExif {
  make?: string;
  model?: string;
  orientation?: number;
  dateTimeOriginal?: string;
  subSecTimeOriginal?: string;
  offsetTimeOriginal?: string;
  serial?: string;
  lens?: string;
  width?: number;
  height?: number;
}

/** Lee los campos EXIF que usa la app desde IFD0 + Exif IFD. */
export async function readTiffExif(tiff: TiffReader, exifReader?: TiffReader): Promise<TiffExif> {
  const out: TiffExif = {};
  const ifd0 = await tiff.readIfd(tiff.firstIfd);
  if (!ifd0) return out;
  const e0 = ifd0.entries;
  out.make = await tiff.string(e0.get(TAG.Make));
  out.model = await tiff.string(e0.get(TAG.Model));
  out.orientation = await tiff.number(e0.get(TAG.Orientation));
  out.serial = await tiff.string(e0.get(TAG.CameraSerialNumber));

  let exifIfd: Ifd | null = null;
  let r = tiff;
  if (exifReader) {
    r = exifReader;
    exifIfd = await exifReader.readIfd(exifReader.firstIfd);
  } else {
    const ptr = await tiff.number(e0.get(TAG.ExifIFD));
    if (ptr) exifIfd = await tiff.readIfd(ptr);
  }
  if (exifIfd) {
    const e = exifIfd.entries;
    out.dateTimeOriginal = (await r.string(e.get(TAG.DateTimeOriginal))) ?? (await r.string(e.get(TAG.CreateDate)));
    out.subSecTimeOriginal = await r.string(e.get(TAG.SubSecTimeOriginal));
    out.offsetTimeOriginal = await r.string(e.get(TAG.OffsetTimeOriginal));
    out.serial = (await r.string(e.get(TAG.BodySerialNumber))) ?? out.serial;
    out.lens = await r.string(e.get(TAG.LensModel));
    out.width = await r.number(e.get(TAG.PixelXDimension));
    out.height = await r.number(e.get(TAG.PixelYDimension));
  }
  return out;
}
