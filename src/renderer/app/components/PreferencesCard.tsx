type Props = {
  trayIcon: boolean;
  onTrayIconChange: (enabled: boolean) => void;
  darkMode: boolean;
  onDarkModeChange: (enabled: boolean) => void;
};

export function PreferencesCard({
  trayIcon,
  onTrayIconChange,
  darkMode,
  onDarkModeChange,
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

      <div className="switch-row">
        <span className="switch-text">
          <span className="switch-title">Dark mode</span>
          <span className="switch-sub">Follows your choice on every window</span>
        </span>
        <input
          className="switch"
          type="checkbox"
          role="switch"
          aria-label="Dark mode"
          checked={darkMode}
          onChange={(event) => onDarkModeChange(event.target.checked)}
        />
      </div>
    </section>
  );
}
