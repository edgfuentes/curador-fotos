import { CancelledError, throwIfCancelled } from '../ports';
import type {
  CancelSignal,
  DestinationDirectory,
  HasherFactory,
  IncrementalHasher,
  SourceDirectory,
} from '../ports';
import type { Photo, PhotoId } from '../model';
import { wallClockIso, cameraDisplayName, effectiveCaptureMs } from '../capture';
import type { CameraSettings } from '../model';
import { nameKey, resolveCollision, sanitizeFolderName } from './naming';
import type { ExportPlan, ExportPlanItem } from './plan';

export const MANIFEST_FILE = 'manifest.json';

export interface ExportProgress {
  readonly phase: 'preparing' | 'copying' | 'verifying' | 'manifest' | 'done';
  /** Índice (1…n) del archivo en curso. */
  readonly index: number;
  readonly total: number;
  readonly fileName: string;
  /** Bytes copiados + verificados / (2 × total), para una barra de progreso continua. */
  readonly bytesDone: number;
  readonly bytesTotal: number;
}

export type ItemOutcome =
  | { readonly status: 'verified'; readonly sha256: string; readonly exportedPath: string }
  | { readonly status: 'failed'; readonly error: string; readonly exportedPath?: string }
  | { readonly status: 'skipped' };

export interface ExportItemResult {
  readonly item: ExportPlanItem;
  readonly outcome: ItemOutcome;
}

export interface ExportSummary {
  readonly folderName: string;
  readonly total: number;
  readonly copied: number;
  readonly verified: number;
  readonly failed: number;
  readonly skipped: number;
  readonly cancelled: boolean;
  readonly bytes: number;
  readonly durationMs: number;
  readonly manifestWritten: boolean;
  readonly results: readonly ExportItemResult[];
}

export interface RunExportParams {
  readonly plan: ExportPlan;
  readonly source: SourceDirectory;
  /** Carpeta elegida por el usuario; dentro se crea `plan.options.baseFolderName`. */
  readonly destination: DestinationDirectory;
  readonly createHasher: HasherFactory;
  readonly photos: ReadonlyMap<PhotoId, Photo>;
  readonly cameraSettings: Readonly<Record<string, CameraSettings>>;
  readonly signal?: CancelSignal;
  readonly onProgress?: (p: ExportProgress) => void;
  readonly now?: () => Date;
  readonly appVersion?: string;
}

/**
 * Elige el nombre de la carpeta de exportación: usa el nombre base si no existe
 * o está vacía; si ya tiene archivos, crea "Nombre (2)", "Nombre (3)"…
 * Nunca se sobrescribe una exportación anterior.
 */
export async function chooseExportFolder(
  destination: DestinationDirectory,
  baseName: string,
): Promise<DestinationDirectory> {
  const base = sanitizeFolderName(baseName);
  const existing = new Set((await destination.listEntryNames()).map(nameKey));
  if (existing.has(nameKey(base))) {
    const dir = await destination.getDirectory(base, { create: false }).catch(() => null);
    if (dir && (await dir.listEntryNames()).length === 0) return dir;
  }
  // Si la base está libre, resolveCollision la devuelve tal cual; si no, agrega " (2)", " (3)"…
  const name = resolveCollision(base, new Set(existing));
  return destination.getDirectory(name, { create: true });
}

/**
 * Copia los ORIGINALES byte a byte y verifica cada copia:
 *  1. Se lee el original en bloques; cada bloque se hashea (SHA-256) y se escribe.
 *  2. Se vuelve a leer la copia desde el destino y se hashea de nuevo.
 *  3. Si tamaño o hash no coinciden, la copia se elimina y se informa el error.
 * Al final se escribe manifest.json con el orden, los hashes y la fecha.
 */
