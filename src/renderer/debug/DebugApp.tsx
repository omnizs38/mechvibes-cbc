import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcRenderer, onIpc, openExternal } from '../shared/electron';

type DebugOptions = {
  enabled: boolean;
  identifier?: string;
};

export function DebugApp() {
  const [options, setOptions] = useState<DebugOptions | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const offOptions = onIpc<[DebugOptions]>('debug-options', (next) => setOptions(next));
    const offUpdate = onIpc<[DebugOptions]>('debug-update', (next) => setOptions(next));
    ipcRenderer.send('fetch-debug-options');
    return () => {
      offOptions();
      offUpdate();
    };
  }, []);

  const toggleRemoteDebugging = useCallback(() => {
    setOptions((previous) => {
      const current = previous ?? { enabled: false };
      const next: DebugOptions = current.enabled
        ? { ...current, enabled: false, identifier: undefined }
        : { ...current, enabled: true };
      ipcRenderer.send('set-debug-options', next);
      return next;
    });
  }, []);

  const enabled = options?.enabled ?? false;
  const identifier = enabled ? options?.identifier ?? '' : '';

  return (
    <div className="debug">
      <header className="debug-head">
        <span className="debug-kicker">Mechvibes</span>
        <h1 className="debug-title">Advanced</h1>
      </header>

      <section className="card">
        <div className="switch-row">
          <span className="switch-text">
            <span className="switch-title">Remote debugging</span>
            <span className="switch-sub">
              Please do not enable this unless you have been asked to.
            </span>
          </span>
          <input
            className="switch"
            type="checkbox"
            role="switch"
            aria-label="Remote debugging"
            checked={enabled}
            disabled={options === null}
            onChange={toggleRemoteDebugging}
          />
        </div>

        {enabled ? (
          <div className="field">
            <div className="field-label">
              <label htmlFor="debug-code">Debug code</label>
            </div>
            <input
              id="debug-code"
              ref={codeRef}
              className="input"
              type="text"
              readOnly
              value={identifier}
              placeholder="You don't have a debug code yet."
              onFocus={() => codeRef.current?.select()}
            />
            <span className="hint">
              Give this code to a developer upon request for live assistance.
            </span>
          </div>
        ) : null}
      </section>

      <footer className="debug-footer">
        <a
          href="https://mechvibes.com"
          onClick={(event) => {
            event.preventDefault();
            openExternal('https://mechvibes.com');
          }}
        >
          mechvibes.com
        </a>
      </footer>
    </div>
  );
}
