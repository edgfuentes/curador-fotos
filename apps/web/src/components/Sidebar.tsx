import { useMemo } from 'react';
import { cameraDisplayName, groupByCamera, UNKNOWN_CAMERA_ID, type CurationStatus } from '@curador/core';
import { useDerived, useSession, useStoreApi } from '../app/context';

const STATUS_FILTERS: { value: CurationStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'marked', label: 'Marcadas' },
  { value: 'discarded', label: 'Descartadas' },
];

export function Sidebar() {
  const store = useStoreApi();
  const { counts, folderCounts } = useDerived();
  const filter = useSession((s) => s.filter);
  const photos = useSession((s) => s.photos);
  const cameras = useSession((s) => s.cameras);
  const duplicates = useSession((s) => s.duplicates);
  const cameraGroups = useMemo(() => groupByCamera(photos), [photos]);

  const statusCount = (v: CurationStatus | 'all') => (v === 'all' ? counts.total.total : counts.total[v]);

  return (
    <aside className="sidebar" aria-label="Filtros y sectores">
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

      <section>
        <h3>Carpetas de origen</h3>
        <ul className="list">
          <li>
            <button className={filter.folder === null ? 'on' : ''} onClick={() => store.setFilter({ folder: null })} aria-pressed={filter.folder === null}>
              <span>Todas las carpetas</span>
              <span className="count">
                <strong className="text-marked">{folderCounts.total.marked}</strong>/{folderCounts.total.total}
              </span>
            </button>
          </li>
          {[...folderCounts.bySector.entries()].map(([name, c]) => (
            <li key={name}>
              <button
                className={filter.folder === name ? 'on' : ''}
                onClick={() => store.setFilter({ folder: name })}
                aria-pressed={filter.folder === name}
                aria-label={`${name}: ${c.marked} marcadas de ${c.total}`}
              >
                <span className="ellipsis">{name}</span>
                <span className="count">
                  <strong className="text-marked">{c.marked}</strong>/{c.total}
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
