'use strict';

const path = require('path');

const SUPPORTED_VERSIONS = new Set([1, 2, 3]);
const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  '.aac',
  '.flac',
  '.m4a',
  '.mp3',
  '.mp4',
  '.oga',
  '.ogg',
  '.opus',
  '.wav',
  '.webm',
]);
const MAX_NAME_LENGTH = 200;
const MAX_DEFINITIONS = 4096;
const MAX_TEMPLATE_SPAN = 100;

class SoundpackValidationError extends Error {
  constructor(message, code = 'INVALID_SOUNDPACK') {
    super(message);
    this.name = 'SoundpackValidationError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SoundpackValidationError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function normalizeSoundReference(value, field = 'sound file') {
  const reference = requireNonEmptyString(value, field);
  if (reference.includes('\0')) {
    throw new SoundpackValidationError(`${field} contains an invalid null byte.`);
  }

  const slashPath = reference.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  if (path.posix.isAbsolute(slashPath) || /^[a-zA-Z]:\//.test(slashPath)) {
    throw new SoundpackValidationError(`${field} must be relative to the soundpack.`);
  }

  const segments = slashPath.split('/');
  const unsafeWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  if (segments.some((segment) => (
    segment === '' ||
    segment === '.' ||
    segment === '..' ||
    /[<>:"|?*\u0000-\u001f]/.test(segment) ||
    /[. ]$/.test(segment) ||
    unsafeWindowsName.test(segment)
  ))) {
    throw new SoundpackValidationError(`${field} contains a path that is unsafe on Windows.`);
  }

  const templates = slashPath.match(/\{[^}]*\}/g) || [];
  if (templates.length > 1) {
    throw new SoundpackValidationError(`${field} contains too many number templates.`);
  }
  for (const template of templates) {
    const match = /^\{(-?\d+)-(-?\d+)\}$/.exec(template);
    if (!match) {
      throw new SoundpackValidationError(`${field} contains an invalid number template.`);
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start < 0 || end < start || end - start > MAX_TEMPLATE_SPAN) {
      throw new SoundpackValidationError(`${field} contains an unsafe number template range.`);
    }
  }

  const extensionProbe = slashPath.replace(/\{[^}]*\}/g, '0');
  const extension = path.posix.extname(extensionProbe).toLowerCase();
  if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    throw new SoundpackValidationError(`${field} uses unsupported audio type "${extension || 'none'}".`);
  }

  return slashPath;
}

function validateSpriteDefinition(value, key) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new SoundpackValidationError(`defines.${key} must contain start and duration values.`);
  }
  const start = Number(value[0]);
  const duration = Number(value[1]);
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new SoundpackValidationError(`defines.${key} has an invalid start or duration.`);
  }
}

