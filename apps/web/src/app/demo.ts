/**
 * Modo demostración: genera fotos de ejemplo en el almacenamiento privado del
 * navegador (OPFS) para probar la app sin tocar archivos reales.
 * Incluye: 3 sectores, 3 cámaras (una con el reloj 5 minutos adelantado),
 * nombres que no coinciden con el orden de captura, un PNG sin EXIF,
 * un RAW con vista previa incrustada, un duplicado exacto y un archivo
 * sin vista previa posible.
 */
import { buildTiff, withExif, WebDestinationDirectory, WebSourceDirectory, type ExifFields } from '@curador/adapters-web';

const SOURCE_DIR = 'Fotos de demostración';
const DEST_DIR = 'Destino de demostración';
const VERSION = '4';

interface Cam {
  make: string;
  model: string;
  serial?: string;
  prefix: string;
  ext: string;
  /** Error de reloj de la cámara, en segundos (la Canon va 5 minutos adelantada). */
  clockError: number;
  offsetTime?: string;
  hue: number;
}

const CAMS: Cam[] = [
  { make: 'Canon', model: 'Canon EOS R6', serial: '012345678', prefix: 'IMG_', ext: 'JPG', clockError: 300, hue: 205 },
  { make: 'Apple', model: 'iPhone 15 Pro', prefix: 'IMG_', ext: 'JPG', clockError: 0, offsetTime: '-03:00', hue: 145 },
  { make: 'SONY', model: 'ILCE-7M4', serial: '4711', prefix: 'DSC0', ext: 'JPG', clockError: 0, hue: 25 },
];

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const exifTime = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

async function render(text: string[], hue: number, portrait = false, type = 'image/jpeg'): Promise<Uint8Array> {
  const w = portrait ? 1067 : 1600;
  const h = portrait ? 1600 : 1067;
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue} 55% 38%)`);
  g.addColorStop(1, `hsl(${(hue + 50) % 360} 60% 18%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    ctx.arc((i * 211) % w, (i * 137) % h, 60 + ((i * 47) % 180), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = `bold ${Math.round(w / 9)}px system-ui, sans-serif`;
  ctx.fillText(text[0] ?? '', w / 2, h / 2 - w / 30);
  ctx.font = `${Math.round(w / 26)}px system-ui, sans-serif`;
  text.slice(1).forEach((t, i) => ctx.fillText(t, w / 2, h / 2 + w / 14 + i * (w / 20)));
  const blob = await c.convertToBlob({ type, quality: 0.86 });
  return new Uint8Array(await blob.arrayBuffer());
}

/** Gira 90° en sentido horario (para simular un sensor con la cámara en vertical). */
async function rotatedCw(jpeg: Uint8Array): Promise<Uint8Array> {
  const bmp = await createImageBitmap(new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
  const c = new OffscreenCanvas(bmp.height, bmp.width);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(0, 1, -1, 0, bmp.height, 0);
  ctx.drawImage(bmp, 0, 0);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.86 })).arrayBuffer());
}

async function writeFile(dir: FileSystemDirectoryHandle, path: string, bytes: Uint8Array): Promise<void> {
  const parts = path.split('/');
  let d = dir;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
  const fh = await d.getFileHandle(parts[parts.length - 1]!, { create: true });
  const w = await fh.createWritable();
  await w.write(bytes as Uint8Array<ArrayBuffer>);
  await w.close();
}

