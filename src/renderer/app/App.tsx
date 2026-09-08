import { useCallback, useEffect, useMemo, useState } from 'react';
import { ipcRenderer, openExternal } from '../shared/electron';
import { readBoolean, store } from '../shared/store';
import { Banners } from './components/Banners';
import { Footer } from './components/Footer';
import { PreferencesCard } from './components/PreferencesCard';
import { ProfilesCard } from './components/ProfilesCard';
import { SoundCard } from './components/SoundCard';
import { SoundpackCard } from './components/SoundpackCard';
import { StatusBar } from './components/StatusBar';
import { UpdatesCard } from './components/UpdatesCard';
import { MV_TRAY_LSID, useMechvibes } from './useMechvibes';
import { useOutputDevices } from './useOutputDevices';
import { useTheme } from './useTheme';
import { useUpdater } from './useUpdater';

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

  // Mirror the stored tray preference to the main process on startup.
  useEffect(() => {
    ipcRenderer.send('show_tray_icon', trayIcon);
  }, [trayIcon]);

  const toggleTrayIcon = useCallback((enabled: boolean) => {
    store.set(MV_TRAY_LSID, enabled);
    setTrayIcon(enabled);
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
        <button className="btn quick-mute" type="button" aria-pressed={mechvibes.mechvibesMuted}
          onClick={() => ipcRenderer.send('mechvibes-set-muted', !mechvibes.mechvibesMuted)}>
          {mechvibes.mechvibesMuted ? 'Resume sound' : 'Mute sound'}
        </button>
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

        <ProfilesCard packs={mechvibes.packs} packId={mechvibes.currentPackId} volume={mechvibes.volume}
          outputDeviceId={mechvibes.savedOutputDeviceId.current} disabled={mechvibes.packLoading || mechvibes.pendingAction !== null}
          apply={mechvibes.applyProfile} />

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
        debugOptionsAvailable={true}
        onOpenDebugOptions={mechvibes.openDebugOptions}
        onOpenExternal={openExternal}
      />
    </div>
  );
}
