import { useMemo } from 'react';
import { cameraDisplayName, groupByCamera, NO_SECTOR, UNKNOWN_CAMERA_ID, type CurationStatus } from '@curador/core';
import { useDerived, useSession, useStoreApi } from '../app/context';

const STATUS_FILTERS: { value: CurationStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Por validar' },
  { value: 'marked', label: 'Aprobadas' },
  { value: 'discarded', label: 'Rechazadas' },
];

export function Sidebar() {
  const stage = useSession((s) => s.stage);
  return stage === 'classify' ? <ClassifySidebar /> : <ValidateSidebar />;
}

/** Etapa 1: filtros para clasificar. */
function ClassifySidebar() {
  const store = useStoreApi();
  const { folderStats, unclassified, counts } = useDerived();
  const filter = useSession((s) => s.filter);
  const photos = useSession((s) => s.photos);
  const cameras = useSession((s) => s.cameras);
  const duplicates = useSession((s) => s.duplicates);
  const cameraGroups = useMemo(() => groupByCamera(photos), [photos]);

  return (
    <aside className="sidebar" aria-label="Filtros">
      <section>
        <h3 id="f-show">Mostrar</h3>
        <div className="seg" role="radiogroup" aria-labelledby="f-show">
          <button role="radio" aria-checked={filter.sector === null} className={filter.sector === null ? 'on' : ''} onClick={() => store.setFilter({ sector: null })}>
            Todas
            <span className="count">{counts.total.total}</span>
          </button>
          <button
            role="radio"
            aria-checked={filter.sector === NO_SECTOR}
            className={filter.sector === NO_SECTOR ? 'on' : ''}
            onClick={() => store.setFilter({ sector: NO_SECTOR })}
          >
            Sin clasificar
            <span className="count">{unclassified}</span>
          </button>
        </div>
      </section>

      <section>
        <h3>Carpetas de origen</h3>
        <ul className="list">
          <li>
            <button className={filter.folder === null ? 'on' : ''} onClick={() => store.setFilter({ folder: null })} aria-pressed={filter.folder === null}>
              <span>Todas las carpetas</span>
              <span className="count">
                {counts.total.total - unclassified}/{counts.total.total}
              </span>
            </button>
          </li>
          {[...folderStats.entries()].map(([name, c]) => (
            <li key={name}>
              <button
                className={filter.folder === name ? 'on' : ''}
                onClick={() => store.setFilter({ folder: name })}
                aria-pressed={filter.folder === name}
                aria-label={`${name}: ${c.classified} clasificadas de ${c.total}`}
              >
                <span className="ellipsis">{name}</span>
                <span className="count">
                  <strong className={c.classified === c.total ? 'text-marked' : ''}>{c.classified}</strong>/{c.total}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Cámara / fotógrafo</h3>
        <ul className="list">
          <li>
            <button className={filter.cameraId === null ? 'on' : ''} onClick={() => store.setFilter({ cameraId: null })} aria-pressed={filter.cameraId === null}>
              <span>Todas</span>
              <span className="count">{photos.length}</span>
            </button>
          </li>
          {cameraGroups.map((g) => {
            const label = g.cameraId === UNKNOWN_CAMERA_ID ? 'Sin datos de cámara' : cameras[g.cameraId]?.label || cameraDisplayName(g.camera!);
            const off = cameras[g.cameraId]?.offsetSeconds ?? 0;
            return (
              <li key={g.cameraId}>
                <button
                  className={filter.cameraId === g.cameraId ? 'on' : ''}
                  onClick={() => store.setFilter({ cameraId: g.cameraId })}
                  aria-pressed={filter.cameraId === g.cameraId}
                  title={g.camera ? cameraDisplayName(g.camera) : undefined}
                >
                  <span className="ellipsis">
                    {label}
                    {off !== 0 && <span className="tag">±</span>}
                  </span>
                  <span className="count">{g.count}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button className="btn btn-sm full" onClick={() => store.setDialog('cameras')}>
          Ajustar hora de cámaras…
        </button>
      </section>

      <section>
        <h3>Duplicados</h3>
        {duplicates.status === 'running' ? (
          <p className="muted small">
            Comparando archivos… {duplicates.checked}/{duplicates.total}
          </p>
        ) : duplicates.groups.length > 0 ? (
          <label className="check">
            <input type="checkbox" checked={filter.duplicatesOnly} onChange={(e) => store.setFilter({ duplicatesOnly: e.target.checked })} />
            Ver {duplicates.ids.size} archivos duplicados ({duplicates.groups.length} grupos)
          </label>
        ) : (
          <p className="muted small">{duplicates.status === 'done' ? 'No hay duplicados exactos.' : '—'}</p>
        )}
      </section>
    </aside>
  );
}

/** Etapa 2: sectores con su avance de validación. */
function ValidateSidebar() {
  const store = useStoreApi();
  const { counts, sectorNames } = useDerived();
  const filter = useSession((s) => s.filter);
  const current = useSession((s) => s.validateSector);
  const statusCount = (v: CurationStatus | 'all') => {
    let n = 0;
    for (const name of sectorNames) {
      const c = counts.bySector.get(name);
      if (c) n += v === 'all' ? c.total : c[v];
    }
    return n;
  };

  return (
    <aside className="sidebar" aria-label="Sectores a validar">
      <section>
        <h3>Sectores</h3>
        <ul className="list validate-list">
          <li>
            <button className={current === null ? 'on' : ''} onClick={() => store.setValidateSector(null)} aria-pressed={current === null}>
              <span>Todos los sectores</span>
              <span className="count">{statusCount('pending')} por validar</span>
            </button>
          </li>
          {sectorNames.map((name) => {
            const c = counts.bySector.get(name) ?? { total: 0, pending: 0, marked: 0, discarded: 0 };
            const done = c.total - c.pending;
            return (
              <li key={name}>
                <button
                  className={current === name ? 'on' : ''}
                  onClick={() => store.setValidateSector(name)}
                  aria-pressed={current === name}
                  aria-label={`${name}: ${c.marked} aprobadas, ${c.discarded} rechazadas, ${c.pending} por validar`}
                >
                  <span className="vsector">
                    <span className="vsector-top">
                      <span className="ellipsis">{name}</span>
                      <span className="count">
                        {done}/{c.total}
                      </span>
                    </span>
                    <span className="progress-mini" aria-hidden="true">
                      <span className="pm-ok" style={{ width: `${c.total ? (c.marked / c.total) * 100 : 0}%` }} />
                      <span className="pm-no" style={{ width: `${c.total ? (c.discarded / c.total) * 100 : 0}%` }} />
                    </span>
                    <span className="small muted">
                      {c.total === 0 ? 'sin fotos' : c.pending === 0 ? '✓ validado' : `faltan ${c.pending}`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <button className="btn btn-primary full" onClick={() => store.startValidation(current)} disabled={statusCount('pending') === 0}>
          Validar a pantalla completa ▶
        </button>
        <p className="muted small">
          <kbd>A</kbd> aprueba · <kbd>R</kbd> rechaza · <kbd>U</kbd> deja por validar. La app pasa sola a la siguiente foto.
        </p>
      </section>

      <section>
        <h3 id="f-status">Estado</h3>
        <div className="seg" role="radiogroup" aria-labelledby="f-status">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.value}
              role="radio"
              aria-checked={filter.status === s.value}
              className={filter.status === s.value ? 'on' : ''}
              onClick={() => store.setFilter({ status: s.value })}
            >
              {s.label}
              <span className="count">{statusCount(s.value)}</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
