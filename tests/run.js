'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadHowls, loadSharedHowls, withTimeout } = require('../src/libs/soundpacks/audio-loader');
const { SoundpackManager } = require('../src/libs/soundpacks/pack-manager');
const { resolveSoundReference } = require('../src/libs/soundpacks/reference-resolver');
const { discoverSoundpacks } = require('../src/libs/soundpacks/registry');
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
const { calculateAdjustedDisplay, calculateGain } = require('../src/utils/volume');
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

class FakeHowl {
  constructor() {
    this.handlers = new Map();
    this.loaded = false;
    this.unloaded = false;
  }

  state() {
    return this.loaded ? 'loaded' : 'loading';
  }

  once(event, callback) {
    this.handlers.set(event, callback);
  }

  off(event, callback) {
    if (this.handlers.get(event) === callback) {
      this.handlers.delete(event);
    }
  }

  emit(event, ...arguments_) {
    const callback = this.handlers.get(event);
    if (callback) {
      this.handlers.delete(event);
      callback(...arguments_);
    }
  }

  unload() {
    this.unloaded = true;
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

test('waits for all audio resources and unloads all on failure', async () => {
  const first = new FakeHowl();
  const second = new FakeHowl();
  const loading = loadHowls([
    { key: 'first', audio: first },
    { key: 'second', audio: second },
  ], { timeoutMs: 100 });
  first.loaded = true;
  first.emit('load');
  let settled = false;
  loading.then(
    () => { settled = true; },
    () => { settled = true; },
  );
  await Promise.resolve();
  assert.equal(settled, false);
  second.emit('loaderror', null, 'decode failed');
  await assert.rejects(loading, /decode failed/);
  assert.equal(first.unloaded, true);
  assert.equal(second.unloaded, true);
});

test('shares one Howl instance across keys with the same source', async () => {
  let created = 0;
  const audioByKey = await loadSharedHowls({
    'keycode-1': { src: ['same.wav'] },
    'keycode-2': { src: ['same.wav'] },
    'keycode-3': { src: ['other.wav'] },
  }, () => {
    created += 1;
    const audio = new FakeHowl();
    audio.loaded = true;
    return audio;
  });
  assert.equal(created, 2);
  assert.equal(audioByKey['keycode-1'], audioByKey['keycode-2']);
  assert.notEqual(audioByKey['keycode-1'], audioByKey['keycode-3']);
});

test('applies a timeout to stalled audio loading', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 5, 'timed out'), /timed out/);
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

test('keeps critical controls keyboard-accessible', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'assets', 'app.css'), 'utf8');
  assert.match(html, /<button[^>]+id="random-button"/);
  assert.match(html, /<label for="volume">/);
  assert.match(html, /<label for="tray_icon_toggle">/);
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
