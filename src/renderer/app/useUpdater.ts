import { useCallback, useEffect, useMemo, useState } from 'react';
import { ipcRenderer, onIpc } from '../shared/electron';
import type { UpdaterState } from '../shared/types';

function describe(state: UpdaterState | null): string {
  if (!state) return 'Update status is unavailable.';
  switch (state.status) {
    case 'idle':
      return 'Updates are ready to check.';
    case 'development':
      return 'Automatic updates are available in installed builds.';
    case 'checking':
      return 'Checking for updates…';
    case 'available':
      return `Mechvibes ${state.availableVersion} is available. Review the changes before downloading.`;
    case 'not-available':
      return `Mechvibes ${state.currentVersion} is up to date.`;
    case 'downloading': {
      const percent = Math.round(clampPercent(state));
      return `Downloading update… ${percent}%`;
    }
    case 'downloaded':
      return `Mechvibes ${state.availableVersion || ''} is ready to install.`;
    case 'error':
      return `Update failed: ${state.error || 'Unknown error.'}`;
    default:
      return 'Update status is unavailable.';
  }
}

function clampPercent(state: UpdaterState | null): number {
  const percent = Number(state?.progress?.percent) || 0;
  return Math.max(0, Math.min(100, percent));
}

export function useUpdater() {
  const [state, setState] = useState<UpdaterState | null>(() => {
    try {
      return (ipcRenderer.sendSync('updater-get-state') as UpdaterState) ?? null;
    } catch {
      return null;
    }
  });

  useEffect(() => onIpc<[UpdaterState]>('updater-state', (next) => setState(next ?? null)), []);

  const check = useCallback(() => ipcRenderer.send('updater-check'), []);
  const download = useCallback(() => ipcRenderer.send('updater-download'), []);
  const install = useCallback(() => ipcRenderer.send('updater-install'), []);
  const setChannel = useCallback(
    (channel: string) => ipcRenderer.send('updater-set-channel', channel),
    [],
  );

  return useMemo(
    () => ({
      state,
      channel: state?.channel || 'stable',
      message: describe(state),
      percent: clampPercent(state),
      releaseNotes: state?.releaseNotes || 'No release notes were provided.',
      isBusy: state?.status === 'checking' || state?.status === 'downloading',
      canDownload: state?.status === 'available',
      canInstall: state?.status === 'downloaded',
      isDownloading: state?.status === 'downloading',
      hasDetails:
        state?.status === 'available' ||
        state?.status === 'downloading' ||
        state?.status === 'downloaded',
      check,
      download,
      install,
      setChannel,
    }),
    [state, check, download, install, setChannel],
  );
}
