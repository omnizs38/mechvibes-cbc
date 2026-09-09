import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcRenderer, log } from '../shared/electron';
import { store } from '../shared/store';
import type { DiscoveryError, SoundPack } from '../shared/types';
import { SoundpackManager } from '../../libs/soundpacks/pack-manager';
import { discoverSoundpacks } from '../../libs/soundpacks/registry';
import { chooseRandomPackIndex } from '../../utils/random-pack';
import { nodePath } from '../shared/electron';

const OFFICIAL_PACKS_DIR = nodePath.join(
  // eslint-disable-next-line
  ...([] as string[]),
);

export type StatusSetter = (text: string, state?: 'info' | 'success' | 'warning' | 'error') => void;

// Audio state lives outside React: it must survive re-renders and stay unique
// for the lifetime of the window.
const packs: SoundPack[] = [];
const packManager = new SoundpackManager(packs);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Discovers installed soundpacks and owns the current selection, including
 * stale-selection race handling (see libs/soundpacks/pack-manager).
 */
export function usePackCatalog(deps: {
  appRoot: string;
  customPacksDir: string;
  packStoreKey: string;
  setStatus: StatusSetter;
}) {
  const [packList, setPackList] = useState<SoundPack[]>([]);
  const [currentPackId, setCurrentPackId] = useState<string>('');
  const [packLoading, setPackLoading] = useState(true);
  const currentPackRef = useRef<SoundPack | null>(null);
  const selectionIdRef = useRef(0);
  const { setStatus, packStoreKey, customPacksDir, appRoot } = deps;
  const officialDirRef = useRef(nodePath.join(appRoot, 'src', 'audio'));

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
        setCurrentPackId(loadedPack.pack_id);
        ipcRenderer.send('pack-changed', {
          name: loadedPack.name,
          version: loadedPack.version,
        });

        if (persist) {
          store.set(packStoreKey, loadedPack.pack_id);
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
    [setStatus, packStoreKey],
  );

  const selectRandomPack = useCallback(() => {
    const index = chooseRandomPackIndex(packs, currentPackRef.current?.pack_id ?? null);
    if (index === null) return;
    const pack = packs[index];
    if (pack) void selectPack(pack.pack_id);
  }, [selectPack]);

  // ---------------------------------------------------------------- bootstrap
  useEffect(() => {
    let disposed = false;

    const bootstrap = async () => {
      const discovery = discoverSoundpacks({
        officialDirectory: officialDirRef.current,
        customDirectory: customPacksDir,
      }) as { packs: SoundPack[]; errors: DiscoveryError[] };

      packs.splice(0, packs.length, ...discovery.packs);
      for (const error of discovery.errors) {
        log.warn(`Skipped soundpack ${error.name}: ${error.message}`);
      }
      log.info(`Discovered ${packs.length} valid soundpacks`);
      if (disposed) return;
      setPackList([...packs]);

      const savedId = store.get(packStoreKey);
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
  }, [selectPack, setStatus, customPacksDir, packStoreKey]);

  const currentPack = packList.find((pack) => pack.pack_id === currentPackId) ?? null;

  return {
    packs: packList,
    currentPack,
    currentPackId,
    packLoading,
    selectPack,
    selectRandomPack,
    currentPackRef,
    hasPack: () => currentPackRef.current !== null,
  };
}
