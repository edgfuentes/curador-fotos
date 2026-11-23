import { useEffect, useState } from 'react';
import { CancelledError, type ImageRef, type Photo, type ViewSize } from '@curador/core';
import { usePlatform, useSession } from './context';

export type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; url: string; width: number; height: number }
  | { status: 'unsupported' }
  | { status: 'error'; message: string };

/** Pide una vista generada localmente y la libera al desmontar. */
export function useView(photo: Photo | undefined, size: ViewSize, priority = 0, enabled = true): ViewState {
  const { thumbnails } = usePlatform();
  const source = useSession((s) => s.source);
  const [state, setState] = useState<ViewState>({ status: 'loading' });

  useEffect(() => {
    if (!photo || !source || !enabled) return;
    const abort = new AbortController();
    let ref: ImageRef | null = null;
    setState({ status: 'loading' });
    thumbnails
      .get(source, photo, size, { signal: abort.signal, priority })
      .then((r) => {
        if (abort.signal.aborted) {
          r?.release();
          return;
        }
        ref = r;
        setState(r ? { status: 'ready', url: r.url, width: r.width, height: r.height } : { status: 'unsupported' });
      })
      .catch((err: unknown) => {
        if (err instanceof CancelledError || abort.signal.aborted) return;
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      abort.abort();
      ref?.release();
    };
    // La foto se identifica por su clave de archivo; priority no debe reiniciar la carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.id, photo?.size, photo?.lastModified, source, size, enabled, thumbnails]);

  return state;
}

/** Precarga vistas (p. ej. la siguiente foto en revisión) manteniéndolas en memoria. */
export function usePreload(photos: (Photo | undefined)[], size: ViewSize): void {
  const { thumbnails } = usePlatform();
  const source = useSession((s) => s.source);
  const key = photos.map((p) => p?.id ?? '').join('\n');
  useEffect(() => {
    if (!source) return;
    const abort = new AbortController();
    const refs: ImageRef[] = [];
    photos.forEach((p, i) => {
      if (!p) return;
      thumbnails
        .get(source, p, size, { signal: abort.signal, priority: 5 - i })
        .then((r) => {
          if (!r) return;
          if (abort.signal.aborted) r.release();
          else refs.push(r);
        })
        .catch(() => undefined);
    });
    return () => {
      abort.abort();
      refs.forEach((r) => r.release());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, source, size, thumbnails]);
}
