'use strict';

import type { ValidatedV3Config, ValidatedSample, ValidatedLayer } from '../src/libs/soundpacks/validation';
import type { ScannedAudioFile, ScannedDirectory } from './soundpack-scanner';

export interface SoundpackGeneratorOptions {
  name: string;
  author?: string;
  license?: string;
  maxVoices?: number;
  preload?: 'all' | 'priority' | 'lazy';
  cacheBudgetMb?: number;
  gain?: number;
  /** If true, use one file per key (multi-key mapping) */
  multiKeyMode?: boolean;
  /** Sample rate for duration estimation */
  sampleRate?: number;
}

/**
 * Generate a v4 soundpack config from scanned directory
 */
export function generateSoundpackConfig(
  scanned: ScannedDirectory,
  options: SoundpackGeneratorOptions,
): ValidatedV3Config {
  const {
    name,
    author = 'Unknown',
    license = 'Unknown',
    maxVoices = 64,
    preload = 'priority',
    cacheBudgetMb = 32,
    gain = 1,
    multiKeyMode = true,
    sampleRate = 44100,
  } = options;

  const keys: Record<string, any> = {};

  if (multiKeyMode) {
    // One file per keycode
    const usedKeycodes = new Set<number>();

    // Keydown samples
    for (const file of scanned.eventTypes.keydown) {
      const keycode = extractKeycodeFromFilename(file);
      if (keycode !== null) {
        usedKeycodes.add(keycode);
        if (!keys[keycode]) {
          keys[keycode] = {};
        }

        const sample = createSample(file);
        keys[keycode].keydown = createLayer([sample]);
      }
    }

    // Keyup samples
    for (const file of scanned.eventTypes.keyup) {
      const keycode = extractKeycodeFromFilename(file);
      if (keycode !== null) {
        usedKeycodes.add(keycode);
        if (!keys[keycode]) {
          keys[keycode] = {};
        }

        const sample = createSample(file);
        keys[keycode].keyup = createLayer([sample]);
      }
    }

    // If no keycodes found, fall back to simple mode
    if (usedKeycodes.size === 0) {
      // Simple mode: all keycodes use same samples
      const keydownSamples = scanned.eventTypes.keydown.map(createSample);
      const keyupSamples = scanned.eventTypes.keyup.map(createSample);

      // Assign to common keycodes
      const commonKeycodes = [30, 31, 32, 33, 34, 35, 36, 37]; // ABCDEFGH

      for (const keycode of commonKeycodes) {
        keys[keycode] = {};
        if (keydownSamples.length > 0) {
          keys[keycode].keydown = createLayer(keydownSamples);
        }
        if (keyupSamples.length > 0) {
          keys[keycode].keyup = createLayer(keyupSamples);
        }
      }
    } else {
      // Fill missing keycodes with defaults
      const keycodeArray = Array.from(usedKeycodes).sort((a, b) => a - b);
      const minKeycode = keycodeArray[0];
      const maxKeycode = keycodeArray[keycodeArray.length - 1];

      for (let i = minKeycode; i <= maxKeycode; i++) {
        if (!keys[i] && keys[minKeycode]) {
          keys[i] = {
            ...(keys[minKeycode].keydown && { keydown: keys[minKeycode].keydown }),
            ...(keys[minKeycode].keyup && { keyup: keys[minKeycode].keyup }),
          };
        }
      }
    }
  } else {
    // Simple mode: all keycodes use same samples
    const keydownSamples = scanned.eventTypes.keydown.map(createSample);
    const keyupSamples = scanned.eventTypes.keyup.map(createSample);

    // Assign to common keycodes
    const commonKeycodes = [30, 31, 32, 33, 34, 35, 36, 37]; // ABCDEFGH

    for (const keycode of commonKeycodes) {
      keys[keycode] = {};
      if (keydownSamples.length > 0) {
        keys[keycode].keydown = createLayer(keydownSamples);
      }
      if (keyupSamples.length > 0) {
        keys[keycode].keyup = createLayer(keyupSamples);
      }
    }
  }

  return {
    name: name || 'Untitled Pack',
    version: 4,
    author,
    license,
    sampleRate: null,
    engine: {
      maxVoices,
      preload,
      cacheBudgetMb,
      gain,
    },
    keys,
    defaults: {},
    checksums: {},
  } as ValidatedV3Config;
}

/**
 * Try to extract keycode from filename (e.g., "30_a.wav" → 30)
 */
function extractKeycodeFromFilename(filename: string): number | null {
  // Match patterns like "30", "30_", "key30", "30-"
  const match = filename.match(/\b(\d{1,3})\b/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num >= 0 && num <= 255) {
      return num;
    }
  }
  return null;
}

/**
 * Create a sample object from a file path
 */
function createSample(file: string): ValidatedSample {
  return {
    file,
    gain: 1,
    pitch: 0,
    weight: 1,
  };
}

/**
 * Create a layer object with samples
 */
function createLayer(samples: ValidatedSample[]): ValidatedLayer {
  return {
    samples,
    mode: 'round-robin',
    gain: 1,
    pitchVariationCents: 0,
    priority: 5,
    envelope: { attackMs: 0, releaseMs: 12 },
  };
}

/**
 * Validate that a config has at least one playable event
 */
export function validateGeneratedConfig(config: ValidatedV3Config): string[] {
  const errors: string[] = [];

  if (!config.name || config.name.trim() === '') {
    errors.push('Name is required');
  }

  if (!config.keys || Object.keys(config.keys).length === 0) {
    if (!config.defaults || (!config.defaults.keydown && !config.defaults.keyup)) {
      errors.push('Must define at least one playable event (keydown or keyup)');
    }
  }

  // Check that all samples reference existing files
  const validateLayer = (layer: ValidatedLayer | undefined) => {
    if (!layer) return;
    for (const sample of layer.samples) {
      if (!sample.file || sample.file.trim() === '') {
        errors.push(`Sample has empty file reference`);
      }
    }
  };

  validateLayer(config.defaults.keydown);
  validateLayer(config.defaults.keyup);

  for (const [keycode, events] of Object.entries(config.keys)) {
    validateLayer(events.keydown);
    validateLayer(events.keyup);
  }

  return errors;
}
