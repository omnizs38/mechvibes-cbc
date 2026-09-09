import type { StatusMessage } from '../../shared/types';

type Props = {
  status: StatusMessage;
  systemMuted: boolean;
  mechvibesMuted: boolean;
};

export function Banners({
  status,
  systemMuted,
  mechvibesMuted,
}: Props) {
  const hasStatus = status.text !== '';
  if (!hasStatus && !systemMuted && !mechvibesMuted) {
    return null;
  }

  return (
    <div role="status" aria-live="polite">
      {hasStatus ? (
        <div className="banner" data-state={status.state}>
          {status.text}
        </div>
      ) : null}

      {systemMuted ? (
        <div className="banner" data-state="warning">
          System audio is muted, so no sounds will play.
        </div>
      ) : null}

      {mechvibesMuted ? (
        <div className="banner" data-state="warning">
          Mechvibes is muted. Resume from the header, tray or Ctrl+Shift+M.
        </div>
      ) : null}
    </div>
  );
}
