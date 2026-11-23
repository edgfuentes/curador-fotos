import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { statusOf, type PhotoId } from '@curador/core';
import { useDerived, useSession, useStoreApi } from '../app/context';
import { Thumb } from './Thumb';
import type { Choice } from './SectorSelect';

/** Tipo MIME propio para arrastrar fotos hacia el panel de sectores. */
export const DRAG_MIME = 'application/x-curador-photos';

type Row =
  | { kind: 'header'; sector: string; shown: number }
  | { kind: 'photos'; sector: string; ids: readonly PhotoId[]; start: number };

const GAP = 12;
const PAD = 16;
const HEADER_H = 52;
const CAPTION_H = 76;

export function Grid() {
  const store = useStoreApi();
  const { sections, visible, ordered, folderCounts, sectorNames } = useDerived();
  const tileSize = useSession((s) => s.tileSize);
  const byId = useSession((s) => s.byId);
  const library = useSession((s) => s.history.present);
  const selection = useSession((s) => s.selection);
  const focusId = useSession((s) => s.focusId);
  const dupIds = useSession((s) => s.duplicates.ids);
  const filter = useSession((s) => s.filter);
  const columns = useSession((s) => s.columns);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cols = Math.max(1, Math.floor((width - PAD * 2 + GAP) / (tileSize + GAP)));
  useEffect(() => store.setColumns(cols), [cols, store]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let start = 0;
    for (const s of sections) {
      out.push({ kind: 'header', sector: s.sector, shown: s.photoIds.length });
      for (let i = 0; i < s.photoIds.length; i += cols) {
        out.push({ kind: 'photos', sector: s.sector, ids: s.photoIds.slice(i, i + cols), start: start + i });
      }
      start += s.photoIds.length;
    }
    return out;
  }, [sections, cols]);

  const rowH = Math.round(tileSize * 0.75) + CAPTION_H + GAP;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'header' ? HEADER_H : rowH),
    overscan: 3,
  });
  useEffect(() => virtualizer.measure(), [rowH, cols, virtualizer]);

  // Mantener visible la foto enfocada al navegar con el teclado.
  const rowOf = useMemo(() => {
    const m = new Map<PhotoId, number>();
    rows.forEach((r, i) => r.kind === 'photos' && r.ids.forEach((id) => m.set(id, i)));
    return m;
  }, [rows]);
  useEffect(() => {
    if (!focusId) return;
    const i = rowOf.get(focusId);
    if (i === undefined) return;
    virtualizer.scrollToIndex(i, { align: 'auto' });
    const t = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && !scrollRef.current?.contains(active)) return;
      scrollRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"] .tile-btn`)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(t);
  }, [focusId, rowOf, virtualizer]);

  const onClick = useCallback(
    (e: MouseEvent, id: PhotoId) => {
      store.focus(id, { select: e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'replace', visible });
    },
    [store, visible],
  );
  const onDoubleClick = useCallback((id: PhotoId) => store.openReview(id), [store]);

  const onChoose = useCallback(
    (id: PhotoId, choice: Choice) => {
      const ids = store.targetsFor(id);
      if (choice === 'new') store.askNewSector(ids);
      else store.choose(ids, choice);
    },
    [store],
  );

  // Arrastrar una o varias fotos hacia un sector del panel derecho.
  const onDragStart = useCallback(
    (e: DragEvent, id: PhotoId) => {
      const ids = selection.has(id) ? visible.filter((v) => selection.has(v)) : [id];
      if (!selection.has(id)) store.focus(id);
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
      e.dataTransfer.setData('text/plain', ids.join('\n'));
    },
    [selection, visible, store],
  );
  const onDragEnd = useCallback(() => undefined, []);

  if (visible.length === 0 && sections.every((s) => s.photoIds.length === 0)) {
    return (
      <div className="grid-empty" ref={scrollRef}>
        <p>No hay fotos que coincidan con los filtros.</p>
        <button className="btn" onClick={() => store.setFilter({ folder: null, cameraId: null, status: 'all', duplicatesOnly: false })}>
          Quitar filtros
        </button>
      </div>
    );
  }

  return (
    <div
      className="grid-scroll"
      ref={scrollRef}
      role="grid"
      aria-label="Fotos por carpeta de origen, ordenadas por fecha de captura"
      aria-rowcount={rows.length}
      aria-colcount={columns}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index]!;
          if (row.kind === 'header') {
            const c = folderCounts.bySector.get(row.sector);
            return (
              <div key={v.key} className="grid-header" role="row" style={{ transform: `translateY(${v.start}px)`, height: HEADER_H }}>
                <h2>{row.sector}</h2>
                <span className="muted">
                  {c?.total ?? 0} fotos · <strong className="text-marked">{c?.marked ?? 0} marcadas</strong>
                  {c?.discarded ? ` · ${c.discarded} descartadas` : ''}
                  {filter.status !== 'all' || filter.cameraId !== null || filter.duplicatesOnly ? ` · ${row.shown} visibles` : ''}
                </span>
              </div>
            );
          }
          return (
            <div
              key={v.key}
              className="grid-row"
              role="row"
              style={{ transform: `translateY(${v.start}px)`, height: rowH, gap: GAP, paddingInline: PAD }}
            >
              {row.ids.map((id) => {
                const photo = byId.get(id);
                if (!photo) return null;
                return (
                  <Thumb
                    key={id}
                    photo={photo}
                    status={statusOf(library, id)}
                    selected={selection.has(id)}
                    focused={focusId === id}
                    duplicate={dupIds.has(id)}
                    time={ordered.timeById.get(id)}
                    size={tileSize}
                    sector={ordered.sectorById.get(id)}
                    sectorNames={sectorNames}
                    onChoose={onChoose}
                    onClick={onClick}
                    onDoubleClick={onDoubleClick}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
