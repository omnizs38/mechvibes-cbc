import { useMemo } from 'react';
import type { SoundPack } from '../../shared/types';

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
  const groups = useMemo(() => {
    const result: Array<{ name: string; packs: SoundPack[] }> = [];
    for (const pack of packs) {
      const name = pack.group || 'Default';
      let group = result.find((candidate) => candidate.name === name);
      if (!group) {
        group = { name, packs: [] };
        result.push(group);
      }
      group.packs.push(pack);
    }
    return result;
  }, [packs]);

  const busy = pendingAction !== null;

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

      {currentPack ? (
        <div className="pack-meta">
          <span className="tag">{currentPack.is_custom ? 'Custom' : 'Default'}</span>
          {currentPack.version ? <span>v{currentPack.version}</span> : null}
          <span>
            {packs.length} pack{packs.length === 1 ? '' : 's'} available
          </span>
        </div>
      ) : null}

      <div className="btn-row" style={{ marginTop: 'var(--space-3)' }}>
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
