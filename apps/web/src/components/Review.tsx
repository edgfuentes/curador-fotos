import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { cameraDisplayName, formatOffset, formatWallClock, statusOf } from '@curador/core';
import { useDerived, useSession, useStoreApi } from '../app/context';
import { usePreload, useView } from '../app/useView';
import { STATUS_LABEL } from './Thumb';

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function Review() {
  const store = useStoreApi();
  const { visible, ordered } = useDerived();
  const focusId = useSession((s) => s.focusId);
  const byId = useSession((s) => s.byId);
  const library = useSession((s) => s.history.present);
  const zoom = useSession((s) => s.zoom);
  const cameras = useSession((s) => s.cameras);
  const autoAdvance = useSession((s) => s.autoAdvance);

  const index = focusId ? visible.indexOf(focusId) : -1;
  const photo = focusId ? byId.get(focusId) : undefined;
  const prev = index > 0 ? byId.get(visible[index - 1]!) : undefined;
  const next = index >= 0 ? byId.get(visible[index + 1]!) : undefined;
  const next2 = index >= 0 ? byId.get(visible[index + 2]!) : undefined;

  const preview = useView(photo, 'preview', 20);
  const full = useView(photo, 'full', 30, zoom);
  // Precarga de la siguiente (y la anterior) para navegar sin esperas.
  usePreload([next, prev, next2], 'preview');

  if (!photo) {
    return (
      <div className="review" role="dialog" aria-modal="true" aria-label="Revisión">
        <div className="review-empty">
          <p>No hay foto seleccionada.</p>
          <button className="btn" onClick={() => store.closeReview()}>
            Volver a la cuadrícula
          </button>
        </div>
      </div>
    );
  }

  const status = statusOf(library, photo.id);
  const time = ordered.timeById.get(photo.id);
  const offset = photo.camera ? (cameras[photo.camera.id]?.offsetSeconds ?? 0) : 0;
  const sector = ordered.sectorById.get(photo.id) ?? '';
  const afterMark = autoAdvance ? (next?.id ?? null) : null;

  return (
    <div className="review" role="dialog" aria-modal="true" aria-label={`Revisión: ${photo.fileName}`}>
      <header className="review-bar">
        <button className="btn btn-ghost" onClick={() => store.closeReview()} title="Volver a la cuadrícula (Esc)">
          ← Cuadrícula
        </button>
        <div className="review-title">
          <strong>{photo.fileName}</strong>
          <span className="muted">
            {index + 1} de {visible.length} · {sector}
          </span>
        </div>
        <span className={`status-pill status-${status}`} aria-live="polite">
          {STATUS_LABEL[status]}
        </span>
      </header>

      <div className="review-stage">
        {zoom ? (
          <ZoomView
            url={full.status === 'ready' ? full.url : preview.status === 'ready' ? preview.url : null}
            loading={full.status === 'loading'}
            onExit={() => store.setZoom(false)}
          />
        ) : preview.status === 'ready' ? (
          <img
            className="review-img"
            src={preview.url}
            alt={photo.fileName}
            onClick={() => store.setZoom(true)}
            title="Clic o Z para ver al 100 %"
          />
        ) : preview.status === 'loading' ? (
          <div className="review-loading shimmer" aria-label="Cargando vista" />
        ) : (
          <div className="review-noprev">
            <strong>{photo.extension.toUpperCase()}</strong>
            <p>
              {preview.status === 'error' ? `No se pudo generar la vista: ${preview.message}` : 'Este archivo no tiene una vista previa disponible.'}
              <br />
              Igual puedes marcarlo y se exportará el original intacto.
            </p>
          </div>
        )}
        {prev && (
          <button className="review-nav review-prev" onClick={() => store.focus(prev.id)} aria-label="Foto anterior (←)">
            ‹
          </button>
        )}
        {next && (
          <button className="review-nav review-next" onClick={() => store.focus(next.id)} aria-label="Foto siguiente (→)">
            ›
          </button>
        )}
      </div>

      <footer className="review-footer">
        <div className="review-meta">
          <span>{time !== undefined ? formatWallClock(time) : 'Sin fecha EXIF'}</span>
          {offset !== 0 && <span className="muted">(ajuste {formatOffset(offset)})</span>}
          <span>{photo.camera ? (cameras[photo.camera.id]?.label || cameraDisplayName(photo.camera)) : 'Cámara desconocida'}</span>
          <span className="muted">{formatBytes(photo.size)}</span>
          <span className="muted" title={photo.relativePath}>
            {photo.relativePath}
          </span>
        </div>
        <div className="review-actions" role="toolbar" aria-label="Acciones de curación">
          <button className={`btn ${status === 'marked' ? 'btn-marked' : ''}`} onClick={() => store.mark('marked', afterMark)} aria-pressed={status === 'marked'}>
            ✓ Marcar <kbd>P</kbd>
          </button>
          <button
            className={`btn ${status === 'discarded' ? 'btn-discarded' : ''}`}
            onClick={() => store.mark('discarded', afterMark)}
            aria-pressed={status === 'discarded'}
          >
            ✕ Descartar <kbd>X</kbd>
          </button>
          <button className="btn" onClick={() => store.resetStatus()}>
            Pendiente <kbd>U</kbd>
          </button>
          <button className="btn" onClick={() => store.setZoom(!zoom)} aria-pressed={zoom}>
            100 % <kbd>Z</kbd>
          </button>
          <label className="check">
            <input type="checkbox" checked={autoAdvance} onChange={(e) => store.setUi({ autoAdvance: e.target.checked })} />
            Avanzar al marcar
          </label>
        </div>
      </footer>
    </div>
  );
}

/** Vista al 100 %: 1 píxel de la imagen = 1 píxel físico de la pantalla. Arrastrar para desplazarse. */
function ZoomView({ url, loading, onExit }: { url: string | null; loading: boolean; onExit(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; sl: number; st: number; moved: boolean } | null>(null);

  useEffect(() => setNatural(null), [url]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !natural) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  }, [natural]);

  const dpr = window.devicePixelRatio || 1;
  const onDown = (e: PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = dragRef.current;
    const el = ref.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    el.scrollLeft = d.sl - dx;
    el.scrollTop = d.st - dy;
  };
  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && !d.moved) onExit();
  };

  return (
    <div className="zoom" ref={ref} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} aria-label="Vista al 100 %">
      {url && (
        <img
          src={url}
          alt=""
          draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={natural ? { width: natural.w / dpr, height: natural.h / dpr } : { visibility: 'hidden' }}
        />
      )}
      {loading && <span className="zoom-loading">Cargando original…</span>}
    </div>
  );
}
