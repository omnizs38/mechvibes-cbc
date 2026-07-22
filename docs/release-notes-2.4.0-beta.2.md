# Mechvibes 2.4.0-beta.2

Mechvibes 2.4.0-beta.2 is the first distributable preview of the 2.4 runtime foundation. It moves the default v1 and v2 soundpack path to a low-latency Web Audio engine while keeping the previous Howler implementation available as an emergency rollback.

## Highlights

- Added a unified Web Audio manifest for v1, v2, and v3 soundpacks.
- Added soundpack v3 layers, weighted or round-robin sample selection, pitch variation, envelopes, configurable preload behavior, optional SHA-256 integrity checks, and author/license metadata.
- Added decoded-sample caching, shared buffers, bounded LRU eviction, voice budgeting, and input-latency metrics.
- Added selectable audio outputs with fallback to the system default when a saved device is unavailable.
- Added an in-app stable/beta update channel with explicit consent before download or installation.
- Added refresh, import, open-folder, and delete controls for local soundpacks.
- Added a dark theme and improved keyboard accessibility for critical controls.

## Windows startup fix

The Windows keycode remapper could create aliases without sound definitions. Those empty aliases reached the Web Audio manifest and caused initial soundpack loading to fail with `Sound unavailable`. Empty aliases are now filtered before either audio engine sees them, with regression coverage for the Windows renderer path.

## Security and reliability

- Updated `adm-zip` to 0.6.0 for GHSA-xcpc-8h2w-3j85.
- Updated `tmp` to 0.2.7 for GHSA-ph9p-34f9-6g65.
- Refreshed vulnerable production transitive locks for `ajv` and `js-yaml`.
- Added strict soundpack path validation, archive and file-size limits, optional v3 checksums, transactional installs, rollback on replacement failure, and bounded streamed downloads.
- Added transactional soundpack selection so failed or stale concurrent loads cannot replace the active pack.

## Verification

- Node.js 22.22.0 syntax, soundpack, test, typecheck, and lint gates pass.
- 32 of 32 automated tests pass, including the forced Windows renderer path.
- GitHub dependency review passes.
- The Windows x64 NSIS build passes and produces an installer artifact.
- Runtime dependency audit reports zero vulnerabilities.

## Beta limitations

- Windows x64 is the release gate; Windows arm64 remains deferred.
- Builds are unsigned and may trigger Microsoft SmartScreen warnings.
- The Howler fallback remains available by setting `MECHVIBES_LEGACY_AUDIO=1` before launch.
- This is prerelease software. Back up custom soundpacks before testing import or deletion workflows.
