'use strict';

const { keycodesFill, keycodesRemap } = require('../libs/keycodes');
const {
  expandNumberTemplateVariants,
  validateSoundpackConfig,
} = require('../libs/soundpacks/validation');

function defaultGetFile(packPath, reference) {
  return require('../libs/soundpacks/file-manager').GetSoundpackSource(packPath, reference);
}

function remapEventLayers(layersByStandardKey) {
  const events = {};
  for (const eventType of ['keydown', 'keyup']) {
    const standardLayers = {};
    for (const [keycode, eventLayers] of Object.entries(layersByStandardKey)) {
      if (eventLayers[eventType]) standardLayers[keycode] = eventLayers[eventType];
    }
    const remapped = keycodesRemap(standardLayers);
    for (const [remappedKey, layer] of Object.entries(remapped)) {
      events[`${eventType}:${remappedKey.replace(/^keycode-/, '')}`] = layer;
    }
  }
  return events;
}

function resolveReferences(packPath, references, fallbackReferences = [], getFile = defaultGetFile) {
  const resolveAll = (items) => items.map((reference) => ({
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

function baseLayer(samples, overrides = {}) {
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

function adaptV1(config, metadata, getFile = defaultGetFile) {
  const layers = {};
  if (config.key_define_type === 'single') {
    const source = getFile(metadata.abs_path, config.sound);
    for (const [keycode, sprite] of Object.entries(config.defines)) {
      if (!sprite) continue;
      layers[keycode] = {
        keydown: baseLayer([{
          source,
          file: config.sound,
          offsetSeconds: Number(sprite[0]) / 1000,
          durationSeconds: Number(sprite[1]) / 1000,
          gain: 1,
          pitch: 0,
          weight: 1,
        }]),
      };
    }
  } else {
    for (const [keycode, reference] of Object.entries(config.defines)) {
      if (!reference) continue;
      layers[keycode] = {
        keydown: baseLayer(resolveReferences(metadata.abs_path, [reference], [], getFile)),
      };
    }
  }
  return {
    id: metadata.pack_id,
    name: config.name,
    version: 1,
    maxVoices: 64,
    cacheBudgetBytes: 192 * 1024 * 1024,
    preload: 'all',
    gain: 1,
    events: remapEventLayers(layers),
    checksums: {},
  };
}

function adaptV2(config, metadata, getFile = defaultGetFile) {
  const layers = {};
  const filled = keycodesFill(config.defines);
  for (const keycode of Object.keys(filled)) {
    const downReference = config.defines[keycode] || config.sound;
    const upReference = config.defines[`${keycode}-up`] || config.soundup;
    layers[keycode] = {
      keydown: baseLayer(resolveReferences(
        metadata.abs_path,
        expandNumberTemplateVariants(downReference),
        expandNumberTemplateVariants(config.sound),
        getFile,
      )),
      keyup: baseLayer(resolveReferences(
        metadata.abs_path,
        expandNumberTemplateVariants(upReference),
        expandNumberTemplateVariants(config.soundup),
        getFile,
      ), { priority: 4 }),
    };
  }
  return {
    id: metadata.pack_id,
    name: config.name,
    version: 2,
    maxVoices: 64,
    cacheBudgetBytes: 192 * 1024 * 1024,
    preload: 'all',
    gain: 1,
    events: remapEventLayers(layers),
    checksums: {},
  };
}

function adaptV3Layer(layer, metadata, getFile = defaultGetFile) {
  if (!layer) return null;
  return baseLayer(layer.samples.map((sample) => ({
    ...sample,
    source: getFile(metadata.abs_path, sample.file),
  })), {
    mode: layer.mode,
    gain: layer.gain,
    pitchVariationCents: layer.pitchVariationCents,
    priority: layer.priority,
    envelope: layer.envelope,
  });
}

function adaptV3(config, metadata, getFile = defaultGetFile) {
  const layers = {};
  const standardKeys = keycodesFill(config.keys);
  for (const keycode of Object.keys(standardKeys)) {
    const keyLayers = config.keys[keycode] || {};
    const keydown = adaptV3Layer(keyLayers.keydown || config.defaults.keydown, metadata, getFile);
    const keyup = adaptV3Layer(keyLayers.keyup || config.defaults.keyup, metadata, getFile);
    if (keydown || keyup) layers[keycode] = { keydown, keyup };
  }
  return {
    id: metadata.pack_id,
    name: config.name,
    version: 3,
    author: config.author,
    license: config.license,
    sampleRate: config.sampleRate,
    maxVoices: config.engine.maxVoices,
    cacheBudgetBytes: config.engine.cacheBudgetMb * 1024 * 1024,
    preload: config.engine.preload,
    gain: config.engine.gain,
    events: remapEventLayers(layers),
    checksums: config.checksums,
  };
}

function createAudioManifest(config, metadata, { getFile = defaultGetFile } = {}) {
  const validated = validateSoundpackConfig(config);
  if (validated.version === 1) return adaptV1(validated, metadata, getFile);
  if (validated.version === 2) return adaptV2(validated, metadata, getFile);
  return adaptV3(validated, metadata, getFile);
}

module.exports = {
  adaptV1,
  adaptV2,
  adaptV3,
  baseLayer,
  createAudioManifest,
  remapEventLayers,
  resolveReferences,
};
