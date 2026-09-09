import { useCallback, useEffect, useRef, useState } from 'react';
import { log, onIpc } from '../shared/electron';
import type { KeyInputEvent, SoundPack } from '../shared/types';
import { LatencyTracker } from '../../audio-engine/latency-tracker';
import { calculateGain } from '../../utils/volume';

// Latency stats must survive re-renders for the lifetime of the window.
const latencyTracker = new LatencyTracker();

export interface PlaybackRefs {
  volumeRef: { readonly current: number };
  systemVolumeRef: { readonly current: number };
  activeVolumeRef: { readonly current: number };
  systemMutedRef: { readonly current: boolean };
  mechvibesMutedRef: { readonly current: boolean };
}

export interface UsePlaybackOptions extends PlaybackRefs {
  /** Reactive mirrors of the refs; used only to invalidate the applied gain. */
  volume: number;
  systemVolume: number;
  activeVolume: boolean;
  packRef: { readonly current: SoundPack | null };
}

/**
 * Turns global key events into sound: dedupes auto-repeat keydowns, records
 * keystroke-to-renderer latency, applies the active-volume gain curve and
 * forwards events to the loaded soundpack.
 */
export function usePlayback({
  volumeRef,
  systemVolumeRef,
  activeVolumeRef,
  systemMutedRef,
  mechvibesMutedRef,
  volume,
  systemVolume,
  activeVolume,
  packRef,
}: UsePlaybackOptions) {
  const [keyPressed, setKeyPressed] = useState(false);
  const lastAppliedGainRef = useRef<number | null>(null);

  // Any input to the gain curve invalidates the last applied value so the
  // next keystroke re-syncs the master gain.
  useEffect(() => {
    lastAppliedGainRef.current = null;
  }, [volume, systemVolume, activeVolume]);

  const playSound = useCallback(
    (event: KeyInputEvent) => {
      const pack = packRef.current;
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
    },
    // Every dependency is a stable ref container, so this callback never has
    // to be re-created while still reading fresh values.
    [],
  );

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

  return { keyPressed };
}
