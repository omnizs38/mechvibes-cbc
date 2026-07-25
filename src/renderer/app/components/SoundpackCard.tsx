import { useId, useMemo, useState } from 'react';
import type { SoundPack } from '../../shared/types';

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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return packs;
    return packs.filter(
      (pack) =>
        // The active pack stays in the list so the select never loses its value.
        pack.pack_id === currentPackId ||
        pack.name.toLowerCase().includes(needle) ||
        (pack.group || '').toLowerCase().includes(needle),
    );
  }, [packs, query, currentPackId]);

  const groups = useMemo(() => {
    const result: Array<{ name: string; packs: SoundPack[] }> = [];
    for (const pack of filtered) {
      const name = pack.group || 'Default';
      let group = result.find((candidate) => candidate.name === name);
      if (!group) {
        group = { name, packs: [] };
        result.push(group);
      }
      group.packs.push(pack);
    }
    return result;
  }, [filtered]);

  const busy = pendingAction !== null;
  const showFilter = packs.length >= FILTER_THRESHOLD;
  const narrowed = query.trim().length > 0;

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Soundpack</h2>
        <button
          type="button"
          className="btn-ghost"
          onClick={onRandom}
          disabled={disabled || packs.length < 2}
        >
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
            placeholder="Filter by name or group…"
            value={query}
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="pack-count">
            {narrowed ? `${filtered.length}/${packs.length}` : packs.length}
          </span>
        </div>
      ) : null}

      <label className="sr-only" htmlFor="pack-list">
        Active soundpack
      </label>
      <select
        id="pack-list"
        className="input"
        value={currentPackId}
        disabled={disabled || packs.length === 0}
        onChange={(event) => onSelect(event.target.value)}
      >
        {packs.length === 0 ? <option value="">No soundpacks found</option> : null}
        {groups.map((group) => (
          <optgroup key={group.name} label={group.name}>
            {group.packs.map((pack) => (
              <option key={pack.pack_id} value={pack.pack_id}>
                {pack.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {narrowed && filtered.length <= 1 ? (
        <span className="hint">Nothing matches “{query.trim()}”.</span>
      ) : null}

      {currentPack ? (
        <div className="pack-meta">
          <span className="tag">{currentPack.is_custom ? 'Custom' : 'Default'}</span>
          {currentPack.version ? <span>v{currentPack.version}</span> : null}
        </div>
      ) : null}

      <div className="btn-row" style={{ marginTop: 'var(--space-2)' }}>
        <button type="button" className="btn-ghost" onClick={onRefresh} disabled={busy}>
          Refresh
        </button>
        <button type="button" className="btn-ghost" onClick={onImport} disabled={busy}>
          Import ZIP
        </button>
        <button type="button" className="btn-ghost" onClick={onOpenFolder} disabled={busy}>
          Open folder
        </button>
        <button
          type="button"
          className="btn-ghost is-danger"
          onClick={onDelete}
          disabled={busy || !currentPack?.is_custom}
        >
          Delete
        </button>
      </div>

      <span className="hint">{actionStatus}</span>
    </section>
  );
}
