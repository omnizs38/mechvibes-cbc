'use strict';

const assert = require('assert').strict;
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LatencyTracker } = require('../src/audio-engine/latency-tracker');
const {
  MANIFEST_FORMAT,
  centsToPlaybackRate: manifestCentsToPlaybackRate,
  clamp: manifestClamp,
} = require('../src/audio-engine/manifest');
const { createAudioManifest } = require('../src/audio-engine/manifest-adapter');
const { AudioGraph } = require('../src/audio-engine/audio-graph');
const { VoiceScheduler } = require('../src/audio-engine/voice-scheduler');
const audioEngineIndex = require('../src/audio-engine');
const { SampleCache } = require('../src/audio-engine/sample-cache');
const { SampleSelector } = require('../src/audio-engine/sample-selector');
const { VoicePool } = require('../src/audio-engine/voice-pool');
const { WebAudioEngine, centsToPlaybackRate } = require('../src/audio-engine');
const { SoundpackManager } = require('../src/libs/soundpacks/pack-manager');
const { keycodesRemap } = require('../src/libs/keycodes');
const { discoverSoundpacks, verifySoundpackChecksums } = require('../src/libs/soundpacks/registry');
const {
  listReferencedSoundFiles,
  normalizeSoundReference,
  validateSoundpackConfig,
} = require('../src/libs/soundpacks/validation');
const {
  buildV4Config,
  parseV4Config,
  hasSound: editorHasSound,
} = require('../src/libs/soundpacks/editor-config');
const {
  commitDirectoryReplacement,
  enforceDownloadSize,
  readResponseBuffer,
  validateInstallationManifest,
} = require('../src/utils/installer');
const { chooseRandomPackIndex } = require('../src/utils/random-pack');
const { resolveLogSenderName } = require('../src/utils/log-sender');
const { calculateAdjustedDisplay, calculateGain } = require('../src/utils/volume');
const { HotkeyTracker } = require('../src/services/hotkey-tracker');
const { UpdateService, normalizeReleaseNotes } = require('../src/services/update-service');
const rendererRoot = path.resolve(__dirname, '..', 'src', 'renderer');

interface TestCase {
  name: string;
  callback: () => unknown;
}

const tests: TestCase[] = [];
function test(name: string, callback: () => unknown): void {
  tests.push({ name, callback });
}

function validV3(overrides = {}) {
  return {
    name: 'Modern pack',
    version: 3,
    author: 'Test Author',
    license: 'CC0-1.0',
    sampleRate: 48000,
    engine: { maxVoices: 64, preload: 'priority', cacheBudgetMb: 128, gain: 1 },
    defaults: {
      keydown: {
        samples: ['press/a.wav', 'press/b.wav'],
        mode: 'round-robin',
        gain: 1,
        pitchVariationCents: 8,
        envelope: { attackMs: 0, releaseMs: 12 },
      },
      keyup: {
        samples: ['release/a.flac'],
      },
    },
    keys: {},
    checksums: {},
    ...overrides,
  };
}

function validV4(overrides = {}) {
  return {
    ...validV3(),
    version: 4,
    defaults: {
      keydown: {
        samples: [{ file: 'press/a.wav', offsetSeconds: 0.2, durationSeconds: 0.1 }],
      },
      keyup: { samples: ['release/a.flac'] },
    },
    ...overrides,
  };
}

function deferred() {
  let resolve!: (value?: unknown) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakePack {
  pack_id: string;
  name: string;
  load: any;
  loadCalls: number;
  unloadCalls: number;
  audio?: unknown;

  constructor(id: string, load: any = null) {
    this.pack_id = id;
    this.name = id;
    this.load = load;
    this.loadCalls = 0;
    this.unloadCalls = 0;
  }

  async LoadSounds() {
    this.loadCalls += 1;
    if (this.load) {
      await this.load.promise;
    }
    this.audio = {};
  }

  UnloadSounds() {
    this.unloadCalls += 1;
    delete this.audio;
  }
}

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.checkCalls = 0;
    this.downloadCalls = 0;
    this.installCalls = 0;
  }

  async checkForUpdates() {
    this.checkCalls += 1;
    return { updateInfo: null };
  }

  async downloadUpdate() {
    this.downloadCalls += 1;
    return ['installer.exe'];
  }

  quitAndInstall(isSilent?: boolean, forceRunAfter?: boolean) {
    this.installCalls += 1;
    this.installArguments = [isSilent, forceRunAfter];
  }
}

test('adapts a v4 sprite config into paired keydown and keyup windows', () => {
  // The shape the bundled sprite packs are stored in: one shared file, per-key
  // keydown windows, and (where present) a keyup release window.
  const config = validateSoundpackConfig(
    validV4({
      defaults: {},
      keys: {
        30: {
          keydown: { samples: [{ file: 'sound.ogg', offsetSeconds: 2.926, durationSeconds: 0.125 }] },
          keyup: {
            samples: [{ file: 'sound.ogg', offsetSeconds: 3.051, durationSeconds: 0.077 }],
            priority: 4,
          },
        },
      },
    }),
  );
  assert.equal(config.version, 4);
  const manifest = createAudioManifest(
    config,
    { pack_id: 'sprite', abs_path: '/pack' },
    { getFile: (_packPath: string, file: string) => `file:///pack/${file}` },
  );
  assert.equal(manifest.events['keydown:30'].samples[0].durationSeconds, 0.125);
  assert.equal(manifest.events['keyup:30'].samples[0].offsetSeconds, 3.051);
  assert.equal(manifest.events['keyup:30'].priority, 4);
});

