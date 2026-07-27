'use strict';

/**
 * Legacy Config Version 3 (Modern with clips/cycles - v1 of the "modern" era)
 * This is the v3 from the original mechvibes that supported clips and cycling modes
 * Different from ValidatedV3Config which is the v3/v4 hybrid used in mechvibes-cbc
 */

export interface LegacyV3Sound {
  /** File path (can use #/ for root) */
  file?: string;

  /** For single file clips */
  clip?: [number, number]; // [start, length]

  /** For multiple files or clips */
  files?: string[];
  clips?: Array<[number, number]>;

  /** Playback mode: 'default', 'random', 'cycle' */
  mode?: 'default' | 'random' | 'cycle';

  /** Repeat delay in ms (for key hold) */
  'repeat-delay'?: number;

  /** Metadata */
  [key: string]: unknown;
}

export interface LegacyV3Config {
  /** Sound definitions by name */
  sounds: Record<string, LegacyV3Sound>;

  /** Key definitions: keyCode -> [keydownSoundName, keyupSoundName?] */
  defines: Record<string, string | string[]>;

  /** Version marker */
  version: 3;

  /** Metadata */
  metadata?: Record<string, unknown>;

  /** Optional author */
  author?: string;

  /** Optional license */
  license?: string;

  /** Optional name */
  name?: string;

  /** Optional metadata */
  [key: string]: unknown;
}

export function isLegacyV3Config(config: unknown): config is LegacyV3Config {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return false;
  }

  const c = config as Record<string, unknown>;

  // Required fields
  if (typeof c.sounds !== 'object' || c.sounds === null || Array.isArray(c.sounds)) {
    return false;
  }

  if (typeof c.defines !== 'object' || c.defines === null || Array.isArray(c.defines)) {
    return false;
  }

  if (c.version !== 3) {
    return false;
  }

  return true;
}
