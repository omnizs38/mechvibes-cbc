import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Zip from 'adm-zip';
import { SampleCache } from '../src/audio-engine/sample-cache';
import { readResponseBuffer } from '../src/utils/installer';
import { filterPacks, readFavoriteIds } from '../src/utils/pack-library';
import { isWindowEvent, protectWebContents, safeExternalUrl } from '../src/utils/window-security';
import {
  GetFileFromArchive,
  GetFileFromFolder,
  ReadSoundpackSource,
  ClearSoundpackCache,
} from '../src/libs/soundpacks/file-manager';
import { listSoundpackCandidates, readSoundpackConfig } from '../src/libs/soundpacks/registry';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const audio = { length: 8, numberOfChannels: 1 };
const context = { decodeAudioData: async () => audio };
function temporary(run: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mechvibes-regression-'));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('external links accept only ordinary HTTP(S) URLs', () => {
  assert.equal(
    safeExternalUrl('https://github.com/omnizs38/mechvibes-cbc'),
    'https://github.com/omnizs38/mechvibes-cbc',
  );
  for (const input of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,test',
    'ms-settings:test',
    'https://user:password@host.test',
    'https://host.test\n',
    {},
    null,
    'x'.repeat(5000),
  ]) {
    assert.equal(safeExternalUrl(input), null);
  }
});

test('IPC accepts only the owning window main frame', () => {
  const mainFrame = {};
  const sender = { mainFrame, isDestroyed: () => false };
  const window = { webContents: sender, isDestroyed: () => false };
  assert.equal(isWindowEvent({ sender, senderFrame: mainFrame } as any, window as any), true);
  assert.equal(isWindowEvent({ sender, senderFrame: {} } as any, window as any), false);
  assert.equal(isWindowEvent({ sender, senderFrame: mainFrame } as any, null), false);
  assert.equal(isWindowEvent({ sender: { ...sender }, senderFrame: mainFrame } as any, window as any), false);
  assert.equal(
    isWindowEvent({ sender, senderFrame: mainFrame } as any, { ...window, isDestroyed: () => true } as any),
    false,
  );
});