test('createAudioManifest skips re-validation for an already-validated config', () => {
  // The load path validates once at discovery and passes validate:false here.
  // A too-low sampleRate is rejected by the validator but trusted when skipped.
  const trusted = {
    name: 'Trusted',
    version: 4,
    sampleRate: 999,
    engine: { maxVoices: 64, preload: 'all', cacheBudgetMb: 192, gain: 1 },
    defaults: {},
    keys: {
      30: {
        keydown: {
          samples: [{ file: 'a.wav', gain: 1, pitch: 0, weight: 1 }],
          mode: 'round-robin',
          gain: 1,
          pitchVariationCents: 0,
          priority: 5,
          envelope: { attackMs: 0, releaseMs: 12 },
        },
      },
    },
    checksums: {},
  };
  const metadata = { pack_id: 'trusted', abs_path: '/pack' };
  const getFile = (_packPath: string, file: string) => `data:audio/mock,${file}`;
  assert.throws(() => createAudioManifest(trusted, metadata, { getFile }), /sampleRate/);
  const manifest = createAudioManifest(trusted, metadata, { getFile, validate: false });
  assert.equal(manifest.sampleRate, 999);
  assert.equal(manifest.events['keydown:30'].samples[0].source, 'data:audio/mock,a.wav');
});

test('remaps Windows key aliases without emitting empty definitions', () => {
  const regularKey = { sample: 'regular' };
  const insertKey = { sample: 'insert' };
  const remapped = keycodesRemap({ 1: regularKey, 3666: insertKey }, 'win32');
  assert.equal(remapped['keycode-1'], regularKey);
  assert.equal(remapped['keycode-3666'], insertKey);
  assert.equal(remapped['keycode-61010'], insertKey);
  assert.equal(Object.hasOwn(remapped, 'keycode-60999'), false);
  assert.equal(Object.values(remapped).every((definition) => definition !== null && definition !== undefined), true);
});

test('validates v3 layers and adapts them to the unified audio manifest', () => {
  const config = validateSoundpackConfig(validV3());
  assert.equal(config.version, 3);
  assert.equal(config.engine.maxVoices, 64);
  assert.equal(config.defaults.keydown.samples.length, 2);
  const manifest = createAudioManifest(config, {
    pack_id: 'custom-modern',
    abs_path: '/packs/modern',
  }, {
    getFile: (_packPath: string, file: string) => `data:audio/mock,${file}`,
  });
  assert.equal(manifest.version, 3);
  assert.equal(manifest.events['keydown:30'].samples.length, 2);
  assert.equal(manifest.events['keyup:30'].samples[0].file, 'release/a.flac');
  assert.throws(() => validateSoundpackConfig(validV3({
    defaults: { keydown: { samples: ['unsafe/../sound.wav'] } },
  })), /unsafe/);
});

test('validates the native v4 config and preserves per-sample windows', () => {
  const config = validateSoundpackConfig(validV4());
  assert.equal(config.version, 4);
  assert.equal(config.defaults.keydown.samples[0].offsetSeconds, 0.2);
  assert.equal(config.defaults.keydown.samples[0].durationSeconds, 0.1);
  const manifest = createAudioManifest(
    config,
    { pack_id: 'custom-v4', abs_path: '/packs/v4' },
    { getFile: (_packPath: string, file: string) => `data:audio/mock,${file}` },
  );
  assert.equal(manifest.version, 4);
  const sample = manifest.events['keydown:30'].samples[0];
  assert.equal(sample.offsetSeconds, 0.2);
  assert.equal(sample.durationSeconds, 0.1);
  assert.equal(sample.source, 'data:audio/mock,press/a.wav');
  // A malformed playback window is rejected rather than silently passed through.
  assert.throws(
    () =>
      validateSoundpackConfig(
        validV4({ defaults: { keydown: { samples: [{ file: 'press/a.wav', durationSeconds: 0 }] } } }),
      ),
    /durationSeconds/,
  );
});

test('editor builds an engine-loadable v4 sprite config and round-trips it', () => {
  const draft = { name: 'My Pack', mode: 'sprite' as const, sound: 'sound.ogg' };
  const defines = { 30: [2926, 125] as [number, number], 57: [0, 0] as [number, number], 44: null };
  const config = buildV4Config(draft.name, draft.mode, draft.sound, defines);
  // Editor output must survive the engine's own validator.
  const validated = validateSoundpackConfig(config);
  assert.equal(validated.version, 4);
  // Keys without sound (57 zero window, 44 null) are dropped; 30 is kept.
  assert.deepEqual(Object.keys(config.keys), ['30']);
  assert.equal(config.keys['30'].keydown.samples[0].offsetSeconds, 2.926);
  assert.equal(config.keys['30'].keydown.samples[0].durationSeconds, 0.125);
  // Parsing it back reproduces the millisecond window and infers sprite mode.
  const parsed = parseV4Config(config);
  assert.equal(parsed.mode, 'sprite');
  assert.equal(parsed.name, 'My Pack');
  assert.equal(parsed.sound, 'sound.ogg');
  assert.deepEqual(parsed.defines['30'], [2926, 125]);
});

test('editor builds and round-trips a v4 per-file config', () => {
  const config = buildV4Config('Files', 'files', 'unused.ogg', { 30: 'a.wav', 44: '' });
  assert.deepEqual(Object.keys(config.keys), ['30']);
  assert.equal(config.keys['30'].keydown.samples[0].file, 'a.wav');
  assert.equal(config.keys['30'].keydown.samples[0].offsetSeconds, undefined);
  validateSoundpackConfig(config);
  const parsed = parseV4Config(config);
  assert.equal(parsed.mode, 'files');
  assert.equal(parsed.defines['30'], 'a.wav');
});

test('editor treats empty and metadata-only configs as an empty sprite draft', () => {
  const empty = parseV4Config({});
  assert.equal(empty.mode, 'sprite');
  assert.deepEqual(empty.defines, {});
  assert.equal(editorHasSound(null), false);
  assert.equal(editorHasSound([0, 0]), false);
  assert.equal(editorHasSound([1, 2]), true);
  assert.equal(editorHasSound(''), false);
  assert.equal(editorHasSound('a.wav'), true);
});

