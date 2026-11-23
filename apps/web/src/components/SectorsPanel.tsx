import { memo, useMemo, useState, type DragEvent } from 'react';
import { NO_SECTOR, type Photo, type PhotoId } from '@curador/core';
import { useDerived, useSession, useStoreApi } from '../app/context';
import { openSectorWindow } from '../app/popup';
import { useView } from '../app/useView';
import { DRAG_MIME } from './Grid';

const PREVIEW_COUNT = 3;

function readDraggedIds(e: DragEvent): PhotoId[] {
  try {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Panel derecho: cada sector con cuántas fotos tiene marcadas y una muestra de 3. */
export function SectorsPanel() {
  const store = useStoreApi();
  const { ordered, sectorNames, unclassified, counts } = useDerived();
  const byId = useSession((s) => s.byId);
  const filter = useSession((s) => s.filter);
  const [newName, setNewName] = useState('');

  const bySector = useMemo(() => new Map(ordered.sectors.map((s) => [s.name, s.photoIds])), [ordered]);
  const classified = counts.total.total - unclassified;

  return (
    <aside className="sectors-panel" aria-label="Sectores y fotos marcadas">
      <header className="sectors-head">
        <h3>Sectores</h3>
        <span className="count">
          <strong className="text-classified">{classified}</strong>/{counts.total.total} clasificadas
        </span>
      </header>
      <button
        className={`unclassified-card${filter.sector === NO_SECTOR ? ' on' : ''}${unclassified === 0 ? ' done' : ''}`}
        onClick={() => store.setFilter({ sector: filter.sector === NO_SECTOR ? null : NO_SECTOR })}
        aria-pressed={filter.sector === NO_SECTOR}
        title="Ver solo las fotos sin clasificar"
      >
        {unclassified === 0 ? (
          <span>✓ Todas las fotos tienen sector</span>
        ) : (
          <>
            <strong>{unclassified}</strong> sin clasificar
          </>
        )}
      </button>
      <p className="muted small sectors-hint">
        Elige el sector en la lista bajo cada foto, pulsa <kbd>1</kbd>–<kbd>9</kbd> (<kbd>0</kbd> lo quita) o arrastra fotos a una tarjeta.
      </p>
      <ul className="sector-cards">
        {sectorNames.map((name, i) => (
          <SectorCard
            key={name}
            name={name}
            index={i}
            marked={bySector.get(name) ?? []}
            byId={byId}
            onDropIds={(ids) => store.classify(name, ids)}
            onOpen={() => openSectorWindow(store, name)}
          />
        ))}
      </ul>
      {unclassified === 0 && classified > 0 && (
        <button className="btn btn-primary full" onClick={() => store.setStage('validate')}>
          Pasar a validar ▶
        </button>
      )}
      <form
        className="row sectors-new"
        onSubmit={(e) => {
          e.preventDefault();
          const name = newName.trim();
          if (!name) return;
          store.addSector(name);
          setNewName('');
        }}
      >
        <input aria-label="Nombre del sector nuevo" placeholder="Sector nuevo…" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn btn-sm" type="submit" disabled={!newName.trim()}>
          Crear
        </button>
      </form>
    </aside>
  );
}

const SectorCard = memo(function SectorCard({
  name,
  index,
  marked,
  byId,
  onDropIds,
  onOpen,
}: {
  name: string;
  index: number;
  marked: readonly PhotoId[];
  byId: ReadonlyMap<PhotoId, Photo>;
  onDropIds(ids: PhotoId[]): void;
  onOpen(): void;
}) {
  const [over, setOver] = useState(false);
  const sample = marked.slice(0, PREVIEW_COUNT);
  const rest = marked.length - sample.length;
  return (
    <li
      className={`sector-card${over ? ' is-over' : ''}${marked.length === 0 ? ' is-empty' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const ids = readDraggedIds(e);
        if (ids.length) onDropIds(ids);
      }}
    >
      <button className="sector-card-btn" onClick={onOpen} title={`Abrir «${name}» en una ventana aparte`}>
        <span className="sector-card-top">
          {index < 9 && <kbd aria-label={`tecla ${index + 1}`}>{index + 1}</kbd>}
          <span className="sector-card-name ellipsis">{name}</span>
          <span className="sector-card-open" aria-hidden="true">
            ↗
          </span>
        </span>
        <span className="sector-card-count">
          <strong>{marked.length}</strong> {marked.length === 1 ? 'foto' : 'fotos'}
        </span>
        {marked.length > 0 ? (
          <span className="sector-card-strip">
            {sample.map((id) => {
              const p = byId.get(id);
              return p ? <MiniThumb key={id} photo={p} /> : null;
            })}
            {rest > 0 && <span className="mini-more">+{rest}</span>}
          </span>
        ) : (
          <span className="sector-card-empty small muted">Sin fotos todavía · suelta fotos aquí</span>
        )}
      </button>
    </li>
  );
});

function MiniThumb({ photo }: { photo: Photo }) {
  const view = useView(photo, 'grid', -1);
  return (
    <span className="mini-thumb">
      {view.status === 'ready' ? (
        <img src={view.url} alt="" draggable={false} />
      ) : view.status === 'loading' ? (
        <span className="tile-placeholder shimmer" />
      ) : (
        <span className="mini-ext">{photo.extension.toUpperCase()}</span>
      )}
    </span>
  );
}