async function generate(dir: FileSystemDirectoryHandle): Promise<void> {
  const start = Date.UTC(2026, 10, 21, 10, 0, 0);
  const sectors = [
    { name: 'Sector 1', count: 12 },
    { name: 'Sector 2', count: 10 },
    { name: 'Sector 3', count: 8 },
  ];
  const files: { path: string; bytes: () => Promise<Uint8Array> }[] = [];
  let t = start;
  const counters = CAMS.map((_, i) => 1000 + i * 3700);
  for (const [si, s] of sectors.entries()) {
    for (let k = 0; k < s.count; k++) {
      t += 37_000 + ((k * 7919) % 90_000);
      const camIndex = (k * 2 + si + Math.floor(k / 3)) % 3;
      const cam = CAMS[camIndex]!;
      counters[camIndex] = counters[camIndex]! + 1 + ((k * 13) % 4);
      const realTime = t;
      const fields: ExifFields = {
        make: cam.make,
        model: cam.model,
        dateTimeOriginal: exifTime(realTime + cam.clockError * 1000),
        subSec: String((k * 37) % 100).padStart(2, '0'),
        orientation: 1,
        ...(cam.serial ? { serial: cam.serial } : {}),
        ...(cam.offsetTime ? { offsetTime: cam.offsetTime } : {}),
      };
      const label = cam.model.replace('Canon ', '');
      const portrait = k % 4 === 3;
      const name = `${cam.prefix}${pad(counters[camIndex]!, 4)}.${cam.ext}`;
      const sub = cam.make === 'Apple' ? 'iPhone' : cam.make === 'Canon' ? 'Canon' : 'Sony';
      files.push({
        path: `${s.name}/${sub}/${name}`,
        bytes: async () => withExif(await render([clock(realTime), s.name, `${label} · hora real`], cam.hue, portrait), fields),
      });
    }
  }

  // RAW (estilo NEF) con vista previa incrustada y orientación vertical en el EXIF.
  const rawTime = start + 50 * 60_000;
  files.push({
    path: 'Sector 2/Nikon/DSC_0420.NEF',
    bytes: async () =>
      buildTiff(
        { make: 'NIKON CORPORATION', model: 'NIKON Z 6_2', serial: '6012345', dateTimeOriginal: exifTime(rawTime), orientation: 8 },
        // Como en una cámara real: la vista se guarda "acostada" y la orientación EXIF (8) indica cómo enderezarla.
        await rotatedCw(await render([clock(rawTime), 'Sector 2', 'RAW NEF vertical'], 280, true)),
      ),
  });
  // PNG sin EXIF: se ordenan al final por nombre natural (2 antes que 10).
  files.push({ path: 'Sector 3/captura_10.png', bytes: () => render(['captura_10', 'PNG sin EXIF'], 0, false, 'image/png') });
  files.push({ path: 'Sector 3/captura_2.png', bytes: () => render(['captura_2', 'PNG sin EXIF'], 0, false, 'image/png') });
  // Archivo sin vista previa posible (se puede marcar y exportar igual).
  files.push({
    path: 'Sector 3/SDIM0001.X3F',
    bytes: async () => {
      const b = new Uint8Array(64 * 1024);
      crypto.getRandomValues(b.subarray(0, 60000));
      b.set([0x46, 0x4f, 0x56, 0x62]);
      return b;
    },
  });
  // Archivos de sistema que se deben ignorar.
  files.push({ path: 'Sector 1/._IMG_1001.JPG', bytes: async () => new Uint8Array([0, 5, 22, 7]) });

  // Escribir en orden mezclado (la fecha de modificación NO debe influir en el orden).
  const shuffled = [...files].sort((a, b) => (a.path.length * 31 + a.path.charCodeAt(a.path.length - 5)) % 17 - (b.path.length * 31 + b.path.charCodeAt(b.path.length - 5)) % 17);
  const written = new Map<string, Uint8Array>();
  for (const f of shuffled) {
    const bytes = await f.bytes();
    written.set(f.path, bytes);
    await writeFile(dir, f.path, bytes);
  }
  // Duplicado exacto de la primera foto de Sector 3.
  const firstS3 = files.find((f) => f.path.startsWith('Sector 3/') && f.path.endsWith('.JPG'))!;
  await writeFile(dir, firstS3.path.replace('.JPG', ' copia.JPG'), written.get(firstS3.path)!);
}

async function opfsRoot(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) throw new Error('Este navegador no permite el modo demostración.');
  return navigator.storage.getDirectory();
}

type IterableDir = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };

async function hasAnyFile(dir: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const h of (dir as IterableDir).values()) {
    if (h.kind === 'file') return true;
    if (await hasAnyFile(h as FileSystemDirectoryHandle)) return true;
  }
  return false;
}

export async function createDemoSource(): Promise<WebSourceDirectory> {
  const root = await opfsRoot();
  let version: string | null = null;
  try {
    version = localStorage.getItem('curador-demo-version');
  } catch {
    /* sin almacenamiento */
  }
  if (version !== VERSION) {
    await root.removeEntry(SOURCE_DIR, { recursive: true }).catch(() => undefined);
    await root.removeEntry(DEST_DIR, { recursive: true }).catch(() => undefined);
  }
  let dir = await root.getDirectoryHandle(SOURCE_DIR, { create: true });
  // Si el navegador borró los archivos (pero no las carpetas), se vuelve a generar todo.
  if (!(await hasAnyFile(dir))) {
    await root.removeEntry(SOURCE_DIR, { recursive: true }).catch(() => undefined);
    dir = await root.getDirectoryHandle(SOURCE_DIR, { create: true });
    await generate(dir);
    try {
      localStorage.setItem('curador-demo-version', VERSION);
    } catch {
      /* sin almacenamiento */
    }
  }
  return new WebSourceDirectory(dir);
}

export async function createDemoDestination(): Promise<WebDestinationDirectory> {
  const root = await opfsRoot();
  return new WebDestinationDirectory(await root.getDirectoryHandle(DEST_DIR, { create: true }));
}
