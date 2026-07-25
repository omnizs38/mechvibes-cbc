/** Shared renderer types. Mirrors the runtime shapes produced by src/libs. */

export type KeyInputEvent = {
  type: 'keydown' | 'keyup';
  keycode: number | string;
  capturedAtMs?: number;
};

export type SoundPack = {
  pack_id: string;
  name: string;
  group?: string;
  version?: string;
  is_custom?: boolean;
  audio?: unknown;
  LoadSounds?: () => Promise<void> | void;
  UnloadSounds?: () => void;
  SetOutputDevice?: (deviceId: string) => Promise<void> | void;
  SetMasterGain?: (gain: number) => void;
  HandleEvent?: (event: KeyInputEvent, volume: number | string) => void;
};

export type DiscoveryError = {
  path: string;
  name: string;
  message: string;
};

export type StatusState = 'info' | 'success' | 'warning' | 'error';

export type StatusMessage = {
  text: string;
  state: StatusState;
};

export type UpdaterStatus =
  | 'idle'
  | 'development'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type UpdaterState = {
  status: UpdaterStatus;
  channel?: string;
  currentVersion?: string;
  availableVersion?: string;
  releaseNotes?: string;
  error?: string;
  progress?: { percent?: number };
};

export type SoundpackActionResult = {
  ok?: boolean;
  canceled?: boolean;
  error?: string;
};
