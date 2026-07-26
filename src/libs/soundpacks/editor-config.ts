'use strict';

/**
 * Pure conversions between the pack editor's per-key draft model and the native
 * v4 soundpack config. Keeps no Electron/DOM dependencies so it is exercised by
 * the node test suite as well as the renderer. Keycodes are in the "standard"
 * keyspace here; platform remapping lives in the renderer (see packData.ts).
 */

import type { ValidatedSample } from './validation';

/** A sprite window `[startMs, lengthMs]`, a dedicated file name, or unset. */
export type SoundDefinition = [number, number] | string | null;
export type PackDefines = Record<string, SoundDefinition>;
/** How keys are authored: one shared file with windows, or one file per key. */
export type AuthoringMode = 'sprite' | 'files';

/**
 * A single v4 keydown sample: a dedicated file, or a window into a shared file.
 * Derived from the validator's sample type so the two never drift.
 */
export type V4Sample = Pick<ValidatedSample, 'file' | 'offsetSeconds' | 'durationSeconds'>;

/** The v4 config shape the editor reads and writes. */
export interface V4Config {
  name: string;
  version: 4;
  engine: { maxVoices: number; preload: string; cacheBudgetMb: number; gain: number };
  defaults: Record<string, never>;
  keys: Record<string, { keydown: { samples: V4Sample[] } }>;
  checksums: Record<string, never>;
}

/** The editor's per-key model after a v4 config is parsed back apart. */
export interface DraftKeys {
  name: string;
  mode: AuthoringMode;
  sound: string;
  defines: PackDefines;
}

export const DEFAULT_SOUND = 'sound.ogg';
const V4_ENGINE = { maxVoices: 64, preload: 'all', cacheBudgetMb: 192, gain: 1 };

export function hasSound(value: SoundDefinition): boolean {
  if (value === null) return false;
  if (typeof value === 'string') return value !== '';
  return value[0] !== 0 || value[1] !== 0;
}

/** Builds the v4 keydown sample for one key, or null when the key has no sound. */
function keydownSample(mode: AuthoringMode, sound: string, value: SoundDefinition): V4Sample | null {
  if (!hasSound(value)) return null;
  if (mode === 'files') {
    return { file: String(value) };
  }
  const [startMs, lengthMs] = value as [number, number];
  return { file: sound, offsetSeconds: startMs / 1000, durationSeconds: lengthMs / 1000 };
}

/** Converts standard-keycode draft defines into an exportable v4 config. */
export function buildV4Config(
  name: string,
  mode: AuthoringMode,
  sound: string,
  standardDefines: PackDefines,
): V4Config {
  const keys: V4Config['keys'] = {};
  for (const [keycode, value] of Object.entries(standardDefines)) {
    const sample = keydownSample(mode, sound, value);
    if (sample) keys[keycode] = { keydown: { samples: [sample] } };
  }
  return {
    name,
    version: 4,
    engine: { ...V4_ENGINE },
    defaults: {},
    keys,
    checksums: {},
  };
}

/** Reads a v4 config back into the editor's per-key model (standard keycodes). */
export function parseV4Config(imported: unknown): DraftKeys {
  const config = (imported ?? {}) as Partial<V4Config>;
  const keys = (config.keys ?? {}) as V4Config['keys'];

  // Collect the first keydown sample per key once, then derive everything else.
  const entries: Array<[string, V4Sample]> = [];
  for (const [keycode, entry] of Object.entries(keys)) {
    const sample = entry?.keydown?.samples?.[0];
    if (sample) entries.push([keycode, sample]);
  }

  const isSprite = entries.some(
    ([, sample]) => sample.offsetSeconds !== undefined || sample.durationSeconds !== undefined,
  );
  const mode: AuthoringMode = entries.length === 0 || isSprite ? 'sprite' : 'files';
  const sound = isSprite ? (entries[0]?.[1].file ?? DEFAULT_SOUND) : DEFAULT_SOUND;

  const defines: PackDefines = {};
  for (const [keycode, sample] of entries) {
    defines[keycode] =
      mode === 'sprite'
        ? [
            Math.round((sample.offsetSeconds ?? 0) * 1000),
            Math.round((sample.durationSeconds ?? 0) * 1000),
          ]
        : sample.file;
  }

  const name = typeof config.name === 'string' && config.name ? config.name : 'Untitled';
  return { name, mode, sound, defines };
}