export async function runExport(params: RunExportParams): Promise<ExportSummary> {
  const { plan, source, destination, createHasher, signal, onProgress } = params;
  const now = params.now ?? (() => new Date());
  const started = Date.now();
  const total = plan.items.length;
  const bytesTotal = plan.totalBytes * 2;
  let bytesDone = 0;
  const emit = (phase: ExportProgress['phase'], index: number, fileName: string) =>
    onProgress?.({ phase, index, total, fileName, bytesDone, bytesTotal });

  emit('preparing', 0, '');
  const root = await chooseExportFolder(destination, plan.options.baseFolderName);
  const dirs = new Map<string, { dir: DestinationDirectory; taken: Set<string> }>();
  const dirFor = async (subfolder: string) => {
    let d = dirs.get(subfolder);
    if (!d) {
      const dir = subfolder ? await root.getDirectory(subfolder, { create: true }) : root;
      d = { dir, taken: new Set((await dir.listEntryNames()).map(nameKey)) };
      dirs.set(subfolder, d);
    }
    return d;
  };

  const results: ExportItemResult[] = [];
  let cancelled = false;
  for (let i = 0; i < plan.items.length; i++) {
    const item = plan.items[i]!;
    if (signal?.aborted) {
      cancelled = true;
      results.push(...plan.items.slice(i).map((it) => ({ item: it, outcome: { status: 'skipped' } as const })));
      break;
    }
    const { dir, taken } = await dirFor(item.subfolder);
    // Colisión con un archivo que ya existía en la carpeta (no debería ocurrir en una carpeta nueva).
    const targetName = taken.has(nameKey(item.targetName)) ? resolveCollision(item.targetName, taken) : item.targetName;
    taken.add(nameKey(targetName));
    const exportedPath = item.subfolder ? `${item.subfolder}/${targetName}` : targetName;
    const bytesBefore = bytesDone;
    try {
      emit('copying', i + 1, targetName);
      const original = await source.openFile(item.sourcePath);
      const srcHasher = await createHasher();
      let written = 0;
      await dir.writeFile(
        targetName,
        tap(original.stream(), (chunk) => {
          throwIfCancelled(signal);
          srcHasher.update(chunk);
          written += chunk.length;
          bytesDone += chunk.length;
          emit('copying', i + 1, targetName);
        }),
        signal,
      );
      const sourceHash = srcHasher.digestHex();
      if (written !== original.size) {
        throw new Error(`Se leyeron ${written} bytes pero el original tiene ${original.size}.`);
      }

      emit('verifying', i + 1, targetName);
      const copy = await dir.openFile(targetName);
      const copyHash = await hashSource(copy.stream(), await createHasher(), (n) => {
        bytesDone += n;
        emit('verifying', i + 1, targetName);
      });
      if (copy.size !== original.size || copyHash !== sourceHash) {
        await dir.removeEntry(targetName).catch(() => undefined);
        throw new Error(
          `La copia no es idéntica al original (tamaño ${copy.size}/${original.size}, SHA-256 distinto). Se eliminó la copia.`,
        );
      }
      results.push({ item, outcome: { status: 'verified', sha256: sourceHash, exportedPath } });
    } catch (err) {
      bytesDone = bytesBefore + item.size * 2;
      if (err instanceof CancelledError || signal?.aborted) {
        cancelled = true;
        results.push({ item, outcome: { status: 'skipped' } });
        results.push(...plan.items.slice(i + 1).map((it) => ({ item: it, outcome: { status: 'skipped' } as const })));
        break;
      }
      results.push({ item, outcome: { status: 'failed', error: errorMessage(err), exportedPath } });
    }
  }

  const verified = results.filter((r) => r.outcome.status === 'verified').length;
  const failed = results.filter((r) => r.outcome.status === 'failed').length;
  const skipped = results.filter((r) => r.outcome.status === 'skipped').length;

  let manifestWritten = false;
  if (verified > 0 || failed > 0) {
    emit('manifest', total, MANIFEST_FILE);
    const manifest = buildManifest({
      plan,
      results,
      folderName: root.name,
      sourceName: source.name,
      exportedAt: now(),
      cancelled,
      photos: params.photos,
      cameraSettings: params.cameraSettings,
      appVersion: params.appVersion ?? '0.0.0',
    });
    try {
      const rootTaken = (await dirFor('')).taken;
      const manifestName = resolveCollision(MANIFEST_FILE, rootTaken);
      await root.writeFile(manifestName, single(utf8Encode(JSON.stringify(manifest, null, 2))));
      manifestWritten = true;
    } catch {
      manifestWritten = false;
    }
  }
  emit('done', total, '');
  return {
    folderName: root.name,
    total,
    copied: verified,
    verified,
    failed,
    skipped,
    cancelled,
    bytes: results.reduce((s, r) => s + (r.outcome.status === 'verified' ? r.item.size : 0), 0),
    durationMs: Date.now() - started,
    manifestWritten,
    results,
  };
}

