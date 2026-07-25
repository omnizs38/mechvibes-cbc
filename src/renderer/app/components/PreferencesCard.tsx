import type { ThemeMode } from '../../shared/theme';

type Props = {
  trayIcon: boolean;
  onTrayIconChange: (enabled: boolean) => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
};

export function PreferencesCard({
  trayIcon,
  onTrayIconChange,
  themeMode,
  onThemeModeChange,
}: Props) {
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Preferences</h2>
      </div>

      <div className="switch-row">
        <span className="switch-text">
          <span className="switch-title">Tray icon</span>
          <span className="switch-sub">Keep Mechvibes in the system tray</span>
        </span>
        <input
          className="switch"
          type="checkbox"
          role="switch"
          aria-label="Tray icon"
          checked={trayIcon}
          onChange={(event) => onTrayIconChange(event.target.checked)}
        />
      </div>

      <div className="field">
        <div className="field-label">
          <label htmlFor="theme-mode">Appearance</label>
          <span className="hint">
            {themeMode === 'system' ? 'Following Windows' : 'Set manually'}
          </span>
        </div>
        <select
          id="theme-mode"
          className="input"
          value={themeMode}
          onChange={(event) => onThemeModeChange(event.target.value as ThemeMode)}
        >
          <option value="system">Follow Windows</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
    </section>
  );
}
