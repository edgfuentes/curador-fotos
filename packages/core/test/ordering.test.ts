import { describe, expect, it } from 'vitest';
import {
  buildCameraInfo,
  classifyByFolder,
  DEFAULT_SECTORS,
  withSectors,
  effectiveCaptureMs,
  emptyLibraryState,
  formatOffset,
  mergeManualOrder,
  naturalCompare,
  orderLibrary,
  parseExifDateTime,
  NO_SECTOR,
  type CameraSettings,
  type LibraryState,
  type Photo,
} from '../src';
import { makePhoto } from './helpers';

describe('parseExifDateTime', () => {
  it('interpreta el formato EXIF estándar', () => {
    const c = parseExifDateTime('2026:11:21 10:32:05');
    expect(c?.wallClockMs).toBe(Date.UTC(2026, 10, 21, 10, 32, 5));
  });

  it('suma las fracciones de SubSecTimeOriginal', () => {
    expect(parseExifDateTime('2026:11:21 10:32:05', '5')?.wallClockMs).toBe(Date.UTC(2026, 10, 21, 10, 32, 5, 500));
    expect(parseExifDateTime('2026:11:21 10:32:05', '05')?.wallClockMs).toBe(Date.UTC(2026, 10, 21, 10, 32, 5, 50));
    expect(parseExifDateTime('2026:11:21 10:32:05', 123)?.wallClockMs).toBe(Date.UTC(2026, 10, 21, 10, 32, 5, 123));
  });

  it('guarda la zona horaria pero NO la usa para el reloj (hora local)', () => {
    const iphone = parseExifDateTime('2026:11:21 10:00:00', null, '-03:00');
    const camara = parseExifDateTime('2026:11:21 10:00:00');
    expect(iphone?.tzOffsetMinutes).toBe(-180);
    expect(iphone?.wallClockMs).toBe(camara?.wallClockMs);
  });

  it('rechaza fechas vacías o inválidas', () => {
    expect(parseExifDateTime('0000:00:00 00:00:00')).toBeUndefined();
    expect(parseExifDateTime('')).toBeUndefined();
    expect(parseExifDateTime(undefined)).toBeUndefined();
    expect(parseExifDateTime('basura')).toBeUndefined();
  });
});

describe('naturalCompare', () => {
  it('ordena números dentro del nombre de forma natural', () => {
    const names = ['IMG_10.jpg', 'IMG_2.jpg', 'IMG_1.jpg', 'img_3.jpg'];
    expect([...names].sort(naturalCompare)).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'img_3.jpg', 'IMG_10.jpg']);
  });
});

describe('orden por fecha EXIF', () => {
  const lib = emptyLibraryState();

  it('ordena por DateTimeOriginal y NUNCA por fecha de modificación', () => {
    const photos: Photo[] = [
      makePhoto('a/IMG_0003.jpg', { time: '2026:11:21 10:00:03', lastModified: 1 }),
      makePhoto('a/IMG_0001.jpg', { time: '2026:11:21 10:00:01', lastModified: 999_999 }),
      makePhoto('a/DSC_9999.jpg', { time: '2026:11:21 10:00:02', lastModified: 500 }),
    ];
    const order = orderLibrary(photos, lib, {});
    expect(order.flat).toEqual(['a/IMG_0001.jpg', 'a/DSC_9999.jpg', 'a/IMG_0003.jpg']);
  });

  it('las fotos sin EXIF van al final en orden natural de nombre', () => {
    const photos: Photo[] = [
      makePhoto('a/sin_fecha_10.png', { lastModified: 1 }),
      makePhoto('a/sin_fecha_2.png', { lastModified: 2 }),
      makePhoto('a/IMG_0001.jpg', { time: '2026:11:21 12:00:00' }),
    ];
    expect(orderLibrary(photos, lib, {}).flat).toEqual(['a/IMG_0001.jpg', 'a/sin_fecha_2.png', 'a/sin_fecha_10.png']);
  });

  it('con la misma hora, desempata por nombre natural', () => {
    const photos: Photo[] = [
      makePhoto('a/B_10.jpg', { time: '2026:11:21 10:00:00' }),
      makePhoto('a/B_9.jpg', { time: '2026:11:21 10:00:00' }),
    ];
    expect(orderLibrary(photos, lib, {}).flat).toEqual(['a/B_9.jpg', 'a/B_10.jpg']);
  });

  it('sin clasificar por defecto; sectores en el orden de la lista y «Sin clasificar» al final', () => {
    const photos: Photo[] = [
      makePhoto('Sector 10/a.jpg', { time: '2026:11:21 09:00:00' }),
      makePhoto('suelta.jpg', { time: '2026:11:21 08:00:00' }),
      makePhoto('Sector 2/iphone/b.jpg', { time: '2026:11:21 11:00:00' }),
    ];
    expect(orderLibrary(photos, lib, {}).sectors.map((s) => s.name)).toEqual([NO_SECTOR]);
    const listed = withSectors(lib, DEFAULT_SECTORS);
    expect(orderLibrary(photos, listed, {}).sectors.map((s) => s.name)).toEqual([...DEFAULT_SECTORS, NO_SECTOR]);
    const byFolder = classifyByFolder(listed, photos);
    expect(orderLibrary(photos, byFolder, {}).sectors.map((s) => s.name)).toEqual([
      ...DEFAULT_SECTORS,
      'Sector 2',
      'Sector 10',
      NO_SECTOR,
    ]);
  });
});

