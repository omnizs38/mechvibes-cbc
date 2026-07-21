'use strict';

const path = require('path');

const SUPPORTED_VERSIONS = new Set([1, 2]);
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
