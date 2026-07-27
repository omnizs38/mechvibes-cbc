'use strict';

import type { ValidatedV3Config, ValidatedSample, ValidatedEventLayers } from './validation';
import { keycodesFill } from '../keycodes';
import type { LegacyV1Config } from './config-v1';
import type { LegacyV2Config } from './config-v2';
import { expandRandomPattern } from './config-v2';
import type { LegacyV3Config, LegacyV3Sound } from './config-v3-legacy';

/**
 * Convert legacy v1 soundpack to modern v4 (ValidatedV3Config with v4 features)
 */
export function convertV1ToV4(config: LegacyV1Config): ValidatedV3Config {
  const keys: Record<string, ValidatedEventLayers> = {};

  // Fill in missing keycodes with defaults
  const filledKeycodes = keycodesFill(config.defines);

  if (config.key_define_type === 'single') {
    // All keys use clips from a single sound file
    const soundFile = config.sound || 'sound.ogg';

    for (const keycode of Object.keys(filledKeycodes)) {
      const clipDef = config.defines[keycode];
      if (!Array.isArray(clipDef) || clipDef.length !== 2) {
        continue;
      }

      const [startBytes, lengthBytes] = clipDef;
      const sample: ValidatedSample = {
        file: soundFile,
        gain: 1,
        pitch: 0,
        weight: 1,
        offsetSeconds: startBytes > 0 ? startBytes / 44100 : 0, // Assume 44.1kHz for byte→time conversion
        durationSeconds: lengthBytes / 44100,
      };

      keys[keycode] = {
        keydown: {
          samples: [sample],
          mode: 'round-robin',
          gain: 1,
          pitchVariationCents: 0,
          priority: 5,
          envelope: { attackMs: 0, releaseMs: 12 },
        },
      };
    }
  } else {
    // key_define_type === 'multi': each keycode has its own file
    for (const keycode of Object.keys(filledKeycodes)) {
      const filename = config.defines[keycode];
      if (typeof filename !== 'string') {
        continue;
      }

      const sample: ValidatedSample = {
        file: filename,
        gain: 1,
        pitch: 0,
        weight: 1,
      };

      keys[keycode] = {
        keydown: {
          samples: [sample],
          mode: 'round-robin',
          gain: 1,
          pitchVariationCents: 0,
          priority: 5,
          envelope: { attackMs: 0, releaseMs: 12 },
        },
      };
    }
  }

  return {
    name: config.name || 'Untitled Pack',
    version: 4 as const,
    author: config.author || 'Unknown',
    license: config.license || 'Unknown',
    sampleRate: null,
    engine: {
      maxVoices: 64,
      preload: 'priority' as const,
      cacheBudgetMb: 32,
      gain: 1,
    },
    keys,
    defaults: {},
    checksums: {},
  } as ValidatedV3Config;
}

/**
 * Convert legacy v2 soundpack to modern v4
 */
export function convertV2ToV4(config: LegacyV2Config): ValidatedV3Config {
  const keys: Record<string, ValidatedEventLayers> = {};

  // Fill in missing keycodes with defaults
  const filledKeycodes = keycodesFill(config.defines);

  for (const keycode of Object.keys(filledKeycodes)) {
    const keydownFile = config.defines[keycode];
    const keyupFile = config.defines[`${keycode}-up`];
    const fallbackKeydown = config.sound;
    const fallbackKeyup = config.soundup;

    // Determine which files to use (with fallbacks)
    const keydownPattern = keydownFile || fallbackKeydown;
    const keyupPattern = keyupFile || fallbackKeyup;

    const keydownFiles = keydownPattern ? expandRandomPattern(keydownPattern) : [];
    const keyupFiles = keyupPattern ? expandRandomPattern(keyupPattern) : [];

    if (keydownFiles.length === 0 && keyupFiles.length === 0) {
      continue;
    }

    const eventLayers: ValidatedEventLayers = {};

    // Create keydown layer
    if (keydownFiles.length > 0) {
      const samples = keydownFiles.map((file) => ({
        file,
        gain: 1,
        pitch: 0,
        weight: 1 / keydownFiles.length, // Equal weight for random selection
      } as ValidatedSample));

      eventLayers.keydown = {
        samples,
        mode: keydownFiles.length > 1 ? 'round-robin' : 'round-robin',
        gain: 1,
        pitchVariationCents: 0,
        priority: 5,
        envelope: { attackMs: 0, releaseMs: 12 },
      };
    }

    // Create keyup layer
    if (keyupFiles.length > 0) {
      const samples = keyupFiles.map((file) => ({
        file,
        gain: 1,
        pitch: 0,
        weight: 1 / keyupFiles.length,
      } as ValidatedSample));

      eventLayers.keyup = {
        samples,
        mode: keyupFiles.length > 1 ? 'round-robin' : 'round-robin',
        gain: 1,
        pitchVariationCents: 0,
        priority: 5,
        envelope: { attackMs: 0, releaseMs: 12 },
      };
    }

    if (eventLayers.keydown || eventLayers.keyup) {
      keys[keycode] = eventLayers;
    }
  }

  return {
    name: config.name || 'Untitled Pack',
    version: 4 as const,
    author: config.author || 'Unknown',
    license: config.license || 'Unknown',
    sampleRate: null,
    engine: {
      maxVoices: 64,
      preload: 'priority' as const,
      cacheBudgetMb: 32,
      gain: 1,
    },
    keys,
    defaults: {},
    checksums: {},
  } as ValidatedV3Config;
}

