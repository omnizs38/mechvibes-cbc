'use strict';

import type { ValidatedV3Config, ValidatedSample, ValidatedEventLayers } from './validation';
import type { LegacyV3Config, LegacyV3Sound } from './config-v3-legacy';

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
