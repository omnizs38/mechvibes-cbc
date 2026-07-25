import { useCallback, useEffect, useState } from 'react';
import { store } from '../shared/store';
import { THEME_LSID } from './useMechvibes';

export type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  const saved = store.get(THEME_LSID);
  if (saved === 'dark' || saved === 'light') return saved;
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store.set(THEME_LSID, theme);
  }, [theme]);

  const setDarkMode = useCallback((enabled: boolean) => setTheme(enabled ? 'dark' : 'light'), []);

  return { theme, isDark: theme === 'dark', setDarkMode };
}
