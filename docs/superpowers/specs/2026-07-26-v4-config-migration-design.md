# Migrate bundled soundpacks to native v4 config + remove legacy engine support

**Date:** 2026-07-26
**Status:** Approved

## Goal

Rewrite all 18 bundled `src/audio/*/config.json` files into the canonical **v4**
soundpack format — the format that maps 1:1 to the engine's in-memory
`AudioManifest` (`MANIFEST_FORMAT = 4`) — then remove v1/v2 support from the
engine entirely so that v3/v4 is the only accepted on-disk format.

## Background

`manifest-adapter.ts` normalizes every soundpack config version into an
`AudioManifest`. Today it supports four on-disk formats:

- **v1 single (sprite):** one `sound` file + `defines` mapping keycode →
  `[offsetMs, durationMs]`. `adaptV1` builds **keydown-only** layers; the `-up`
  sprite entries these packs ship are wrapped as non-numeric keydown events that
  no real keypress matches, so they are silently dead today.
- **v1 multi:** `defines` mapping keycode → filename, no release track.
- **v2 multi:** generic `sound`/`soundup` (with `{a-b}` number templates) plus
  per-key `defines` overrides including `-up` release variants. `adaptV2` wires
  keyup correctly with `priority: 4`.
- **v3 / v4:** modern schema (`engine` / `defaults` / `keys` / `checksums`).
  v4 = v3 plus per-sample `offsetSeconds` / `durationSeconds` windows.

Keycodes are a single shared keyspace across all versions: legacy `defines` keys
and modern `keys` keys both pass through `keycodesFill` / `keycodesRemap` at
manifest-build time, so keycode strings copy across verbatim.

The 18 bundled packs currently break down as:

- **8 CherryMX** (`*-abs` / `*-pbt`) — v1 sprite, **with** `-up` entries.
- **eg-oreo, eg-crystal-purple, topre-purple-hybrid-pbt** — v1 sprite
  (eg-oreo is keydown-only, no `-up`).
- **nk-cream** — v1 multi.
- **holy-pandas, cream-travel, turquoise, mxblack-travel, mxblue-travel,
  mxbrown-travel** — v2 multi.

## Decisions

- **Remove v1/v2 support entirely.** Any old-format pack a user previously
  imported stops loading until re-authored. Only v3/v4 accepted everywhere.
- **One-off conversion.** A throwaway script converts the 18 configs; no
  maintained converter tool is kept.
- **Empty checksums.** Converted configs omit `checksums` (schema default `{}`).
- **Wire sprite `-up` into keyup.** The v1 sprite `-up` windows become v4 keyup
  layers, restoring the pack authors' clear intent. This IS an audible change vs
  the current build (these packs now play a release click).

## Part 1 — Convert the 18 configs

Every converted config uses this skeleton. `author` / `license` / `sampleRate`
are omitted so validation applies its defaults (`''`, `''`, `null`); the
`engine` block reproduces the values `adaptV1` / `adaptV2` hardcoded, so
playback parameters are unchanged.

```json
{
  "name": "<unchanged>",
  "version": 4,
  "engine": { "maxVoices": 64, "preload": "all", "cacheBudgetMb": 192, "gain": 1 },
  "defaults": { ... },
  "keys": { ... },
  "checksums": {}
}
```

### A. v1 sprite → v4

Single `sound` file; each `defines` entry is `[offsetMs, durationMs]`.

- `"14": [x, y]` → `keys."14".keydown.samples = [{ file: <sound>, offsetSeconds: x/1000, durationSeconds: y/1000 }]`
- `"14-up": [x, y]` → `keys."14".keyup.samples = [{ file: <sound>, offsetSeconds: x/1000, durationSeconds: y/1000 }]`
- `null` entries skipped. No `defaults`.

### B. v1 multi → v4 (nk-cream)

- `"30": "a.wav"` → `keys."30".keydown.samples = [{ file: "a.wav" }]`
- `null` entries skipped. Unused `sound` fallback dropped. No `defaults`.

### C. v2 multi → v4

- `sound` (e.g. `press/GENERIC_R{0-4}.mp3`) → `defaults.keydown.samples` = the
  template expanded into its full variant list (5 samples), `mode: round-robin`.
- `soundup` → `defaults.keyup.samples`, `priority: 4`.
- `defines` keydown / `-up` overrides → `keys.<kc>.keydown` / `keys.<kc>.keyup`
  (keyup `priority: 4`). Overrides with templates are expanded the same way.

The converter is a scratchpad script, run once, then discarded. After it runs,
each pack is load-tested through `createAudioManifest` to confirm it adapts to a
manifest with the expected keydown (and now keyup) events.

## Part 2 — Remove legacy support (committed code changes)

- **`src/libs/soundpacks/validation.ts`**
  - `SUPPORTED_VERSIONS` → `new Set([3, 4])`.
  - Delete `ValidatedLegacyConfig`; `ValidatedSoundpackConfig = ValidatedV3Config`.
  - Delete `validateSpriteDefinition`.
  - `validateSoundpackConfig`: version is required (no default-to-1); the legacy
    branch (`key_define_type` / `defines` / `sound` / `soundup`) is removed.
  - `listReferencedSoundFiles`: keep only the v3/v4 branch.
  - Delete `expandNumberTemplate` and `expandNumberTemplateVariants`.
- **`src/audio-engine/manifest-adapter.ts`**
  - Delete `adaptV1`, `adaptV2`, `resolveReferences`, and the
    `expandNumberTemplateVariants` import.
  - `createAudioManifest` becomes `version === 4 ? adaptV4 : adaptV3`.
  - Keep `baseLayer`, `adaptV3Layer`, `adaptModern`, and the `keycodesFill`
    import (still used by `adaptModern`).
- **`src/libs/soundpacks/reference-resolver.ts`** — delete the file; its only
  consumer is the test suite.
- **`tests/run.ts`** — remove `validV1`, the legacy-validation / sprite /
  template-expansion / `resolveSoundReference` tests and their imports; keep and
  extend v3 + v4 coverage (including a v4 sprite pack that adapts to keyup).

## Verification

- `npm run verify` (`build:main` → `check-syntax`, `tests/run.js`, `typecheck`)
  is green.
- Each converted pack adapts through `createAudioManifest` to a manifest with
  the expected events.

## Out of scope

No audio files change (sprite packs keep their single OGG). No checksums
computed. No maintained converter tool. No UI changes.
