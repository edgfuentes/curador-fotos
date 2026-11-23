import { useSession, useStoreApi } from '../app/context';

export function ScanProgress() {
  const store = useStoreApi();
  const scan = useSession((s) => s.scan);
  const name = useSession((s) => s.source?.name ?? '');
  const pct = scan.total ? Math.round((scan.done / scan.total) * 100) : undefined;
  const label =
    scan.step === 'files'
      ? `Buscando fotos… ${scan.found.toLocaleString('es')} encontradas`
      : scan.step === 'metadata'
        ? `Leyendo fecha y cámara (EXIF)… ${scan.done.toLocaleString('es')} de ${scan.total.toLocaleString('es')}`
        : 'Recuperando tus marcas…';
  return (
    <main className="home" aria-busy="true">
      <div className="home-card">
        <h1>Abriendo «{name}»</h1>
        <p className="home-lead" aria-live="polite">
          {label}
        </p>
        <div
          className="progress"
          role="progressbar"
          aria-label="Progreso de lectura"
          aria-valuemin={0}
          aria-valuemax={100}
          {...(pct !== undefined ? { 'aria-valuenow': pct } : {})}
        >
          <div className={pct === undefined ? 'progress-bar indeterminate' : 'progress-bar'} style={{ width: `${pct ?? 40}%` }} />
        </div>
        <p className="muted small">La primera vez puede tardar; después los datos quedan en caché en este navegador.</p>
        <button className="btn" onClick={() => store.closeSource()}>
          Cancelar
        </button>
      </div>
    </main>
  );
}
