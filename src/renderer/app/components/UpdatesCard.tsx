import { useState } from 'react';
import type { useUpdater } from '../useUpdater';

type Props = {
  updater: ReturnType<typeof useUpdater>;
};

export function UpdatesCard({ updater }: Props) {
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Updates</h2>
        <button
          type="button"
          className="btn-ghost"
          onClick={updater.check}
          disabled={updater.isBusy}
        >
          {updater.isBusy ? 'Working…' : 'Check now'}
        </button>
      </div>

      <div className="field">
        <div className="field-label">
          <label htmlFor="update-channel">Channel</label>
          <span className="hint">
            {updater.channel === 'beta' ? 'Pre-releases included' : 'Stable releases only'}
          </span>
        </div>
        <select
          id="update-channel"
          className="input"
          value={updater.channel}
          disabled={updater.isBusy}
          onChange={(event) => updater.setChannel(event.target.value)}
        >
          <option value="stable">Stable</option>
          <option value="beta">Beta</option>
        </select>
      </div>

      <p className="hint">{updater.message}</p>

      {updater.isDownloading ? (
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(updater.percent)}
        >
          <div className="progress-bar" style={{ width: `${updater.percent}%` }} />
        </div>
      ) : null}

      {updater.hasDetails ? (
        <>
          <div className="btn-row" style={{ marginTop: 'var(--space-2)' }}>
            {updater.canDownload ? (
              <button type="button" className="btn btn-primary" onClick={updater.download}>
                Download update
              </button>
            ) : null}
            {updater.canInstall ? (
              <button type="button" className="btn btn-primary" onClick={updater.install}>
                Restart and install
              </button>
            ) : null}
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setNotesOpen((open) => !open)}
              aria-expanded={notesOpen}
            >
              {notesOpen ? 'Hide release notes' : 'Release notes'}
            </button>
          </div>
          {notesOpen ? <div className="release-notes">{updater.releaseNotes}</div> : null}
        </>
      ) : null}
    </section>
  );
}
