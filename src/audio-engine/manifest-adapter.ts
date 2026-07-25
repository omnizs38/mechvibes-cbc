'use strict';

import { keycodesFill, keycodesRemap } from '../libs/keycodes';
import { expandNumberTemplateVariants, validateSoundpackConfig } from '../libs/soundpacks/validation';
import type { AudioManifest, ManifestLayer, ManifestSample } from './web-audio-engine';
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

export function resolveReferences(
  packPath: string,
  references: string[],
  fallbackReferences: string[] = [],
  getFile: GetFile = defaultGetFile,
): ManifestSample[] {
  const resolveAll = (items: string[]): ManifestSample[] =>
    items.map((reference) => ({
      source: getFile(packPath, reference),
      file: reference,
      gain: 1,
      pitch: 0,
      weight: 1,
    }));
  try {
    return resolveAll(references);
  } catch (error) {
    if (fallbackReferences.length === 0) throw error;
    return resolveAll(fallbackReferences);
  }
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

export function adaptV1(
  config: AnyConfig,
  metadata: SoundpackMetadata,
  getFile: GetFile = defaultGetFile,
): AudioManifest {
  const layers: Record<string, EventLayers> = {};
  if (config['key_define_type'] === 'single') {
    const source = getFile(metadata.abs_path, config['sound']);
    for (const [keycode, sprite] of Object.entries(config['defines'] as AnyConfig)) {
      if (!sprite) continue;
      const values = sprite as [number, number];
      layers[keycode] = {
        keydown: baseLayer([
          {
            source,
            file: config['sound'],
            offsetSeconds: Number(values[0]) / 1000,
            durationSeconds: Number(values[1]) / 1000,
            gain: 1,
            pitch: 0,
            weight: 1,
          },
        ]),
      };
    }
  } else {
    for (const [keycode, reference] of Object.entries(config['defines'] as AnyConfig)) {
      if (!reference) continue;
      layers[keycode] = {
        keydown: baseLayer(resolveReferences(metadata.abs_path, [String(reference)], [], getFile)),
      };
    }
  }
  return {
    id: metadata.pack_id,
    name: config['name'],
    version: 1,
    maxVoices: 64,
    cacheBudgetBytes: 192 * 1024 * 1024,
    preload: 'all',
    gain: 1,
    events: remapEventLayers(layers),
    checksums: {},
  };
}

export function adaptV2(
  config: AnyConfig,
  metadata: SoundpackMetadata,
  getFile: GetFile = defaultGetFile,
): AudioManifest {
  const layers: Record<string, EventLayers> = {};
  const filled = keycodesFill(config['defines'] as Record<string, unknown>);
  for (const keycode of Object.keys(filled)) {
    const downReference = config['defines'][keycode] || config['sound'];
    const upReference = config['defines'][`${keycode}-up`] || config['soundup'];
    layers[keycode] = {
      keydown: baseLayer(
        resolveReferences(
          metadata.abs_path,
          expandNumberTemplateVariants(String(downReference)),
          expandNumberTemplateVariants(String(config['sound'])),
          getFile,
        ),
      ),
      keyup: baseLayer(
        resolveReferences(
          metadata.abs_path,
          expandNumberTemplateVariants(String(upReference)),
          expandNumberTemplateVariants(String(config['soundup'])),
          getFile,
        ),
        { priority: 4 },
      ),
    };
  }
  return {
    id: metadata.pack_id,
    name: config['name'],
    version: 2,
    maxVoices: 64,
    cacheBudgetBytes: 192 * 1024 * 1024,
    preload: 'all',
    gain: 1,
    events: remapEventLayers(layers),
    checksums: {},
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

export function adaptV3(
  config: AnyConfig,
  metadata: SoundpackMetadata,
  getFile: GetFile = defaultGetFile,
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
    version: 3,
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

export function createAudioManifest(
  config: unknown,
  metadata: SoundpackMetadata,
  { getFile = defaultGetFile }: { getFile?: GetFile } = {},
): AudioManifest {
  const validated = validateSoundpackConfig(config) as AnyConfig;
  if (validated['version'] === 1) return adaptV1(validated, metadata, getFile);
  if (validated['version'] === 2) return adaptV2(validated, metadata, getFile);
  return adaptV3(validated, metadata, getFile);
}
