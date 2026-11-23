/**
 * Utilidades JPEG: leer dimensiones / tipo de codificación desde el encabezado
 * y localizar JPEG completos dentro de un bloque de bytes (para RAW sin
 * estructura TIFF conocida).
 */

export interface JpegInfo {
  readonly width: number;
  readonly height: number;
  /** Marcador SOF (0xC0 baseline, 0xC2 progresivo, 0xC3 sin pérdida…). */
  readonly sof: number;
}

/** Los navegadores decodifican baseline (C0), extendido (C1) y progresivo (C2). */
export function isBrowserDecodable(info: JpegInfo): boolean {
  return info.sof === 0xc0 || info.sof === 0xc1 || info.sof === 0xc2;
}

const isSof = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

/** Lee el encabezado de un JPEG que empieza en `start`. */
export function parseJpegHeader(bytes: Uint8Array, start = 0): JpegInfo | null {
  if (bytes[start] !== 0xff || bytes[start + 1] !== 0xd8) return null;
  let p = start + 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return null;
    let marker = bytes[p + 1]!;
    while (marker === 0xff && p + 2 < bytes.length) {
      p++;
      marker = bytes[p + 1]!;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker >= 0xd0 && marker <= 0xd7) {
      p += 2;
      continue;
    }
    const len = (bytes[p + 2]! << 8) | bytes[p + 3]!;
    if (len < 2) return null;
    if (isSof(marker)) {
      if (p + 9 > bytes.length) return null;
      const height = (bytes[p + 5]! << 8) | bytes[p + 6]!;
      const width = (bytes[p + 7]! << 8) | bytes[p + 8]!;
      return width > 0 && height > 0 ? { width, height, sof: marker } : null;
    }
    p += 2 + len;
  }
  return null;
}

/**
 * Devuelve el offset (exclusivo) donde termina el JPEG que empieza en `start`,
 * o -1 si no termina dentro de `bytes`. Maneja JPEG progresivos (varios SOS).
 */
export function findJpegEnd(bytes: Uint8Array, start: number): number {
  let p = start + 2;
  const n = bytes.length;
  while (p + 2 <= n) {
    if (bytes[p] !== 0xff) return -1;
    const marker = bytes[p + 1]!;
    if (marker === 0xd9) return p + 2;
    if (marker === 0xff) {
      p++;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      p += 2;
      continue;
    }
    if (p + 4 > n) return -1;
    const len = (bytes[p + 2]! << 8) | bytes[p + 3]!;
    p += 2 + len;
    if (marker === 0xda) {
      // Datos de entropía: avanzar hasta el próximo marcador real.
      while (p + 1 < n) {
        if (bytes[p] === 0xff) {
          const m = bytes[p + 1]!;
          if (m === 0x00 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) {
            p += m === 0xff ? 1 : 2;
            continue;
          }
          break;
        }
        p++;
      }
    }
  }
  return -1;
}

export interface FoundJpeg extends JpegInfo {
  readonly offset: number;
  readonly length: number;
}

/** Busca JPEG decodificables dentro de un bloque (respaldo para RAW sin estructura conocida). */
export function scanForJpegs(bytes: Uint8Array, baseOffset = 0, minSide = 120): FoundJpeg[] {
  const out: FoundJpeg[] = [];
  let i = 0;
  while (i + 3 < bytes.length) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      const info = parseJpegHeader(bytes, i);
      if (info && isBrowserDecodable(info) && Math.max(info.width, info.height) >= minSide) {
        const end = findJpegEnd(bytes, i);
        if (end > 0) {
          out.push({ ...info, offset: baseOffset + i, length: end - i });
          i = end;
          continue;
        }
      }
    }
    i++;
  }
  return out;
}
