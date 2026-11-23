import { useEffect } from 'react';
import { derive } from './context';
import type { SessionStore } from './store';

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** Atajos de teclado globales (cuadrícula y revisión). */
export function useShortcuts(store: SessionStore): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = store.getState();
      if (s.phase !== 'ready' || isTyping(e.target)) return;
      if (s.dialog) return; // el diálogo maneja su propio teclado (Esc)
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;
      const { visible } = derive(s);
      const i = s.focusId ? visible.indexOf(s.focusId) : -1;
      const at = (n: number) => visible[Math.max(0, Math.min(visible.length - 1, n))] ?? null;
      const inReview = s.view === 'review';
      const go = (n: number) => {
        const id = at(n);
        if (id) store.focus(id, e.shiftKey && !inReview ? { select: 'range', visible } : {});
      };
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      // Deshacer / rehacer
      if (mod && key.toLowerCase() === 'z') {
        handled();
        if (e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && key.toLowerCase() === 'y') {
        handled();
        store.redo();
        return;
      }
      if (mod && key.toLowerCase() === 'a' && !inReview) {
        handled();
        store.selectAll(visible);
        return;
      }
      if (mod) return;

      const next = i >= 0 ? (visible[i + 1] ?? null) : null;

      // 1–9: marcar para el sector con ese número (panel derecho).
      if (/^[1-9]$/.test(key) && !e.altKey) {
        const sector = derive(s).sectorNames[Number(key) - 1];
        handled();
        if (!sector) return store.toast(`No hay un sector ${key}. Créalo en el panel de sectores.`);
        return store.markForSector(sector, undefined, inReview && s.autoAdvance ? next : null);
      }
      switch (key) {
        case 'ArrowRight':
          handled();
          return go(i < 0 ? 0 : i + 1);
        case 'ArrowLeft':
          handled();
          return go(i < 0 ? 0 : i - 1);
        case 'ArrowDown':
          if (inReview) return;
          handled();
          return go(i < 0 ? 0 : i + s.columns);
        case 'ArrowUp':
          if (inReview) return;
          handled();
          return go(i < 0 ? 0 : i - s.columns);
        case 'Home':
          handled();
          return go(0);
        case 'End':
          handled();
          return go(visible.length - 1);
        case 'Enter':
        case ' ':
          if (inReview) {
            if (key === ' ') {
              handled();
              go(i + 1);
            }
            return;
          }
          handled();
          return store.openReview();
        case 'Escape':
          handled();
          if (inReview && s.zoom) return store.setZoom(false);
          if (inReview) return store.closeReview();
          return store.clearSelection();
        case 'g':
        case 'G':
          if (inReview) {
            handled();
            store.closeReview();
          }
          return;
        case 'p':
        case 'P':
          handled();
          return store.mark('marked', inReview && s.autoAdvance ? next : null);
        case 'x':
        case 'X':
          handled();
          return store.mark('discarded', inReview && s.autoAdvance ? next : null);
        case 'u':
        case 'U':
          handled();
          return store.resetStatus();
        case 'z':
        case 'Z':
          handled();
          if (inReview) return store.setZoom(!s.zoom);
          return store.openReview(undefined, true);
        case 'e':
        case 'E':
          handled();
          return store.setDialog('export');
        case '?':
          handled();
          return store.setDialog('help');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);
}