test('validates idempotently when optional metadata is omitted', () => {
  // The load path validates a config, then re-validates the result inside
  // createAudioManifest, so a config without author/license/sampleRate must
  // survive a second pass (its defaults are '' / '' / null).
  const once = validateSoundpackConfig({
    name: 'No metadata',
    version: 4,
    engine: { maxVoices: 64, preload: 'all', cacheBudgetMb: 192, gain: 1 },
    defaults: {},
    keys: { 30: { keydown: { samples: ['a.wav'] } } },
    checksums: {},
  });
  assert.equal(once.author, '');
  assert.equal(once.sampleRate, null);
  assert.doesNotThrow(() => validateSoundpackConfig(once));
});

test('verifies optional v3 SHA-256 sample integrity', () => {
  const config = {
    checksums: {
      'press/a.wav': '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    },
  };
  verifySoundpackChecksums('/pack', config, {
    getFile: () => 'data:audio/wav;base64,aGVsbG8=',
    clearCache() {},
  });
  let cleared = false;
  assert.throws(() => verifySoundpackChecksums('/pack', {
    checksums: { 'press/a.wav': '0'.repeat(64) },
  }, {
    getFile: () => 'data:audio/wav;base64,aGVsbG8=',
    clearCache: () => { cleared = true; },
  }), /Checksum mismatch/);
  assert.equal(cleared, true);
});

test('rejects unsafe or malformed soundpack configuration', () => {
  assert.throws(
    () => validateSoundpackConfig(validV3({ defaults: { keydown: { samples: ['../outside.wav'] } } })),
    /unsafe/,
  );
  assert.throws(() => validateSoundpackConfig(validV4({ version: 99 })), /Unsupported/);
  assert.throws(() => validateSoundpackConfig(validV4({ version: 1 })), /Unsupported/);
  assert.throws(() => validateSoundpackConfig(validV3({ keys: { key: { keydown: { samples: ['a.wav'] } } } })), /invalid/);
  assert.throws(
    () =>
      validateSoundpackConfig(
        validV4({ keys: { 30: { keydown: { samples: [{ file: 'a.wav', durationSeconds: 0 }] } } } }),
      ),
    /durationSeconds/,
  );
  assert.throws(() => normalizeSoundReference('C:/secret.wav'), /relative/);
  // Number templates were a v1/v2 feature; brace filenames are now rejected.
  assert.throws(() => normalizeSoundReference('key_{0-4}.mp3'), /unsafe on Windows/);
  assert.throws(() => normalizeSoundReference('CON.wav'), /unsafe on Windows/);
  assert.throws(() => normalizeSoundReference('folder/./sound.wav'), /unsafe on Windows/);
  assert.equal(normalizeSoundReference('./sound.wav'), 'sound.wav');
});

test('lists every referenced sound file for a v4 config', () => {
  const references = listReferencedSoundFiles(
    validV4({
      defaults: { keydown: { samples: ['press/a.wav', 'press/b.wav'] }, keyup: { samples: ['release/a.flac'] } },
      keys: { 30: { keydown: { samples: [{ file: 'press/special.mp3' }] } } },
    }),
  );
  assert.deepEqual(
    new Set(references),
    new Set(['press/a.wav', 'press/b.wav', 'release/a.flac', 'press/special.mp3']),
  );
});

test('calculates finite and clamped audio gain', () => {
  assert.equal(calculateGain({ configuredVolume: 50, systemVolume: 50, activeAdjustment: true }), 1);
  assert.equal(calculateGain({ configuredVolume: 200, systemVolume: 0, activeAdjustment: true }), 2);
  assert.equal(calculateGain({ configuredVolume: 50, systemVolume: 50, activeAdjustment: false }), 0.5);
  assert.equal(calculateAdjustedDisplay({ configuredVolume: 'bad', systemVolume: 50, activeAdjustment: true }), 100);
});

test('chooses a different random pack without recursion', () => {
  const packs = [{ pack_id: 'a' }, { pack_id: 'b' }, { pack_id: 'c' }];
  assert.equal(chooseRandomPackIndex([packs[0]], 'a', () => 0), null);
  assert.equal(chooseRandomPackIndex(packs, 'a', () => 0), 1);
  assert.equal(chooseRandomPackIndex(packs, 'a', () => 0.9999), 2);
});

test('resolves the electron-log sender label without crashing on undefined window options', () => {
  // Regression: `event.sender.browserWindowOptions` is undefined for webContents
  // not created directly via `new BrowserWindow(...)`. Dereferencing `.name`
  // without guarding the options object threw a TypeError and crashed startup.
  assert.equal(resolveLogSenderName({ sender: { browserWindowOptions: undefined } }), 'u/w');
  // A webContents that exposes options but without a string name also falls back.
  assert.equal(resolveLogSenderName({ sender: { browserWindowOptions: {} } }), 'u/w');
  assert.equal(resolveLogSenderName({ sender: { browserWindowOptions: { name: 42 } } }), 'u/w');
  // The working case keeps returning the configured window name.
  assert.equal(resolveLogSenderName({ sender: { browserWindowOptions: { name: 'main' } } }), 'main');
});

test('posts remote logs and records non-200 responses without recursing', async () => {
  // The custom electron-log v5 remote transport imports `electron` and does real
  // HTTP, so stub `electron` and drive it against a throwaway server. Guards the
  // v4->v5 rewrite: payload shape, circular/error-safe serialization, response
  // status handling, and — critically — that logging a failure does not fan back
  // into the remote transport and recurse.
  const nodeModule = require('module');
  const originalLoad = nodeModule._load;
  nodeModule._load = (request: string, ...rest: unknown[]) =>
    request === 'electron'
      ? { app: { getVersion: () => '2.4.2' } }
      : originalLoad.call(nodeModule, request, ...rest);

  const http = require('http');
  try {
    delete require.cache[require.resolve('../src/libs/electron-log/transports/remote')];
    const remoteTransportFactory = require('../src/libs/electron-log/transports/remote');

    const writes: Array<{ transport: string; level: string; data: unknown[] }> = [];
    const sink = (transport: string) => (message: { level: string; data: unknown[] }) =>
      writes.push({ transport, level: message.level, data: message.data });
    const electronLog = {
      variables: { sender: 'main' } as Record<string, unknown> & { sender?: string },
      transports: { file: sink('file'), console: sink('console'), ipc: sink('ipc') },
    };

    let body: string | null = null;
    const server = http.createServer((request: any, response: any) => {
      let chunks = '';
      request.on('data', (chunk: string) => (chunks += chunk));
      request.on('end', () => {
        body = chunks;
        response.statusCode = 500;
        response.end('nope');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    const transport = remoteTransportFactory(electronLog, `http://127.0.0.1:${port}/debug/ipc/`);
    assert.equal(transport.requestOptions.method, 'LOG'); // preserved from v4
    assert.equal(transport.level, false); // disabled until debugging is enabled

    transport.level = 'silly';
    transport.client.identifier = 'test-id';
    // Node's server parser rejects the custom LOG method; POST lets the harness
    // read the wire payload while the default LOG is asserted above.
    transport.requestOptions.method = 'POST';

    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    transport({
      data: ['hello', circular, new Error('boom')],
      level: 'info',
      date: new Date(),
      variables: { sender: 'renderer' },
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    const parsed = JSON.parse(String(body));
    assert.equal(parsed.client.name, 'Mechvibes');
    assert.equal(parsed.client.identifier, 'test-id');
    const serialized = JSON.stringify(parsed.data);
    assert.ok(serialized.includes('[Circular]'), 'circular references are made safe');
    assert.ok(serialized.includes('boom'), 'errors keep their message');

    const warnTargets = writes.filter((w) => w.level === 'warn').map((w) => w.transport).sort();
    assert.deepEqual(warnTargets, ['console', 'file', 'ipc']);
    assert.ok(writes.length <= 6, 'a failed send does not recurse into the remote transport');
    assert.equal(electronLog.variables.sender, 'main'); // sender is restored

    server.close();
  } finally {
    nodeModule._load = originalLoad;
    delete require.cache[require.resolve('../src/libs/electron-log/transports/remote')];
  }
});

test('selects v3 samples without immediate repeats', () => {
  const selector = new SampleSelector(() => 0);
  const samples = ['a', 'b', 'c'];
  assert.equal(selector.choose('keydown:30', samples, 'round-robin'), 'a');
  assert.equal(selector.choose('keydown:30', samples, 'round-robin'), 'b');
  assert.equal(selector.choose('keydown:30', samples, 'random'), 'a');
  assert.notEqual(selector.choose('keydown:30', samples, 'random'), 'a');
});

test('enforces the voice budget by stealing the oldest low-priority voice', () => {
  const stopped: any[] = [];
  const makeSource = (name: string) => ({ stop: () => stopped.push(name), onended: null });
  const pool = new VoicePool(2);
  const high = makeSource('high');
  const oldestLow = makeSource('old-low');
  const newest = makeSource('new');
  pool.reserve({ source: oldestLow, priority: 1, startedAt: 1 });
  pool.reserve({ source: high, priority: 8, startedAt: 2 });
  pool.reserve({ source: newest, priority: 5, startedAt: 3 });
  assert.deepEqual(stopped, ['old-low']);
  assert.equal(pool.size, 2);
  assert.equal(pool.getStats().stolenVoices, 1);
});

test('keeps the previous soundpack when a new selection fails', async () => {
  const first = new FakePack('first');
  const failedLoad = deferred();
  const second = new FakePack('second', failedLoad);
  const manager = new SoundpackManager([first, second]);
  await manager.select('first');
  failedLoad.reject(new Error('broken audio'));
  await assert.rejects(manager.select('second'), /broken audio/);
  assert.equal(manager.current, first);
  assert.equal(first.unloadCalls, 0);
  assert.equal(second.unloadCalls, 1);
});

test('only commits the latest concurrent soundpack selection', async () => {
  const first = new FakePack('first');
  const secondLoad = deferred();
  const thirdLoad = deferred();
  const second = new FakePack('second', secondLoad);
  const third = new FakePack('third', thirdLoad);
  const manager = new SoundpackManager([first, second, third]);
  await manager.select('first');

  const secondSelection = manager.select('second');
  const thirdSelection = manager.select('third');
  secondLoad.resolve();
  await assert.rejects(secondSelection, /newer soundpack selection/);
  assert.equal(manager.current, first);
  thirdLoad.resolve();
  await thirdSelection;
  assert.equal(manager.current, third);
  assert.equal(first.unloadCalls, 1);
  assert.equal(second.unloadCalls, 1);
});

test('deduplicates repeated in-flight selection of the same pack', async () => {
  const load = deferred();
  const pack = new FakePack('pack', load);
  const manager = new SoundpackManager([pack]);
  const first = manager.select('pack');
  const second = manager.select('pack');
  assert.notEqual(first, second);
  load.resolve();
  await assert.rejects(first, /newer soundpack selection/);
  await second;
  assert.equal(manager.current, pack);
  assert.equal(pack.loadCalls, 1);
});

test('honors a repeated latest choice across overlapping loads', async () => {
  const first = new FakePack('first');
  const secondLoad = deferred();
  const thirdLoad = deferred();
  const second = new FakePack('second', secondLoad);
  const third = new FakePack('third', thirdLoad);
  const manager = new SoundpackManager([first, second, third]);
  await manager.select('first');

  const firstSecondSelection = manager.select('second');
  const thirdSelection = manager.select('third');
  const latestSecondSelection = manager.select('second');
  secondLoad.resolve();
  await assert.rejects(firstSecondSelection, /newer soundpack selection/);
  await latestSecondSelection;
  assert.equal(manager.current, second);
  thirdLoad.resolve();
  await assert.rejects(thirdSelection, /newer soundpack selection/);
  assert.equal(manager.current, second);
  assert.equal(second.loadCalls, 1);
});

test('deduplicates decoded audio and evicts least-recently-used samples', async () => {
  let fetchCalls = 0;
  let clock = 0;
  const cache = new SampleCache({
    context: {
      async decodeAudioData() {
        return { length: 4, numberOfChannels: 1, duration: 0.1 };
      },
    },
    readSourceImpl: async () => null,
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(4),
      };
    },
    budgetBytes: 32,
    now: () => ++clock,
  });
  await cache.load('a.wav');
  await cache.load('a.wav');
  await cache.load('b.wav');
  cache.get('a.wav');
  await cache.load('c.wav');
  assert.equal(fetchCalls, 3);
  assert.equal(cache.has('a.wav'), true);
  assert.equal(cache.has('b.wav'), false);
  assert.equal(cache.has('c.wav'), true);
});

test('loads local file URLs without browser fetch', async () => {
  let readCalls = 0;
  const cache = new SampleCache({
    context: {
      async decodeAudioData() {
        return { length: 2, numberOfChannels: 1, duration: 0.05 };
      },
    },
    fetchImpl: async () => { throw new Error('fetch should not run'); },
    readSourceImpl: async () => {
      readCalls += 1;
      return Buffer.from([1, 2, 3, 4]);
    },
  });
  await cache.load('file:///C:/packs/key.wav');
  assert.equal(readCalls, 1);
});

test('tracks bounded input latency percentiles', () => {
  const tracker = new LatencyTracker(4);
  [1, 2, 3, 4, 100].forEach((value) => tracker.record(value));
  const stats = tracker.getStats();
  assert.equal(stats.samples, 4);
  assert.equal(stats.totalSamples, 5);
  assert.equal(stats.p50Ms, 3);
  assert.equal(stats.p95Ms, 100);
  assert.equal(stats.maxMs, 100);
});

test('converts pitch cents to playback rate', () => {
  assert.equal(centsToPlaybackRate(0), 1);
  assert.equal(centsToPlaybackRate(1200), 2);
  assert.equal(centsToPlaybackRate(-1200), 0.5);
});

test('exposes the canonical v4 manifest module and shared helpers', () => {
  // The engine re-exports must resolve to the same canonical definitions.
  assert.equal(MANIFEST_FORMAT, 4);
  assert.equal(manifestCentsToPlaybackRate(1200), 2);
  assert.equal(manifestCentsToPlaybackRate(undefined), 1);
  assert.equal(manifestClamp(5, 0, 2), 2);
  assert.equal(manifestClamp(-5, 0, 2), 0);
  assert.equal(manifestClamp(1, 0, 2), 1);
  assert.equal(centsToPlaybackRate, manifestCentsToPlaybackRate);
});

test('audio graph applies master*pack gain and switches output device', async () => {
  const appliedGains: number[] = [];
  const parameter = () => ({
    value: 0,
    cancelScheduledValues() {},
    setValueAtTime() {},
    linearRampToValueAtTime() {},
  });
  const masterGainNode = {
    connect() {},
    gain: { value: 1, setValueAtTime: (value: number) => appliedGains.push(value) },
  };
  let currentSink = '';
  const context = {
    currentTime: 0,
    state: 'running',
    destination: {},
    createGain: () => masterGainNode,
    createDynamicsCompressor: () => ({
      connect() {},
      threshold: parameter(),
      knee: parameter(),
      ratio: parameter(),
      attack: parameter(),
      release: parameter(),
    }),
    setSinkId: async (id: string) => {
      currentSink = id;
    },
    get sinkId() {
      return currentSink;
    },
    async close() {
      this.state = 'closed';
    },
    async resume() {},
  };
  const graph = new AudioGraph({ contextFactory: () => context });
  graph.ensureCreated();
  graph.setPackGain(0.5);
  graph.setMasterGain(2); // 2 * 0.5 = 1
  assert.equal(appliedGains.at(-1), 1);
  graph.setPackGain(2); // 2 * 2 = 4, clamped to 2
  assert.equal(appliedGains.at(-1), 2);
  assert.equal(await graph.setOutputDevice('device-1'), 'device-1');
  assert.equal(graph.outputDevice, 'device-1');
  await graph.close();
  assert.equal(graph.contextState, 'not-created');
});

test('audio graph keeps an inaudible signal running so the output never idles', async () => {
  // Regression: after ~30s of digital silence Chromium swaps the real output
  // sink for a timer-driven one. The audio clock then advances at ~0.655x real
  // time while state still reads "running", so voices scheduled at
  // context.currentTime land seconds in the past and surface late and bunched.
  // Measured on Windows; a single sound restores the clock, so the fix is to
  // never be silent.
  const parameter = () => ({
    value: 0,
    cancelScheduledValues() {},
    setValueAtTime() {},
    linearRampToValueAtTime() {},
  });
  const destination = { id: 'destination' };
  const connections: unknown[] = [];
  let started = 0;
  let stopped = 0;
  let channelData: Float32Array | null = null;

  const context = {
    currentTime: 0,
    state: 'running',
    sampleRate: 48000,
    destination,
    createGain: () => ({ connect() {}, gain: parameter() }),
    createDynamicsCompressor: () => ({
      connect() {},
      threshold: parameter(),
      knee: parameter(),
      ratio: parameter(),
      attack: parameter(),
      release: parameter(),
    }),
    createBuffer: (_channels: number, length: number) => {
      channelData = new Float32Array(length);
      return { getChannelData: () => channelData as Float32Array };
    },
    createBufferSource: () => ({
      buffer: null as unknown,
      loop: false,
      connect: (target: unknown) => connections.push(target),
      disconnect() {},
      start: () => {
        started += 1;
      },
      stop: () => {
        stopped += 1;
      },
    }),
    async close() {
      this.state = 'closed';
    },
    async resume() {},
  };

  const graph = new AudioGraph({ contextFactory: () => context });
  graph.ensureCreated();

  assert.equal(started, 1, 'a keep-alive source is started with the graph');
  assert.ok(
    connections.includes(destination),
    'keep-alive goes straight to the destination, so muting cannot idle the stream',
  );

  const data = channelData as unknown as Float32Array;
  assert.ok(data && data.length === 48000, 'one second of buffer is generated');
  assert.ok(
    data.some((sample: number) => sample !== 0),
    'the signal is non-zero, otherwise it still reads as digital silence',
  );
  assert.ok(
    data.every((sample: number) => Math.abs(sample) <= 1e-5),
    'and stays at dither level, far below anything audible',
  );

  await graph.close();
  assert.equal(stopped, 1, 'the keep-alive is stopped with the context');
});

test('voice scheduler reserves one voice and starts the buffer window', () => {
  const starts: unknown[][] = [];
  const parameter = () => ({
    value: 0,
    cancelScheduledValues() {},
    setValueAtTime() {},
    linearRampToValueAtTime() {},
  });
  const node = () => ({ connect() {}, disconnect() {} });
  const context = {
    currentTime: 2,
    createGain: () => ({ ...node(), gain: parameter() }),
    createBufferSource: () => ({
      ...node(),
      buffer: null,
      playbackRate: { value: 1 },
      stop() {},
      start: (...args: unknown[]) => starts.push(args),
      onended: null,
    }),
  };
  const graph = { context, masterNode: node() };
  const pool = new VoicePool(4);
  const scheduler = new VoiceScheduler({ graph, voicePool: pool, random: () => 0.5, now: () => 5 });
  const delay = scheduler.schedule(
    { duration: 0.1 },
    { source: 'a.wav', gain: 1, pitch: 0 },
    {
      samples: [],
      mode: 'round-robin',
      gain: 1,
      pitchVariationCents: 0,
      priority: 5,
      envelope: { attackMs: 0, releaseMs: 10 },
    },
    { type: 'keydown', keycode: 30 },
  );
  assert.equal(starts.length, 1);
  assert.deepEqual(starts[0], [2, 0, 0.1]);
  assert.equal(pool.size, 1);
  assert.equal(delay, 0);
});

test('voice scheduler tolerates a decoded buffer without a duration', () => {
  // Regression for the DecodedBuffer.duration guard: a buffer whose duration is
  // missing must fall back to a finite window rather than start on NaN.
  const starts: unknown[][] = [];
  const parameter = () => ({
    value: 0,
    cancelScheduledValues() {},
    setValueAtTime() {},
    linearRampToValueAtTime() {},
  });
  const node = () => ({ connect() {}, disconnect() {} });
  const context = {
    currentTime: 2,
    createGain: () => ({ ...node(), gain: parameter() }),
    createBufferSource: () => ({
      ...node(),
      buffer: null,
      playbackRate: { value: 1 },
      stop() {},
      start: (...args: unknown[]) => starts.push(args),
      onended: null,
    }),
  };
  const graph = { context, masterNode: node() };
  const scheduler = new VoiceScheduler({ graph, voicePool: new VoicePool(4), random: () => 0.5, now: () => 5 });
  scheduler.schedule(
    {},
    { source: 'a.wav', gain: 1, pitch: 0 },
    { samples: [], mode: 'round-robin', gain: 1, pitchVariationCents: 0, priority: 5, envelope: { attackMs: 0, releaseMs: 10 } },
    { type: 'keydown', keycode: 30 },
  );
  assert.equal(starts.length, 1);
  const [when, offset, duration] = starts[0] as number[];
  assert.equal(when, 2);
  assert.equal(offset, 0);
  assert.ok(Number.isFinite(duration) && duration > 0, 'duration falls back to a finite window');
});

test('audio-engine index exposes the public facade', () => {
  assert.equal(typeof audioEngineIndex.WebAudioEngine, 'function');
  assert.equal(typeof audioEngineIndex.AudioGraph, 'function');
  assert.equal(typeof audioEngineIndex.VoiceScheduler, 'function');
  assert.equal(typeof audioEngineIndex.createAudioManifest, 'function');
  assert.equal(audioEngineIndex.MANIFEST_FORMAT, 4);
});

test('schedules a buffered v3 sound through one Web Audio graph', async () => {
  const starts = [];
  const parameter = () => ({
    value: 0,
    cancelScheduledValues() {},
    setValueAtTime() {},
    linearRampToValueAtTime() {},
  });
  const node = () => ({ connect() {}, disconnect() {} });
  const context = {
    currentTime: 1,
    state: 'running',
    destination: {},
    createGain: () => ({ ...node(), gain: parameter() }),
    createDynamicsCompressor: () => ({
      ...node(),
      threshold: parameter(),
      knee: parameter(),
      ratio: parameter(),
      attack: parameter(),
      release: parameter(),
    }),
    createBufferSource: () => ({
      ...node(),
      playbackRate: { value: 1 },
      stop() {},
      start: (...arguments_: unknown[]) => starts.push(arguments_),
      onended: null,
    }),
    async decodeAudioData() {
      return { length: 4800, numberOfChannels: 1, duration: 0.1 };
    },
    async resume() {},
    async close() { this.state = 'closed'; },
  };
  const engine = new WebAudioEngine({
    contextFactory: () => context,
    readSourceImpl: async () => null,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(4),
    }),
    random: () => 0.5,
    now: () => 1,
  });
  await engine.loadManifest({
    id: 'test',
    name: 'Test',
    maxVoices: 64,
    cacheBudgetBytes: 1024 * 1024,
    preload: 'all',
    gain: 1,
    events: {
      'keydown:30': {
        samples: [{ source: 'a.wav', gain: 1, pitch: 0 }],
        mode: 'round-robin',
        gain: 1,
        pitchVariationCents: 0,
        priority: 5,
        envelope: { attackMs: 0, releaseMs: 10 },
      },
    },
  });
  assert.equal(await engine.play({ type: 'keydown', keycode: 30 }), true);
  assert.equal(starts.length, 1);
  assert.equal(engine.getStats().voices.activeVoices, 1);
  await engine.dispose();
});

test('drops key events while the audio context is suspended instead of queueing them', async () => {
  // Regression: an AudioContext freezes `currentTime` while suspended, so every
  // voice scheduled during that window got `start()` at the same stale time.
  // Nothing was audible, and the moment the context resumed the whole backlog
  // fired at once. Events must be dropped, and the context resumed, instead.
  const starts: unknown[][] = [];
  const parameter = () => ({
    value: 0,
    cancelScheduledValues() {},
    setValueAtTime() {},
    linearRampToValueAtTime() {},
  });
  const node = () => ({ connect() {}, disconnect() {} });
  let resumeCalls = 0;
  const context = {
    currentTime: 1,
    state: 'running',
    destination: {},
    onstatechange: null as null | (() => void),
    createGain: () => ({ ...node(), gain: parameter() }),
    createDynamicsCompressor: () => ({
      ...node(),
      threshold: parameter(),
      knee: parameter(),
      ratio: parameter(),
      attack: parameter(),
      release: parameter(),
    }),
    createBufferSource: () => ({
      ...node(),
      playbackRate: { value: 1 },
      stop() {},
      start: (...arguments_: unknown[]) => starts.push(arguments_),
      onended: null,
    }),
    async decodeAudioData() {
      return { length: 4800, numberOfChannels: 1, duration: 0.1 };
    },
    addEventListener(type: string, listener: () => void) {
      if (type === 'statechange') this.onstatechange = listener;
    },
    removeEventListener() {},
    // The device is still asleep: resume() is accepted but the context does
    // not come back until the OS hands the endpoint over, which is what makes
    // the suspended window last long enough to matter.
    async resume() {
      resumeCalls += 1;
    },
    async close() {
      this.state = 'closed';
    },
  };
  const engine = new WebAudioEngine({
    contextFactory: () => context,
    readSourceImpl: async () => null,
    fetchImpl: async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(4),
    }),
    random: () => 0.5,
    now: () => 1,
  });
  await engine.loadManifest({
    id: 'test',
    name: 'Test',
    maxVoices: 64,
    cacheBudgetBytes: 1024 * 1024,
    preload: 'all',
    gain: 1,
    events: {
      'keydown:30': {
        samples: [{ source: 'a.wav', gain: 1, pitch: 0 }],
        mode: 'round-robin',
        gain: 1,
        pitchVariationCents: 0,
        priority: 5,
        envelope: { attackMs: 0, releaseMs: 10 },
      },
    },
  });

  assert.equal(await engine.play({ type: 'keydown', keycode: 30 }), true);
  assert.equal(starts.length, 1, 'plays normally while running');

  // The output device goes to sleep: the context suspends and its clock stops.
  context.state = 'suspended';
  const frozenTime = context.currentTime;
  resumeCalls = 0;

  for (let index = 0; index < 5; index += 1) {
    assert.equal(
      await engine.play({ type: 'keydown', keycode: 30 }),
      false,
      'keypresses while suspended are reported as not played',
    );
  }

  assert.equal(context.currentTime, frozenTime, 'the context clock really is frozen');
  assert.equal(starts.length, 1, 'no voice is queued against the frozen clock');
  assert.equal(engine.getStats().droppedEvents, 5, 'the dropped events are counted');
  assert.ok(resumeCalls > 0, 'a resume is requested so playback recovers');

  // Once resumed, playback works again with no backlog to flush.
  context.state = 'running';
  context.currentTime = 9;
  assert.equal(await engine.play({ type: 'keydown', keycode: 30 }), true);
  assert.equal(starts.length, 2);
  assert.deepEqual((starts[1] as number[])[0], 9, 'schedules against the live clock');

  await engine.dispose();
});

test('isolates malformed soundpack folders during discovery', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mechvibes-registry-'));
  const official = path.join(root, 'official');
  const custom = path.join(root, 'custom');
  fs.mkdirSync(path.join(official, 'good'), { recursive: true });
  fs.mkdirSync(path.join(custom, 'bad'), { recursive: true });
  fs.writeFileSync(path.join(official, 'good', 'config.json'), JSON.stringify(validV4()));
  fs.writeFileSync(path.join(custom, 'bad', 'config.json'), '{broken');

  class StubConfig {
    constructor(config: any, metadata: any) {
      Object.assign(this, config, metadata);
    }
  }
  const result = discoverSoundpacks({
    officialDirectory: official,
    customDirectory: custom,
    factories: { 3: () => StubConfig, 4: () => StubConfig },
  });
  assert.equal(result.packs.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.packs[0].pack_id, 'default-good');
  fs.rmSync(root, { recursive: true, force: true });
});