test('window policy denies popups, navigation, redirects and webviews', () => {
  const handlers = new Map<string, (event: any) => void>();
  let open!: () => { action: string };
  protectWebContents({
    setWindowOpenHandler: (fn: typeof open) => {
      open = fn;
    },
    on: (name: string, fn: (event: any) => void) => handlers.set(name, fn),
  } as any);
  assert.deepEqual(open(), { action: 'deny' });
  for (const name of ['will-navigate', 'will-redirect', 'will-attach-webview']) {
    let prevented = false;
    handlers.get(name)!({
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true, name);
  }
});

test('a cleared asynchronous decode cannot refill the cache', async () => {
  const decoding = deferred<typeof audio>();
  const cache = new SampleCache({
    context: { decodeAudioData: () => decoding.promise },
    readSourceImpl: () => new Uint8Array(1),
  });
  const loading = cache.load('sample');
  await Promise.resolve();
  cache.clear();
  decoding.resolve(audio);
  await loading;
  assert.deepEqual(cache.getStats(), { entries: 0, pending: 0, totalBytes: 0, budgetBytes: cache.budgetBytes });
});

test('old cleared request cannot delete a replacement in-flight request', async () => {
  const old = deferred<Uint8Array>();
  const next = deferred<Uint8Array>();
  let reads = 0;
  const cache = new SampleCache({ context, readSourceImpl: () => (++reads === 1 ? old.promise : next.promise) });
  const first = cache.load('same');
  cache.clear();
  const second = cache.load('same');
  old.resolve(new Uint8Array(1));
  await first;
  assert.equal(cache.getStats().pending, 1);
  const third = cache.load('same');
  assert.equal(reads, 2);
  next.resolve(new Uint8Array(1));
  await Promise.all([second, third]);
  assert.equal(cache.totalBytes, 32);
});

test('concurrent pinned requests promote the shared sample', async () => {
  const source = deferred<Uint8Array>();
  const cache = new SampleCache({ context, readSourceImpl: () => source.promise, budgetBytes: 1 });
  const first = cache.load('pinned');
  const second = cache.load('pinned', { pinned: true });
  source.resolve(new Uint8Array(1));
  await Promise.all([first, second]);
  cache.clear({ includePinned: false });
  assert.equal(cache.has('pinned'), true);
});

test('failed sample loads can be retried', async () => {
  let calls = 0;
  const cache = new SampleCache({
    context,
    readSourceImpl: () => {
      if (++calls === 1) throw new Error('disk unavailable');
      return new Uint8Array(1);
    },
  });
  await assert.rejects(cache.load('retry'), /disk unavailable/);
  assert.equal(cache.getStats().pending, 0);
  await cache.load('retry');
  assert.equal(cache.has('retry'), true);
});

test('preload bounds concurrency and preserves deduplicated source order', async () => {
  let active = 0;
  let maximum = 0;
  const cache = new SampleCache({
    context: { decodeAudioData: async (bytes) => ({ length: new Uint8Array(bytes)[0], numberOfChannels: 1 }) },
    readSourceImpl: async (source) => {
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return new Uint8Array([Number(source)]);
    },
  });
  const result = await cache.preload(['1', '2', '1', '3', '4', '5', '6', '7', '8', '9']);
  assert.ok(maximum <= 4);
  assert.deepEqual(
    result.map((buffer) => buffer.length),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
});

test('clear stops queued preload workers from loading additional samples', async () => {
  const source = deferred<Uint8Array>();
  let reads = 0;
  const cache = new SampleCache({
    context,
    readSourceImpl: () => {
      reads++;
      return source.promise;
    },
  });
  const preloading = cache.preload(['1', '2', '3', '4', '5', '6']);
  cache.clear();
  source.resolve(new Uint8Array(1));
  await assert.rejects(preloading, /cleared/);
  assert.equal(reads, 4);
  assert.equal(cache.getStats().entries, 0);
});

test('audio downloads stop at the streaming byte limit without decoding', async () => {
  let canceled = false;
  let decoded = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(3));
    },
    cancel() {
      canceled = true;
    },
  });
  const cache = new SampleCache({
    context: {
      decodeAudioData: async () => {
        decoded = true;
        return audio;
      },
    },
    readSourceImpl: () => null,
    fetchImpl: async () => ({
      ok: true,
      body,
      arrayBuffer: async () => {
        throw new Error('must stream');
      },
    }),
    maxSampleBytes: 4,
  });
  await assert.rejects(cache.load('https://example.test/sample'), /byte limit/);
  assert.equal(canceled, true);
  assert.equal(decoded, false);
  assert.equal(body.locked, false);
});

test('response reader releases stream locks on success and errors', async () => {
  const good = new Response(new Uint8Array([1, 2]));
  assert.deepEqual(await readResponseBuffer(good, 3), Buffer.from([1, 2]));
  assert.equal(good.body!.locked, false);
  const bad = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error('connection lost'));
      },
    }),
  );
  await assert.rejects(readResponseBuffer(bad, 3), /connection lost/);
  assert.equal(bad.body!.locked, false);
});

const packs = [
  { pack_id: 'default-blue', name: 'Cherry Blue', group: 'Default' },
  { pack_id: 'custom-red', name: 'Cherry Red', group: 'Custom' },
];
test('library matches multiple terms across names, groups and IDs', () => {
  assert.deepEqual(filterPacks(packs, { query: ' CHERRY  custom ' }), [packs[1]]);
  assert.deepEqual(filterPacks(packs, { query: 'default-blue' }), [packs[0]]);
  assert.deepEqual(filterPacks(packs, { query: 'missing' }), []);
  assert.deepEqual(filterPacks(packs), packs);
});
test('favorites filter composes with search without retaining nonmatches', () => {
  assert.deepEqual(filterPacks(packs, { favorites: ['custom-red'], favoritesOnly: true }), [packs[1]]);
  assert.deepEqual(filterPacks(packs, { query: 'blue', favorites: ['custom-red'], favoritesOnly: true }), []);
});
test('favorite settings reject corrupt data and deduplicate identifiers', () => {
  assert.deepEqual(readFavoriteIds('corrupt'), []);
  assert.deepEqual(readFavoriteIds(['id', null, {}, '', 'id', 'x'.repeat(513)]), ['id']);
  assert.equal(readFavoriteIds(Array.from({ length: 1200 }, (_, i) => `${i}`)).length, 1000);
});

