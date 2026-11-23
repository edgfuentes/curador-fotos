import { memo, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { formatWallClock, prefixWidth, statusOf, type Photo, type PhotoId } from '@curador/core';
import { useDerived, useSession, useStoreApi } from '../app/context';
import { SectorWindowPortal } from '../app/popup';
import { useView } from '../app/useView';
import { SectorSelect, type Choice } from './SectorSelect';

/** Todas las ventanas de sector abiertas. */
export function SectorWindows() {
  const store = useStoreApi();
  const sectors = useSession((s) => s.sectorWindows);
  return (
    <>
      {sectors.map((name) => (
        <SectorWindowHost key={name} sector={name} store={store} />
      ))}
    </>
  );
}

function SectorWindowHost({ sector, store }: { sector: string; store: ReturnType<typeof useStoreApi> }) {
  const { ordered } = useDerived();
  const library = useSession((s) => s.history.present);
  const count = useMemo(
    () => ordered.sectors.find((s) => s.name === sector)?.photoIds.filter((id) => statusOf(library, id) === 'marked').length ?? 0,
    [ordered, library, sector],
  );
  return (
    <SectorWindowPortal store={store} sector={sector} title={`${sector} · ${count} fotos — Curador`}>
      <SectorView sector={sector} />
    </SectorWindowPortal>
  );
}

/** Detalle de un sector: sus fotos marcadas en el orden final de exportación. */
function SectorView({ sector }: { sector: string }) {
  const store = useStoreApi();
  const { ordered, sectorNames } = useDerived();
  const library = useSession((s) => s.history.present);
  const byId = useSession((s) => s.byId);
  const canUndo = useSession((s) => s.history.past.length > 0);
  const canRedo = useSession((s) => s.history.future.length > 0);
  const [focus, setFocus] = useState<PhotoId | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: PhotoId; target: PhotoId | null; side: 'before' | 'after' } | null>(null);

  const group = ordered.sectors.find((s) => s.name === sector);
  const ids = useMemo(() => (group?.photoIds ?? []).filter((id) => statusOf(library, id) === 'marked'), [group, library]);
  const width = prefixWidth(ids.length);

  const onChoose = (id: PhotoId, choice: Choice) => {
    if (choice !== 'new') return store.choose([id], choice);
    // El nombre se pide en esta misma ventana (la principal puede estar detrás).
    const name = rootRef.current?.ownerDocument.defaultView?.prompt('Nombre del sector nuevo')?.trim();
    if (name) store.markForSector(name, [id]);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'SELECT') return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (!focus) return;
    const i = ids.indexOf(focus);
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      // Saltar respecto de la foto marcada vecina (las pendientes del sector no se ven aquí).
      const left = e.key === 'ArrowLeft';
      const neighbor = ids[i + (left ? -1 : 1)];
      if (neighbor) store.moveTo([focus], neighbor, left ? 'before' : 'after');
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = ids[Math.max(0, Math.min(ids.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)))];
      if (next) {
        setFocus(next);
        (e.currentTarget.ownerDocument.querySelector(`[data-id="${CSS.escape(next)}"] .stile-btn`) as HTMLElement | null)?.focus();
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const next = ids[i + 1] ?? ids[i - 1] ?? null;
      store.unmark([focus]);
      setFocus(next);
    }
  };

  const onDrop = (e: DragEvent, target: PhotoId) => {
    e.preventDefault();
    if (drag && drag.id !== target) store.moveTo([drag.id], target, drag.side);
    setDrag(null);
  };

  return (
    <div className="sector-window" ref={rootRef} onKeyDown={onKeyDown}>
      <header className="sector-window-head">
        <div>
          <h1>{sector}</h1>
          <p className="muted">
            <strong className="text-marked">{ids.length}</strong> {ids.length === 1 ? 'foto seleccionada' : 'fotos seleccionadas'} · orden
            de exportación{group?.hasManualOrder ? ' (manual)' : ' (por hora de captura)'}
          </p>
        </div>
        <div className="sector-window-actions">
          <button className="btn btn-ghost" onClick={() => store.undo()} disabled={!canUndo} title="Deshacer (⌘Z)" aria-label="Deshacer">
            ↶
          </button>
          <button className="btn btn-ghost" onClick={() => store.redo()} disabled={!canRedo} title="Rehacer (⇧⌘Z)" aria-label="Rehacer">
            ↷
          </button>
          {group?.hasManualOrder && (
            <button className="btn btn-sm" onClick={() => store.resetOrder(sector)}>
              Volver a orden por fecha
            </button>
          )}
          <button className="btn btn-sm" onClick={(e) => e.currentTarget.ownerDocument.defaultView?.close()}>
            Cerrar
          </button>
        </div>
      </header>
      <p className="muted small sector-window-hint">
        Arrastra para cambiar el orden · <kbd>⌥←</kbd> <kbd>⌥→</kbd> mueven la foto elegida · <kbd>⌫</kbd> la quita del sector · los cambios
        se ven al instante en la ventana principal.
      </p>
      {ids.length === 0 ? (
        <div className="sector-window-empty">
          <p>Este sector todavía no tiene fotos marcadas.</p>
          <p className="muted small">En la ventana principal, elige «{sector}» en la lista bajo cada foto o arrástralas a su tarjeta.</p>
        </div>
      ) : (
        <ol className="sector-grid" aria-label={`Fotos de ${sector} en orden de exportación`}>
          {ids.map((id, i) => {
            const p = byId.get(id);
            if (!p) return null;
            return (
              <SectorTile
                key={id}
                photo={p}
                number={String(i + 1).padStart(width, '0')}
                time={ordered.timeById.get(id)}
                focused={focus === id}
                dropSide={drag?.target === id ? drag.side : null}
                sector={sector}
                sectorNames={sectorNames}
                onFocus={setFocus}
                onChoose={onChoose}
                onRemove={(pid) => store.unmark([pid])}
                onDragStart={(pid) => setDrag({ id: pid, target: null, side: 'before' })}
                onDragOver={(e, pid) => {
                  e.preventDefault();
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const side = e.clientX < r.left + r.width / 2 ? 'before' : 'after';
                  setDrag((d) => (d && (d.target !== pid || d.side !== side) ? { ...d, target: pid, side } : d));
                }}
                onDrop={onDrop}
                onDragEnd={() => setDrag(null)}
              />
            );
          })}
        </ol>
      )}
    </div>
  );
}