test('validates transactional installer manifests and limits', () => {
  const manifest = validateInstallationManifest({
    name: 'Pack',
    folder: 'safe-pack',
    files: ['config.json', 'press/key.wav'],
  });
  assert.equal(manifest.folder, 'safe-pack');
  assert.throws(() => validateInstallationManifest({ name: 'Pack', folder: '../escape', files: ['config.json'] }), /unsafe/);
  assert.throws(() => validateInstallationManifest({ name: 'Pack', folder: 'pack', files: ['script.exe', 'config.json'] }), /Unsupported/);
  assert.throws(() => validateInstallationManifest({ name: 'Pack', folder: 'CON', files: ['config.json'] }), /unsafe on Windows/);
  assert.throws(() => validateInstallationManifest({ name: 'Pack', folder: 'pack', files: ['config.json', 'CONFIG.JSON'] }), /duplicate Windows paths/);
  assert.throws(() => enforceDownloadSize({ fileBytes: 65 * 1024 * 1024, totalBytes: 65 * 1024 * 1024 }), /exceeds/);
});

test('restores the previous installation when replacement fails', () => {
  const createFileSystem = (failMove?: any) => {
    const entries = new Map([
      ['install', 'old'],
      ['temp', 'new'],
    ]);
    return {
      entries,
      existsSync: (entry: string) => entries.has(entry),
      moveSync(source: string, destination: string) {
        if (failMove && failMove(source, destination)) {
          throw new Error('simulated move failure');
        }
        const value = entries.get(source);
        if (value === undefined) {
          throw new Error(`missing ${source}`);
        }
        entries.delete(source);
        entries.set(destination, value);
      },
      removeSync: (entry: string) => entries.delete(entry),
    };
  };

  const failedReplacement = createFileSystem((source: string) => source === 'temp');
  assert.throws(() => commitDirectoryReplacement(failedReplacement, {
    tempDirectory: 'temp',
    installDirectory: 'install',
    backupDirectory: 'backup',
  }), /simulated move failure/);
  assert.equal(failedReplacement.entries.get('install'), 'old');
  assert.equal(failedReplacement.entries.get('temp'), 'new');
  assert.equal(failedReplacement.entries.has('backup'), false);

  const failedBackup = createFileSystem((source: string) => source === 'install');
  assert.throws(() => commitDirectoryReplacement(failedBackup, {
    tempDirectory: 'temp',
    installDirectory: 'install',
    backupDirectory: 'backup',
  }), /simulated move failure/);
  assert.equal(failedBackup.entries.get('install'), 'old');
  assert.equal(failedBackup.entries.get('temp'), 'new');
});

