# Automated Windows releases

## One-time GitHub setup

1. Open repository Settings, then Environments.
2. Create an environment named `release`.
3. Add at least one required reviewer.
4. Keep the workflow token at its default read-only scope; the protected publish job requests `contents: write` only after approval.
5. Do not add signing certificates or passwords until Windows signing is intentionally configured.

## Prepared beta candidate

The next candidate is `2.4.0-beta.2`. Review its [release notes](release-notes-2.4.0-beta.2.md), merge the release preparation branch, and tag the resulting `main` commit as `v2.4.0-beta.2`. Do not tag the unmerged release branch.

## Beta release

1. Set `package.json` and both package-lock version fields to `2.4.0-beta.N`.
2. Commit and push the release candidate.
3. Create and push the matching tag:

```text
git tag -a v2.4.0-beta.N -m "Mechvibes 2.4.0 beta N"
git push origin v2.4.0-beta.N
```

The release workflow validates the version, installs the lockfile, runs all gates, builds the unsigned x64 NSIS installer, generates update metadata, SHA-256 checksums, and a CycloneDX SBOM. The publish job waits for approval in the `release` environment. After approval, the tag is published as a GitHub prerelease.

Users on the stable channel do not receive beta releases. Beta users must opt in through the update channel selector.

## Stable release

Repeat the process with package version `2.4.0` and tag `v2.4.0`. A stable release must not be tagged until the beta soak and Windows acceptance matrix pass.

## Update behavior

- The application checks after startup, every six hours, and on demand.
- It never downloads before the user confirms.
- It never restarts before the user confirms.
- Drafts and unapproved workflow artifacts are not update-visible.
- Failed or offline checks do not interrupt audio playback.
- A disconnected output device falls back to the system default.

## Unsigned preview warning

The initial beta and stable candidates are unsigned by explicit project decision. Windows SmartScreen can warn users and update identity assurance is weaker than a signed release. Broad stable distribution should wait for OV, EV, or Azure Trusted Signing. Signing credentials belong only in protected CI secrets and must never be committed.

## Audio rollback switch

The beta keeps the previous Howler-based v1/v2 path as an emergency fallback. For a development or diagnostic run, set `MECHVIBES_LEGACY_AUDIO=1` before launching Mechvibes. Soundpack v3 always uses the Web Audio engine. The fallback is temporary and should be removed only after beta soak proves parity.

## Rollback

If a release is bad, stop approval before publishing. If already published, mark it as a prerelease or remove the release assets, restore the previous published version, and issue a higher patch version. Never reuse a published version number with different bytes.

## Windows arm64

The 2.4.0 release gate is Windows x64. Arm64 is intentionally deferred until the native input hook, installer, and audio device tests pass on real arm64 hardware. The release workflow is structured so an arm64 matrix entry can be added without changing update semantics.
