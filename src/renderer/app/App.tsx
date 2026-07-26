import { useCallback, useEffect, useMemo, useState } from 'react';
import { ipcRenderer, log, openExternal } from '../shared/electron';
import { readBoolean, store } from '../shared/store';
import { Banners } from './components/Banners';
import { Footer } from './components/Footer';
import { PreferencesCard } from './components/PreferencesCard';
import { SoundCard } from './components/SoundCard';
import { SoundpackCard } from './components/SoundpackCard';
import { StatusBar } from './components/StatusBar';
import { UpdatesCard } from './components/UpdatesCard';
import { APP_VERSION, MV_TRAY_LSID, useMechvibes } from './useMechvibes';
import { useOutputDevices } from './useOutputDevices';
import { useTheme } from './useTheme';
import { useUpdater } from './useUpdater';

const DEBUG_STATUS_URL = 'https://beta.mechvibes.com/debug/status/';

export function App() {
  const mechvibes = useMechvibes();
  const updater = useUpdater();
  const theme = useTheme();

  const outputs = useOutputDevices({
    savedDeviceRef: mechvibes.savedOutputDeviceId,
    applyToPack: mechvibes.applyOutputDeviceToPack,
    hasPack: mechvibes.hasPack,
  });

  const [trayIcon, setTrayIcon] = useState(() => readBoolean(MV_TRAY_LSID, false));
  const [debugOptionsAvailable, setDebugOptionsAvailable] = useState(false);

  // Mirror the stored tray preference to the main process on startup.
  useEffect(() => {
    ipcRenderer.send('show_tray_icon', trayIcon);
  }, [trayIcon]);

  const toggleTrayIcon = useCallback((enabled: boolean) => {
    store.set(MV_TRAY_LSID, enabled);
    setTrayIcon(enabled);
  }, []);

  // The advanced/debug entry point is only shown when the backend enables it.
  useEffect(() => {
    let canceled = false;
    fetch(DEBUG_STATUS_URL, {
      method: 'GET',
      headers: {
        'User-Agent': `Mechvibes/${APP_VERSION} (Electron/${process.versions.electron})`,
      },
    })
      .then(async (response) => {
        const body = await response.text();
        if (!canceled && response.status === 200 && body === 'enabled') {
          setDebugOptionsAvailable(true);
        }
      })
      .catch((error: unknown) => {
        log.debug(`Debug status check failed: ${error instanceof Error ? error.message : error}`);
      });
    return () => {
      canceled = true;
    };
  }, []);

  const subtitle = useMemo(() => {
    if (mechvibes.packLoading) return 'Loading soundpack…';
    if (!mechvibes.currentPack) return 'Sound unavailable';
    const version = mechvibes.currentPack.version ? ` · v${mechvibes.currentPack.version}` : '';
    return `${mechvibes.currentPack.name}${version}`;
  }, [mechvibes.currentPack, mechvibes.packLoading]);

  return (
    <div className="app">
      <header className="app-header">
        <div
          className={[
            'keycap',
            mechvibes.keyPressed ? 'is-pressed' : '',
            mechvibes.packLoading ? 'is-loading' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        >
          {/* Lucide "keyboard" (ISC). Inlined: the renderer CSP forbids
              remote sources, and an emoji renders differently per platform. */}
          <svg
            className="keycap-glyph"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 8h.01" />
            <path d="M12 12h.01" />
            <path d="M14 8h.01" />
            <path d="M16 12h.01" />
            <path d="M18 8h.01" />
            <path d="M6 8h.01" />
            <path d="M7 16h10" />
            <path d="M8 12h.01" />
            <rect width="20" height="16" x="2" y="4" rx="2" />
          </svg>
        </div>
        <div className="app-title">
          <span className="app-name">Mechvibes</span>
          <span className="app-subtitle">{subtitle}</span>
        </div>
      </header>

      <Banners
        status={mechvibes.status}
        remoteDebugInUse={mechvibes.remoteDebugInUse}
        onDisableRemoteDebug={mechvibes.disableRemoteDebug}
        systemMuted={mechvibes.systemMuted}
        mechvibesMuted={mechvibes.mechvibesMuted}
      />

      <main className={`app-main${mechvibes.packLoading ? ' is-loading' : ''}`}>
        <SoundpackCard
          packs={mechvibes.packs}
          currentPackId={mechvibes.currentPackId}
          currentPack={mechvibes.currentPack}
          disabled={mechvibes.packLoading}
          pendingAction={mechvibes.pendingAction}
          actionStatus={mechvibes.soundpackActionStatus}
          onSelect={(packId) => void mechvibes.selectPack(packId)}
          onRandom={mechvibes.selectRandomPack}
          onRefresh={() => void mechvibes.refreshPacks()}
          onImport={() => void mechvibes.importPack()}
          onOpenFolder={() => void mechvibes.openPacksFolder()}
          onDelete={() => void mechvibes.deleteCurrentPack()}
        />

        <SoundCard
          volume={mechvibes.volume}
          adjustedVolume={mechvibes.adjustedVolume}
          activeVolume={mechvibes.activeVolume}
          onVolumeChange={mechvibes.setVolume}
          onVolumeWheel={mechvibes.nudgeVolume}
          outputs={outputs}
        />

        <PreferencesCard
          trayIcon={trayIcon}
          onTrayIconChange={toggleTrayIcon}
          themeMode={theme.mode}
          onThemeModeChange={theme.setMode}
        />

        <UpdatesCard updater={updater} />
      </main>

      <StatusBar version={mechvibes.appVersion} updater={updater} />

      <Footer
        debugOptionsAvailable={debugOptionsAvailable}
        onOpenDebugOptions={mechvibes.openDebugOptions}
        onOpenExternal={openExternal}
      />
    </div>
  );
}
