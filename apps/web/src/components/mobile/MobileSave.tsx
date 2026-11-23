import { useEffect, useMemo, useState } from 'react';
import { NO_SECTOR, prefixWidth, sanitizeFolderName, statusOf, type PhotoId } from '@curador/core';
import { WebSourceDirectory } from '@curador/adapters-web';
import { useDerived, useSession, useStoreApi } from '../../app/context';
import { formatBytes } from './MobileHome';

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

/** Nombre del Atajo de iOS que guarda lo compartido en un álbum nuevo. */
export const SHORTCUT_NAME = 'Guardar en álbum nuevo';

interface Item {
  id: PhotoId;
  sector: string;
  sourcePath: string;
  /** «001_Entrada_IMG_1234.JPG»: número global en el orden final + sector, para que todo quede junto y en orden. */
  targetName: string;
  size: number;
}

type Prep =
  { kind: 'idle' } | { kind: 'preparing'; done: number } | { kind: 'ready'; files: File[]; key: string } | { kind: 'shared'; key: string };

function canShareFiles(): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([new Uint8Array([0xff, 0xd8, 0xff])], 'x.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}

/** Etapa 3 en el teléfono: todas las aprobadas se comparten juntas, en un solo envío. */
export function MobileSave() {
  const store = useStoreApi();
  const { ordered, counts, sectorNames } = useDerived();
  const library = useSession((s) => s.history.present);
  const byId = useSession((s) => s.byId);
  const source = useSession((s) => s.source);
  const name = source?.name ?? 'Carrera';
  const [prep, setPrep] = useState<Prep>({ kind: 'idle' });
  const shareable = useMemo(canShareFiles, []);

  const items = useMemo<Item[]>(() => {
    const ids = ordered.flat.filter((id) => ordered.sectorById.get(id) !== NO_SECTOR && statusOf(library, id) === 'marked');
    const width = prefixWidth(ids.length);
    const out: Item[] = [];
    ids.forEach((id, i) => {
      const p = byId.get(id);
      if (!p) return;
      const sector = ordered.sectorById.get(id) ?? '';
      out.push({
        id,
        sector,
        sourcePath: p.relativePath,
        targetName: `${String(i + 1).padStart(width, '0')}_${sanitizeFolderName(sector).replace(/\s+/g, '-')}_${p.fileName}`,
        size: p.size,
      });
    });
    return out;
  }, [ordered, library, byId]);

  const key = items.map((it) => it.targetName).join('\n');
  const totalBytes = items.reduce((n, it) => n + it.size, 0);
  // Si cambian las aprobadas, hay que volver a preparar.
  useEffect(() => setPrep((p) => (p.kind === 'ready' || p.kind === 'shared' ? (p.key === key ? p : { kind: 'idle' }) : p)), [key]);

  const pendingClassified = counts.total.pending - (counts.bySector.get(NO_SECTOR)?.pending ?? 0);

  // Leer los archivos antes de compartir: Safari exige que share() se llame justo después de un toque.
  const prepare = async () => {
    if (!(source instanceof WebSourceDirectory)) return;
    setPrep({ kind: 'preparing', done: 0 });
    try {
      let done = 0;
      const files = await Promise.all(
        items.map(async (it) => {
          const f = await source.getFile(it.sourcePath);
          const ext = it.targetName.split('.').pop()?.toLowerCase() ?? '';
          const file = new File([f], it.targetName, {
            type: f.type || MIME[ext] || 'application/octet-stream',
            lastModified: f.lastModified,
          });
          done++;
          if (done % 20 === 0) setPrep({ kind: 'preparing', done });
          return file;
        }),
      );
      setPrep({ kind: 'ready', files, key });
    } catch (err) {
      console.error(err);
      setPrep({ kind: 'idle' });
      store.toast('No se pudieron leer las fotos. Vuelve a intentarlo.', 'error');
    }
  };

  const share = async (files: File[]) => {
    try {
      await navigator.share({ files, title: name });
      setPrep({ kind: 'shared', key });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // el usuario cerró el menú
      console.error(err);
      store.toast('iOS no pudo compartir tantas fotos juntas. Cierra otras apps y vuelve a intentarlo.', 'error', 7000);
    }
  };

  if (!items.length) {
    return (
      <div className="m-scroll m-save">
        <div className="m-empty">
          <p className="m-empty-big">Todavía no hay fotos aprobadas</p>
          <p className="muted">Valida las fotos en la etapa 2: desliza a la derecha las que quieres guardar.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="m-scroll m-save">
      <div className="m-save-card">
        <p className="m-save-total">
          <strong className="text-marked">{items.length}</strong> {items.length === 1 ? 'foto aprobada' : 'fotos aprobadas'}
          <span className="muted small"> · {formatBytes(totalBytes)}</span>
        </p>
        <ul className="m-save-sectors">
          {sectorNames.map((s) => {
            const n = counts.bySector.get(s)?.marked ?? 0;
            return n ? (
              <li key={s}>
                <span className="ellipsis">{s}</span>
                <strong>{n}</strong>
              </li>
            ) : null;
          })}
        </ul>
        <p className="small muted">
          Van todas juntas, en el orden de los sectores y numeradas: <code>001_Entrada_IMG_1234.JPG</code>… Son los originales, sin
          recomprimir.
        </p>
        {prep.kind === 'idle' ? (
          <button className="btn btn-primary btn-lg full" onClick={() => void prepare()} disabled={!shareable}>
            Preparar las {items.length} fotos
          </button>
        ) : prep.kind === 'preparing' ? (
          <button className="btn btn-lg full" disabled>
            Leyendo… {prep.done} de {items.length}
          </button>
        ) : prep.kind === 'ready' ? (
          <button className="btn btn-primary btn-lg full" onClick={() => void share(prep.files)}>
            Guardar las {items.length} fotos ⬆︎
          </button>
        ) : (
          <button className="btn btn-lg full" onClick={() => void prepare()}>
            ✓ Enviadas · volver a guardar
          </button>
        )}
        {prep.kind === 'ready' && (
          <p className="small muted m-save-hint">
            En el menú elige <strong>«{SHORTCUT_NAME}»</strong> para crear un álbum, o «Guardar en Archivos» para una carpeta.
          </p>
        )}
      </div>

      {pendingClassified > 0 && (
        <p className="m-note">
          Quedan <strong>{pendingClassified}</strong> fotos por validar: no se incluyen hasta que las apruebes.
        </p>
      )}
      {!shareable && (
        <p className="m-note">
          Este navegador no permite compartir archivos. Abre la app en Safari del iPhone/iPad o usa la versión de escritorio para exportar a
          una carpeta.
        </p>
      )}

      <details className="m-howto">
        <summary>Guardar en un álbum nuevo (configurar una sola vez)</summary>
        <p className="small">
          Una página web no puede crear álbumes en Fotos, pero un <strong>Atajo</strong> de iOS sí. Se crea una vez y después aparece en el
          menú de compartir:
        </p>
        <ol>
          <li>
            Abre la app <strong>Atajos</strong> y toca <strong>＋</strong>. Ponle de nombre <strong>«{SHORTCUT_NAME}»</strong>.
          </li>
          <li>
            Toca <strong>ⓘ</strong> (detalles) y activa <strong>«Mostrar en hoja de compartir»</strong>. Que reciba{' '}
            <strong>Imágenes</strong>.
          </li>
          <li>
            Agrega la acción <strong>«Solicitar entrada»</strong> (texto) con la pregunta «Nombre del álbum».
          </li>
          <li>
            Agrega la acción <strong>«Crear álbum»</strong>: como nombre, la <em>Entrada proporcionada</em>; como contenido, la{' '}
            <em>Entrada del atajo</em>.
          </li>
        </ol>
        <p className="small">
          Listo: al tocar «Guardar las fotos», elige <strong>«{SHORTCUT_NAME}»</strong>, escribe el nombre (p. ej. «{name}») y quedan todas
          en ese álbum.
        </p>
        <p className="small muted">
          Si tu versión de iOS no tiene «Crear álbum», crea el álbum antes en Fotos y usa la acción «Guardar en álbum de fotos». Sin Atajo,
          también puedes elegir «Guardar N imágenes» y luego en Fotos: Seleccionar → Añadir a álbum → Nuevo álbum.
        </p>
      </details>
    </div>
  );
}
