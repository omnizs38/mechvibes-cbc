import type { StatusMessage } from '../../shared/types';

type Props = {
  status: StatusMessage;
  remoteDebugInUse: boolean;
  onDisableRemoteDebug: () => void;
  systemMuted: boolean;
  mechvibesMuted: boolean;
};

export function Banners({
  status,
  remoteDebugInUse,
  onDisableRemoteDebug,
  systemMuted,
  mechvibesMuted,
}: Props) {
  const hasStatus = status.text !== '';
  if (!hasStatus && !remoteDebugInUse && !systemMuted && !mechvibesMuted) {
    return null;
  }

  return (
    <div role="status" aria-live="polite">
      {hasStatus ? (
        <div className="banner" data-state={status.state}>
          {status.text}
        </div>
      ) : null}

      {remoteDebugInUse ? (
        <div className="banner" data-state="warning">
          <span>Remote debugging is active.</span>
          <button type="button" className="btn-ghost" onClick={onDisableRemoteDebug}>
            Turn off
          </button>
        </div>
      ) : null}

      {systemMuted ? (
        <div className="banner" data-state="warning">
          System audio is muted, so no sounds will play.
        </div>
      ) : null}

      {mechvibesMuted ? (
        <div className="banner" data-state="warning">
          Mechvibes is muted from the tray menu.
        </div>
      ) : null}
    </div>
  );
}
