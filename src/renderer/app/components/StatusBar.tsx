import type { useUpdater } from '../useUpdater';

type Props = {
  version: string;
  updater: ReturnType<typeof useUpdater>;
};

type State = 'idle' | 'busy' | 'ready' | 'error';

function stateOf(status: string | undefined): State {
  switch (status) {
    case 'checking':
    case 'downloading':
      return 'busy';
    case 'available':
    case 'downloaded':
      return 'ready';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

/**
 * Always-visible footer strip: which version is installed, what the updater is
 * doing, and the single action that makes sense right now.
 */
export function StatusBar({ version, updater }: Props) {
  const state = stateOf(updater.state?.status);

  const action = updater.canInstall
    ? { label: 'Restart and install', run: updater.install, primary: true }
    : updater.canDownload
      ? { label: 'Download', run: updater.download, primary: true }
      : { label: 'Check for updates', run: updater.check, primary: false };

  return (
    <div className="app-statusbar" data-state={state}>
      <span className="status-dot" aria-hidden="true" />
      <span className="status-version">v{version}</span>
      <span className="status-message" title={updater.message}>
        {updater.message}
      </span>

      {updater.isDownloading ? (
        <span
          className="status-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(updater.percent)}
        >
          <span className="status-progress-bar" style={{ width: `${updater.percent}%` }} />
        </span>
      ) : null}

      <button
        type="button"
        className={action.primary ? 'btn btn-primary btn-small' : 'btn-ghost'}
        onClick={action.run}
        disabled={updater.isBusy}
      >
        {action.label}
      </button>
    </div>
  );
}
