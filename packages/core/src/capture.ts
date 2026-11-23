import type { CameraInfo, CameraSettings, CaptureInfo } from './model';

/**
 * Interpreta una fecha EXIF "YYYY:MM:DD HH:MM:SS" (también acepta "-" o "T").
 * Devuelve la hora de reloj como milisegundos pseudo-UTC, o undefined si es inválida
 * (p. ej. "0000:00:00 00:00:00", que algunas cámaras escriben sin reloj configurado).
 */
export function parseExifDateTime(
  value: string | undefined | null,
  subSec?: string | number | null,
  offset?: string | null,
): CaptureInfo | undefined {
  if (!value) return undefined;
  const m = /^\s*(\d{4})[:\-/](\d{2})[:\-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?/.exec(String(value));
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, inlineFrac] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) {
    return undefined;
  }
  const ms = fractionToMs(inlineFrac ?? (subSec == null ? undefined : String(subSec).trim()));
  const wallClockMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const tz = parseOffset(offset);
  return tz === undefined
    ? { wallClockMs, raw: String(value).trim() }
    : { wallClockMs, raw: String(value).trim(), tzOffsetMinutes: tz };
}

function fractionToMs(frac: string | undefined): number {
  if (!frac || !/^\d+$/.test(frac)) return 0;
  // SubSecTime son dígitos de fracción decimal: "5" = 0,5 s; "05" = 0,05 s.
  return Math.round(Number(`0.${frac}`) * 1000) % 1000;
}

export function parseOffset(offset: string | null | undefined): number | undefined {
  if (!offset) return undefined;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset.trim());
  if (!m) return undefined;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** Formatea milisegundos pseudo-UTC como "21/11/2026 10:32:05". */
export function formatWallClock(ms: number, withSeconds = true): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  const base = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return withSeconds ? `${base}:${p(d.getUTCSeconds())}` : base;
}

/** ISO local sin zona: "2026-11-21T10:32:05.000". */
export function wallClockIso(ms: number): string {
  return new Date(ms).toISOString().replace('Z', '');
}

// ---------------------------------------------------------------- cámaras

function clean(s: string | undefined | null): string {
  return (s ?? '').replace(/\0/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Construye la información de cámara. El modelo a menudo repite la marca
 * ("Canon" + "Canon EOS R6"), así que se evita duplicarla en la etiqueta.
 */
export function buildCameraInfo(
  make: string | undefined | null,
  model: string | undefined | null,
  serial?: string | number | null,
): CameraInfo | undefined {
  const mk = clean(make);
  const md = clean(model);
  if (!mk && !md) return undefined;
  const sn = clean(serial == null ? undefined : String(serial));
  const id = [mk.toLowerCase(), md.toLowerCase(), sn.toLowerCase()].join('|');
  return sn ? { id, make: mk, model: md, serial: sn } : { id, make: mk, model: md };
}

export function cameraDisplayName(camera: CameraInfo): string {
  const model = camera.model.toLowerCase().startsWith(camera.make.toLowerCase())
    ? camera.model
    : `${camera.make} ${camera.model}`.trim();
  return camera.serial ? `${model} · nº ${camera.serial}` : model;
}

export const UNKNOWN_CAMERA_ID = '__sin_camara__';

/**
 * Hora efectiva para ordenar = hora de reloj de la cámara + desfase configurado.
 * Devuelve undefined si la foto no tiene fecha EXIF.
 */
export function effectiveCaptureMs(
  photo: { capture?: CaptureInfo; camera?: CameraInfo },
  settings: Readonly<Record<string, CameraSettings>>,
): number | undefined {
  if (!photo.capture) return undefined;
  const offset = photo.camera ? (settings[photo.camera.id]?.offsetSeconds ?? 0) : 0;
  return photo.capture.wallClockMs + offset * 1000;
}

/** Valida y normaliza un desfase en segundos (límite ±7 días). */
export function clampOffsetSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  const limit = 7 * 24 * 3600;
  return Math.max(-limit, Math.min(limit, Math.round(seconds)));
}

/** "+1 h 02 min 05 s", "−45 s", "sin desfase". */
export function formatOffset(seconds: number): string {
  if (!seconds) return 'sin desfase';
  const sign = seconds < 0 ? '−' : '+';
  let rest = Math.abs(seconds);
  const parts: string[] = [];
  const d = Math.floor(rest / 86400);
  rest -= d * 86400;
  const h = Math.floor(rest / 3600);
  rest -= h * 3600;
  const m = Math.floor(rest / 60);
  const s = rest - m * 60;
  if (d) parts.push(`${d} d`);
  if (h) parts.push(`${h} h`);
  if (m) parts.push(`${m} min`);
  if (s) parts.push(`${s} s`);
  return `${sign}${parts.join(' ')}`;
}
