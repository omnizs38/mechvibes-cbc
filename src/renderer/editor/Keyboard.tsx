import type { PackData, SoundDefinition } from './packData';
import { ZONES, hasSound, keyLabels, keySizes, layout } from './packData';

type Props = {
  pack: PackData;
  selectedKeycode: string | null;
  onSelect: (keycode: string | null) => void;
  onSave: (keycode: string, value: SoundDefinition) => void;
};

type DraftProps = {
  keycode: string;
  pack: PackData;
  up: boolean;
  left: boolean;
  onSave: (keycode: string, value: SoundDefinition) => void;
  onClose: () => void;
};

function KeyPopover({ keycode, pack, up, left, onSave, onClose }: DraftProps) {
  const current = pack.defines[keycode] ?? null;
  const single = Array.isArray(current) ? current : [0, 0];
  const multi = typeof current === 'string' ? current : '';

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (pack.mode === 'sprite') {
      onSave(keycode, [Number(form.get('start') ?? 0), Number(form.get('length') ?? 0)]);
    } else {
      onSave(keycode, String(form.get('file') ?? ''));
    }
  };

  return (
    <form
      className={['key-popover', up ? 'is-up' : '', left ? 'is-left' : ''].filter(Boolean).join(' ')}
      onClick={(event) => event.stopPropagation()}
      onSubmit={submit}
    >
      {pack.mode === 'sprite' ? (
        <>
          <div className="popover-title">Start and length (ms)</div>
          <div className="popover-inputs">
            <input
              className="input"
              type="number"
              name="start"
              placeholder="Start…"
              defaultValue={single[0] || ''}
              autoFocus
            />
            <input
              className="input"
              type="number"
              name="length"
              placeholder="Length…"
              defaultValue={single[1] || ''}
            />
          </div>
        </>
      ) : (
        <>
          <div className="popover-title">Audio file name</div>
          <input
            className="input"
            type="text"
            name="file"
            placeholder="Sound file name…"
            defaultValue={multi}
            autoFocus
          />
        </>
      )}

      <div className="popover-actions">
        <button type="submit" className="btn btn-primary">
          Save
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </form>
  );
}

export function Keyboard({ pack, selectedKeycode, onSelect, onSave }: Props) {
  return (
    <div className="keyboard" onClick={() => onSelect(null)}>
      {ZONES.map((zone) => {
        const rows = layout[zone] ?? [];
        return (
          <div className="key-zone" key={zone}>
            {rows.map((row, rowIndex) => (
              <div className="key-row" key={`${zone}-${rowIndex}`}>
                {row.map((rawKey, keyIndex) => {
                  const keycode = String(rawKey);
                  const blank = !rawKey;
                  const size = keySizes[keycode];
                  const selected = selectedKeycode === keycode;
                  return (
                    <div
                      key={`${zone}-${rowIndex}-${keyIndex}-${keycode}`}
                      className={[
                        'key',
                        size ? `size-${size}` : '',
                        blank ? 'is-blank' : '',
                        hasSound(pack.defines[keycode] ?? null) ? 'has-sound' : '',
                        selected ? 'is-selected' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      data-keycode={keycode}
                      role={blank ? undefined : 'button'}
                      tabIndex={blank ? undefined : 0}
                      onClick={(event) => {
                        if (blank) return;
                        event.stopPropagation();
                        onSelect(selected ? null : keycode);
                      }}
                      onKeyDown={(event) => {
                        if (blank) return;
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelect(selected ? null : keycode);
                        }
                      }}
                    >
                      <span>{keyLabels[keycode] ?? ''}</span>
                      {selected ? (
                        <KeyPopover
                          keycode={keycode}
                          pack={pack}
                          up={rowIndex > 3}
                          left={zone === 'numpad'}
                          onSave={onSave}
                          onClose={() => onSelect(null)}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
