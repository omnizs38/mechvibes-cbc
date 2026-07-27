'use strict';

import path from 'path';
import { isLegacyV1Config, type LegacyV1Config } from './config-v1';
import { isLegacyV2Config, type LegacyV2Config } from './config-v2';
import { isLegacyV3Config, type LegacyV3Config } from './config-v3-legacy';
import { convertV1ToV4, convertV2ToV4, convertV3LegacyToV4 } from './config-converter';

const SUPPORTED_VERSIONS: ReadonlySet<number> = new Set([1, 2, 3, 4]);
export const SUPPORTED_AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
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

/** Loose shape for user-authored JSON that has not been validated yet. */
type AnyRecord = Record<string, any>;

export type SoundpackEventType = 'keydown' | 'keyup';
export type SampleMode = 'round-robin' | 'random';
export type PreloadStrategy = 'all' | 'priority' | 'lazy';

export interface ValidatedSample {
  file: string;
  gain: number;
  pitch: number;
  weight: number;
  /** Optional playback window (v4). Absent means play the whole file. */
  offsetSeconds?: number;
  durationSeconds?: number;
  [key: string]: unknown;
}

export interface ValidatedLayer {
  samples: ValidatedSample[];
  mode: SampleMode;
  gain: number;
  pitchVariationCents: number;
  priority: number;
  envelope: { attackMs: number; releaseMs: number };
  [key: string]: unknown;
}

export type ValidatedEventLayers = Partial<Record<SoundpackEventType, ValidatedLayer>>;

export interface ValidatedV3Config {
  name: string;
  /** 3 or 4 — the v4 config is the v3 schema plus per-sample offset/duration. */
  version: 3 | 4;
  author: string;
  license: string;
  sampleRate: number | null;
  engine: {
    maxVoices: number;
    preload: PreloadStrategy;
    cacheBudgetMb: number;
    gain: number;
  };
  defaults: ValidatedEventLayers;
  keys: Record<string, ValidatedEventLayers>;
  checksums: Record<string, string>;
  [key: string]: unknown;
}

export type ValidatedSoundpackConfig = ValidatedV3Config;

export class SoundpackValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = 'INVALID_SOUNDPACK') {
    super(message);
    this.name = 'SoundpackValidationError';
    this.code = code;
  }
}