/**
 * Convert legacy v3 soundpack (from original mechvibes) to modern v4
 */
export function convertV3LegacyToV4(config: LegacyV3Config): ValidatedV3Config {
  const keys: Record<string, ValidatedEventLayers> = {};
  const sounds = config.sounds || {};

  for (const [keycode, soundDef] of Object.entries(config.defines)) {
    if (!soundDef) {
      continue;
    }

    const soundNames = Array.isArray(soundDef) ? soundDef : [soundDef];
    const eventLayers: ValidatedEventLayers = {};

    for (let i = 0; i < soundNames.length; i++) {
      const soundName = soundNames[i];
      const eventType = i === 0 ? 'keydown' : 'keyup';
      const sound = sounds[soundName];

      if (!sound) {
        continue;
      }

      const samples = convertLegacyV3SoundToSamples(sound);
      if (samples.length === 0) {
        continue;
      }

      eventLayers[eventType] = {
        samples,
        mode: (sound.mode === 'random' || sound.mode === 'cycle') ? 'round-robin' : 'round-robin',
        gain: 1,
        pitchVariationCents: 0,
        priority: 5,
        envelope: { attackMs: 0, releaseMs: 12 },
      };
    }

    if (Object.keys(eventLayers).length > 0) {
      keys[keycode] = eventLayers;
    }
  }

  return {
    name: config.name || 'Untitled Pack',
    version: 4,
    author: config.author || 'Unknown',
    license: config.license || 'Unknown',
    sampleRate: null,
    engine: {
      maxVoices: 64,
      preload: 'priority',
      cacheBudgetMb: 32,
      gain: 1,
    },
    keys,
    defaults: {},
    checksums: {},
  } as ValidatedV3Config;
}

/**
 * Convert a legacy v3 sound definition to modern samples array
 */
function convertLegacyV3SoundToSamples(sound: LegacyV3Sound): ValidatedSample[] {
  const samples: ValidatedSample[] = [];

  // Handle single file with optional clip
  if (sound.file) {
    const sample: ValidatedSample = {
      file: sound.file.replace('#/', ''),
      gain: 1,
      pitch: 0,
      weight: 1,
    };

    if (sound.clip && Array.isArray(sound.clip) && sound.clip.length === 2) {
      const [startBytes, lengthBytes] = sound.clip;
      sample.offsetSeconds = startBytes > 0 ? startBytes / 44100 : 0;
      sample.durationSeconds = lengthBytes / 44100;
    }

    samples.push(sample);
    return samples;
  }

  // Handle multiple files
  if (sound.files && Array.isArray(sound.files)) {
    return sound.files.map((file) => ({
      file: file.replace('#/', ''),
      gain: 1,
      pitch: 0,
      weight: 1 / sound.files!.length,
    }));
  }

  // Handle multiple clips from single file
  if (sound.clips && Array.isArray(sound.clips)) {
    return sound.clips.map((clip) => {
      const [startBytes, lengthBytes] = clip;
      return {
        file: sound.file || 'sound.ogg',
        gain: 1,
        pitch: 0,
        weight: 1 / sound.clips!.length,
        offsetSeconds: startBytes > 0 ? startBytes / 44100 : 0,
        durationSeconds: lengthBytes / 44100,
      };
    });
  }

  return samples;
}
