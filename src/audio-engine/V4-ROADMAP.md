# Audio Engine v4 — Rewrite Roadmap

## Why

The current engine (`web-audio-engine.ts` + helpers) works and is tested, but the
core file mixes several responsibilities — graph construction, master gain,
output-device switching, per-event scheduling, metrics and manifest type
definitions all live in one class. This makes the playback path hard to test in
isolation and hard to evolve.

The v4 rewrite is a **quality refactor**, done **module by module**, that keeps
playback behaviour identical while moving the whole engine onto a clean, layered
structure with a single canonical manifest format ("v4"). Legacy soundpack
formats (v1/v2/v3) keep working as adapters that produce a v4 manifest.

Guiding rules:

- No behaviour change to playback. The test suite (`tests/run.ts`) stays green
  after every module.
- One responsibility per module; the orchestrator only wires modules together.
- The v4 manifest is the single contract every module depends on.

## Canonical format marker

`MANIFEST_FORMAT = 4` (in `manifest.ts`) marks the in-memory manifest schema.
It is distinct from a pack's source `version` (1/2/3/4), which records the config
format the manifest was adapted *from*.

## Target module layout (`src/audio-engine/`)

| Module | Responsibility | Status |
| --- | --- | --- |
| `manifest.ts` | Canonical v4 manifest types + `MANIFEST_FORMAT`, `centsToPlaybackRate`, `clamp` | **M1 — done** |
| `sample-selector.ts` | Round-robin / random sample choice | kept |
| `sample-cache.ts` | Decode + LRU cache with byte budget | kept (later: split fetch/decode) |
| `voice-pool.ts` | Polyphony + priority voice-stealing | kept |
| `latency-tracker.ts` | Input→render latency percentiles | kept |
| `audio-graph.ts` | AudioContext, master gain, compressor, output device | **M2 — done** |
| `voice-scheduler.ts` | Per-event scheduling (envelope, pitch, offset) | **M3 — done** |
| `engine.ts` | Orchestrator wiring the modules together | **M4 — done** |
| `index.ts` | Public API facade | **M4 — done** |
| `manifest-adapter.ts` | v1/v2/v3/v4 → v4 manifest, plus `adaptV4` | **M5 — done** |

The old `web-audio-engine.ts` monolith has been removed (**M6**); the orchestrator
now lives in `engine.ts`, and all consumers import through `index.ts`.

## Modules

- **M1 — Canonical manifest (foundation).** Extract manifest types + shared
  helpers into `manifest.ts`; add `MANIFEST_FORMAT`. Everything else imports from
  here. `web-audio-engine.ts` re-exports for backward compatibility.
- **M2 — AudioGraph.** Extract context/gain/compressor/output-device handling.
- **M3 — VoiceScheduler.** Extract the `playBuffer` scheduling path.
- **M4 — Engine + facade.** Rebuild the engine as a thin orchestrator; add
  `index.ts` public API. Keep the existing pack contract
  (`play`/`loadManifest`/`setMasterGain`/`setOutputDevice`/`dispose`/`getStats`).
- **M5 — v4 config format.** First-class native v4 config (1:1 with the manifest),
  validation, and `adaptV4`. Legacy adapters keep producing v4 manifests.
- **M6 — Cleanup.** Removed the `web-audio-engine.ts` monolith (renamed to
  `engine.ts`), pointed the benchmark and tests at `index.ts`, refreshed docs.

## Status: complete

All six modules landed. `src/audio-engine/` is now a layered set of
single-responsibility modules behind `index.ts`, the v4 config format is
first-class (`adaptV4` + validation), and legacy v1/v2/v3 packs keep working as
adapters. Playback behaviour is unchanged; the test suite is green.

## Verification

After each module: `npm run build:main && npm test && npm run typecheck`.
