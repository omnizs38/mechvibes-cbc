import { store } from './store';

export const THEME_LSID = 'mechvibes-theme';

/** What the user picked. `system` defers to the OS setting. */
export type ThemeMode = 'system' | 'light' | 'dark';

/** What actually gets painted. */
export type Theme = 'light' | 'dark';

function darkQuery(): MediaQueryList | null {
  if (typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-color-scheme: dark)');
}

/** Reads the stored mode, treating anything unexpected as `system`. */
export function readThemeMode(): ThemeMode {
  const saved = store.get(THEME_LSID);
  return saved === 'dark' || saved === 'light' || saved === 'system' ? saved : 'system';
}

/** The theme Windows is currently asking for. */
export function systemTheme(): Theme {
  return darkQuery()?.matches ? 'dark' : 'light';
}

export function resolveTheme(mode: ThemeMode = readThemeMode()): Theme {
  return mode === 'system' ? systemTheme() : mode;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * Subscribes to OS theme changes.
 *
 * Returns an unsubscribe function; callers that live for the whole window
 * lifetime can safely ignore it.
 */
export function watchSystemTheme(onChange: (theme: Theme) => void): () => void {
  const query = darkQuery();
  if (!query) return () => {};
  const listener = (event: MediaQueryListEvent) => onChange(event.matches ? 'dark' : 'light');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/**
 * Applies the stored theme and keeps following the OS while the mode is
 * `system`. Secondary windows call this once and never manage the theme
 * themselves.
 */
export function applyStoredTheme(): () => void {
  const apply = () => applyTheme(resolveTheme());
  apply();
  return watchSystemTheme(() => {
    if (readThemeMode() === 'system') apply();
  });
}
