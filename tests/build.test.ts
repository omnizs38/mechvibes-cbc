import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareWindowsRuntime, sha256File, runtimePin } from '../tools/prepare-windows-runtime';
import { writeChecksums } from '../tools/release-metadata';
import { cleanDist } from '../tools/clean-dist';

async function temporary(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mechvibes-build-'));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
const payload = Buffer.from('verified runtime fixture');
const pin = {
  version: '14.44.35211.0',
  url: 'https://download.visualstudio.microsoft.com/runtime.exe',
  sha256: crypto.createHash('sha256').update(payload).digest('hex'),
  bytes: payload.length,
};
const fakeFetch = (body = payload) => (async () => new Response(body)) as typeof fetch;

test('runtime pin uses immutable Microsoft URL and matching version/hash', () => {
  assert.match(runtimePin.url, /^https:\/\/download\.visualstudio\.microsoft\.com\/download\/pr\//);
  assert.match(runtimePin.sha256, /^[a-f0-9]{64}$/);
  assert.match(runtimePin.version, /^14\.\d+\.\d+\.\d+$/);
});

test('runtime download is verified and cache reuse does not access the network', () =>
  temporary(async (root) => {
    let verified = 0;
    const signature = () => {
      verified++;
    };
    const first = await prepareWindowsRuntime(root, pin, fakeFetch(), signature);
    assert.equal(await sha256File(first), pin.sha256);
    const second = await prepareWindowsRuntime(
      root,
      pin,
      (async () => {
        throw new Error('must not fetch');
      }) as typeof fetch,
      signature,
    );
    assert.equal(second, first);
    assert.equal(verified, 2);
  }));

test('runtime hash mismatch leaves no usable payload or temporary files', () =>
  temporary(async (root) => {
    await assert.rejects(
      prepareWindowsRuntime(root, { ...pin, sha256: '0'.repeat(64) }, fakeFetch(), () => {}),
      /mismatch/,
    );
    assert.deepEqual(await fs.readdir(root), []);
  }));

test('oversized runtime downloads are stopped and removed', () =>
  temporary(async (root) => {
    await assert.rejects(
      prepareWindowsRuntime(root, pin, fakeFetch(Buffer.alloc(pin.bytes + 1)), () => {}),
      /exceeds/,
    );
    assert.deepEqual(await fs.readdir(root), []);
  }));

test('runtime signature rejection does not populate the cache', () =>
  temporary(async (root) => {
    await assert.rejects(
      prepareWindowsRuntime(root, pin, fakeFetch(), () => {
        throw new Error('signature rejected');
      }),
      /signature rejected/,
    );
    assert.deepEqual(await fs.readdir(root), []);
  }));

test('tampered cache fails closed rather than silently downloading a replacement', () =>
  temporary(async (root) => {
    await fs.writeFile(path.join(root, 'vc_redist.x64.exe'), 'tampered');
    await assert.rejects(
      prepareWindowsRuntime(root, pin, fakeFetch(), () => {}),
      /Cached Runtime checksum mismatch/,
    );
  }));

test('invalid runtime pins fail before downloading', () =>
  temporary(async (root) => {
    for (const bad of [
      { ...pin, url: 'https://example.com/runtime.exe' },
      { ...pin, bytes: 1e10 },
      { ...pin, version: 'bad"' },
    ]) {
      await assert.rejects(
        prepareWindowsRuntime(root, bad, fakeFetch(), () => {}),
        /Invalid pinned/,
      );
    }
  }));

test('checksums include SBOM and installers, exclude debug files, and overwrite on rerun', () =>
  temporary(async (root) => {
    for (const name of ['Mechvibes.exe', 'sbom.cdx.json', 'latest.yml', 'builder-debug.yml'])
      await fs.writeFile(path.join(root, name), name);
    assert.deepEqual(await writeChecksums(root), ['Mechvibes.exe', 'latest.yml', 'sbom.cdx.json']);
    const first = await fs.readFile(path.join(root, 'SHA256SUMS.txt'), 'utf8');
    await writeChecksums(root);
    assert.equal(await fs.readFile(path.join(root, 'SHA256SUMS.txt'), 'utf8'), first);
    assert.match(first, /sbom\.cdx\.json/);
    assert.doesNotMatch(first, /builder-debug/);
  }));

test('release metadata refuses to describe a release without installers', () =>
  temporary(async (root) => {
    await fs.writeFile(path.join(root, 'sbom.cdx.json'), '{}');
    await assert.rejects(writeChecksums(root), /No distributable installers/);
  }));

test('cleanDist only cleans the explicitly resolved project output', () =>
  temporary(async (root) => {
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, 'dist', 'old.exe'), 'old');
    await fs.writeFile(path.join(root, 'keep.txt'), 'keep');
    await cleanDist(root);
    assert.deepEqual(await fs.readdir(path.join(root, 'dist')), []);
    assert.equal(await fs.readFile(path.join(root, 'keep.txt'), 'utf8'), 'keep');
  }));

test('NSIS embeds pinned runtime before app installation without forced user scope', async () => {
  const installer = await fs.readFile(path.join(__dirname, '../build/installer.nsh'), 'utf8');
  assert.match(installer, /Section "-Visual C\+\+ Runtime"/);
  assert.match(installer, /StdUtils.HashFile/);
  assert.match(installer, /SetErrorLevel 740/);
  assert.match(installer, /SetErrorLevel 1603/);
  assert.match(installer, /3010/);
  assert.match(installer, /SetRebootFlag true/);
  assert.doesNotMatch(installer, /inetc::get|SetShellVarContext all/);
});
