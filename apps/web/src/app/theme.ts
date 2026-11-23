import { useEffect, useState } from 'react';

export type Theme = 'auto' | 'light' | 'dark';
const KEY = 'curador-theme';

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(theme: Theme = read()): void {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* almacenamiento no disponible */
    }
  }, [theme]);
  return { theme, cycle: () => setTheme((t) => (t === 'auto' ? 'dark' : t === 'dark' ? 'light' : 'auto')) };
}