async function* tap(stream: AsyncIterable<Uint8Array>, fn: (chunk: Uint8Array) => void): AsyncIterable<Uint8Array> {
  for await (const chunk of stream) {
    fn(chunk);
    yield chunk;
  }
}

/** Codificación UTF-8 sin depender de TextEncoder (no forma parte de ECMAScript). */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}

async function* single(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

/** Calcula el SHA-256 de un flujo de bytes. */
export async function hashSource(
  stream: AsyncIterable<Uint8Array>,
  hasher: IncrementalHasher,
  onChunk?: (bytes: number) => void,
): Promise<string> {
  for await (const chunk of stream) {
    hasher.update(chunk);
    onChunk?.(chunk.length);
  }
  return hasher.digestHex();
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

// --------------------------------------------------------------- manifest

export interface ExportManifest {
  readonly app: string;
  readonly appVersion: string;
  readonly manifestVersion: 1;
  readonly exportedAt: string;
  readonly sourceFolder: string;
  readonly exportFolder: string;
  readonly options: ExportPlan['options'];
  readonly cancelled: boolean;
  readonly summary: { readonly total: number; readonly verified: number; readonly failed: number; readonly skipped: number };
  readonly items: readonly {
    readonly order: number;
    readonly orderInFolder: number;
    readonly sector: string;
    readonly originalPath: string;
    readonly exportedPath: string | null;
    readonly size: number;
    readonly sha256: string | null;
    readonly status: ItemOutcome['status'];
    readonly error?: string;
    readonly captureTime: string | null;
    readonly correctedCaptureTime: string | null;
    readonly camera: string | null;
  }[];
}

export function buildManifest(args: {
  plan: ExportPlan;
  results: readonly ExportItemResult[];
  folderName: string;
  sourceName: string;
  exportedAt: Date;
  cancelled: boolean;
  photos: ReadonlyMap<PhotoId, Photo>;
  cameraSettings: Readonly<Record<string, CameraSettings>>;
  appVersion: string;
}): ExportManifest {
  const { results } = args;
  return {
    app: 'Curador de Fotos',
    appVersion: args.appVersion,
    manifestVersion: 1,
    exportedAt: args.exportedAt.toISOString(),
    sourceFolder: args.sourceName,
    exportFolder: args.folderName,
    options: args.plan.options,
    cancelled: args.cancelled,
    summary: {
      total: results.length,
      verified: results.filter((r) => r.outcome.status === 'verified').length,
      failed: results.filter((r) => r.outcome.status === 'failed').length,
      skipped: results.filter((r) => r.outcome.status === 'skipped').length,
    },
    items: results.map(({ item, outcome }) => {
      const photo = args.photos.get(item.photoId);
      const corrected = photo ? effectiveCaptureMs(photo, args.cameraSettings) : undefined;
      return {
        order: item.order,
        orderInFolder: item.orderInFolder,
        sector: item.sector,
        originalPath: item.sourcePath,
        exportedPath: outcome.status === 'skipped' ? null : (outcome.exportedPath ?? null),
        size: item.size,
        sha256: outcome.status === 'verified' ? outcome.sha256 : null,
        status: outcome.status,
        ...(outcome.status === 'failed' ? { error: outcome.error } : {}),
        captureTime: photo?.capture ? wallClockIso(photo.capture.wallClockMs) : null,
        correctedCaptureTime: corrected !== undefined ? wallClockIso(corrected) : null,
        camera: photo?.camera ? cameraDisplayName(photo.camera) : null,
      };
    }),
  };
}
