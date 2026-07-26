import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appRoot,
  getGlobal,
  ipcRenderer,
  log,
  nodePath,
  onIpc,
  requireFromSrc,
} from '../shared/electron';
import { readNumber, store } from '../shared/store';
import type {
  DiscoveryError,
  KeyInputEvent,
  SoundPack,
  SoundpackActionResult,
  StatusMessage,
  StatusState,
} from '../shared/types';

const { LatencyTracker } = requireFromSrc('audio-engine/latency-tracker');
const { SoundpackManager } = requireFromSrc('libs/soundpacks/pack-manager');
const { discoverSoundpacks } = requireFromSrc('libs/soundpacks/registry');
const { calculateAdjustedDisplay, calculateGain } = requireFromSrc('utils/volume');
const { chooseRandomPackIndex } = requireFromSrc('utils/random-pack');

export const MV_PACK_LSID = getGlobal<string>('current_pack_store_id');
export const MV_VOL_LSID = 'mechvibes-volume';
export const MV_TRAY_LSID = 'mechvibes-hidden';
export const OUTPUT_DEVICE_LSID = 'mechvibes-output-device';
export const THEME_LSID = 'mechvibes-theme';

export const APP_VERSION = getGlobal<string>('app_version');
const CUSTOM_PACKS_DIR = getGlobal<string>('custom_dir');
const OFFICIAL_PACKS_DIR = nodePath.join(appRoot, 'src', 'audio');

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 200;
export const VOLUME_STEP = 5;

// Audio state lives outside React: it must survive re-renders and stay unique
// for the lifetime of the window.
const packs: SoundPack[] = [];
const packManager = new SoundpackManager(packs);
const latencyTracker = new LatencyTracker();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type MechvibesState = ReturnType<typeof useMechvibes>;

