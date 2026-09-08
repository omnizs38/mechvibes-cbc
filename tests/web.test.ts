import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
const modulePromise = fs
  .readFile(path.join(__dirname, '../public/github.js'), 'utf8')
  .then((source) => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
const url = 'https://github.com/omnizs38/mechvibes-cbc/releases';
const stable = {
  tag_name: 'v2.5.3',
  name: 'Stable',
  draft: false,
  prerelease: false,
  body: 'Notes',
  published_at: '2026-08-01T00:00:00Z',
  html_url: `${url}/tag/v2.5.3`,
  assets: [
    {
      name: 'Mechvibes-2.5.3-x64.exe',
      size: 1024,
      browser_download_url: `${url}/download/v2.5.3/Mechvibes-2.5.3-x64.exe`,
    },
    { name: 'SHA256SUMS.txt', size: 120, browser_download_url: `${url}/download/v2.5.3/SHA256SUMS.txt` },
  ],
};
test('site prefers a stable release over a newer beta', async () => {
  const { selectReleases } = await modulePromise;
  const beta = { ...stable, tag_name: 'v3.0.0-beta.1', prerelease: true, published_at: '2026-09-01T00:00:00Z' };
  assert.equal(selectReleases([beta, stable]).latest.tag_name, stable.tag_name);
  assert.equal(selectReleases([beta, stable]).preview.tag_name, beta.tag_name);
});
test('site excludes drafts and malformed release data', async () => {
  const { selectReleases, normalizeRelease } = await modulePromise;
  assert.equal(selectReleases([{ ...stable, draft: true }]).latest, null);
  assert.equal(normalizeRelease({ ...stable, published_at: 'not-a-date' }), null);
  assert.equal(normalizeRelease(null), null);
  assert.throws(() => selectReleases({}));
});
test('site accepts installer links only from the correct GitHub release path', async () => {
  const { safeReleaseUrl } = await modulePromise;
  for (const value of [
    'javascript:alert(1)',
    'https://evil.test/file.exe',
    `${url.replace('github.com', 'github.com.evil.test')}/download/a/b`,
    'https://user:pass@github.com/omnizs38/mechvibes-cbc/releases/download/a/b',
    'https://github.com/other/repo/releases/download/a/b',
  ])
    assert.equal(safeReleaseUrl(value, true), null);
  assert.ok(safeReleaseUrl(stable.assets[0].browser_download_url, true));
});
test('site does not treat phones or iPads as desktop download targets', async () => {
  const { platformFromHints } = await modulePromise;
  assert.equal(platformFromHints('MacIntel', 'Safari', 5), 'unknown');
  assert.equal(platformFromHints('Linux', 'Android Mobile'), 'unknown');
  assert.equal(platformFromHints('MacIntel', 'Macintosh', 0), 'mac');
  assert.equal(platformFromHints('Win32', 'Windows'), 'windows');
  assert.equal(platformFromHints('Linux x86_64', 'X11'), 'linux');
});
test('download selection excludes metadata and unrelated executables', async () => {
  const { pickInstaller } = await modulePromise;
  assert.equal(pickInstaller(stable, 'windows').name, stable.assets[0].name);
  assert.equal(pickInstaller(stable, 'linux'), null);
  assert.equal(pickInstaller(stable, 'unknown'), null);
  assert.equal(pickInstaller({ ...stable, assets: [{ ...stable.assets[0], name: 'Uninstall.exe' }] }, 'windows'), null);
});
test('site strips malicious asset URLs before rendering', async () => {
  const { normalizeRelease } = await modulePromise;
  assert.equal(
    normalizeRelease({
      ...stable,
      assets: [{ ...stable.assets[0], browser_download_url: 'https://attacker.test/app.exe' }],
    }).assets.length,
    0,
  );
});
