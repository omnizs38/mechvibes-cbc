'use strict';

const assert = require('assert').strict;
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LatencyTracker } = require('../src/audio-engine/latency-tracker');
const { createAudioManifest } = require('../src/audio-engine/manifest-adapter');
const { SampleCache } = require('../src/audio-engine/sample-cache');
const { SampleSelector } = require('../src/audio-engine/sample-selector');
const { VoicePool } = require('../src/audio-engine/voice-pool');
const { WebAudioEngine, centsToPlaybackRate } = require('../src/audio-engine/web-audio-engine');
const { SoundpackManager } = require('../src/libs/soundpacks/pack-manager');
const { keycodesRemap } = require('../src/libs/keycodes');
const { resolveSoundReference } = require('../src/libs/soundpacks/reference-resolver');
const { discoverSoundpacks, verifySoundpackChecksums } = require('../src/libs/soundpacks/registry');
const {
  expandNumberTemplate,
  expandNumberTemplateVariants,
  listReferencedSoundFiles,
  normalizeSoundReference,
  validateSoundpackConfig,
} = require('../src/libs/soundpacks/validation');
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
const { runRendererSmoke } = require('./renderer-smoke');

const tests = [];
function test(name, callback) {
  tests.push({ name, callback });
}

function validV1(overrides = {}) {
  return {
    name: 'Test pack',
    key_define_type: 'single',
    includes_numpad: false,
    sound: 'sound.ogg',
    defines: { 1: [0, 100] },
    ...overrides,
  };
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakePack {
  constructor(id, load = null) {
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

  quitAndInstall(isSilent, forceRunAfter) {
    this.installCalls += 1;
    this.installArguments = [isSilent, forceRunAfter];
  }
}

test('validates bundled v1 and v2 shapes', () => {
  assert.equal(validateSoundpackConfig(validV1()).version, 1);
  const v2 = validateSoundpackConfig({
    name: 'V2',
    version: 2,
    key_define_type: 'multi',
    sound: 'press/key_{0-4}.mp3',
    soundup: 'release/key.mp3',
    defines: { 1: 'press/key_1.mp3', '1-up': 'release/key.mp3' },
  });
  assert.equal(v2.version, 2);
  const metadata = { pack_id: 'default-test', abs_path: '/pack' };
  const getFile = (_packPath, file) => `file:///pack/${file}`;
  const v1Manifest = createAudioManifest(validateSoundpackConfig(validV1()), metadata, { getFile });
  assert.equal(v1Manifest.events['keydown:1'].samples[0].durationSeconds, 0.1);
  const v2Manifest = createAudioManifest(v2, metadata, { getFile });
  assert.equal(v2Manifest.events['keydown:1'].samples.length, 1);
  assert.equal(v2Manifest.events['keyup:1'].samples.length, 1);
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
    getFile: (_packPath, file) => `data:audio/mock,${file}`,
  });
  assert.equal(manifest.version, 3);
  assert.equal(manifest.events['keydown:30'].samples.length, 2);
  assert.equal(manifest.events['keyup:30'].samples[0].file, 'release/a.flac');
  assert.throws(() => validateSoundpackConfig(validV3({
    defaults: { keydown: { samples: ['unsafe/../sound.wav'] } },
  })), /unsafe/);
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
  assert.throws(() => validateSoundpackConfig(validV1({ sound: '../outside.wav' })), /unsafe/);
  assert.throws(() => validateSoundpackConfig(validV1({ version: 99 })), /Unsupported/);
  assert.throws(() => validateSoundpackConfig(validV1({ defines: { key: [0, 1] } })), /invalid key/);
  assert.throws(() => validateSoundpackConfig(validV1({ defines: { 1: [0, 0] } })), /invalid start or duration/);
  assert.throws(() => normalizeSoundReference('C:/secret.wav'), /relative/);
  assert.throws(() => normalizeSoundReference('CON.wav'), /unsafe on Windows/);
  assert.throws(() => normalizeSoundReference('folder/./sound.wav'), /unsafe on Windows/);
  assert.equal(normalizeSoundReference('./sound.wav'), 'sound.wav');
});

test('expands bounded number templates deterministically', () => {
  assert.equal(expandNumberTemplate('press/key_{0-4}.mp3', () => 0), 'press/key_0.mp3');
  assert.equal(expandNumberTemplate('press/key_{0-4}.mp3', () => 0.9999), 'press/key_4.mp3');
  assert.deepEqual(expandNumberTemplateVariants('press/key_{1-3}.mp3'), [
    'press/key_1.mp3',
    'press/key_2.mp3',
    'press/key_3.mp3',
  ]);
  const references = listReferencedSoundFiles({
    name: 'V2',
    version: 2,
    key_define_type: 'multi',
    sound: 'press/key_{0-1}.mp3',
    soundup: 'release/key.mp3',
    defines: { 1: 'press/special.mp3' },
  });
  assert.deepEqual(new Set(references), new Set([
    'press/key_0.mp3',
    'press/key_1.mp3',
    'release/key.mp3',
    'press/special.mp3',
  ]));
  assert.deepEqual(listReferencedSoundFiles({
    name: 'Legacy multi',
    key_define_type: 'multi',
    sound: 'unused.ogg',
    defines: { 1: 'key.wav' },
  }), ['key.wav']);
});