export function isPlainObject(value: unknown): value is AnyRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SoundpackValidationError(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

export function normalizeSoundReference(value: unknown, field = 'sound file'): string {
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
  if (
    segments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        /[<>:"|?*{}]|\p{Cc}/u.test(segment) ||
        /[. ]$/.test(segment) ||
        unsafeWindowsName.test(segment),
    )
  ) {
    throw new SoundpackValidationError(`${field} contains a path that is unsafe on Windows.`);
  }

  const extension = path.posix.extname(slashPath).toLowerCase();
  if (!SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    throw new SoundpackValidationError(
      `${field} uses unsupported audio type "${extension || 'none'}".`,
    );
  }

  return slashPath;
}

function validateFiniteRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  fallback?: number,
): number {
  if (value === undefined && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new SoundpackValidationError(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function validateV3Sample(sample: unknown, field: string): ValidatedSample {
  if (typeof sample === 'string') {
    return { file: normalizeSoundReference(sample, field), gain: 1, pitch: 0, weight: 1 };
  }
  if (!isPlainObject(sample)) {
    throw new SoundpackValidationError(`${field} must be a file path or sample object.`);
  }
  const normalized: ValidatedSample = {
    ...sample,
    file: normalizeSoundReference(sample['file'], `${field}.file`),
    gain: validateFiniteRange(sample['gain'], `${field}.gain`, 0, 2, 1),
    pitch: validateFiniteRange(sample['pitch'], `${field}.pitch`, -1200, 1200, 0),
    weight: validateFiniteRange(sample['weight'], `${field}.weight`, 0.01, 100, 1),
  };
  // Optional per-sample playback window (v4 sprite support). Validated whenever
  // present so a malformed window is rejected rather than silently passed on.
  if (sample['offsetSeconds'] !== undefined) {
    normalized.offsetSeconds = validateFiniteRange(
      sample['offsetSeconds'],
      `${field}.offsetSeconds`,
      0,
      3600,
    );
  }
  if (sample['durationSeconds'] !== undefined) {
    normalized.durationSeconds = validateFiniteRange(
      sample['durationSeconds'],
      `${field}.durationSeconds`,
      0.001,
      3600,
    );
  }
  return normalized;
}

function validateV3Layer(layer: unknown, field: string): ValidatedLayer {
  if (!isPlainObject(layer)) {
    throw new SoundpackValidationError(`${field} must be an object.`);
  }
  const samples = layer['samples'];
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 128) {
    throw new SoundpackValidationError(`${field}.samples must contain between 1 and 128 entries.`);
  }
  const mode = layer['mode'] === undefined ? 'round-robin' : layer['mode'];
  if (mode !== 'round-robin' && mode !== 'random') {
    throw new SoundpackValidationError(`${field}.mode must be round-robin or random.`);
  }
  const envelope = layer['envelope'] === undefined ? {} : layer['envelope'];
  if (!isPlainObject(envelope)) {
    throw new SoundpackValidationError(`${field}.envelope must be an object.`);
  }
  return {
    ...layer,
    samples: samples.map((sample: unknown, index: number) =>
      validateV3Sample(sample, `${field}.samples[${index}]`),
    ),
    mode,
    gain: validateFiniteRange(layer['gain'], `${field}.gain`, 0, 2, 1),
    pitchVariationCents: validateFiniteRange(
      layer['pitchVariationCents'],
      `${field}.pitchVariationCents`,
      0,
      100,
      0,
    ),
    priority: validateFiniteRange(layer['priority'], `${field}.priority`, 0, 10, 5),
    envelope: {
      attackMs: validateFiniteRange(envelope['attackMs'], `${field}.envelope.attackMs`, 0, 100, 0),
      releaseMs: validateFiniteRange(
        envelope['releaseMs'],
        `${field}.envelope.releaseMs`,
        0,
        2000,
        12,
      ),
    },
  };
}

function validateModernConfig(
  config: AnyRecord,
  name: string,
  version: 3 | 4,
): ValidatedV3Config {
  const engine = config['engine'] === undefined ? {} : config['engine'];
  const defaults = config['defaults'] === undefined ? {} : config['defaults'];
  const keys = config['keys'] === undefined ? {} : config['keys'];
  if (!isPlainObject(engine) || !isPlainObject(defaults) || !isPlainObject(keys)) {
    throw new SoundpackValidationError('v3 engine, defaults, and keys must be objects.');
  }
  const preload = engine['preload'] === undefined ? 'priority' : engine['preload'];
  if (!['all', 'priority', 'lazy'].includes(preload)) {
    throw new SoundpackValidationError('engine.preload must be all, priority, or lazy.');
  }

  const eventTypes: SoundpackEventType[] = ['keydown', 'keyup'];

  const normalizedDefaults: ValidatedEventLayers = {};
  for (const eventType of eventTypes) {
    if (defaults[eventType] !== undefined) {
      normalizedDefaults[eventType] = validateV3Layer(defaults[eventType], `defaults.${eventType}`);
    }
  }

  const normalizedKeys: Record<string, ValidatedEventLayers> = {};
  for (const [key, eventLayers] of Object.entries(keys)) {
    if (!/^[0-9]+$/.test(key) || !isPlainObject(eventLayers)) {
      throw new SoundpackValidationError(`keys.${key} is invalid.`);
    }
    const normalizedEvents: ValidatedEventLayers = {};
    for (const eventType of eventTypes) {
      if (eventLayers[eventType] !== undefined) {
        normalizedEvents[eventType] = validateV3Layer(
          eventLayers[eventType],
          `keys.${key}.${eventType}`,
        );
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

  const checksums = config['checksums'] === undefined ? {} : config['checksums'];
  if (!isPlainObject(checksums)) {
    throw new SoundpackValidationError('checksums must be an object.');
  }
  const normalizedChecksums: Record<string, string> = {};
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
    version,
    // Empty/absent author, license, and sampleRate all normalize to their
    // defaults so validation stays idempotent — the load path validates a
    // config, then re-validates the result inside createAudioManifest.
    author: !config['author'] ? '' : requireNonEmptyString(config['author'], 'author'),
    license: !config['license'] ? '' : requireNonEmptyString(config['license'], 'license'),
    sampleRate:
      config['sampleRate'] === undefined || config['sampleRate'] === null
        ? null
        : validateFiniteRange(config['sampleRate'], 'sampleRate', 22050, 192000),
    engine: {
      maxVoices: Math.round(
        validateFiniteRange(engine['maxVoices'], 'engine.maxVoices', 1, 256, 64),
      ),
      preload: preload as PreloadStrategy,
      cacheBudgetMb: Math.round(
        validateFiniteRange(engine['cacheBudgetMb'], 'engine.cacheBudgetMb', 32, 1024, 192),
      ),
      gain: validateFiniteRange(engine['gain'], 'engine.gain', 0, 2, 1),
    },
    defaults: normalizedDefaults,
    keys: normalizedKeys,
    checksums: normalizedChecksums,
  };
}

export function validateSoundpackConfig(config: unknown): ValidatedSoundpackConfig {
  if (!isPlainObject(config)) {
    throw new SoundpackValidationError('config.json must contain a JSON object.');
  }

  const version = Number(config['version']);
  if (!Number.isInteger(version) || !SUPPORTED_VERSIONS.has(version)) {
    throw new SoundpackValidationError(
      `Unsupported soundpack config version: ${config['version']}.`,
      'UNSUPPORTED_VERSION',
    );
  }

  // Convert legacy formats (v1, v2, v3-legacy) to modern v4
  let normalizedConfig = config as AnyRecord;
  
  if (version === 1) {
    if (!isLegacyV1Config(config)) {
      throw new SoundpackValidationError('Invalid v1 soundpack config format.');
    }
    // Convert v1 → v4
    normalizedConfig = convertV1ToV4(config as LegacyV1Config);
  } else if (version === 2) {
    if (!isLegacyV2Config(config)) {
      throw new SoundpackValidationError('Invalid v2 soundpack config format.');
    }
    // Convert v2 → v4
    normalizedConfig = convertV2ToV4(config as LegacyV2Config);
  } else if (version === 3) {
    // Check if it's legacy v3 or modern v3
    if (isLegacyV3Config(config)) {
      // Legacy v3 (from original mechvibes with clips/cycles)
      normalizedConfig = convertV3LegacyToV4(config as LegacyV3Config);
    }
    // Modern v3 (same as v4 in mechvibes-cbc) will pass through to validateModernConfig
  }

  const name = requireNonEmptyString(normalizedConfig['name'], 'name');
  if (name.length > MAX_NAME_LENGTH) {
    throw new SoundpackValidationError(`name must not exceed ${MAX_NAME_LENGTH} characters.`);
  }

  // All converted configs are now in v4 format
  return validateModernConfig(normalizedConfig, name, 4);
}

export function listReferencedSoundFiles(config: unknown): string[] {
  const validated = validateSoundpackConfig(config);
  const references = new Set<string>();
  const addLayer = (layer?: ValidatedLayer): void => {
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
