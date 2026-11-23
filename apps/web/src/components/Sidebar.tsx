import { useMemo, useState } from 'react';
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
  const { ordered, counts } = useDerived();
  const filter = useSession((s) => s.filter);
  const photos = useSession((s) => s.photos);
  const cameras = useSession((s) => s.cameras);
  const duplicates = useSession((s) => s.duplicates);
  const selectionSize = useSession((s) => s.selection.size);
  const cameraGroups = useMemo(() => groupByCamera(photos), [photos]);
  const [newSector, setNewSector] = useState('');

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
        <h3>Sectores</h3>
        <ul className="list">
          <li>
            <button className={filter.sector === null ? 'on' : ''} onClick={() => store.setFilter({ sector: null })} aria-pressed={filter.sector === null}>
              <span>Todos los sectores</span>
              <span className="count">
                <strong>{counts.total.marked}</strong>/{counts.total.total}
              </span>
            </button>
          </li>
          {ordered.sectors.map((s) => {
            const c = counts.bySector.get(s.name);
            return (
              <li key={s.name}>
                <button
                  className={filter.sector === s.name ? 'on' : ''}
                  onClick={() => store.setFilter({ sector: s.name })}
                  aria-pressed={filter.sector === s.name}
                  aria-label={`${s.name}: ${c?.marked ?? 0} marcadas de ${c?.total ?? 0}`}
                >
                  <span className="ellipsis">{s.name}</span>
                  <span className="count">
                    <strong className="text-marked">{c?.marked ?? 0}</strong>/{c?.total ?? 0}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <details className="assign">
          <summary>Asignar {selectionSize > 1 ? `${selectionSize} fotos` : 'la foto'} a un sector</summary>
          <div className="assign-body">
            <select
              aria-label="Sector de destino"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__folder__') store.assignSector(null);
                else if (v) store.assignSector(v);
              }}
            >
              <option value="">Elegir sector…</option>
              {ordered.sectors.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
              <option value="__folder__">↺ Según su carpeta de origen</option>
            </select>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                const name = newSector.trim();
                if (!name) return;
                store.addSector(name);
                store.assignSector(name);
                setNewSector('');
              }}
            >
              <input
                aria-label="Nombre del sector nuevo"
                placeholder="Sector nuevo…"
                value={newSector}
                onChange={(e) => setNewSector(e.target.value)}
              />
              <button className="btn btn-sm" type="submit">
                Crear
              </button>
            </form>
          </div>
        </details>
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
