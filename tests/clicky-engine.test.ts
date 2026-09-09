'use strict';

const assert = require('assert').strict;
const { test } = require('node:test');
const {
  convertToV4,
  convertMany,
  detectDialect,
  CLICKY_ENGINE_NAME,
  CLICKY_MAX_BATCH,
} = require('../src/libs/soundpacks/clicky-engine');

function modernV3(overrides = {}) {
  return {
    name: 'Modern v3 pack',
    version: 3,
    author: 'Test Author',
    license: 'CC0-1.0',
    engine: { maxVoices: 64, preload: 'priority', cacheBudgetMb: 128, gain: 1 },
    defaults: {
      keydown: { samples: ['press/a.wav', 'press/b.wav'], mode: 'round-robin' },
      keyup: { samples: ['release/a.flac'] },
    },
    keys: {},
    checksums: {},
    ...overrides,
  };
}

function modernV4(overrides = {}) {
  return {
    ...modernV3(),
    version: 4,
    defaults: {
      keydown: { samples: [{ file: 'press/a.wav', offsetSeconds: 0.2, durationSeconds: 0.1 }] },
      keyup: { samples: ['release/a.flac'] },
    },
    ...overrides,
  };
}

function legacyV3() {
  return {
    version: 3,
    name: 'Legacy pack',
    sounds: { press: { file: 'sound.ogg', clip: [44100, 22050] } },
    defines: { 30: 'press' },
  };
}

test('Clicky Engine promotes a modern v3 pack to v4', () => {
  const result = convertToV4(modernV3());
  assert.equal(result.config.version, 4);
  assert.equal(result.dialect, 'modern-v3');
  assert.equal(result.alreadyV4, false);
  assert.equal(typeof result.durationMs, 'number');
  assert.ok(result.durationMs >= 0);
  assert.equal(result.config.defaults.keydown.samples.length, 2);
});

test('Clicky Engine takes a fast path for already-v4 packs', () => {
  const result = convertToV4(modernV4());
  assert.equal(result.config.version, 4);
  assert.equal(result.dialect, 'modern-v4');
  assert.equal(result.alreadyV4, true);
  assert.equal(result.config.defaults.keydown.samples[0].offsetSeconds, 0.2);
});

test('Clicky Engine bridges legacy v3 (clips) to v4', () => {
  const result = convertToV4(legacyV3());
  assert.equal(result.dialect, 'legacy-v3');
  assert.equal(result.config.version, 4);
  const sample = result.config.keys['30'].keydown.samples[0];
  assert.equal(sample.file, 'sound.ogg');
  assert.equal(sample.offsetSeconds, 1); // 44100 / 44100
  assert.equal(sample.durationSeconds, 0.5); // 22050 / 44100
});

test('Clicky Engine never mutates the caller input', () => {
  const input = modernV3();
  convertToV4(input);
  assert.equal(input.version, 3, 'the original config keeps its version');
  assert.equal(Array.isArray(input.defaults.keydown.samples), true);
  assert.equal(input.defaults.keydown.samples[0], 'press/a.wav');
});

test('Clicky Engine rejects unsupported v1/v2 packs with a machine-readable code', () => {
  const v1 = () => convertToV4({ version: 1, name: 'legacy v1' });
  assert.throws(v1, (error) => {
    assert.equal(error.code, 'UNSUPPORTED_VERSION');
    assert.match(error.message, /no longer supported/);
    return true;
  });
  assert.throws(() => convertToV4({ version: 2, name: 'legacy v2' }), /Unsupported/);
});

test('Clicky Engine rejects unsafe sound references (defense in depth)', () => {
  assert.throws(
    () => convertToV4(modernV3({ defaults: { keydown: { samples: ['../escape.wav'] } } })),
    /unsafe|relative/,
  );
});

test('detectDialect classifies inputs without validating them', () => {
  assert.equal(detectDialect(modernV4()), 'modern-v4');
  assert.equal(detectDialect(modernV3()), 'modern-v3');
  assert.equal(detectDialect(legacyV3()), 'legacy-v3');
  assert.equal(detectDialect(null), 'modern-v3');
});

test('convertMany captures per-item failures without aborting the batch', () => {
  const outcomes = convertMany([
    { id: 'good', config: modernV3() },
    { id: 'bad-version', config: { version: 1, name: 'v1' } },
    { id: 'legacy', config: legacyV3() },
  ]);
  assert.equal(outcomes.length, 3);
  assert.equal(outcomes[0].ok, true);
  assert.equal(outcomes[0].result.config.version, 4);
  assert.equal(outcomes[1].ok, false);
  assert.equal(outcomes[1].code, 'UNSUPPORTED_VERSION');
  assert.equal(outcomes[2].ok, true);
  assert.equal(outcomes[2].result.dialect, 'legacy-v3');
});

test('convertMany enforces a bounded batch size', () => {
  const oversized = new Array(CLICKY_MAX_BATCH + 1).fill(0).map((_, index) => ({
    id: String(index),
    config: modernV3(),
  }));
  assert.throws(() => convertMany(oversized), /limited to/);
  assert.throws(() => convertMany('nope'), /must be an array/);
});

test('Clicky Engine exposes its display name', () => {
  assert.equal(CLICKY_ENGINE_NAME, 'Clicky Engine');
});
