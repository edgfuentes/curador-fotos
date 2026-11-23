import { useSyncExternalStore } from 'react';

const QUERY = '(pointer: coarse)';

function forced(): 'mobile' | 'desktop' | null {
  try {
    const p = new URLSearchParams(location.search);
    if (p.has('movil')) return 'mobile';
    if (p.has('escritorio')) return 'desktop';
  } catch {
    /* sin location */
  }
  return null;
}

function subscribe(cb: () => void): () => void {
  const mq = matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

/**
 * Versión táctil en iPhone/iPad (puntero grueso) y en navegadores que no pueden
 * abrir carpetas (Safari, Firefox). `?movil` o `?escritorio` en la dirección la fuerzan.
 */
export function useMobileUi(folderAccessSupported: boolean): boolean {
  const coarse = useSyncExternalStore(
    subscribe,
    () => matchMedia(QUERY).matches,
    () => false,
  );
  const f = forced();
  if (f) return f === 'mobile';
  return coarse || !folderAccessSupported;
}
