import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  commitDirectoryReplacement,
  enforceDownloadSize,
  parseContentLength,
  readResponseBuffer,
  type ReplacementFileSystem,
} from '../src/utils/installer';
import { isWindowEvent, protectWebContents } from '../src/utils/window-security';
import { readProfileBackup } from '../src/services/profile-files';

const replacement = { tempDirectory: 'temp', installDirectory: 'install', backupDirectory: 'backup' };
function fakeFiles() {
  const entries = new Map([['install', 'old'], ['temp', 'new']]);
  const api: ReplacementFileSystem = {
    existsSync: (name) => entries.has(name),
    moveSync(source, destination) {
      if (entries.has(destination)) throw new Error('Destination exists');
      const value = entries.get(source);
      if (value === undefined) throw new Error('Source missing');
      entries.set(destination, value);
      entries.delete(source);
    },
    removeSync(name) { entries.delete(name); },
  };
  return { entries, api };
}

test('backup cleanup failure never rolls back a committed installation', () => {
  const { entries, api } = fakeFiles();
  api.removeSync = (name) => {
    assert.equal(name, 'backup');
    entries.set(name, 'partially deleted old pack');
    throw new Error('Access denied during cleanup');
  };
  assert.doesNotThrow(() => commitDirectoryReplacement(api, replacement));
  assert.equal(entries.get('install'), 'new');
  assert.equal(entries.get('backup'), 'partially deleted old pack');
  assert.equal(entries.has('temp'), false);
});

test('completed backup deletion followed by an error preserves the new pack', () => {
  const { entries, api } = fakeFiles();
  api.removeSync = (name) => {
    entries.delete(name);
    throw new Error('Cleanup failed after deletion');
  };
  assert.doesNotThrow(() => commitDirectoryReplacement(api, replacement));
  assert.equal(entries.get('install'), 'new');
});

test('failed promotion still restores the previous complete installation', () => {
  const { entries, api } = fakeFiles();
  const move = api.moveSync;
  api.moveSync = (source, destination, options) => {
    if (source === 'temp') throw new Error('Promotion failed');
    move(source, destination, options);
  };
  assert.throws(() => commitDirectoryReplacement(api, replacement), /Promotion failed/);
  assert.equal(entries.get('install'), 'old');
  assert.equal(entries.get('temp'), 'new');
  assert.equal(entries.has('backup'), false);
});

test('normal replacement and first installation both commit successfully', () => {
  for (const existing of [true, false]) {
    const { entries, api } = fakeFiles();
    if (!existing) entries.delete('install');
    commitDirectoryReplacement(api, replacement);
    assert.deepEqual([...entries], [['install', 'new']]);
  }
});

test('unstreamable responses are rejected without calling arrayBuffer', async () => {
  let allocated = false;
  const response = {
    headers: { get: () => '1' },
    arrayBuffer: async () => { allocated = true; return new ArrayBuffer(1); },
  };
  await assert.rejects(readResponseBuffer(response, 4), /streaming/);
  assert.equal(allocated, false);
});

test('invalid response limits fail before acquiring or reading a stream', async () => {
  for (const limit of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    let acquired = false;
    const response = {
      body: { getReader() { acquired = true; throw new Error('Unexpected read'); } },
      arrayBuffer: async () => new ArrayBuffer(0),
    };
    await assert.rejects(readResponseBuffer(response, limit), /Invalid response byte limit/);
    assert.equal(acquired, false);
  }
});

test('bodyless responses and exact-size streaming responses remain supported', async () => {
  assert.deepEqual(await readResponseBuffer(new Response(null, { status: 204 }), 0), Buffer.alloc(0));
  const response = new Response(new Uint8Array([1, 2, 3]));
  assert.deepEqual(await readResponseBuffer(response, 3), Buffer.from([1, 2, 3]));
  assert.equal(response.body!.locked, false);
});

test('oversized chunks are rejected before copying and preserve the size error', async (t) => {
  const payload = new Uint8Array(8);
  let canceled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(payload); },
    cancel() { canceled = true; throw new Error('Cancellation failed'); },
  }));
  const original = Buffer.from;
  let copied = false;
  const copy = t.mock.method(Buffer, 'from', ((...args: any[]) => {
    if (args[0] === payload) copied = true;
    return (original as any)(...args);
  }) as typeof Buffer.from);
  try {
    await assert.rejects(readResponseBuffer(response, 4), /exceeds/);
    assert.equal(copied, false);
    assert.equal(canceled, true);
    assert.equal(response.body!.locked, false);
  } finally { copy.mock.restore(); }
});

