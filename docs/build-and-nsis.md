# Build and Windows installer maintenance

## Build once, package separately

- `npm run verify` compiles and checks the app, tests and website.
- `npm run build:app` compiles the desktop sources and verifies renderer assets.
- `npm run build:win` / `build:mac` / `build:linux` compile then package.
- `npm run package:win` / `package:mac` / `package:linux` package existing build
  output. CI uses these after verification to avoid compiling the same sources
  two or three times. Run `verify` or `build:app` first; the pre-pack hook rejects
  missing main/preload/renderer entry points. It does not establish freshness by
  itself; standalone developers should normally use the `build:*` commands.
- Packaging defaults to `--publish never`. CI release staging remains a separate
  manually published draft workflow, not an electron-builder side effect.
- `npm run build:clean` removes only this repository's `dist` path, independent of
  the caller's working directory. A dist symlink is unlinked, not traversed.

CI caches Electron/electron-builder downloads per OS and lockfile. The Microsoft
runtime cache has a separate content-pin key, and is revalidated before reuse.
Application, upstream and NOTICE license files accompany packaged distributions.

## NSIS prerequisites

`build/windows-runtime.json` pins Microsoft Visual C++ x64 Runtime 14.44.35211.0
by immutable Microsoft URL, exact byte length and SHA-256. `npm run prepare:windows`
can prefetch it. The Windows packaging hook downloads it if needed, checks size
and hash, and on Windows verifies a valid Microsoft Authenticode signature.
Generated files under `build/vendor/` must never be committed. Cross-compilation
on non-Windows hosts verifies the pin but cannot perform Windows Authenticode
trust-chain validation; Windows CI provides that additional gate.

The approximately 25.6 MB prerequisite is embedded in NSIS, so end-user setup no
longer depends on aka.ms availability or downloads an unverified executable.
It is extracted to NSIS's temporary plugin directory and hashed again before
execution. Redistribution is subject to Microsoft's runtime license; the runtime
is not relicensed under this repository's MPL/MIT licenses. Keep its original
Microsoft-signed binary intact.

The hidden prerequisite section runs when installation starts, **before** the
existing app is uninstalled or replaced. It checks the x64 registry's `Installed`
flag and numeric version, skips compatible/newer runtimes, and:

- Requests consent in interactive setup before installing a missing/old runtime.
- Uses elevation for the Microsoft installer while retaining electron-builder's
  per-user/per-machine selection for the application itself.
- For silent setup, fails with 740 if prerequisite installation needs elevation
  and setup is not already elevated. Provision the runtime first for unattended
  non-admin, per-user deployment; no hidden UAC prompt is attempted in that case.
- Treats 0 as success; handles 3010/1641 as restart-required and sets NSIS's reboot
  flag. `/norestart` is passed to Microsoft; this script never issues `Reboot`.
- Accepts 1638 only if a subsequent version check proves a compatible runtime is
  installed. Other failures abort before application files are replaced.
- Uses 1603 for prerequisite failure and 1223 for declining interactive consent.

Setup adds a welcome/license flow, English/Russian language support, and visible
installation details. Default uninstallation preserves settings/custom packs and
never removes the shared Microsoft runtime. Explicit administrator/user deletion
outside this default flow is not prevented.

## Updating the runtime pin

1. Retrieve a new runtime from Microsoft's official Visual C++ redistributable
   documentation/link. Record its immutable download URL, file version, exact
   size and SHA-256 in `build/windows-runtime.json`.
2. Remove the old local `build/vendor/` cache, then run `npm run prepare:windows`.
   A cache with an unexpected digest fails closed instead of being trusted.
3. Run `npm run verify` and Windows packaging. Windows signature verification and
   NSIS compilation must pass. Do not weaken hash/signature checks to fix CI.
4. Test missing, old, current and newer runtime installations, declined UAC,
   interrupted installation, reboot-required results and offline setup on a VM.

## Installer smoke tests

Windows CI runs `tools/smoke-nsis.ps1` on a disposable hosted runner. It silently
installs into a unique temporary directory, verifies packaged app/license files,
reinstalls, uninstalls, and checks that a uniquely named custom-data sentinel
survives. It does not launch the app or delete unrelated user data. The script
refuses to run without Windows CI environment markers.

This catches installer regressions but does not emulate every privilege/UAC or
reboot condition, and it does not prove audible playback. Keep manual VM tests
for standard-user first install, all-user upgrades, unavailable disk space,
locked files, Unicode paths, missing runtime, and reboot-required cases.

## Release metadata and reruns

`npm run release:metadata -- dist` generates a CycloneDX SBOM from the repository
then writes a sorted `SHA256SUMS.txt` that covers it as well as installers, update
metadata and blockmaps. It fails on SBOM errors or an empty installer set, excludes
builder-debug/effective configuration files, and replaces rather than appends
checksums on reruns. The SBOM describes the npm dependency tree, including build
tools; it is not a complete file-level SBOM of Chromium or Microsoft's runtime.

The same command works for `dist-merged` without incorrectly treating that asset
folder as an npm project. Release reruns may overwrite matching assets in an
existing **draft**, preserving release notes. They refuse to modify a published
release and never delete a release or tag. Before manually publishing a refreshed
draft, remove obsolete assets if the build's target list changed.