test('stops streamed downloads when the byte limit is exceeded', async () => {
  const makeResponse = (chunks: any[]) => {
    let index = 0;
    let cancelled = false;
    return {
      response: {
        headers: { get: () => null },
        body: {
          getReader: () => ({
            async read() {
              if (index >= chunks.length) {
                return { done: true, value: undefined };
              }
              const value = Uint8Array.from(chunks[index]);
              index += 1;
              return { done: false, value };
            },
            async cancel() { cancelled = true; },
          }),
        },
      },
      wasCancelled: () => cancelled,
    };
  };

  const valid = makeResponse([[1, 2], [3]]);
  assert.deepEqual(await readResponseBuffer(valid.response, 3), Buffer.from([1, 2, 3]));
  const oversized = makeResponse([[1, 2, 3]]);
  await assert.rejects(readResponseBuffer(oversized.response, 2), /exceeds/);
  assert.equal(oversized.wasCancelled(), true);
});

test('latches Ctrl+Shift+M so mute toggles once per key press', () => {
  let toggles = 0;
  const hotkeys = new HotkeyTracker({ onMuteToggle: () => { toggles += 1; } });
  hotkeys.handleKeydown({ keycode: 29 });
  hotkeys.handleKeydown({ keycode: 42 });
  assert.equal(hotkeys.handleKeydown({ keycode: 50 }), true);
  assert.equal(hotkeys.handleKeydown({ keycode: 50 }), false);
  assert.equal(toggles, 1);
  hotkeys.handleKeyup({ keycode: 50 });
  assert.equal(hotkeys.handleKeydown({ keycode: 50 }), true);
  assert.equal(toggles, 2);
});