describe('desfase de hora por cámara', () => {
  const canon = buildCameraInfo('Canon', 'Canon EOS R6', '012345')!;
  const iphone = buildCameraInfo('Apple', 'iPhone 15 Pro')!;

  it('identifica la cámara por marca + modelo + número de serie', () => {
    const otraCanon = buildCameraInfo('Canon', 'Canon EOS R6', '999')!;
    expect(canon.id).not.toBe(otraCanon.id);
    expect(buildCameraInfo('  Canon ', 'Canon EOS R6\0', '012345')!.id).toBe(canon.id);
  });

  it('corrige un reloj adelantado y reordena', () => {
    // La Canon tiene el reloj 5 minutos adelantado.
    const photos: Photo[] = [
      makePhoto('x/canon.jpg', { time: '2026:11:21 10:06:00', camera: canon }),
      makePhoto('x/iphone.jpg', { time: '2026:11:21 10:03:00', camera: iphone }),
    ];
    const lib = emptyLibraryState();
    expect(orderLibrary(photos, lib, {}).flat).toEqual(['x/iphone.jpg', 'x/canon.jpg']);

    const settings: Record<string, CameraSettings> = { [canon.id]: { cameraId: canon.id, offsetSeconds: -5 * 60 } };
    expect(orderLibrary(photos, lib, settings).flat).toEqual(['x/canon.jpg', 'x/iphone.jpg']);
    expect(effectiveCaptureMs(photos[0]!, settings)).toBe(Date.UTC(2026, 10, 21, 10, 1, 0));
  });

  it('el desfase no afecta a otras cámaras ni a fotos sin fecha', () => {
    const settings = { [canon.id]: { cameraId: canon.id, offsetSeconds: 3600 } };
    expect(effectiveCaptureMs(makePhoto('a.jpg', { time: '2026:11:21 10:00:00', camera: iphone }), settings)).toBe(
      Date.UTC(2026, 10, 21, 10, 0, 0),
    );
    expect(effectiveCaptureMs(makePhoto('b.jpg', { camera: canon }), settings)).toBeUndefined();
  });

  it('formatea desfases legibles', () => {
    expect(formatOffset(0)).toBe('sin desfase');
    expect(formatOffset(-45)).toBe('−45 s');
    expect(formatOffset(3725)).toBe('+1 h 2 min 5 s');
  });
});

describe('orden manual', () => {
  const cmp = (a: string, b: string) => a.localeCompare(b);

  it('el orden manual prevalece sobre el automático', () => {
    expect(mergeManualOrder(['a', 'b', 'c'], ['c', 'a', 'b'], cmp)).toEqual(['c', 'a', 'b']);
  });

  it('las fotos nuevas se intercalan según el orden automático', () => {
    // Manual: c, a. Nuevas: b, d.
    expect(mergeManualOrder(['a', 'b', 'c', 'd'], ['c', 'a'], cmp)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('ignora IDs que ya no existen', () => {
    expect(mergeManualOrder(['a', 'b'], ['zz', 'b', 'a'], cmp)).toEqual(['b', 'a']);
  });

  it('orderLibrary aplica el orden manual del sector', () => {
    const photos = [
      makePhoto('S/1.jpg', { time: '2026:11:21 10:00:01' }),
      makePhoto('S/2.jpg', { time: '2026:11:21 10:00:02' }),
    ];
    const lib: LibraryState = { ...classifyByFolder(emptyLibraryState(), photos), manualOrder: { S: ['S/2.jpg', 'S/1.jpg'] } };
    const order = orderLibrary(photos, lib, {});
    expect(order.flat).toEqual(['S/2.jpg', 'S/1.jpg']);
    expect(order.sectors[0]?.hasManualOrder).toBe(true);
  });
});
