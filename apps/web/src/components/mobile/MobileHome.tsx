import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import {
  defaultCarreraName,
  deleteCarrera,
  importPhotos,
  listCarreras,
  openCarrera,
  uniqueCarreraName,
  type Carrera,
} from '../../app/carreras';
import { useSession, useStoreApi } from '../../app/context';
import { createDemoSource } from '../../app/demo';
import { Logo } from '../Home';

const ACCEPT = 'image/*';

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function MobileHome() {
  const store = useStoreApi();
  const error = useSession((s) => s.error);
  const [name, setName] = useState(defaultCarreraName);
  const [carreras, setCarreras] = useState<Carrera[] | null>(null);
  const [copy, setCopy] = useState<{
    name: string;
    done: number;
    total: number;
  } | null>(null);

  const refresh = useCallback(() => {
    listCarreras()
      .then(setCarreras)
      .catch(() => setCarreras([]));
  }, []);
  useEffect(refresh, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    store.setError(null);
    try {
      await fn();
    } catch (err) {
      console.error(err);
      store.setError(err instanceof Error ? err.message : String(err));
      refresh();
    } finally {
      setCopy(null);
    }
  };

  /** Copia las fotos elegidas a la carrera (nueva o existente) y la abre. */
  const onPick = (target: string | null) => (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!files.length) return;
    void run(async () => {
      const carrera = target ?? (await uniqueCarreraName(name));
      setCopy({ name: carrera, done: 0, total: files.length });
      const r = await importPhotos(carrera, files, (done, total) => setCopy({ name: carrera, done, total }));
      if (r.added === 0 && !target) {
        await deleteCarrera(carrera).catch(() => undefined);
        throw new Error('Ninguno de los archivos elegidos es una foto compatible.');
      }
      await store.openSource(r.source);
      if (r.added)
        store.toast(
          `${r.added} ${r.added === 1 ? 'foto agregada' : 'fotos agregadas'}${r.skipped ? ` · ${r.skipped} ya estaban o no son fotos` : ''}`,
          'success',
        );
    });
  };

  const open = (c: Carrera) => run(async () => store.openSource(await openCarrera(c.name)));

  const remove = (c: Carrera) => {
    if (!confirm(`¿Borrar «${c.name}» de esta app?\n\nSe borran las ${c.count} copias y sus marcas. Las fotos de tu fototeca no se tocan.`))
      return;
    void run(async () => {
      await deleteCarrera(c.name);
      refresh();
    });
  };

  if (copy) {
    const pct = copy.total ? Math.round((copy.done / copy.total) * 100) : 0;
    return (
      <main className="home" aria-busy="true">
        <div className="home-card">
          <h1>Preparando «{copy.name}»</h1>
          <p className="home-lead" aria-live="polite">
            Copiando fotos a la app… {copy.done} de {copy.total}
          </p>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <p className="muted small">Se copian tal cual, sin recomprimir. No cierres esta pantalla.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="home m-home">
      <div className="home-card">
        <div className="home-logo" aria-hidden="true">
          <Logo />
        </div>
        <h1>Curador de Fotos</h1>
        <p className="home-lead">
          <strong>1</strong> marca el sector de cada foto · <strong>2</strong> valida deslizando: derecha aprueba, izquierda rechaza ·{' '}
          <strong>3</strong> guarda las aprobadas en Fotos o Archivos.
        </p>

        <label className="field m-name">
          <span>Nombre de la carrera</span>
          <input value={name} onChange={(e) => setName(e.target.value)} enterKeyHint="done" />
        </label>
        <label className="btn btn-primary btn-lg full m-pick">
          Elegir fotos de la carrera…
          <input type="file" accept={ACCEPT} multiple hidden onChange={onPick(null)} />
        </label>

        {error && (
          <p className="home-error" role="alert">
            {error}
          </p>
        )}

        {carreras && carreras.length > 0 && (
          <section className="m-carreras" aria-label="Mis carreras">
            <h2>Mis carreras</h2>
            <ul>
              {carreras.map((c) => (
                <li key={c.name} className="m-carrera">
                  <button className="m-carrera-open" onClick={() => void open(c)}>
                    <strong className="ellipsis">{c.name}</strong>
                    <span className="muted small">
                      {c.count} {c.count === 1 ? 'foto' : 'fotos'} · {formatBytes(c.bytes)}
                    </span>
                  </button>
                  <label className="btn btn-sm" title="Agregar más fotos a esta carrera">
                    ＋ Fotos
                    <input type="file" accept={ACCEPT} multiple hidden onChange={onPick(c.name)} />
                  </label>
                  <button className="btn btn-sm btn-ghost m-danger" onClick={() => remove(c)} aria-label={`Borrar ${c.name}`}>
                    Borrar
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <ul className="home-points">
          <li>Las fotos se copian dentro de la app, en este equipo: no se suben a ningún servidor.</li>
          <li>Las fotos de tu fototeca no se modifican.</li>
        </ul>
        <button className="link" onClick={() => void run(async () => store.openSource(await createDemoSource(), { demo: true }))}>
          Probar con fotos de demostración
        </button>
      </div>
    </main>
  );
}
