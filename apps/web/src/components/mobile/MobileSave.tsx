import { useMemo, useState } from 'react';
import { buildExportPlan, NO_SECTOR, statusOf, type ExportPlanItem } from '@curador/core';
import { WebSourceDirectory } from '@curador/adapters-web';
import { useDerived, useSession, useStoreApi } from '../../app/context';
import { formatBytes } from './MobileHome';

/** iOS se pone lento (o falla) al compartir muchas fotos grandes de una vez. */
const BATCH = 30;

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

interface Part {
  key: string;
  sector: string;
  label: string;
  items: readonly ExportPlanItem[];
}

type PartState = { kind: 'preparing' } | { kind: 'ready'; files: File[] } | { kind: 'done' };

function canShareFiles(): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({
      files: [
        new File([new Uint8Array([0xff, 0xd8, 0xff])], 'x.jpg', {
          type: 'image/jpeg',
        }),
      ],
    });
  } catch {
    return false;
  }
}

/** Etapa 3 en el teléfono: las aprobadas se comparten para «Guardar imágenes» (Fotos) o «Guardar en Archivos». */
export function MobileSave() {
  const store = useStoreApi();
  const { ordered, counts } = useDerived();
  const library = useSession((s) => s.history.present);
  const byId = useSession((s) => s.byId);
  const source = useSession((s) => s.source);
  const name = source?.name ?? 'Carrera';
  const [states, setStates] = useState<Record<string, PartState>>({});
  const shareable = useMemo(canShareFiles, []);

  const plan = useMemo(() => {
    const ids = ordered.flat.filter((id) => ordered.sectorById.get(id) !== NO_SECTOR && statusOf(library, id) === 'marked');
    return buildExportPlan(ids, byId, ordered.sectorById, {
      baseFolderName: name,
      numberPrefix: true,
      bySector: true,
    });
  }, [ordered, library, byId, name]);

  const parts = useMemo<Part[]>(() => {
    const bySector = new Map<string, ExportPlanItem[]>();
    for (const it of plan.items) {
      const list = bySector.get(it.sector) ?? [];
      list.push(it);
      bySector.set(it.sector, list);
    }
    const out: Part[] = [];
    for (const [sector, items] of bySector) {
      const n = Math.ceil(items.length / BATCH);
      for (let i = 0; i < n; i++) {
        const slice = items.slice(i * BATCH, (i + 1) * BATCH);
        out.push({
          key: `${sector}#${i}`,
          sector,
          label:
            n > 1
              ? `Parte ${i + 1} de ${n} · fotos ${i * BATCH + 1}–${i * BATCH + slice.length}`
              : `${slice.length} ${slice.length === 1 ? 'foto' : 'fotos'}`,
          items: slice,
        });
      }
    }
    return out;
  }, [plan]);

  const pendingClassified = counts.total.pending - (counts.bySector.get(NO_SECTOR)?.pending ?? 0);

  // Leer los archivos antes de compartir: Safari exige que share() se llame justo después del toque.
  const prepare = async (part: Part) => {
    if (!(source instanceof WebSourceDirectory)) return;
    setStates((s) => ({ ...s, [part.key]: { kind: 'preparing' } }));
    try {
      const files = await Promise.all(
        part.items.map(async (it) => {
          const f = await source.getFile(it.sourcePath);
          const ext = it.targetName.split('.').pop()?.toLowerCase() ?? '';
          return new File([f], it.targetName, {
            type: f.type || MIME[ext] || 'application/octet-stream',
            lastModified: f.lastModified,
          });
        }),
      );
      setStates((s) => ({ ...s, [part.key]: { kind: 'ready', files } }));
    } catch (err) {
      console.error(err);
      setStates((s) => {
        const { [part.key]: _, ...rest } = s;
        return rest;
      });
      store.toast('No se pudieron leer las fotos. Vuelve a intentarlo.', 'error');
    }
  };

  const share = async (part: Part, files: File[]) => {
    try {
      await navigator.share({ files, title: `${name} · ${part.sector}` });
      setStates((s) => ({ ...s, [part.key]: { kind: 'done' } }));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // el usuario cerró el menú
      console.error(err);
      store.toast('No se pudieron compartir las fotos. Prueba con menos a la vez.', 'error', 6000);
    }
  };

  if (!plan.items.length) {
    return (
      <div className="m-scroll m-save">
        <div className="m-empty">
          <p className="m-empty-big">Todavía no hay fotos aprobadas</p>
          <p className="muted">Valida las fotos en la etapa 2: desliza a la derecha las que quieres guardar.</p>
        </div>
      </div>
    );
  }

  let lastSector = '';
  return (
    <div className="m-scroll m-save">
      <p className="m-lead">
        <strong className="text-marked">{plan.items.length} aprobadas</strong> · {formatBytes(plan.totalBytes)} · originales sin
        recomprimir, numerados en orden (001_, 002_…).
      </p>
      {pendingClassified > 0 && (
        <p className="m-note">
          Quedan <strong>{pendingClassified}</strong> fotos por validar: no se incluyen hasta que las apruebes.
        </p>
      )}
      <details className="m-howto" open>
        <summary>¿Cómo quedan en un álbum?</summary>
        <ol>
          <li>
            Toca <strong>Compartir</strong> en un sector y elige <strong>«Guardar N imágenes»</strong>: quedan en Fotos, al final de
            Recientes.
          </li>
          <li>
            En Fotos: <strong>Seleccionar</strong> → marca las recién guardadas → <strong>＋ Añadir a álbum</strong> →{' '}
            <strong>Nuevo álbum</strong> (p. ej. «{name} · Entrada»).
          </li>
          <li>
            Para subirlas a la web, elige mejor <strong>«Guardar en Archivos»</strong> y crea una carpeta por sector.
          </li>
        </ol>
        <p className="small muted">Safari no permite que una página web cree álbumes por sí sola. Al guardar en Fotos se agregan copias.</p>
      </details>
      {!shareable && (
        <p className="m-note">
          Este navegador no permite compartir archivos. Abre la app en Safari del iPhone/iPad o usa la versión de escritorio para exportar a
          una carpeta.
        </p>
      )}
      <ul className="m-parts">
        {parts.map((part) => {
          const st = states[part.key];
          const header = part.sector !== lastSector;
          lastSector = part.sector;
          return (
            <li key={part.key} className="m-part">
              {header && <h3>{part.sector}</h3>}
              <div className="m-part-row">
                <span className="m-part-label">
                  {part.label}
                  <span className="small muted"> · {formatBytes(part.items.reduce((n, it) => n + it.size, 0))}</span>
                </span>
                {!st ? (
                  <button className="btn" onClick={() => void prepare(part)} disabled={!shareable}>
                    Preparar
                  </button>
                ) : st.kind === 'preparing' ? (
                  <button className="btn" disabled>
                    Leyendo…
                  </button>
                ) : st.kind === 'ready' ? (
                  <button className="btn btn-primary" onClick={() => void share(part, st.files)}>
                    Compartir ⬆︎
                  </button>
                ) : (
                  <button className="btn btn-ghost" onClick={() => void prepare(part)}>
                    ✓ Compartida · otra vez
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
