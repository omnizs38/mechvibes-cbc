import { useCallback, useEffect, useState, type MutableRefObject } from 'react';
import { store } from '../shared/store';
import { OUTPUT_DEVICE_LSID } from './useMechvibes';

export type OutputDevice = { deviceId: string; label: string };

type Options = {
  savedDeviceRef: MutableRefObject<string>;
  applyToPack: (deviceId: string) => Promise<void>;
  hasPack: () => boolean;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useOutputDevices({ savedDeviceRef, applyToPack, hasPack }: Options) {
  const [devices, setDevices] = useState<OutputDevice[]>([]);
  const [deviceId, setDeviceId] = useState(savedDeviceRef.current);
  const [supported, setSupported] = useState(true);
  const [status, setStatus] = useState('');

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
      setSupported(false);
      setStatus('Output selection is not supported by this runtime.');
      return;
    }

    const audioOutputs = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'audiooutput',
    );

    setDevices(
      audioOutputs.map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Audio output ${index + 1}`,
      })),
    );

    const saved = savedDeviceRef.current;
    const stillConnected = !saved || audioOutputs.some((device) => device.deviceId === saved);
    if (!stillConnected) {
      savedDeviceRef.current = '';
      store.set(OUTPUT_DEVICE_LSID, '');
      setDeviceId('');
      setStatus('Saved device disconnected; using system default.');
      if (hasPack()) {
        void applyToPack('').catch(() => undefined);
      }
      return;
    }
    setDeviceId(saved);
  }, [applyToPack, hasPack, savedDeviceRef]);

  const apply = useCallback(
    async (nextDeviceId: string) => {
      try {
        await applyToPack(nextDeviceId);
        setDeviceId(nextDeviceId || '');
        setStatus(nextDeviceId ? 'Selected output is active.' : 'Using system default output.');
      } catch (error) {
        setStatus(`Could not select output: ${message(error)}`);
      }
    },
    [applyToPack],
  );

  const chooseWithSystemPicker = useCallback(async () => {
    try {
      let nextDeviceId = deviceId;
      const mediaDevices = navigator.mediaDevices as MediaDevices & {
        selectAudioOutput?: (options?: { deviceId?: string }) => Promise<MediaDeviceInfo>;
      };
      if (mediaDevices && typeof mediaDevices.selectAudioOutput === 'function') {
        const selected = await mediaDevices.selectAudioOutput(
          savedDeviceRef.current ? { deviceId: savedDeviceRef.current } : undefined,
        );
        nextDeviceId = selected.deviceId;
        await refresh();
      }
      await apply(nextDeviceId);
    } catch (error) {
      setStatus(`Could not select output: ${message(error)}`);
    }
  }, [apply, deviceId, refresh, savedDeviceRef]);

  useEffect(() => {
    void refresh().catch((error: unknown) => setStatus(`Could not list outputs: ${message(error)}`));

    if (!navigator.mediaDevices) return undefined;
    const onDeviceChange = () => {
      void refresh().catch((error: unknown) =>
        setStatus(`Could not refresh outputs: ${message(error)}`),
      );
    };
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
  }, [refresh]);

  return { devices, deviceId, supported, status, apply, chooseWithSystemPicker, refresh };
}
