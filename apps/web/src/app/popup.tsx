/**
 * Ventanas aparte (una por sector). Se abren con window.open en el mismo origen y
 * React dibuja dentro con un portal, así comparten el estado de la sesión y se
 * actualizan en vivo. Las miniaturas (blob: URLs) también se comparten.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SessionStore } from './store';

const windows = new Map<string, Window>();
const pendingClose = new Map<string, ReturnType<typeof setTimeout>>();

function windowName(sector: string): string {
  let h = 0;
  for (const ch of sector) h = (Math.imul(h, 31) + ch.codePointAt(0)!) | 0;
  return `curador-sector-${(h >>> 0).toString(36)}`;
}

/** Debe llamarse desde un clic (los navegadores bloquean ventanas abiertas sin gesto del usuario). */
export function openSectorWindow(store: SessionStore, sector: string): void {
  const existing = windows.get(sector);
  if (existing && !existing.closed) {
    existing.focus();
    return;
  }
  const w = window.open('', windowName(sector), 'popup,width=1180,height=840');
  if (!w) {
    store.toast('El navegador bloqueó la ventana. Permite las ventanas emergentes para este sitio.', 'error', 6000);
    return;
  }
  windows.set(sector, w);
  store.openSectorWindow(sector);
}

function closeAll(): void {
  for (const w of windows.values()) if (!w.closed) w.close();
  windows.clear();
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', closeAll);

function copyStyles(target: Document): void {
  target.head.querySelectorAll('[data-copied-style]').forEach((n) => n.remove());
  document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    const clone = node.cloneNode(true) as HTMLElement;
    if (clone instanceof HTMLLinkElement) clone.href = (node as HTMLLinkElement).href; // ruta absoluta
    clone.setAttribute('data-copied-style', '');
    target.head.appendChild(clone);
  });
}

function syncTheme(target: Document): void {
  const theme = document.documentElement.dataset.theme;
  if (theme) target.documentElement.dataset.theme = theme;
  else delete target.documentElement.dataset.theme;
}

/** Monta `children` dentro de la ventana del sector mientras esté abierta. */
export function SectorWindowPortal({
  store,
  sector,
  title,
  children,
}: {
  store: SessionStore;
  sector: string;
  title: string;
  children: ReactNode;
}) {
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const timer = pendingClose.get(sector);
    if (timer) clearTimeout(timer);
    pendingClose.delete(sector);

    const w = windows.get(sector);
    if (!w || w.closed) {
      store.closeSectorWindow(sector);
      return;
    }
    const doc = w.document;
    doc.documentElement.lang = 'es';
    if (!doc.querySelector('meta[charset]')) {
      const meta = doc.createElement('meta');
      meta.setAttribute('charset', 'utf-8');
      doc.head.prepend(meta);
    }
    copyStyles(doc);
    syncTheme(doc);
    let el = doc.getElementById('sector-root');
    if (!el) {
      doc.body.replaceChildren();
      el = doc.createElement('div');
      el.id = 'sector-root';
      doc.body.appendChild(el);
    }
    setRoot(el);

    // Tema y estilos (en desarrollo Vite inyecta <style> nuevos) se mantienen al día.
    const mo = new MutationObserver(() => {
      syncTheme(doc);
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const headMo = new MutationObserver(() => copyStyles(doc));
    headMo.observe(document.head, { childList: true, subtree: true, characterData: true });

    const onClose = () => {
      windows.delete(sector);
      store.closeSectorWindow(sector);
    };
    w.addEventListener('pagehide', onClose);

    return () => {
      mo.disconnect();
      headMo.disconnect();
      w.removeEventListener('pagehide', onClose);
      setRoot(null);
      // Cerrar con un pequeño retraso: en modo estricto React desmonta y vuelve a montar.
      pendingClose.set(
        sector,
        setTimeout(() => {
          pendingClose.delete(sector);
          windows.delete(sector);
          if (!w.closed) w.close();
        }, 50),
      );
    };
  }, [sector, store]);

  useEffect(() => {
    const w = windows.get(sector);
    if (w && !w.closed) w.document.title = title;
  }, [sector, title, root]);

  return root ? createPortal(children, root) : null;
}
