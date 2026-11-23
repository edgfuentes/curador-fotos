import { describe, expect, it } from 'vitest';
import { buildTiff, withExif } from '../src/demo/exif-writer';
import { findJpegEnd, parseJpegHeader, scanForJpegs } from '../src/parsers/jpeg';
import { choosePreview, findRawPreviews, readRawExif } from '../src/parsers/raw';
import { readTiffExif, TiffReader, type ReadAt } from '../src/parsers/tiff';

/** JPEG sintético (estructura válida, no decodificable por píxeles): SOI, SOF, SOS, datos, EOI. */
function fakeJpeg(width: number, height: number, sof = 0xc0, payload = 200): Uint8Array {
  const sofSeg = [0xff, sof, 0, 17, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const sos = [0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0];
  // Datos de entropía con FF00 (relleno) y un marcador RST para probar el recorrido.
  const data: number[] = [];
  for (let i = 0; i < payload; i++) data.push(i % 7 === 0 ? 0xff : i & 0x7f, ...(i % 7 === 0 ? [0x00] : []));
  data.push(0xff, 0xd3, 1, 2, 3);
  return Uint8Array.from([0xff, 0xd8, ...sofSeg, ...sos, ...data, 0xff, 0xd9]);
}

const reader = (bytes: Uint8Array): ReadAt => async (offset, length) =>
  bytes.subarray(Math.max(0, offset), Math.min(bytes.length, offset + length));

describe('JPEG', () => {
  it('lee dimensiones y tipo SOF', () => {
    expect(parseJpegHeader(fakeJpeg(6000, 4000))).toEqual({ width: 6000, height: 4000, sof: 0xc0 });
    expect(parseJpegHeader(fakeJpeg(10, 10, 0xc3))?.sof).toBe(0xc3);
  });

  it('encuentra el final del JPEG saltando rellenos y RST', () => {
    const j = fakeJpeg(100, 50);
    expect(findJpegEnd(j, 0)).toBe(j.length);
  });

  it('busca JPEG dentro de un bloque y descarta los sin pérdida (no decodificables)', () => {
    const a = fakeJpeg(160, 120);
    const b = fakeJpeg(1620, 1080);
    const lossless = fakeJpeg(6000, 4000, 0xc3);
    const blob = new Uint8Array(50 + a.length + 30 + lossless.length + 10 + b.length + 5);
    let p = 50;
    blob.set(a, p);
    p += a.length + 30;
    blob.set(lossless, p);
    p += lossless.length + 10;
    blob.set(b, p);
    const found = scanForJpegs(blob);
    expect(found.map((f) => [f.width, f.offset])).toEqual([
      [160, 50],
      [1620, p],
    ]);
  });
});

describe('TIFF / EXIF', () => {
  const fields = {
    make: 'NIKON CORPORATION',
    model: 'NIKON Z 6_2',
    serial: '6012345',
    orientation: 6,
    dateTimeOriginal: '2026:11:21 10:32:05',
    subSec: '42',
    offsetTime: '-03:00',
  };

  it('lee IFD0 y Exif IFD de un TIFF', async () => {
    const tiff = buildTiff(fields);
    const r = await TiffReader.open(reader(tiff));
    expect(r).not.toBeNull();
    expect(await readTiffExif(r!)).toMatchObject({
      make: 'NIKON CORPORATION',
      model: 'NIKON Z 6_2',
      orientation: 6,
      dateTimeOriginal: '2026:11:21 10:32:05',
      subSecTimeOriginal: '42',
      offsetTimeOriginal: '-03:00',
      serial: '6012345',
    });
  });

  it('inserta EXIF en un JPEG sin alterar el resto', () => {
    const j = fakeJpeg(10, 10);
    const out = withExif(j, fields);
    expect(out[2]).toBe(0xff);
    expect(out[3]).toBe(0xe1);
    expect(parseJpegHeader(out)).toEqual(parseJpegHeader(j));
  });
});

describe('RAW', () => {
  it('extrae la vista previa JPEG de un RAW basado en TIFF (estilo NEF/DNG)', async () => {
    const preview = fakeJpeg(6048, 4024);
    const raw = buildTiff({ make: 'NIKON', model: 'Z 6', dateTimeOriginal: '2026:11:21 08:00:00' }, preview);
    const previews = await findRawPreviews(reader(raw), raw.length, 'nef');
    expect(previews).toHaveLength(1);
    const c = previews[0]!;
    expect([c.width, c.height]).toEqual([6048, 4024]);
    expect(Array.from(raw.subarray(c.offset, c.offset + c.length))).toEqual(Array.from(preview));
    expect((await readRawExif(reader(raw), raw.length, 'nef'))?.dateTimeOriginal).toBe('2026:11:21 08:00:00');
  });

  it('acepta la firma de Panasonic RW2 / Olympus ORF', async () => {
    const raw = buildTiff({ make: 'Panasonic', dateTimeOriginal: '2026:01:02 03:04:05' }, fakeJpeg(1920, 1080), {
      magic: 0x55,
    });
    expect((await readRawExif(reader(raw), raw.length, 'rw2'))?.make).toBe('Panasonic');
    expect(await findRawPreviews(reader(raw), raw.length, 'rw2')).toHaveLength(1);
  });

  it('lee el JPEG incrustado de un Fujifilm RAF', async () => {
    const jpeg = withExif(fakeJpeg(1920, 1280), { make: 'FUJIFILM', model: 'X-T5', dateTimeOriginal: '2026:11:21 07:00:00' });
    const raf = new Uint8Array(200 + jpeg.length + 100);
    raf.set([...'FUJIFILMCCD-RAW 0201'].map((c) => c.charCodeAt(0)));
    new DataView(raf.buffer).setUint32(84, 200, false);
    new DataView(raf.buffer).setUint32(88, jpeg.length, false);
    raf.set(jpeg, 200);
    const previews = await findRawPreviews(reader(raf), raf.length, 'raf');
    expect(previews[0]).toMatchObject({ offset: 200, width: 1920 });
    expect((await readRawExif(reader(raf), raf.length, 'raf'))?.model).toBe('X-T5');
  });

  it('respaldo: busca JPEG en formatos desconocidos', async () => {
    const blob = new Uint8Array(5000);
    blob.set(fakeJpeg(800, 600), 1000);
    expect((await findRawPreviews(reader(blob), blob.length, 'x3f'))[0]).toMatchObject({ offset: 1000, width: 800 });
  });

  it('elige la vista más pequeña suficiente para la cuadrícula y la mayor para el zoom', () => {
    const c = [
      { offset: 1, length: 1, width: 160, height: 120 },
      { offset: 2, length: 1, width: 6000, height: 4000 },
      { offset: 3, length: 1, width: 1620, height: 1080 },
    ];
    expect(choosePreview(c, 480)?.width).toBe(1620);
    expect(choosePreview(c, 100000)?.width).toBe(6000);
    expect(choosePreview([], 10)).toBeNull();
  });
});