export function useMechvibes() {
  const [packList, setPackList] = useState<SoundPack[]>([]);
  const [currentPackId, setCurrentPackId] = useState<string>('');
  const [packLoading, setPackLoading] = useState(true);
  const [status, setStatusState] = useState<StatusMessage>({ text: '', state: 'info' });
  const [soundpackActionStatus, setSoundpackActionStatus] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const [volume, setVolumeState] = useState(() => readNumber(MV_VOL_LSID, 50));
  const [systemVolume, setSystemVolume] = useState(50);
  const [activeVolume, setActiveVolume] = useState(true);
  const [systemMuted, setSystemMuted] = useState(false);
  const [mechvibesMuted, setMechvibesMuted] = useState(false);
  const [remoteDebugInUse, setRemoteDebugInUse] = useState(false);
  const [keyPressed, setKeyPressed] = useState(false);

  const currentPackRef = useRef<SoundPack | null>(null);
  const outputDeviceRef = useRef<string>(String(store.get(OUTPUT_DEVICE_LSID) ?? ''));
  const volumeRef = useRef(volume);
  const systemVolumeRef = useRef(systemVolume);
  const activeVolumeRef = useRef(activeVolume);
  const systemMutedRef = useRef(systemMuted);
  const mechvibesMutedRef = useRef(mechvibesMuted);
  const lastAppliedGainRef = useRef<number | null>(null);
  const selectionIdRef = useRef(0);

  const setStatus = useCallback((text: string, state: StatusState = 'info') => {
    setStatusState({ text, state });
  }, []);

  // ---------------------------------------------------------------- playback
  const playSound = useCallback((event: KeyInputEvent) => {
    const pack = currentPackRef.current;
    if (!pack || pack.audio === undefined || systemMutedRef.current || mechvibesMutedRef.current) {
      return;
    }

    if (Number.isFinite(event.capturedAtMs)) {
      latencyTracker.record(Date.now() - Number(event.capturedAtMs));
      if (latencyTracker.totalSamples % 1000 === 0) {
        const stats = latencyTracker.getStats();
        log.debug(
          `Input-to-renderer latency p50=${stats.p50Ms}ms p95=${stats.p95Ms}ms p99=${stats.p99Ms}ms`,
        );
      }
    }

    const gain = calculateGain({
      configuredVolume: volumeRef.current,
      systemVolume: systemVolumeRef.current,
      activeAdjustment: activeVolumeRef.current,
    });
    if (gain !== lastAppliedGainRef.current) {
      pack.SetMasterGain?.(gain);
      lastAppliedGainRef.current = gain;
    }

    pack.HandleEvent?.(event, volumeRef.current);
  }, []);

  // ------------------------------------------------------------ pack loading
  const selectPack = useCallback(
    async (packId: string, persist = true): Promise<SoundPack | null> => {
      const previousPack = packManager.current as SoundPack | null;
      const startedAt = performance.now();
      const requestId = ++selectionIdRef.current;

      setPackLoading(true);
      setStatus('Loading soundpack…');

      try {
        const loadedPack = (await packManager.select(packId)) as SoundPack;
        if (requestId !== selectionIdRef.current) {
          return loadedPack;
        }

        currentPackRef.current = loadedPack;
        lastAppliedGainRef.current = null;
        setCurrentPackId(loadedPack.pack_id);
        ipcRenderer.send('pack-changed', {
          name: loadedPack.name,
          version: loadedPack.version,
        });

        const deviceId = outputDeviceRef.current;
        if (deviceId && typeof loadedPack.SetOutputDevice === 'function') {
          try {
            await loadedPack.SetOutputDevice(deviceId);
          } catch (error) {
            log.warn(`Saved output device is unavailable: ${errorMessage(error)}`);
          }
        }

        if (persist) {
          store.set(MV_PACK_LSID, loadedPack.pack_id);
        }

        setStatus('', 'success');
        log.info(`Loaded ${loadedPack.pack_id} in ${Math.round(performance.now() - startedAt)}ms`);
        return loadedPack;
      } catch (error) {
        if (requestId !== selectionIdRef.current) {
          return null;
        }
        currentPackRef.current = previousPack;
        if (previousPack) {
          setCurrentPackId(previousPack.pack_id);
          setStatus(`Could not load that soundpack. Continuing with ${previousPack.name}.`, 'error');
        } else {
          setCurrentPackId('');
          setStatus(
            'No soundpack could be loaded. Check the soundpack files and try again.',
            'error',
          );
        }
        log.warn(`Failed to load ${packId}: ${errorMessage(error)}`);
        return null;
      } finally {
        if (requestId === selectionIdRef.current) {
          setPackLoading(false);
        }
      }
    },
    [setStatus],
  );

  const selectRandomPack = useCallback(() => {
    const index = chooseRandomPackIndex(packs, currentPackRef.current?.pack_id ?? null);
    if (index === null) return;
    const pack = packs[index];
    if (pack) void selectPack(pack.pack_id);
  }, [selectPack]);

  // --------------------------------------------------------------- bootstrap
  useEffect(() => {
    let disposed = false;

    const bootstrap = async () => {
      const discovery = discoverSoundpacks({
        officialDirectory: OFFICIAL_PACKS_DIR,
        customDirectory: CUSTOM_PACKS_DIR,
      }) as { packs: SoundPack[]; errors: DiscoveryError[] };

      packs.splice(0, packs.length, ...discovery.packs);
      for (const error of discovery.errors) {
        log.warn(`Skipped soundpack ${error.name}: ${error.message}`);
      }
      log.info(`Discovered ${packs.length} valid soundpacks`);
      if (disposed) return;
      setPackList([...packs]);

      const savedId = store.get(MV_PACK_LSID);
      const savedPack =
        packs.find((pack) => pack.pack_id === savedId) ?? (packs.length > 0 ? packs[0] : undefined);

      if (savedPack) {
        await selectPack(savedPack.pack_id, true);
        if (!disposed && discovery.errors.length > 0 && currentPackRef.current) {
          const count = discovery.errors.length;
          setStatus(`${count} invalid soundpack${count === 1 ? '' : 's'} skipped.`, 'warning');
        }
      } else if (!disposed) {
        setPackLoading(false);
        setStatus(
          'No valid soundpacks were found. Add a valid soundpack and restart Mechvibes.',
          'error',
        );
      }

      if (!disposed) {
        ipcRenderer.send('renderer-ready');
      }
    };

    void bootstrap();

    const disposeOnUnload = () => packManager.dispose();
    window.addEventListener('beforeunload', disposeOnUnload);
    return () => {
      disposed = true;
      window.removeEventListener('beforeunload', disposeOnUnload);
    };
  }, [selectPack, setStatus]);

  // ------------------------------------------------------------------- input
  useEffect(() => {
    const pressedKeys = new Set<KeyInputEvent['keycode']>();

    const offKeydown = onIpc<[KeyInputEvent]>('keydown', (inputEvent) => {
      const { keycode, capturedAtMs } = inputEvent;
      if (pressedKeys.has(keycode)) return;
      pressedKeys.add(keycode);
      setKeyPressed(true);
      playSound({ type: 'keydown', keycode, capturedAtMs });
    });

    const offKeyup = onIpc<[KeyInputEvent]>('keyup', (inputEvent) => {
      const { keycode, capturedAtMs } = inputEvent;
      pressedKeys.delete(keycode);
      playSound({ type: 'keyup', keycode, capturedAtMs });
      if (pressedKeys.size === 0) setKeyPressed(false);
    });

    return () => {
      offKeydown();
      offKeyup();
    };
  }, [playSound]);

  // ------------------------------------------------------------- main events
  useEffect(() => {
    const unsubscribers = [
      onIpc<[boolean]>('debug-in-use', (enabled) => setRemoteDebugInUse(Boolean(enabled))),
      onIpc<[string]>('input-hook-error', (message) =>
        setStatus(message || 'Global keyboard capture is unavailable.', 'error'),
      ),
      onIpc<[number]>('system-volume-update', (value) => setSystemVolume(Number(value))),
      onIpc<[boolean]>('system-mute-status', (enabled) => setSystemMuted(Boolean(enabled))),
      onIpc<[boolean]>('mechvibes-mute-status', (enabled) => setMechvibesMuted(Boolean(enabled))),
      onIpc<[boolean]>('ava-toggle', (enabled) => setActiveVolume(Boolean(enabled))),
    ];
    return () => unsubscribers.forEach((off) => off());
  }, [setStatus]);

  // Keep refs in sync so IPC callbacks always read fresh values.
  useEffect(() => {
    volumeRef.current = volume;
    lastAppliedGainRef.current = null;
  }, [volume]);
  useEffect(() => {
    systemVolumeRef.current = systemVolume;
    lastAppliedGainRef.current = null;
  }, [systemVolume]);
  useEffect(() => {
    activeVolumeRef.current = activeVolume;
    lastAppliedGainRef.current = null;
  }, [activeVolume]);
  useEffect(() => {
    systemMutedRef.current = systemMuted;
  }, [systemMuted]);
  useEffect(() => {
    mechvibesMutedRef.current = mechvibesMuted;
  }, [mechvibesMuted]);

  // ------------------------------------------------------------------ volume
  const setVolume = useCallback((next: number) => {
    const clamped = Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, Math.round(next)));
    store.set(MV_VOL_LSID, clamped);
    setVolumeState(clamped);
  }, []);

  const nudgeVolume = useCallback(
    (direction: 1 | -1) => setVolume(volumeRef.current + direction * VOLUME_STEP),
    [setVolume],
  );

  const adjustedVolume: number = calculateAdjustedDisplay({
    configuredVolume: volume,
    systemVolume,
    activeAdjustment: activeVolume,
  });

  // -------------------------------------------------------- soundpack manager
  const runSoundpackAction = useCallback(
    async (
      actionId: string,
      action: () => Promise<SoundpackActionResult>,
      pendingMessage: string,
      refreshAfter = true,
    ) => {
      setPendingAction(actionId);
      setSoundpackActionStatus(pendingMessage);
      try {
        const result = await action();
        if (!result || !result.ok) {
          setSoundpackActionStatus(
            result?.canceled ? 'Action canceled.' : `Action failed: ${result?.error ?? 'Unknown error.'}`,
          );
          return;
        }
        if (refreshAfter) {
          setSoundpackActionStatus('Soundpack manager updated. Refreshing…');
          window.location.reload();
        } else {
          setSoundpackActionStatus('Soundpack folder opened.');
        }
      } catch (error) {
        setSoundpackActionStatus(`Action failed: ${errorMessage(error)}`);
      } finally {
        setPendingAction(null);
      }
    },
    [],
  );

  const refreshPacks = useCallback(
    () =>
      runSoundpackAction('refresh', () => ipcRenderer.invoke('soundpack-refresh'), 'Refreshing soundpacks…'),
    [runSoundpackAction],
  );
  const importPack = useCallback(
    () =>
      runSoundpackAction('import', () => ipcRenderer.invoke('soundpack-import'), 'Waiting for a ZIP soundpack…'),
    [runSoundpackAction],
  );
  const openPacksFolder = useCallback(
    () =>
      runSoundpackAction(
        'open',
        () => ipcRenderer.invoke('soundpack-open-folder'),
        'Opening soundpack folder…',
        false,
      ),
    [runSoundpackAction],
  );
  const deleteCurrentPack = useCallback(() => {
    const pack = currentPackRef.current;
    if (!pack) return Promise.resolve();
    return runSoundpackAction(
      'delete',
      () => ipcRenderer.invoke('soundpack-delete', pack.pack_id),
      'Waiting for deletion confirmation…',
    );
  }, [runSoundpackAction]);

  const disableRemoteDebug = useCallback(() => {
    ipcRenderer.send('set-debug-options', { enabled: false });
  }, []);

  const openDebugOptions = useCallback(() => {
    ipcRenderer.send('open-debug-options');
  }, []);

  const applyOutputDeviceToPack = useCallback(async (deviceId: string) => {
    const pack = currentPackRef.current;
    if (!pack) throw new Error('No soundpack is active.');
    if (typeof pack.SetOutputDevice !== 'function') {
      throw new Error('Output selection is not supported by this audio engine.');
    }
    await pack.SetOutputDevice(deviceId);
    outputDeviceRef.current = deviceId || '';
    store.set(OUTPUT_DEVICE_LSID, outputDeviceRef.current);
  }, []);

  const currentPack = packList.find((pack) => pack.pack_id === currentPackId) ?? null;

  return {
    appVersion: APP_VERSION,
    packs: packList,
    currentPack,
    currentPackId,
    packLoading,
    status,
    setStatus,
    selectPack,
    selectRandomPack,
    volume,
    setVolume,
    nudgeVolume,
    adjustedVolume,
    activeVolume,
    systemVolume,
    systemMuted,
    mechvibesMuted,
    remoteDebugInUse,
    keyPressed,
    soundpackActionStatus,
    pendingAction,
    refreshPacks,
    importPack,
    openPacksFolder,
    deleteCurrentPack,
    disableRemoteDebug,
    openDebugOptions,
    applyOutputDeviceToPack,
    hasPack: () => currentPackRef.current !== null,
    savedOutputDeviceId: outputDeviceRef,
  };
}