test('local audio edits are not hidden by a stale base64 cache', () =>
  temporary((root) => {
    const target = path.join(root, 'sound.wav');
    fs.writeFileSync(target, 'first');
    assert.match(GetFileFromFolder(root, 'sound.wav')!, /Zmlyc3Q=$/);
    fs.writeFileSync(target, 'second');
    assert.match(GetFileFromFolder(root, 'sound.wav')!, /c2Vjb25k$/);
  }));

test('ZIP updates at the same path invalidate audio/config data', () =>
  temporary((root) => {
    const target = path.join(root, 'pack.zip');
    const write = (name: string) => {
      const zip = new Zip();
      zip.addFile('config.json', Buffer.from(JSON.stringify({ name })));
      zip.writeZip(target);
    };
    write('before');
    assert.equal(JSON.parse(GetFileFromArchive(target, 'config.json')!).name, 'before');
    write('after with different length');
    assert.equal(JSON.parse(GetFileFromArchive(target, 'config.json')!).name, 'after with different length');
    ClearSoundpackCache(target);
  }));

test('ZIPs reject duplicate case-insensitive paths', () =>
  temporary((root) => {
    const target = path.join(root, 'duplicate.zip');
    const zip = new Zip();
    zip.addFile('config.json', Buffer.from('{}'));
    zip.addFile('CONFIG.JSON', Buffer.from('{}'));
    zip.writeZip(target);
    assert.throws(() => GetFileFromArchive(target, 'config.json'), /Duplicate archive path/);
  }));

test('folder config has a one-MiB read limit', () =>
  temporary((root) => {
    const target = path.join(root, 'config.json');
    fs.writeFileSync(target, ' '.repeat(1024 * 1024 + 1));
    assert.throws(() => readSoundpackConfig(root), /byte limit/);
  }));

test('discovery ignores hidden and interrupted transaction directories', () =>
  temporary((root) => {
    for (const name of ['normal', '.install-pack', 'pack.backup-123']) fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, 'sound.import-123.zip'), '');
    assert.deepEqual(
      listSoundpackCandidates(root).map((name) => path.basename(name)),
      ['normal'],
    );
  }));

test('local source reader rejects oversized files before allocating payload', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mechvibes-large-'));
  try {
    const target = path.join(root, 'large.wav');
    // Keep mutations bound to the same exclusively created file. Reopening
    // its path after the reader's stat check creates a check/use race.
    const descriptor = fs.openSync(target, 'wx+');
    try {
      fs.ftruncateSync(descriptor, 64 * 1024 * 1024 + 1);
      await assert.rejects(ReadSoundpackSource(pathToFileURL(target).href), /byte limit/);
      fs.ftruncateSync(descriptor, 0);
      fs.writeSync(descriptor, 'audio', 0, 'utf8');
      assert.deepEqual(await ReadSoundpackSource(pathToFileURL(target).href), Buffer.from('audio'));
    } finally {
      fs.closeSync(descriptor);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('all renderer windows use the existing shared preload and absolute paths', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.ts'), 'utf8');
  assert.equal((main.match(/preload: path.join\(__dirname, 'preload.js'\)/g) ?? []).length, 4);
  for (const window of ['app', 'debug', 'editor', 'install']) {
    assert.ok(main.includes(`path.join(__dirname, 'renderer-dist', '${window}.html')`));
    const html = fs.readFileSync(path.join(__dirname, `../src/renderer/${window}.html`), 'utf8');
    assert.match(html, /script-src 'self' file:;/);
    assert.match(html, /object-src 'none'/);
    assert.match(html, /frame-src 'none'/);
  }
});