test('normalizes updater release notes', () => {
  assert.equal(normalizeReleaseNotes('One change'), 'One change');
  assert.equal(normalizeReleaseNotes([{ note: 'First' }, { note: 'Second' }]), 'First\n\nSecond');
  assert.equal(normalizeReleaseNotes(null), '');
});

test('requires consent before downloading and installing updates', async () => {
  const updater = new FakeUpdater();
  const values = new Map();
  const states: any[] = [];
  const service = new UpdateService({
    autoUpdater: updater,
    app: { isPackaged: true, getVersion: () => '2.4.0-beta.2' },
    log: { warn() {} },
    send: (_channel: string, state: any) => states.push(state),
    store: {
      get: (key: string) => values.get(key),
      set: (key: string, value: any) => values.set(key, value),
    },
    timers: {
      setTimeout: () => 1,
      setInterval: () => 2,
      clearTimeout() {},
      clearInterval() {},
    },
  });

  service.start();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(service.getState().channel, 'beta');
  assert.equal(updater.downloadCalls, 0);

  updater.emit('update-available', { version: '2.4.0-beta.3', releaseNotes: 'Faster audio' });
  assert.equal(service.getState().status, 'available');
  assert.equal(updater.downloadCalls, 0);
  await service.download();
  assert.equal(updater.downloadCalls, 1);
  updater.emit('update-downloaded', { version: '2.4.0-beta.3' });
  service.install();
  assert.equal(updater.installCalls, 1);
  assert.deepEqual(updater.installArguments, [false, true]);

  service.applyChannel('stable');
  assert.equal(values.get('mechvibes-update-channel'), 'stable');
  assert.equal(updater.channel, 'latest');
  assert.equal(states.at(-1).channel, 'stable');
  service.stop();
});

