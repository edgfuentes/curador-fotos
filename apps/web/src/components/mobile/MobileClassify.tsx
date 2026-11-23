import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { NO_SECTOR, type CurationStatus, type Photo, type PhotoId } from '@curador/core';
import { useDerived, useSession, useStoreApi } from '../../app/context';
import { usePreload } from '../../app/useView';
import { MPhoto } from './MPhoto';

const GAP = 3;
const MIN_TILE = 110;

/** Etapa 1 en el teléfono: seleccionar varias fotos y tocar su sector, o ir una por una. */
export function MobileClassify({ onDone }: { onDone(): void }) {
  const store = useStoreApi();
  const { sections, sectorNames, unclassified, counts, ordered } = useDerived();
  const filter = useSession((s) => s.filter);
  const byId = useSession((s) => s.byId);
  const onlyPending = filter.sector === NO_SECTOR;
  const ids = useMemo(() => sections.flatMap((s) => s.photoIds), [sections]);
  const [sel, setSel] = useState<ReadonlySet<PhotoId>>(new Set());
  const [one, setOne] = useState<{
    ids: readonly PhotoId[];
    index: number;
  } | null>(null);
  const total = counts.total.total;

  // Al entrar se muestran solo las que faltan.
  useEffect(() => {
    if (unclassified > 0) store.setFilter({ sector: NO_SECTOR });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // La selección solo conserva fotos que siguen en pantalla.
  useEffect(() => {
    setSel((s) => {
      if (!s.size) return s;
      const visible = new Set(ids);
      const next = new Set([...s].filter((id) => visible.has(id)));
      return next.size === s.size ? s : next;
    });
  }, [ids]);

  const assign = (sector: string | null) => {
    if (!sel.size) return;
    store.classify(sector, [...sel]);
    setSel(new Set());
  };

  const toggle = (id: PhotoId) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  if (one) {
    return <ClassifyOne ids={one.ids} start={one.index} sectorNames={sectorNames} onClose={() => setOne(null)} />;
  }

  return (
    <div className="m-classify">
      <div className="m-bar">
        <div className="m-progress-line">
          <strong>{total - unclassified}</strong>/{total} con sector
          <span className="m-progress-mini" aria-hidden="true">
            <span
              style={{
                width: `${total ? ((total - unclassified) / total) * 100 : 0}%`,
              }}
            />
          </span>
        </div>
        <div className="m-seg" role="group" aria-label="Mostrar">
          <button className={onlyPending ? 'on' : ''} onClick={() => store.setFilter({ sector: NO_SECTOR })} aria-pressed={onlyPending}>
            Sin sector ({unclassified})
          </button>
          <button className={!onlyPending ? 'on' : ''} onClick={() => store.setFilter({ sector: null })} aria-pressed={!onlyPending}>
            Todas ({total})
          </button>
        </div>
      </div>

      {ids.length === 0 ? (
        <div className="m-empty">
          {onlyPending && total > 0 ? (
            <>
              <p className="m-empty-big">✓ Todas las fotos tienen sector</p>
              <button className="btn btn-primary btn-lg" onClick={onDone}>
                Pasar a validar ▶
              </button>
              <button className="btn" onClick={() => store.setFilter({ sector: null })}>
                Ver todas
              </button>
            </>
          ) : (
            <p className="muted">No hay fotos en esta carrera.</p>
          )}
        </div>
      ) : (
        <PhotoGrid ids={ids} byId={byId} sel={sel} sectorById={ordered.sectorById} sectorNames={sectorNames} onTap={toggle} />
      )}

      {ids.length > 0 && (
        <div className="m-dock">
          {sel.size > 0 ? (
            <>
              <div className="m-dock-head">
                <strong>
                  {sel.size} {sel.size === 1 ? 'seleccionada' : 'seleccionadas'}
                </strong>
                <span className="m-dock-sub">toca su sector</span>
                <button className="link" onClick={() => setSel(new Set())}>
                  Quitar selección
                </button>
              </div>
              <SectorButtons sectorNames={sectorNames} onPick={assign} onNew={() => store.askNewSector([...sel])} showClear />
            </>
          ) : (
            <div className="m-dock-row">
              <button className="btn" onClick={() => setSel(new Set(ids))} disabled={!ids.length}>
                Seleccionar todas
              </button>
              <button className="btn btn-primary" disabled={!ids.length} onClick={() => setOne({ ids, index: 0 })}>
                Una por una ▶
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SectorButtons({
  sectorNames,
  current,
  onPick,
  onNew,
  showClear,
  big,
}: {
  sectorNames: readonly string[];
  current?: string;
  onPick(sector: string | null): void;
  onNew(): void;
  showClear?: boolean;
  big?: boolean;
}) {
  const store = useStoreApi();
  return (
    <div className={`m-sectors${big ? ' big' : ''}`}>
      {sectorNames.map((name, i) => (
        <button
          key={name}
          className={`m-sector${current === name ? ' on' : ''}`}
          onClick={() => onPick(name)}
          aria-pressed={current === name}
        >
          {i < 9 && <span className="m-sector-n">{i + 1}</span>}
          <span className="ellipsis">{name}</span>
        </button>
      ))}
      <button className="m-sector m-sector-new" onClick={onNew}>
        ＋ Nuevo
      </button>
      <button className="m-sector m-sector-edit" onClick={() => store.setDialog('sectors')} aria-label="Corregir nombres de sectores">
        ✎ Editar
      </button>
      {showClear && (
        <button className="m-sector m-sector-clear" onClick={() => onPick(null)}>
          Sin sector
        </button>
      )}
    </div>
  );
}

export function PhotoGrid({
  ids,
  byId,
  sel,
  sectorById,
  sectorNames,
  statusOf,
  onTap,
}: {
  ids: readonly PhotoId[];
  byId: ReadonlyMap<PhotoId, Photo>;
  sel?: ReadonlySet<PhotoId>;
  sectorById?: ReadonlyMap<PhotoId, string>;
  sectorNames?: readonly string[];
  /** Si se da, cada foto muestra si está aprobada o rechazada (en vez del sector y la casilla). */
  statusOf?(id: PhotoId): CurationStatus;
  onTap(id: PhotoId): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const cols = Math.max(3, Math.floor((width + GAP) / (MIN_TILE + GAP)));
  const tile = width ? (width - GAP * (cols - 1)) / cols : MIN_TILE;
  const rows = Math.ceil(ids.length / cols);
  const v = useVirtualizer({
    count: rows,
    getScrollElement: () => ref.current,
    estimateSize: () => tile + GAP,
    overscan: 4,
  });
  useEffect(() => v.measure(), [tile, v]);

  return (
    <div className="m-grid-scroll" ref={ref}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="m-grid-row"
            style={{
              transform: `translateY(${row.start}px)`,
              height: tile,
              gap: GAP,
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
            }}
          >
            {ids.slice(row.index * cols, row.index * cols + cols).map((id) => {
              const p = byId.get(id);
              if (!p) return <span key={id} />;
              const sector = sectorById?.get(id) ?? NO_SECTOR;
              return (
                <GridTile
                  key={id}
                  photo={p}
                  selected={sel?.has(id) ?? false}
                  sector={sector === NO_SECTOR ? null : sector}
                  sectorIndex={sectorNames?.indexOf(sector) ?? -1}
                  status={statusOf?.(id)}
                  onTap={onTap}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

const GridTile = memo(function GridTile({
  photo,
  selected,
  sector,
  sectorIndex,
  status,
  onTap,
}: {
  photo: Photo;
  selected: boolean;
  sector: string | null;
  sectorIndex: number;
  status?: CurationStatus;
  onTap(id: PhotoId): void;
}) {
  if (status) {
    const label = status === 'marked' ? 'aprobada' : status === 'discarded' ? 'rechazada' : 'por validar';
    return (
      <button className={`m-tile is-${status}`} onClick={() => onTap(photo.id)} aria-label={`${photo.fileName}, ${label}`}>
        <MPhoto photo={photo} size="grid" />
        <span className={`m-status-badge ${status}`} aria-hidden="true">
          {status === 'marked' ? '✓' : status === 'discarded' ? '✕' : ''}
        </span>
      </button>
    );
  }
  return (
    <button
      className={`m-tile${selected ? ' is-selected' : ''}`}
      onClick={() => onTap(photo.id)}
      aria-pressed={selected}
      aria-label={`${photo.fileName}${sector ? `, ${sector}` : ', sin sector'}`}
    >
      <MPhoto photo={photo} size="grid" />
      {sector && (
        <span className="m-tile-sector ellipsis">
          {sectorIndex >= 0 && sectorIndex < 9 ? `${sectorIndex + 1} · ` : ''}
          {sector}
        </span>
      )}
      <span className="m-check" aria-hidden="true">
        {selected ? '✓' : ''}
      </span>
    </button>
  );
});

/** Una foto a la vez: tocar el sector la clasifica y pasa a la siguiente; deslizar cambia de foto. */
function ClassifyOne({
  ids,
  start,
  sectorNames,
  onClose,
}: {
  ids: readonly PhotoId[];
  start: number;
  sectorNames: readonly string[];
  onClose(): void;
}) {
  const store = useStoreApi();
  const byId = useSession((s) => s.byId);
  const { ordered } = useDerived();
  const [index, setIndex] = useState(start);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const id = ids[index];
  const photo = id ? byId.get(id) : undefined;
  const sector = id ? ordered.sectorById.get(id) : undefined;
  usePreload([byId.get(ids[index + 1] ?? ''), byId.get(ids[index + 2] ?? '')], 'preview');

  const go = (d: number) => {
    const n = index + d;
    if (n < 0) return;
    if (n >= ids.length) {
      store.toast('Llegaste a la última foto.', 'success');
      return onClose();
    }
    setIndex(n);
  };

  const pick = (s: string | null) => {
    if (!id) return;
    store.classify(s, [id]);
    go(1);
  };

  const onDown = (e: PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1);
  };

  if (!photo || !id) return null;
  return (
    <div className="m-one">
      <div className="m-one-head">
        <button className="btn btn-sm" onClick={onClose}>
          ‹ Volver
        </button>
        <span className="muted small">
          {index + 1} de {ids.length}
        </span>
        <span className={`m-one-sector${sector && sector !== NO_SECTOR ? ' set' : ''}`}>
          {sector && sector !== NO_SECTOR ? sector : 'Sin sector'}
        </span>
      </div>
      <div className="m-one-photo" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (swipe.current = null)}>
        <MPhoto key={id} photo={photo} size="preview" priority={10} />
      </div>
      <p className="m-one-name ellipsis muted small">{photo.fileName} · desliza para cambiar de foto</p>
      <SectorButtons sectorNames={sectorNames} current={sector} onPick={pick} onNew={() => store.askNewSector([id])} big />
      <div className="m-one-nav">
        <button className="btn" onClick={() => go(-1)} disabled={index === 0}>
          ‹ Anterior
        </button>
        <button className="btn" onClick={() => go(1)}>
          Saltar ›
        </button>
      </div>
    </div>
  );
}
