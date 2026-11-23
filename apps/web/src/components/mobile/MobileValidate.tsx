import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { statusOf, type CurationStatus, type PhotoId } from '@curador/core';
import { useDerived, useSession, useStoreApi } from '../../app/context';
import { usePreload } from '../../app/useView';
import { MPhoto } from './MPhoto';

/** Distancia (px) a partir de la cual soltar la tarjeta cuenta como decisión. */
const THRESHOLD = 90;

/** Etapa 2 en el teléfono: elegir un sector y validar sus fotos deslizando. */
export function MobileValidate({ onDone }: { onDone(): void }) {
  const store = useStoreApi();
  const { ordered, counts, sectorNames, unclassified } = useDerived();
  const library = useSession((s) => s.history.present);
  const [deck, setDeck] = useState<{
    sector: string;
    ids: readonly PhotoId[];
  } | null>(null);

  const start = (sector: string, all: boolean) => {
    const ids = ordered.sectors.find((s) => s.name === sector)?.photoIds ?? [];
    const list = all ? ids : ids.filter((id) => statusOf(library, id) === 'pending');
    if (!list.length) return store.toast('Este sector no tiene fotos por validar.');
    setDeck({ sector, ids: list });
  };

  if (deck) {
    const nextSector = sectorNames.find((n) => n !== deck.sector && (counts.bySector.get(n)?.pending ?? 0) > 0) ?? null;
    return (
      <SwipeDeck
        key={deck.sector + deck.ids.length}
        sector={deck.sector}
        ids={deck.ids}
        onClose={() => setDeck(null)}
        nextSector={nextSector}
        onNextSector={() => nextSector && start(nextSector, false)}
        onSave={onDone}
      />
    );
  }

  const pendingAll = sectorNames.reduce((n, s) => n + (counts.bySector.get(s)?.pending ?? 0), 0);
  const classified = counts.total.total - unclassified;

  return (
    <div className="m-validate m-scroll">
      <p className="m-lead">
        Elige un sector. Desliza la foto a la <strong className="text-marked">derecha para aprobarla</strong> o a la{' '}
        <strong className="text-discarded">izquierda para rechazarla</strong>.
      </p>
      {unclassified > 0 && (
        <p className="m-note">
          Quedan <strong>{unclassified}</strong> fotos sin sector: no se pueden validar hasta clasificarlas.
        </p>
      )}
      {classified === 0 ? (
        <p className="muted">Primero clasifica las fotos por sector (etapa 1).</p>
      ) : (
        <ul className="m-vsectors">
          {sectorNames.map((name) => {
            const c = counts.bySector.get(name);
            if (!c || c.total === 0) return null;
            const done = c.marked + c.discarded;
            return (
              <li key={name} className="m-vsector">
                <button className="m-vsector-btn" onClick={() => start(name, c.pending === 0)}>
                  <span className="m-vsector-top">
                    <strong className="ellipsis">{name}</strong>
                    <span className={c.pending ? 'm-pill' : 'm-pill ok'}>{c.pending ? `faltan ${c.pending}` : '✓ listo'}</span>
                  </span>
                  <span className="m-vbar" aria-hidden="true">
                    <span className="ok" style={{ width: `${(c.marked / c.total) * 100}%` }} />
                    <span className="no" style={{ width: `${(c.discarded / c.total) * 100}%` }} />
                  </span>
                  <span className="small muted">
                    {c.marked} aprobadas · {c.discarded} rechazadas · {done}/{c.total}
                  </span>
                  <span className="m-vsector-cta">{c.pending ? 'Validar ▶' : 'Revisar de nuevo'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {classified > 0 && pendingAll === 0 && (
        <button className="btn btn-primary btn-lg full" onClick={onDone}>
          Todo validado · Guardar aprobadas ▶
        </button>
      )}
    </div>
  );
}

function SwipeDeck({
  sector,
  ids,
  onClose,
  nextSector,
  onNextSector,
  onSave,
}: {
  sector: string;
  ids: readonly PhotoId[];
  onClose(): void;
  nextSector: string | null;
  onNextSector(): void;
  onSave(): void;
}) {
  const store = useStoreApi();
  const byId = useSession((s) => s.byId);
  const library = useSession((s) => s.history.present);
  const [index, setIndex] = useState(0);
  const [decided, setDecided] = useState<CurationStatus[]>([]);
  const [drag, setDrag] = useState<{
    dx: number;
    dy: number;
    leaving: 0 | 1 | -1;
    active?: boolean;
  }>({ dx: 0, dy: 0, leaving: 0 });
  const start = useRef<{
    x: number;
    y: number;
    t: number;
    pointer: number;
  } | null>(null);
  const busy = useRef(false);

  const id = ids[index];
  const photo = id ? byId.get(id) : undefined;
  const under = byId.get(ids[index + 1] ?? '');
  usePreload([byId.get(ids[index + 1] ?? ''), byId.get(ids[index + 2] ?? ''), byId.get(ids[index + 3] ?? '')], 'preview');

  const decide = (status: 'marked' | 'discarded') => {
    if (!id || busy.current) return;
    busy.current = true;
    setDrag((d) => ({
      ...d,
      leaving: status === 'marked' ? 1 : -1,
      active: false,
    }));
    setTimeout(() => {
      store.validate(status, [id]);
      setDecided((d) => [...d, status]);
      setIndex((i) => i + 1);
      setDrag({ dx: 0, dy: 0, leaving: 0 });
      busy.current = false;
    }, 200);
  };

  const back = () => {
    if (!decided.length || busy.current) return;
    store.undo();
    setDecided((d) => d.slice(0, -1));
    setIndex((i) => Math.max(0, i - 1));
  };

  // Teclado (iPad con teclado): → aprueba, ← rechaza, ⌘Z deshace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') decide('marked');
      else if (e.key === 'ArrowLeft') decide('discarded');
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (busy.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* puntero ya liberado */
    }
    start.current = {
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      pointer: e.pointerId,
    };
  };
  const onMove = (e: PointerEvent) => {
    const s = start.current;
    if (!s || s.pointer !== e.pointerId) return;
    setDrag({
      dx: e.clientX - s.x,
      dy: e.clientY - s.y,
      leaving: 0,
      active: true,
    });
  };
  const onUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const speed = Math.abs(dx) / Math.max(1, performance.now() - s.t); // px/ms
    if (Math.abs(dx) > THRESHOLD || (speed > 0.5 && Math.abs(dx) > 55)) decide(dx > 0 ? 'marked' : 'discarded');
    else setDrag({ dx: 0, dy: 0, leaving: 0 });
  };

  const approved = decided.filter((d) => d === 'marked').length;
  const rejected = decided.length - approved;

  if (!photo || !id) {
    return (
      <div className="m-deck-done">
        <p className="m-empty-big">✓ «{sector}» validado</p>
        <p>
          <strong className="text-marked">{approved} aprobadas</strong> · <strong className="text-discarded">{rejected} rechazadas</strong>
        </p>
        <div className="stack">
          {nextSector ? (
            <button className="btn btn-primary btn-lg" onClick={onNextSector}>
              Seguir con «{nextSector}» ▶
            </button>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={onSave}>
              Guardar aprobadas ▶
            </button>
          )}
          <button className="btn" onClick={back} disabled={!decided.length}>
            ↶ Deshacer la última
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Volver a sectores
          </button>
        </div>
      </div>
    );
  }

  const leavingX = drag.leaving * (typeof window !== 'undefined' ? window.innerWidth * 1.3 : 800);
  const dx = drag.leaving ? leavingX : drag.dx;
  const strength = Math.min(1, Math.abs(dx) / THRESHOLD);
  const current = statusOf(library, id);

  return (
    <div className="m-deck">
      <div className="m-deck-head">
        <button className="btn btn-sm" onClick={onClose}>
          ‹ Sectores
        </button>
        <span className="m-deck-title ellipsis">
          <strong>{sector}</strong> · {index + 1} de {ids.length}
        </span>
        <span className="small muted">faltan {ids.length - index}</span>
      </div>
      <div className="m-deck-stage">
        {under && (
          <div className="m-card m-card-under" style={{ transform: `scale(${0.94 + 0.06 * strength})` }} aria-hidden="true">
            <MPhoto key={under.id} photo={under} size="preview" />
          </div>
        )}
        <div
          key={id}
          className={`m-card${drag.active ? '' : ' animate'}`}
          style={{
            transform: `translate(${dx}px, ${drag.leaving ? drag.dy : drag.dy * 0.25}px) rotate(${dx / 18}deg)`,
          }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => {
            start.current = null;
            setDrag({ dx: 0, dy: 0, leaving: 0 });
          }}
          role="img"
          aria-label={`${photo.fileName}. Desliza a la derecha para aprobar o a la izquierda para rechazar.`}
        >
          <MPhoto key={id} photo={photo} size="preview" priority={10} />
          <span className="m-stamp m-stamp-ok" style={{ opacity: dx > 0 ? strength : 0 }}>
            APROBADA
          </span>
          <span className="m-stamp m-stamp-no" style={{ opacity: dx < 0 ? strength : 0 }}>
            RECHAZADA
          </span>
          {current !== 'pending' && (
            <span className={`m-card-status ${current}`}>{current === 'marked' ? '✓ aprobada' : '✕ rechazada'}</span>
          )}
          <span className="m-card-name ellipsis">{photo.fileName}</span>
        </div>
      </div>
      <div className="m-deck-actions">
        <button className="m-round no" onClick={() => decide('discarded')} aria-label="Rechazar">
          ✕
        </button>
        <button className="m-round undo" onClick={back} disabled={!decided.length} aria-label="Deshacer">
          ↶
        </button>
        <button className="m-round ok" onClick={() => decide('marked')} aria-label="Aprobar">
          ✓
        </button>
      </div>
    </div>
  );
}