test('falls back when an explicit v2 sound file is missing', () => {
  const loaded = [];
  const value = resolveSoundReference(
    'press/missing.mp3',
    'press/generic_{0-1}.mp3',
    (reference) => {
      loaded.push(reference);
      if (reference === 'press/missing.mp3') {
        throw new Error('missing');
      }
      return reference;
    },
    () => 0,
  );
  assert.equal(value, 'press/generic_0.mp3');
  assert.deepEqual(loaded, ['press/missing.mp3', 'press/generic_0.mp3']);
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

test('selects v3 samples without immediate repeats', () => {
  const selector = new SampleSelector(() => 0);
  const samples = ['a', 'b', 'c'];
  assert.equal(selector.choose('keydown:30', samples, 'round-robin'), 'a');
  assert.equal(selector.choose('keydown:30', samples, 'round-robin'), 'b');
  assert.equal(selector.choose('keydown:30', samples, 'random'), 'a');
  assert.notEqual(selector.choose('keydown:30', samples, 'random'), 'a');
});

test('enforces the voice budget by stealing the oldest low-priority voice', () => {
  const stopped = [];
  const makeSource = (name) => ({ stop: () => stopped.push(name), onended: null });
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
      start: (...arguments_) => starts.push(arguments_),
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

test('isolates malformed soundpack folders during discovery', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mechvibes-registry-'));
  const official = path.join(root, 'official');
  const custom = path.join(root, 'custom');
  fs.mkdirSync(path.join(official, 'good'), { recursive: true });
  fs.mkdirSync(path.join(custom, 'bad'), { recursive: true });
  fs.writeFileSync(path.join(official, 'good', 'config.json'), JSON.stringify(validV1()));
  fs.writeFileSync(path.join(custom, 'bad', 'config.json'), '{broken');

  class StubConfig {
    constructor(config, metadata) {
      Object.assign(this, config, metadata);
    }
  }
  const result = discoverSoundpacks({
    officialDirectory: official,
    customDirectory: custom,
    factories: { 1: () => StubConfig, 2: () => StubConfig },
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
  const createFileSystem = (failMove) => {
    const entries = new Map([
      ['install', 'old'],
      ['temp', 'new'],
    ]);
    return {
      entries,
      existsSync: (entry) => entries.has(entry),
      moveSync(source, destination) {
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
      removeSync: (entry) => entries.delete(entry),
    };
  };

  const failedReplacement = createFileSystem((source) => source === 'temp');
  assert.throws(() => commitDirectoryReplacement(failedReplacement, {
    tempDirectory: 'temp',
    installDirectory: 'install',
    backupDirectory: 'backup',
  }), /simulated move failure/);
  assert.equal(failedReplacement.entries.get('install'), 'old');
  assert.equal(failedReplacement.entries.get('temp'), 'new');
  assert.equal(failedReplacement.entries.has('backup'), false);

  const failedBackup = createFileSystem((source) => source === 'install');
  assert.throws(() => commitDirectoryReplacement(failedBackup, {
    tempDirectory: 'temp',
    installDirectory: 'install',
    backupDirectory: 'backup',
  }), /simulated move failure/);
  assert.equal(failedBackup.entries.get('install'), 'old');
  assert.equal(failedBackup.entries.get('temp'), 'new');
});

test('stops streamed downloads when the byte limit is exceeded', async () => {
  const makeResponse = (chunks) => {
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
  const states = [];
  const service = new UpdateService({
    autoUpdater: updater,
    app: { isPackaged: true, getVersion: () => '2.4.0-beta.2' },
    log: { warn() {} },
    send: (_channel, state) => states.push(state),
    store: {
      get: (key) => values.get(key),
      set: (key, value) => values.set(key, value),
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
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'assets', 'app.css'), 'utf8');
  assert.match(html, /<button[^>]+id="random-button"/);
  assert.match(html, /<label for="volume"[^>]*>/);
  assert.match(html, /<label for="tray_icon_toggle"[^>]*>/);
  assert.match(html, /<label for="output-device"[^>]*>/);
  assert.match(html, /id="check-updates-button"/);
  assert.match(html, /id="app-status"[^>]+aria-live="polite"/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /\.checkbox:focus\s*\{\s*outline:\s*none/);
});

test('starts the renderer and loads the initial bundled soundpack once', async () => {
  await runRendererSmoke(path.resolve(__dirname, '..'));
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