function validateFiniteRange(value, field, minimum, maximum, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new SoundpackValidationError(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function validateV3Sample(sample, field) {
  if (typeof sample === 'string') {
    return { file: normalizeSoundReference(sample, field), gain: 1, pitch: 0, weight: 1 };
  }
  if (!isPlainObject(sample)) {
    throw new SoundpackValidationError(`${field} must be a file path or sample object.`);
  }
  return {
    ...sample,
    file: normalizeSoundReference(sample.file, `${field}.file`),
    gain: validateFiniteRange(sample.gain, `${field}.gain`, 0, 2, 1),
    pitch: validateFiniteRange(sample.pitch, `${field}.pitch`, -1200, 1200, 0),
    weight: validateFiniteRange(sample.weight, `${field}.weight`, 0.01, 100, 1),
  };
}

function validateV3Layer(layer, field) {
  if (!isPlainObject(layer)) {
    throw new SoundpackValidationError(`${field} must be an object.`);
  }
  if (!Array.isArray(layer.samples) || layer.samples.length < 1 || layer.samples.length > 128) {
    throw new SoundpackValidationError(`${field}.samples must contain between 1 and 128 entries.`);
  }
  const mode = layer.mode === undefined ? 'round-robin' : layer.mode;
  if (mode !== 'round-robin' && mode !== 'random') {
    throw new SoundpackValidationError(`${field}.mode must be round-robin or random.`);
  }
  const envelope = layer.envelope === undefined ? {} : layer.envelope;
  if (!isPlainObject(envelope)) {
    throw new SoundpackValidationError(`${field}.envelope must be an object.`);
  }
  return {
    ...layer,
    samples: layer.samples.map((sample, index) => validateV3Sample(sample, `${field}.samples[${index}]`)),
    mode,
    gain: validateFiniteRange(layer.gain, `${field}.gain`, 0, 2, 1),
    pitchVariationCents: validateFiniteRange(layer.pitchVariationCents, `${field}.pitchVariationCents`, 0, 100, 0),
    priority: validateFiniteRange(layer.priority, `${field}.priority`, 0, 10, 5),
    envelope: {
      attackMs: validateFiniteRange(envelope.attackMs, `${field}.envelope.attackMs`, 0, 100, 0),
      releaseMs: validateFiniteRange(envelope.releaseMs, `${field}.envelope.releaseMs`, 0, 2000, 12),
    },
  };
}

function validateV3Config(config, name) {
  const engine = config.engine === undefined ? {} : config.engine;
  const defaults = config.defaults === undefined ? {} : config.defaults;
  const keys = config.keys === undefined ? {} : config.keys;
  if (!isPlainObject(engine) || !isPlainObject(defaults) || !isPlainObject(keys)) {
    throw new SoundpackValidationError('v3 engine, defaults, and keys must be objects.');
  }
  const preload = engine.preload === undefined ? 'priority' : engine.preload;
  if (!['all', 'priority', 'lazy'].includes(preload)) {
    throw new SoundpackValidationError('engine.preload must be all, priority, or lazy.');
  }

  const normalizedDefaults = {};
  for (const eventType of ['keydown', 'keyup']) {
    if (defaults[eventType] !== undefined) {
      normalizedDefaults[eventType] = validateV3Layer(defaults[eventType], `defaults.${eventType}`);
    }
  }

  const normalizedKeys = {};
  for (const [key, eventLayers] of Object.entries(keys)) {
    if (!/^[0-9]+$/.test(key) || !isPlainObject(eventLayers)) {
      throw new SoundpackValidationError(`keys.${key} is invalid.`);
    }
    const normalizedEvents = {};
    for (const eventType of ['keydown', 'keyup']) {
      if (eventLayers[eventType] !== undefined) {
        normalizedEvents[eventType] = validateV3Layer(eventLayers[eventType], `keys.${key}.${eventType}`);
      }
    }
    if (Object.keys(normalizedEvents).length === 0) {
      throw new SoundpackValidationError(`keys.${key} must define keydown or keyup.`);
    }
    normalizedKeys[key] = normalizedEvents;
  }
  if (Object.keys(normalizedDefaults).length === 0 && Object.keys(normalizedKeys).length === 0) {
    throw new SoundpackValidationError('v3 must define at least one playable event layer.');
  }

  const checksums = config.checksums === undefined ? {} : config.checksums;
  if (!isPlainObject(checksums)) {
    throw new SoundpackValidationError('checksums must be an object.');
  }
  const normalizedChecksums = {};
  for (const [file, checksum] of Object.entries(checksums)) {
    const normalizedFile = normalizeSoundReference(file, `checksums.${file}`);
    if (typeof checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(checksum)) {
      throw new SoundpackValidationError(`checksums.${file} must be a SHA-256 hex digest.`);
    }
    normalizedChecksums[normalizedFile] = checksum.toLowerCase();
  }

  return {
    ...config,
    name,
    version: 3,
    author: config.author === undefined ? '' : requireNonEmptyString(config.author, 'author'),
    license: config.license === undefined ? '' : requireNonEmptyString(config.license, 'license'),
    sampleRate: config.sampleRate === undefined ? null : validateFiniteRange(config.sampleRate, 'sampleRate', 22050, 192000),
    engine: {
      maxVoices: Math.round(validateFiniteRange(engine.maxVoices, 'engine.maxVoices', 1, 256, 64)),
      preload,
      cacheBudgetMb: Math.round(validateFiniteRange(engine.cacheBudgetMb, 'engine.cacheBudgetMb', 32, 1024, 192)),
      gain: validateFiniteRange(engine.gain, 'engine.gain', 0, 2, 1),
    },
    defaults: normalizedDefaults,
    keys: normalizedKeys,
    checksums: normalizedChecksums,
  };
}

function validateSoundpackConfig(config) {
  if (!isPlainObject(config)) {
    throw new SoundpackValidationError('config.json must contain a JSON object.');
  }

  const version = config.version === undefined ? 1 : Number(config.version);
  if (!Number.isInteger(version) || !SUPPORTED_VERSIONS.has(version)) {
    throw new SoundpackValidationError(`Unsupported soundpack config version: ${config.version}.`, 'UNSUPPORTED_VERSION');
  }

  const name = requireNonEmptyString(config.name, 'name');
  if (name.length > MAX_NAME_LENGTH) {
    throw new SoundpackValidationError(`name must not exceed ${MAX_NAME_LENGTH} characters.`);
  }
  if (version === 3) {
    return validateV3Config(config, name);
  }

  if (config.key_define_type !== 'single' && config.key_define_type !== 'multi') {
    throw new SoundpackValidationError('key_define_type must be either "single" or "multi".');
  }

  if (!isPlainObject(config.defines)) {
    throw new SoundpackValidationError('defines must be an object.');
  }
  const definitionEntries = Object.entries(config.defines);
  if (definitionEntries.length === 0 || definitionEntries.length > MAX_DEFINITIONS) {
    throw new SoundpackValidationError(`defines must contain between 1 and ${MAX_DEFINITIONS} entries.`);
  }
  if (definitionEntries.every(([, value]) => value === null || value === undefined)) {
    throw new SoundpackValidationError('defines must contain at least one playable definition.');
  }

  normalizeSoundReference(config.sound, 'sound');
  if (version === 2) {
    normalizeSoundReference(config.soundup, 'soundup');
  }

  for (const [key, value] of definitionEntries) {
    if (!/^[0-9]+(?:-up)?$/.test(key)) {
      throw new SoundpackValidationError(`defines contains an invalid key "${key}".`);
    }
    if (value === null || value === undefined) {
      continue;
    }
    if (config.key_define_type === 'single') {
      validateSpriteDefinition(value, key);
    } else {
      normalizeSoundReference(value, `defines.${key}`);
    }
  }

  return {
    ...config,
    name,
    version,
  };
}

function expandNumberTemplate(reference, random = Math.random) {
  return reference.replace(/\{(-?\d+)-(-?\d+)\}/g, (_template, startValue, endValue) => {
    const start = Number(startValue);
    const end = Number(endValue);
    const offset = Math.floor(random() * (end - start + 1));
    return String(start + offset);
  });
}

function expandNumberTemplateVariants(reference) {
  const match = /\{(-?\d+)-(-?\d+)\}/.exec(reference);
  if (!match) {
    return [reference];
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const variants = [];
  for (let value = start; value <= end; value += 1) {
    variants.push(reference.replace(match[0], String(value)));
  }
  return variants;
}

function listReferencedSoundFiles(config) {
  const validated = validateSoundpackConfig(config);
  const references = new Set();
  if (validated.version === 3) {
    const addLayer = (layer) => {
      if (!layer) return;
      layer.samples.forEach((sample) => references.add(sample.file));
    };
    addLayer(validated.defaults.keydown);
    addLayer(validated.defaults.keyup);
    Object.values(validated.keys).forEach((events) => {
      addLayer(events.keydown);
      addLayer(events.keyup);
    });
    return [...references];
  }
  if (validated.key_define_type === 'single' || validated.version === 2) {
    expandNumberTemplateVariants(validated.sound).forEach((reference) => references.add(reference));
  }
  if (validated.version === 2) {
    expandNumberTemplateVariants(validated.soundup).forEach((reference) => references.add(reference));
  }
  if (validated.key_define_type === 'multi') {
    for (const reference of Object.values(validated.defines)) {
      if (reference !== null && reference !== undefined) {
        expandNumberTemplateVariants(reference).forEach((variant) => references.add(variant));
      }
    }
  }
  return [...references];
}

module.exports = {
  SoundpackValidationError,
  SUPPORTED_AUDIO_EXTENSIONS,
  expandNumberTemplate,
  expandNumberTemplateVariants,
  isPlainObject,
  listReferencedSoundFiles,
  normalizeSoundReference,
  validateSoundpackConfig,
};
