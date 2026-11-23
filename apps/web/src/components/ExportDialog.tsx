import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildExportPlan,
  DEFAULT_EXPORT_OPTIONS,
  prefixedName,
  runExport,
  statusOf,
  type DestinationDirectory,
  type ExportOptions,
  type ExportProgress,
  type ExportSummary,
} from '@curador/core';
import { useDerived, usePlatform, useSession, useStoreApi } from '../app/context';
import { createDemoDestination } from '../app/demo';
import { Dialog } from './Dialog';

const APP_VERSION = '0.1.0';

function bytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
  return `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} MB`;
}

export function ExportDialog() {
  const store = useStoreApi();
  const { fileSystem, createHasher } = usePlatform();
  const { ordered } = useDerived();
  const library = useSession((s) => s.history.present);
  const byId = useSession((s) => s.byId);
  const cameras = useSession((s) => s.cameras);
  const source = useSession((s) => s.source);
  const demo = useSession((s) => s.demo);

  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [phase, setPhase] = useState<'options' | 'running' | 'summary'>('options');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [summary, setSummary] = useState<ExportSummary | null>(null);
  const [destName, setDestName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void store.loadPreference<ExportOptions>('export').then((o) => o && setOptions({ ...DEFAULT_EXPORT_OPTIONS, ...o }));
  }, [store]);
  const update = (patch: Partial<ExportOptions>) => {
    const next = { ...options, ...patch };
    setOptions(next);
    void store.savePreference('export', next);
  };

  const markedIds = useMemo(() => ordered.flat.filter((id) => statusOf(library, id) === 'marked'), [ordered, library]);
  const plan = useMemo(
    () => buildExportPlan(markedIds, byId, ordered.sectorById, { ...options, baseFolderName: options.baseFolderName.trim() || DEFAULT_EXPORT_OPTIONS.baseFolderName }),
    [markedIds, byId, ordered.sectorById, options],
  );
  const perFolder = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of plan.items) m.set(it.subfolder, (m.get(it.subfolder) ?? 0) + 1);
    return [...m];
  }, [plan]);

  const start = async () => {
    if (!source) return;
    setError(null);
    let destination: DestinationDirectory | null;
    try {
      destination = demo ? await createDemoDestination() : await fileSystem.pickDestinationDirectory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!destination) return;
    if (await fileSystem.isInside(source, destination).catch(() => false)) {
      const ok = window.confirm(
        'La carpeta de destino está dentro de la carpeta de fotos de origen. Las copias quedarán junto a los originales (la app las ignorará al escanear). ¿Continuar?',
      );
      if (!ok) return;
    }
    setDestName(destination.name);
    const abort = new AbortController();
    abortRef.current = abort;
    setPhase('running');
    let frame = 0;
    let latest: ExportProgress | null = null;
    try {
      const result = await runExport({
        plan,
        source,
        destination,
        createHasher,
        photos: byId,
        cameraSettings: cameras,
        signal: abort.signal,
        appVersion: APP_VERSION,
        onProgress: (p) => {
          latest = p;
          if (!frame) {
            frame = requestAnimationFrame(() => {
              frame = 0;
              setProgress(latest);
            });
          }
        },
      });
      cancelAnimationFrame(frame);
      setSummary(result);
      setPhase('summary');
      store.toast(
        result.failed ? `Exportación con ${result.failed} errores` : `Exportadas y verificadas ${result.verified} fotos`,
        result.failed ? 'error' : 'success',
        6000,
      );
    } catch (err) {
      cancelAnimationFrame(frame);
      setError(err instanceof Error ? err.message : String(err));
      setPhase('options');
    } finally {
      abortRef.current = null;
    }
  };

  const close = () => {
    if (phase === 'running') return;
    store.setDialog(null);
  };

  return (
    <Dialog title="Exportar seleccionadas" onClose={close} closable={phase !== 'running'} wide>
      {phase === 'options' && (
        <>
          <p>
            Se copiarán <strong>{plan.items.length} originales</strong> ({bytes(plan.totalBytes)}) byte a byte, en el orden
            definido, y cada copia se verificará con SHA-256. Los originales no se tocan.
          </p>
          {plan.items.length === 0 && (
            <p className="warn" role="alert">
              No hay fotos marcadas. Marca fotos con la tecla P antes de exportar.
            </p>
          )}
          <div className="form">
            <label>
              Nombre de la carpeta
              <input value={options.baseFolderName} onChange={(e) => update({ baseFolderName: e.target.value })} />
            </label>
            <label className="check">
              <input type="checkbox" checked={options.bySector} onChange={(e) => update({ bySector: e.target.checked })} />
              Crear una subcarpeta por sector (la numeración se reinicia en cada una)
            </label>
            <label className="check">
              <input type="checkbox" checked={options.numberPrefix} onChange={(e) => update({ numberPrefix: e.target.checked })} />
              Agregar prefijo numérico ({prefixedName(1, Math.max(1, plan.items.length), 'IMG_1234.JPG')}) para que cualquier visor
              respete el orden
            </label>
          </div>
          <div className="export-preview">
            <code>
              {options.baseFolderName || DEFAULT_EXPORT_OPTIONS.baseFolderName}/
              {perFolder.map(([folder, n]) => (
                <span key={folder} className="tree">
                  {folder ? `  ${folder}/  (${n} fotos)` : `  ${n} fotos`}
                </span>
              ))}
              <span className="tree">  manifest.json</span>
            </code>
            {plan.items.length > 0 && (
              <p className="muted small">
                Primera: {plan.items[0]!.subfolder ? `${plan.items[0]!.subfolder}/` : ''}
                {plan.items[0]!.targetName}
              </p>
            )}
          </div>
          {demo && <p className="muted small">Modo demostración: se exporta al almacenamiento privado del navegador.</p>}
          {error && (
            <p className="warn" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="btn" onClick={close}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={start} disabled={plan.items.length === 0}>
              {demo ? 'Exportar' : 'Elegir destino y exportar…'}
            </button>
          </div>
        </>
      )}

      {phase === 'running' && (
        <>
          <p aria-live="polite">
            {progress?.phase === 'preparing'
              ? 'Preparando carpetas…'
              : progress?.phase === 'manifest'
                ? 'Escribiendo manifest.json…'
                : `${progress?.phase === 'verifying' ? 'Verificando' : 'Copiando'} ${progress?.index ?? 0} de ${progress?.total ?? plan.items.length}: ${progress?.fileName ?? ''}`}
          </p>
          <ProgressBar value={progress ? progress.bytesDone / Math.max(1, progress.bytesTotal) : 0} />
          <p className="muted small">Destino: {destName}</p>
          <div className="dialog-actions">
            <button className="btn" onClick={() => abortRef.current?.abort()}>
              Cancelar exportación
            </button>
          </div>
        </>
      )}

      {phase === 'summary' && summary && (
        <>
          <div className={`summary ${summary.failed ? 'has-errors' : ''}`}>
            <div>
              <strong>{summary.copied}</strong>
              <span>copiadas</span>
            </div>
            <div>
              <strong>{summary.verified}</strong>
              <span>verificadas (SHA-256)</span>
            </div>
            <div>
              <strong>{summary.failed}</strong>
              <span>errores</span>
            </div>
            {summary.skipped > 0 && (
              <div>
                <strong>{summary.skipped}</strong>
                <span>sin copiar</span>
              </div>
            )}
          </div>
          <p>
            {summary.cancelled ? 'Exportación cancelada. ' : ''}
            Carpeta creada: <strong>{destName}/{summary.folderName}</strong> · {bytes(summary.bytes)} en {(summary.durationMs / 1000).toFixed(1).replace('.', ',')} s
            {summary.manifestWritten ? ' · manifest.json incluido' : ''}
          </p>
          {summary.failed > 0 && (
            <ul className="errors">
              {summary.results
                .filter((r) => r.outcome.status === 'failed')
                .map((r) => (
                  <li key={r.item.photoId}>
                    <strong>{r.item.sourcePath}</strong>: {r.outcome.status === 'failed' ? r.outcome.error : ''}
                  </li>
                ))}
            </ul>
          )}
          <div className="dialog-actions">
            <button className="btn btn-primary" onClick={close} autoFocus>
              Listo
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="progress" role="progressbar" aria-label="Progreso de exportación" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className="progress-bar" style={{ width: `${pct}%` }} />
      <span className="progress-label">{pct} %</span>
    </div>
  );
}
