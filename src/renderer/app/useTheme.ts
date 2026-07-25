import { useCallback, useEffect, useState } from 'react';
import { store } from '../shared/store';
import {
  applyTheme,
  readThemeMode,
  resolveTheme,
  watchSystemTheme,
  type Theme,
  type ThemeMode,
} from '../shared/theme';
import { THEME_LSID } from './useMechvibes';

export type { Theme, ThemeMode };

/**
 * Owns the theme for the whole application.
 *
 * The chosen mode is persisted, so the other windows can read it, and while it
 * is `system` the OS setting is followed live rather than sampled once at
 * startup.
 */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readThemeMode);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(readThemeMode()));

  useEffect(() => {
    const resolved = resolveTheme(mode);
    setTheme(resolved);
    applyTheme(resolved);
    store.set(THEME_LSID, mode);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'system') return undefined;
    return watchSystemTheme((next) => {
      setTheme(next);
      applyTheme(next);
    });
  }, [mode]);

  const setDarkMode = useCallback(
    (enabled: boolean) => setMode(enabled ? 'dark' : 'light'),
    [],
  );

  return { mode, theme, isDark: theme === 'dark', setMode, setDarkMode };
}
