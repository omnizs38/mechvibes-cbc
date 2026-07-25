import type { useOutputDevices } from '../useOutputDevices';
import { VOLUME_MAX, VOLUME_MIN, VOLUME_STEP } from '../useMechvibes';

type Props = {
  volume: number;
  adjustedVolume: number;
  activeVolume: boolean;
  onVolumeChange: (value: number) => void;
  onVolumeWheel: (direction: 1 | -1) => void;
  outputs: ReturnType<typeof useOutputDevices>;
};

export function SoundCard({
  volume,
  adjustedVolume,
  activeVolume,
  onVolumeChange,
  onVolumeWheel,
  outputs,
}: Props) {
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Sound</h2>
      </div>

      <div className="field">
        <div className="field-label">
          <label htmlFor="volume">Volume</label>
          <span className="field-value">
            {activeVolume ? `${volume} → ${adjustedVolume}` : volume}
          </span>
        </div>
        <input
          id="volume"
          className="slider"
          type="range"
          min={VOLUME_MIN}
          max={VOLUME_MAX}
          step={VOLUME_STEP}
          value={volume}
          aria-valuetext={`${volume} percent${activeVolume ? `, adjusted to ${adjustedVolume} percent` : ''}`}
          onChange={(event) => onVolumeChange(Number(event.target.value))}
          onWheel={(event) => onVolumeWheel(event.deltaY < 0 ? 1 : -1)}
        />
        <div className="slider-scale" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <span className="hint">
          {activeVolume
            ? 'Volume is balanced against the system volume.'
            : 'Above 100% the sound may clip.'}
        </span>
      </div>

      <div className="field">
        <div className="field-label">
          <label htmlFor="output-device">Output device</label>
        </div>
        <div className="split">
          <select
            id="output-device"
            className="input"
            value={outputs.deviceId}
            disabled={!outputs.supported}
            onChange={(event) => void outputs.apply(event.target.value)}
          >
            <option value="">System default</option>
            {outputs.devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn"
            disabled={!outputs.supported}
            onClick={() => void outputs.chooseWithSystemPicker()}
          >
            Choose…
          </button>
        </div>
        <span className="hint">{outputs.status}</span>
      </div>
    </section>
  );
}