test('a lying Content-Length cannot bypass the streamed limit', async () => {
  const response = new Response(new Uint8Array(5), { headers: { 'content-length': '1' } });
  await assert.rejects(readResponseBuffer(response, 4), /exceeds/);
  assert.equal(response.body!.locked, false);
});

test('content length accepts only safe unsigned decimal integers', () => {
  const parse = (value: string) => parseContentLength({
    headers: { get: () => value },
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  for (const value of ['', ' ', '-1', '+1', '1.5', '1e3', '0x10', 'Infinity', '9007199254740992']) {
    assert.equal(parse(value), null, value);
  }
  assert.equal(parse('0'), 0);
  assert.equal(parse('123'), 123);
  assert.equal(parseContentLength(null), null);
});

test('download accounting rejects invalid or inconsistent counters', () => {
  for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => enforceDownloadSize({ fileBytes: value, totalBytes: value }), /Invalid/);
  }
  assert.throws(() => enforceDownloadSize({ fileBytes: 2, totalBytes: 1 }), /Invalid/);
  assert.doesNotThrow(() => enforceDownloadSize({ fileBytes: 0, totalBytes: 0 }));
});

test('IPC fails closed for missing or disposed frames without throwing', () => {
  const sender: any = { mainFrame: null, isDestroyed: () => false };
  const window: any = { webContents: sender, isDestroyed: () => false };
  assert.equal(isWindowEvent({ sender, senderFrame: null }, window), false);
  const event = { sender, get senderFrame(): never { throw new Error('Frame disposed'); } };
  assert.equal(isWindowEvent(event, window), false);
  const frame = {};
  sender.mainFrame = frame;
  assert.equal(isWindowEvent({ sender, senderFrame: frame } as any, window), true);
  assert.equal(isWindowEvent({ sender, senderFrame: {} } as any, window), false);
  Object.defineProperty(sender, 'mainFrame', { get() { throw new Error('Contents disposed'); } });
  assert.equal(isWindowEvent({ sender, senderFrame: frame } as any, window), false);
});

test('navigation policy also prevents subframe navigation', () => {
  const handlers = new Map<string, (event: { preventDefault(): void }) => void>();
  let popup: (() => { action: string }) | undefined;
  protectWebContents({
    on: (name: string, callback: (event: { preventDefault(): void }) => void) => handlers.set(name, callback),
    setWindowOpenHandler: (callback: () => { action: string }) => { popup = callback; },
  } as any);
  assert.deepEqual(popup!(), { action: 'deny' });
  for (const event of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    let prevented = false;
    handlers.get(event)?.({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true, event);
  }
});

test('profile reader still accepts regular files and rejects malformed and oversized input', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mechvibes-profile-security-'));
  try {
    const file = path.join(root, 'profiles.json');
    const fd = fs.openSync(file, 'wx');
    try {
      fs.writeSync(fd, JSON.stringify({ format: 'mechvibes-profiles', version: 1, profiles: [] }));
      assert.deepEqual(await readProfileBackup(file), []);
      fs.ftruncateSync(fd, 0);
      await assert.rejects(readProfileBackup(file), SyntaxError);
      fs.ftruncateSync(fd, 65537);
      await assert.rejects(readProfileBackup(file), /64 KiB/);
    } finally { fs.closeSync(fd); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('profile FIFO import rejects promptly without requiring a writer', { skip: process.platform === 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mechvibes-fifo-security-'));
  try {
    const fifo = path.join(root, 'profiles.json');
    execFileSync('mkfifo', [fifo]);
    // An isolated child with an OS timeout makes regression failure bounded:
    // an accidentally blocking open cannot hang the whole test runner.
    const child = spawnSync(process.execPath, ['-e', `
      require(process.argv[1]).readProfileBackup(process.argv[2])
        .then(() => process.exit(2), error => process.exit(/not a file/.test(error.message) ? 0 : 3));
    `, require.resolve('../src/services/profile-files'), fifo], { timeout: 5000, encoding: 'utf8' });
    assert.equal(child.error, undefined, String(child.error));
    assert.equal(child.status, 0, child.stderr);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
