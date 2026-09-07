import { useId, useMemo, useState } from 'react';
import type { SoundPack } from '../../shared/types';
import { store } from '../../shared/store';
import { filterPacks, readFavoriteIds } from '../../../utils/pack-library';

const FAVORITES_KEY = 'mechvibes-favorite-packs';

/** Below this many packs a filter box costs more space than it saves. */
const FILTER_THRESHOLD = 8;

type Props = {
  packs: SoundPack[];
  currentPackId: string;
  currentPack: SoundPack | null;
  disabled: boolean;
  pendingAction: string | null;
  actionStatus: string;
  onSelect: (packId: string) => void;
  onRandom: () => void;
  onRefresh: () => void;
  onImport: () => void;
  onOpenFolder: () => void;
  onDelete: () => void;
};

export function SoundpackCard({
  packs,
  currentPackId,
  currentPack,
  disabled,
  pendingAction,
  actionStatus,
  onSelect,
  onRandom,
  onRefresh,
  onImport,
  onOpenFolder,
  onDelete,
}: Props) {
  const [query, setQuery] = useState('');
  const filterId = useId();

  const [favorites, setFavorites] = useState(() => readFavoriteIds(store.get(FAVORITES_KEY)));
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [preferenceError, setPreferenceError] = useState('');
  const matches = useMemo(
    () => filterPacks(packs, { query, favorites, favoritesOnly }),
    [packs, query, favorites, favoritesOnly],
  );
  // Keep the active option selected without counting it as a search match.
  const activeOutsideFilter = packs.find(
    (pack) => pack.pack_id === currentPackId && !matches.some((match) => match.pack_id === pack.pack_id),
  );

  const toggleFavorite = () => {
    if (!currentPackId) return;
    const next = favorites.includes(currentPackId)
      ? favorites.filter((id) => id !== currentPackId)
      : readFavoriteIds([...favorites, currentPackId]);
    try {
      store.set(FAVORITES_KEY, next);
      setFavorites(next);
      setPreferenceError('');
    } catch {
      setPreferenceError('Could not save favorites. Please try again.');
    }
  };

  const groups = useMemo(() => {
    const result: Array<{ name: string; packs: SoundPack[] }> = [];
    for (const pack of matches) {
      const name = pack.group || 'Default';
      let group = result.find((candidate) => candidate.name === name);
      if (!group) {
        group = { name, packs: [] };
        result.push(group);
      }
      group.packs.push(pack);
    }
    return result;
  }, [matches]);

  const busy = pendingAction !== null;
  const showFilter = packs.length >= FILTER_THRESHOLD;
  const narrowed = query.trim().length > 0 || favoritesOnly;

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Soundpack</h2>
        <button type="button" className="btn-ghost" onClick={onRandom} disabled={disabled || busy || packs.length < 2}>
          Surprise me
        </button>
      </div>

      {showFilter ? (
        <div className="pack-toolbar">
          <label className="sr-only" htmlFor={filterId}>
            Filter soundpacks
          </label>
          <input
            id={filterId}
            className="input pack-search"
            type="search"
            placeholder="Search name, group or ID…"
            value={query}
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="pack-count">{narrowed ? `${matches.length}/${packs.length}` : packs.length}</span>
        </div>
      ) : null}

      <label className="sr-only" htmlFor="pack-list">
        Active soundpack
      </label>
      <select
        id="pack-list"
        className="input"
        value={currentPackId}
        disabled={disabled || busy || packs.length === 0}
        onChange={(event) => onSelect(event.target.value)}
      >
        {packs.length === 0 ? <option value="">No soundpacks found</option> : null}
        {activeOutsideFilter ? (
          <optgroup label="Currently active (outside filter)">
            <option value={activeOutsideFilter.pack_id}>{activeOutsideFilter.name}</option>
          </optgroup>
        ) : null}
        {groups.map((group) => (
          <optgroup key={group.name} label={group.name}>
            {group.packs.map((pack) => (
              <option key={pack.pack_id} value={pack.pack_id}>
                {favorites.includes(pack.pack_id) ? '★ ' : ''}
                {pack.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {narrowed && matches.length === 0 ? (
        <span className="hint" role="status">
          No matching soundpacks. Try another search or turn off Favorites only.
        </span>
      ) : null}

      <div className="btn-row" style={{ marginTop: 'var(--space-2)' }}>
        <button
          type="button"
          className="btn-ghost"
          aria-pressed={favoritesOnly}
          onClick={() => setFavoritesOnly((value) => !value)}
        >
          Favorites only
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={!currentPackId || busy || disabled}
          aria-pressed={favorites.includes(currentPackId)}
          onClick={toggleFavorite}
        >
          {favorites.includes(currentPackId) ? 'Remove favorite' : 'Add favorite'}
        </button>
        {narrowed ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setQuery('');
              setFavoritesOnly(false);
            }}
          >
            Clear filters
          </button>
        ) : null}
      </div>
      {preferenceError ? (
        <span className="hint" role="alert">
          {preferenceError}
        </span>
      ) : null}

      {currentPack ? (
        <div className="pack-meta">
          <span className="tag">{currentPack.is_custom ? 'Custom' : 'Default'}</span>
          {currentPack.version ? <span>v{currentPack.version}</span> : null}
        </div>
      ) : null}

      <div className="btn-row" style={{ marginTop: 'var(--space-2)' }}>
        <button type="button" className="btn-ghost" onClick={onRefresh} disabled={busy || disabled}>
          Refresh
        </button>
        <button type="button" className="btn-ghost" onClick={onImport} disabled={busy || disabled}>
          Import ZIP
        </button>
        <button type="button" className="btn-ghost" onClick={onOpenFolder} disabled={busy || disabled}>
          Open folder
        </button>
        <button
          type="button"
          className="btn-ghost is-danger"
          onClick={onDelete}
          disabled={busy || disabled || !currentPack?.is_custom}
        >
          Delete
        </button>
      </div>

      <span className="hint" role="status" aria-live="polite">
        {actionStatus}
      </span>
    </section>
  );
}
