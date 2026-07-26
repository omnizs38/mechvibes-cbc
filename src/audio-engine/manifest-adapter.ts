'use strict';

import { keycodesFill, keycodesRemap } from '../libs/keycodes';
import { validateSoundpackConfig } from '../libs/soundpacks/validation';
import type { AudioManifest, ManifestLayer, ManifestSample } from './manifest';
import type { SoundpackMetadata } from '../libs/soundpacks/registry';

export type GetFile = (packPath: string, reference: string) => string;

export type EventLayers = {
  keydown?: ManifestLayer | null;
  keyup?: ManifestLayer | null;
};

/** Soundpack configs are dynamically shaped per version, so they stay loose here. */
type AnyConfig = Record<string, any>;

function defaultGetFile(packPath: string, reference: string): string {
  const fileManager = require('../libs/soundpacks/file-manager') as typeof import('../libs/soundpacks/file-manager');
  return fileManager.GetSoundpackSource(packPath, reference);
}

export function remapEventLayers(
  layersByStandardKey: Record<string, EventLayers>,
): Record<string, ManifestLayer> {
  const events: Record<string, ManifestLayer> = {};
  for (const eventType of ['keydown', 'keyup'] as const) {
    const standardLayers: Record<string, ManifestLayer> = {};
    for (const [keycode, eventLayers] of Object.entries(layersByStandardKey)) {
      const layer = eventLayers[eventType];
      if (layer) standardLayers[keycode] = layer;
    }
    const remapped = keycodesRemap(standardLayers);
    for (const [remappedKey, layer] of Object.entries(remapped)) {
      events[`${eventType}:${remappedKey.replace(/^keycode-/, '')}`] = layer;
    }
  }
  return events;
}

export function baseLayer(
  samples: ManifestSample[],
  overrides: Partial<ManifestLayer> = {},
): ManifestLayer {
  return {
    samples,
    mode: 'round-robin',
    gain: 1,
    pitchVariationCents: 0,
    priority: 5,
    envelope: { attackMs: 0, releaseMs: 12 },
    ...overrides,
  };
}

export function adaptV3Layer(
  layer: AnyConfig | null | undefined,
  metadata: SoundpackMetadata,
  getFile: GetFile = defaultGetFile,
): ManifestLayer | null {
  if (!layer) return null;
  return baseLayer(
    (layer['samples'] as ManifestSample[]).map((sample) => ({
      ...sample,
      source: getFile(metadata.abs_path, String(sample.file)),
    })),
    {
      mode: layer['mode'],
      gain: layer['gain'],
      pitchVariationCents: layer['pitchVariationCents'],
      priority: layer['priority'],
      envelope: layer['envelope'],
    },
  );
}

function adaptModern(
  config: AnyConfig,
  metadata: SoundpackMetadata,
  getFile: GetFile,
  version: 3 | 4,
): AudioManifest {
  const layers: Record<string, EventLayers> = {};
  const standardKeys = keycodesFill(config['keys'] as Record<string, unknown>);
  for (const keycode of Object.keys(standardKeys)) {
    const keyLayers = config['keys'][keycode] || {};
    const keydown = adaptV3Layer(keyLayers.keydown || config['defaults'].keydown, metadata, getFile);
    const keyup = adaptV3Layer(keyLayers.keyup || config['defaults'].keyup, metadata, getFile);
    if (keydown || keyup) layers[keycode] = { keydown, keyup };
  }
  return {
    id: metadata.pack_id,
    name: config['name'],
    version,
    author: config['author'],
    license: config['license'],
    sampleRate: config['sampleRate'],
    maxVoices: config['engine'].maxVoices,
    cacheBudgetBytes: config['engine'].cacheBudgetMb * 1024 * 1024,
    preload: config['engine'].preload,
    gain: config['engine'].gain,
    events: remapEventLayers(layers),
    checksums: config['checksums'],
  };
}

export function adaptV3(
  config: AnyConfig,
  metadata: SoundpackMetadata,
  getFile: GetFile = defaultGetFile,
): AudioManifest {
  return adaptModern(config, metadata, getFile, 3);
}

/**
 * v4 is the canonical native config: the v3 schema, plus per-sample
 * `offsetSeconds` / `durationSeconds` windows (carried through by
 * {@link adaptV3Layer}). It maps 1:1 to the audio manifest.
 */
export function adaptV4(
  config: AnyConfig,
  metadata: SoundpackMetadata,
  getFile: GetFile = defaultGetFile,
): AudioManifest {
  return adaptModern(config, metadata, getFile, 4);
}

export function createAudioManifest(
  config: unknown,
  metadata: SoundpackMetadata,
  { getFile = defaultGetFile, validate = true }: { getFile?: GetFile; validate?: boolean } = {},
): AudioManifest {
  // The load path validates the config at discovery and hands the result
  // straight here, so callers with an already-validated config pass
  // `validate: false` to skip a redundant second full validation pass.
  const validated = (validate ? validateSoundpackConfig(config) : config) as AnyConfig;
  if (validated['version'] === 4) return adaptV4(validated, metadata, getFile);
  return adaptV3(validated, metadata, getFile);
}
