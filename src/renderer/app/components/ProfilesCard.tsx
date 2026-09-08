import { useState } from 'react';
import { ipcRenderer } from '../../shared/electron';
import { store } from '../../shared/store';
import {
  PROFILE_STORE_KEY,
  MAX_PROFILES,
  validateProfiles,
  validateProfile,
  type SoundProfile,
} from '../../../utils/profiles';
import type { SoundPack } from '../../shared/types';

type Props = {
  packs: SoundPack[];
  packId: string;
  volume: number;
  outputDeviceId: string;
  disabled: boolean;
  apply: (profile: SoundProfile) => Promise<string>;
};
export function ProfilesCard({ packs, packId, volume, outputDeviceId, disabled, apply }: Props) {
  const [state, setState] = useState(() => {
    try {
      return { profiles: validateProfiles(store.get(PROFILE_STORE_KEY) ?? []), error: '' };
    } catch {
      return { profiles: [] as SoundProfile[], error: 'Saved profiles are invalid. Existing data was not changed.' };
    }
  });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const commit = (next: SoundProfile[]) => {
    store.set(PROFILE_STORE_KEY, validateProfiles(next));
    setState({ profiles: next, error: '' });
  };
  const run = async (action: () => Promise<void> | void) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Sound profiles</h2>
        <span className="tag">3.0</span>
      </div>
      <p className="hint">Save a soundpack, volume and output for each part of your day.</p>
      {state.error ? (
        <div className="banner" role="alert">
          <p>{state.error}</p>
          <button
            className="btn-ghost is-danger"
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() => {
                if (
                  window.confirm(
                    'Reset invalid profile settings? Soundpack files and other preferences will not be changed.',
                  )
                ) {
                  commit([]);
                  setMessage('Profiles reset. You can now import a valid backup.');
                }
              })
            }
          >
            Reset invalid profiles
          </button>
        </div>
      ) : null}
      <form
        className="profile-create"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => {
            const profile = validateProfile({ id: crypto.randomUUID(), name, packId, volume, outputDeviceId });
            commit([...state.profiles, profile]);
            setName('');
            setMessage(`Saved ${profile.name}.`);
          });
        }}
      >
        <label className="sr-only" htmlFor="profile-name">
          New profile name
        </label>
        <input
          id="profile-name"
          className="input"
          placeholder="e.g. Quiet work"
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy || disabled || Boolean(state.error)}
        />
        <button
          className="btn"
          type="submit"
          disabled={
            busy || disabled || !packId || !name.trim() || Boolean(state.error) || state.profiles.length >= MAX_PROFILES
          }
        >
          Save current
        </button>
      </form>
      <ul className="profile-list">
        {state.profiles.map((profile) => {
          const available = packs.some((pack) => pack.pack_id === profile.packId);
          return (
            <li key={profile.id}>
              <div>
                <strong>{profile.name}</strong>
                <span className="hint">{available ? `${profile.volume}% volume` : 'Soundpack not installed'}</span>
              </div>
              <button
                className="btn-ghost"
                type="button"
                disabled={!available || busy || disabled}
                onClick={() => void run(async () => setMessage(await apply(profile)))}
              >
                Apply
              </button>
              <button
                className="btn-ghost is-danger"
                type="button"
                disabled={busy}
                aria-label={`Delete profile ${profile.name}`}
                onClick={() =>
                  void run(() => {
                    if (window.confirm(`Delete profile “${profile.name}”? Soundpack files will be kept.`))
                      commit(state.profiles.filter((p) => p.id !== profile.id));
                  })
                }
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
      {!state.profiles.length && !state.error ? (
        <p className="hint">No profiles yet. Choose your sound and save it above.</p>
      ) : null}
      <div className="btn-row">
        <button
          className="btn-ghost"
          type="button"
          disabled={busy || !state.profiles.length}
          onClick={() =>
            void run(async () => {
              const result = await ipcRenderer.invoke('profiles-export');
              setMessage(
                result.canceled
                  ? 'Export canceled.'
                  : result.ok
                    ? 'Profiles exported. Sound files are not included.'
                    : result.error,
              );
            })
          }
        >
          Export profiles
        </button>
        <button
          className="btn-ghost"
          type="button"
          disabled={busy || Boolean(state.error)}
          onClick={() =>
            void run(async () => {
              const result = await ipcRenderer.invoke('profiles-import');
              if (result.ok) {
                setState({ profiles: validateProfiles(result.profiles), error: '' });
                setMessage('Profiles imported. Existing profiles were kept.');
              } else setMessage(result.canceled ? 'Import canceled.' : result.error);
            })
          }
        >
          Import profiles
        </button>
      </div>
      <p className="hint" role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