test('keeps critical controls keyboard-accessible', () => {
  const root = path.dirname(path.dirname(rendererRoot));
  assert.ok(fs.existsSync(path.join(root, 'package.json')));
  const soundCard = fs.readFileSync(path.join(rendererRoot, 'app', 'components', 'SoundCard.tsx'), 'utf8');
  const soundpackCard = fs.readFileSync(path.join(rendererRoot, 'app', 'components', 'SoundpackCard.tsx'), 'utf8');
  const banners = fs.readFileSync(path.join(rendererRoot, 'app', 'components', 'Banners.tsx'), 'utf8');
  const updatesCard = fs.readFileSync(path.join(rendererRoot, 'app', 'components', 'UpdatesCard.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(rendererRoot, 'styles', 'base.css'), 'utf8');
  assert.match(soundpackCard, /htmlFor="pack-list"/);
  assert.match(soundCard, /<label htmlFor="volume">/);
  assert.match(updatesCard, /<label htmlFor="update-channel">/);
  assert.match(soundCard, /<label htmlFor="output-device">/);
  assert.match(banners, /role="status" aria-live="polite"/);
  assert.ok(fs.existsSync(path.join(rendererRoot, 'app', 'App.tsx')));
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /:focus\s*\{\s*outline:\s*none/);
});

test('ships one React entry point per renderer window', async () => {
  for (const rendererWindow of ['app', 'debug', 'editor', 'install']) {
    const html = fs.readFileSync(path.join(rendererRoot, `${rendererWindow}.html`), 'utf8');
    assert.match(html, /<div id="root"><\/div>/);
    assert.ok(html.includes(`src="./${rendererWindow}/main.tsx"`));
    assert.ok(fs.existsSync(path.join(rendererRoot, rendererWindow, 'main.tsx')));
  }
});

(async () => {
  let failures = 0;
  for (const { name, callback } of tests) {
    try {
      await callback();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }

  console.log(`\n${tests.length - failures}/${tests.length} tests passed.`);
  if (failures > 0) {
    process.exit(1);
  }
})();
