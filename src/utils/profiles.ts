/** Portable preferences only: no audio files, credentials, logging or update settings. */
export const PROFILE_STORE_KEY = 'mechvibes-profiles';
export const MAX_PROFILES = 32;
export const MAX_PROFILE_BYTES = 64 * 1024;
export interface SoundProfile {
  id: string;
  name: string;
  packId: string;
  volume: number;
  outputDeviceId: string;
}
export interface ProfileBackup {
  format: 'mechvibes-profiles';
  version: 1;
  profiles: SoundProfile[];
}

function text(value: unknown, name: string, limit: number, allowEmpty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > limit ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    (!allowEmpty && !value.trim())
  ) {
    throw new Error(`Invalid profile ${name}.`);
  }
  return value.trim();
}
export function validateProfile(value: unknown): SoundProfile {
  if (!value || typeof value !== 'object') throw new Error('Invalid sound profile.');
  const p = value as Record<string, unknown>;
  if (typeof p.volume !== 'number' || !Number.isFinite(p.volume) || p.volume < 0 || p.volume > 200) {
    throw new Error('Profile volume must be between 0 and 200.');
  }
  return {
    id: text(p.id, 'ID', 128),
    name: text(p.name, 'name', 60),
    packId: text(p.packId, 'soundpack', 512),
    volume: Math.round(p.volume),
    outputDeviceId: text(p.outputDeviceId, 'output device', 512, true),
  };
}
export function validateProfiles(value: unknown): SoundProfile[] {
  if (!Array.isArray(value) || value.length > MAX_PROFILES)
    throw new Error(`At most ${MAX_PROFILES} profiles are supported.`);
  const profiles = value.map(validateProfile);
  if (new Set(profiles.map((p) => p.id)).size !== profiles.length) throw new Error('Duplicate profile IDs.');
  return profiles;
}
export function parseProfileBackup(source: string): SoundProfile[] {
  if (new TextEncoder().encode(source).length > MAX_PROFILE_BYTES) throw new Error('Profile backup exceeds 64 KiB.');
  const data = JSON.parse(source) as ProfileBackup;
  if (!data || data.format !== 'mechvibes-profiles' || data.version !== 1)
    throw new Error('Unsupported profile backup.');
  return validateProfiles(data.profiles);
}
export function serializeProfiles(profiles: SoundProfile[]): string {
  const source =
    JSON.stringify({ format: 'mechvibes-profiles', version: 1, profiles: validateProfiles(profiles) }, null, 2) + '\n';
  if (new TextEncoder().encode(source).length > MAX_PROFILE_BYTES) throw new Error('Profile backup exceeds 64 KiB.');
  return source;
}
export function mergeProfiles(current: SoundProfile[], incoming: SoundProfile[]): SoundProfile[] {
  const result = [...validateProfiles(current)];
  const ids = new Set(result.map((p) => p.id));
  // Existing user profiles win conflicts; importing must not silently overwrite them.
  for (const profile of validateProfiles(incoming)) {
    if (!ids.has(profile.id)) {
      result.push(profile);
      ids.add(profile.id);
    }
  }
  return validateProfiles(result);
}