const SectorTile = memo(function SectorTile(p: {
  photo: Photo;
  number: string;
  time: number | undefined;
  focused: boolean;
  dropSide: 'before' | 'after' | null;
  sector: string;
  sectorNames: readonly string[];
  onFocus(id: PhotoId): void;
  onChoose(id: PhotoId, c: Choice): void;
  onRemove(id: PhotoId): void;
  onDragStart(id: PhotoId): void;
  onDragOver(e: DragEvent, id: PhotoId): void;
  onDrop(e: DragEvent, id: PhotoId): void;
  onDragEnd(): void;
}) {
  const view = useView(p.photo, 'grid', 0);
  const id = p.photo.id;
  return (
    <li
      className={['stile', p.focused && 'is-focused', p.dropSide && `drop-${p.dropSide}`].filter(Boolean).join(' ')}
      data-id={id}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        p.onDragStart(id);
      }}
      onDragOver={(e) => p.onDragOver(e, id)}
      onDrop={(e) => p.onDrop(e, id)}
      onDragEnd={p.onDragEnd}
    >
      <button className="stile-btn" onClick={() => p.onFocus(id)} onFocus={() => p.onFocus(id)} aria-label={`${p.number}, ${p.photo.fileName}`}>
        <span className="stile-img">
          {view.status === 'ready' ? (
            <img src={view.url} alt="" draggable={false} />
          ) : view.status === 'loading' ? (
            <span className="tile-placeholder shimmer" />
          ) : (
            <span className="tile-placeholder no-preview">
              <span>{p.photo.extension.toUpperCase()}</span>
            </span>
          )}
          <span className="stile-num">{p.number}</span>
        </span>
        <span className="tile-caption">
          <span className="tile-name" title={p.photo.relativePath}>
            {p.photo.fileName}
          </span>
          <span className="tile-time">{p.time !== undefined ? formatWallClock(p.time) : 'sin fecha EXIF'}</span>
        </span>
      </button>
      <div className="stile-actions">
        <SectorSelect
          status="marked"
          sector={p.sector}
          sectorNames={p.sectorNames}
          onChoose={(c) => p.onChoose(id, c)}
          label={`Mover ${p.photo.fileName} a otro sector`}
        />
        <button className="btn btn-sm btn-ghost" onClick={() => p.onRemove(id)} title="Quitar del sector (vuelve a pendiente)" aria-label={`Quitar ${p.photo.fileName}`}>
          ✕
        </button>
      </div>
    </li>
  );
});
