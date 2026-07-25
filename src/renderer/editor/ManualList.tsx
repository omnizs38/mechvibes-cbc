import type { PackData, SoundDefinition } from './packData';
import { ZONES, hasSound, keyLabels, layout } from './packData';

type Props = {
  pack: PackData;
  onSave: (keycode: string, value: SoundDefinition) => void;
};

export function ManualList({ pack, onSave }: Props) {
  return (
    <div className="manual-zones">
      {ZONES.map((zone) => {
        const keys = (layout[zone] ?? []).flat().filter(Boolean).map(String);
        return (
          <div className="card" key={zone}>
            <div className="card-head">
              <h3 className="card-title">{zone}</h3>
            </div>
            {keys.map((keycode) => {
              const value = pack.defines[keycode] ?? null;
              const single = Array.isArray(value) ? value : [0, 0];
              const multi = typeof value === 'string' ? value : '';
              return (
                <div
                  className={`manual-key${hasSound(value) ? ' has-sound' : ''}`}
                  key={`${zone}-${keycode}`}
                >
                  <span className="manual-key-label">{keyLabels[keycode] ?? keycode}</span>
                  {pack.key_define_type === 'single' ? (
                    <span className="manual-key-inputs">
                      <input
                        className="input"
                        type="number"
                        placeholder="Start…"
                        value={single[0] || ''}
                        onChange={(event) =>
                          onSave(keycode, [Number(event.target.value), single[1] ?? 0])
                        }
                      />
                      <input
                        className="input"
                        type="number"
                        placeholder="Length…"
                        value={single[1] || ''}
                        onChange={(event) =>
                          onSave(keycode, [single[0] ?? 0, Number(event.target.value)])
                        }
                      />
                    </span>
                  ) : (
                    <span className="manual-key-inputs">
                      <input
                        className="input is-wide"
                        type="text"
                        placeholder="File name…"
                        value={multi}
                        onChange={(event) => onSave(keycode, event.target.value)}
                      />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
