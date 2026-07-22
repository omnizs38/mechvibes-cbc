# Soundpack v3

Soundpack v3 adds layered keydown and keyup playback, deterministic round-robin variation, envelopes, gain and pitch control, cache policy, metadata, and optional SHA-256 integrity data. Mechvibes continues to read v1 and v2 without conversion.

## Minimal example

```json
{
  "version": 3,
  "name": "Studio Linear",
  "author": "Example Author",
  "license": "CC0-1.0",
  "sampleRate": 48000,
  "engine": {
    "maxVoices": 64,
    "preload": "priority",
    "cacheBudgetMb": 192,
    "gain": 0.9
  },
  "defaults": {
    "keydown": {
      "samples": [
        "press/generic-01.flac",
        "press/generic-02.flac",
        "press/generic-03.flac"
      ],
      "mode": "round-robin",
      "gain": 1,
      "pitchVariationCents": 6,
      "priority": 5,
      "envelope": { "attackMs": 0, "releaseMs": 12 }
    },
    "keyup": {
      "samples": ["release/generic.wav"],
      "gain": 0.7,
      "priority": 4
    }
  },
  "keys": {
    "57": {
      "keydown": {
        "samples": [
          { "file": "press/space-01.flac", "gain": 0.95 },
          { "file": "press/space-02.flac", "gain": 0.95 }
        ],
        "mode": "round-robin",
        "priority": 8
      }
    }
  },
  "checksums": {
    "press/generic-01.flac": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}
```

## Event lookup

- Numeric keys use the existing Mechvibes standard keycodes.
- A key-specific layer overrides the corresponding default layer.
- Missing key-specific layers fall back to defaults.
- A missing layer means no sound for that event.
- Platform remapping is applied after configuration validation.

## Sample selection

- `round-robin` cycles deterministically through samples and avoids repetitive machine-gun sound.
- `random` excludes the immediately previous sample when more than one variant exists.
- `pitchVariationCents` is intentionally capped at 100 cents and defaults to zero.
- Standard keyboards do not report physical velocity; Mechvibes does not invent velocity by default.

## Preload policy

- `all` decodes and pins every referenced sample before the pack becomes active.
- `priority` preloads event layers with priority 5 or higher and loads the rest on first use.
- `lazy` loads every sample on demand.
- `cacheBudgetMb` controls decoded PCM memory, not compressed file size.

## Audio quality guidance

- Prefer clean 48 kHz WAV or FLAC masters with consistent headroom.
- Remove DC offset and excessive silence, but do not normalize every sample to clipping.
- Keep keydown and keyup levels balanced and use the pack gain for final calibration.
- OGG and MP3 remain supported for compact packs, but transcoding cannot improve a low-quality source.
- Very long samples increase decoded memory and can reduce polyphony.

## Integrity

`checksums` maps a relative sample path to a lowercase or uppercase SHA-256 hex digest. Paths and digests are validated. Release tooling should generate checksums from final packaged bytes.

The machine-readable schema is `docs/soundpack-v3.schema.json`.
