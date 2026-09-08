import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  validateProfile,
  validateProfiles,
  parseProfileBackup,
  serializeProfiles,
  mergeProfiles,
} from '../src/utils/profiles';
import { readProfileBackup } from '../src/services/profile-files';
import { HotkeyTracker } from '../src/services/hotkey-tracker';
const profile = { id: 'writing', name: 'Writing', packId: 'default-blue', volume: 40, outputDeviceId: '' };

test('profile roundtrip includes only portable sound preferences', () => {
  const clean = validateProfile({
    ...profile,
    name: ' Writing ',
    volume: 40.4,
    remoteDebug: true,
    updateChannel: 'beta',
  });
  assert.deepEqual(clean, profile);
  assert.deepEqual(parseProfileBackup(serializeProfiles([clean])), [profile]);
  assert.doesNotMatch(serializeProfiles([clean]), /remoteDebug|updateChannel/);
});
test('profiles reject invalid numbers, missing settings and unsafe text', () => {
  for (const volume of [-1, 201, NaN, Infinity, '50']) assert.throws(() => validateProfile({ ...profile, volume }));
  for (const name of ['', ' ', 'bad\nname', 'x'.repeat(61)]) assert.throws(() => validateProfile({ ...profile, name }));
  assert.throws(() => validateProfile({ ...profile, packId: undefined }));
});
test('profile list has a strict count and unique IDs', () => {
  assert.throws(() => validateProfiles([profile, profile]), /Duplicate/);
  assert.throws(() => validateProfiles(Array.from({ length: 33 }, (_, i) => ({ ...profile, id: `${i}` }))), /32/);
});
test('import keeps existing profiles on ID conflicts', () => {
  assert.deepEqual(
    mergeProfiles(
      [profile],
      [
        { ...profile, volume: 90 },
        { ...profile, id: 'new' },
      ],
    ),
    [profile, { ...profile, id: 'new' }],
  );
});
test('profile backup rejects unsupported schemas and oversized UTF-8 data', () => {
  assert.throws(() => parseProfileBackup('{broken'));
  assert.throws(
    () => parseProfileBackup(JSON.stringify({ format: 'mechvibes-profiles', version: 2, profiles: [] })),
    /Unsupported/,
  );
  assert.throws(() => parseProfileBackup('🙂'.repeat(20000)), /64 KiB/);
});
test('merging over the limit fails without changing existing profiles', () => {
  const profiles = Array.from({ length: 32 }, (_, i) => ({ ...profile, id: `${i}` }));
  assert.throws(() => mergeProfiles(profiles, [profile]), /32/);
  assert.equal(profiles.length, 32);
});
test('profile file reader enforces a descriptor-based byte limit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mechvibes-profiles-'));
  try {
    const valid = path.join(root, 'valid.json');
    await fs.writeFile(valid, serializeProfiles([profile]));
    assert.deepEqual(await readProfileBackup(valid), [profile]);
    const big = path.join(root, 'big.json');
    const handle = await fs.open(big, 'wx');
    try {
      await handle.truncate(65537);
    } finally {
      await handle.close();
    }
    await assert.rejects(readProfileBackup(big), /64 KiB/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('reset after sleep clears held modifiers and mute latch', () => {
  let toggles = 0;
  const tracker = new HotkeyTracker({
    onMuteToggle: () => {
      toggles++;
    },
  });
  for (const keycode of [29, 42, 50]) tracker.handleKeydown({ keycode });
  tracker.reset();
  tracker.handleKeydown({ keycode: 50 });
  assert.equal(toggles, 1);
  tracker.handleKeyup({ keycode: 50 });
  for (const keycode of [29, 42, 50]) tracker.handleKeydown({ keycode });
  assert.equal(toggles, 2);
});
