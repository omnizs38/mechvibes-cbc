import { store } from './store';

const THEME_LSID = 'mechvibes-theme';

/**
 * Applies the theme chosen in the main window. Secondary windows only read it.
 */
export function applyStoredTheme(): void {
  const saved = store.get(THEME_LSID);
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved === 'dark' || saved === 'light' ? saved : prefersDark ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
}
