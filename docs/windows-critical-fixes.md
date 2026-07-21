# Windows critical-fix verification

This document defines the release gate for the Windows 10/11 x64 stability patch. The baseline is `main` at commit `b7cb6332fa741f82bdf2281bf6d2b9990e84ddbb`.

## Scope

The first stage deliberately keeps Electron 12 and `iohook` 0.9.3 to avoid combining user-facing fixes with a native-runtime migration. It addresses:

- duplicate and racing soundpack loads;
- loss of the working pack when a replacement fails;
- early completion of multi-file pack loading;
- malformed folder and ZIP isolation;
- bounded archive, file, manifest, and download sizes;
- transactional soundpack installation;
- finite, clamped active-volume gain;
- keyboard navigation, focus visibility, status announcements, and disabled actions;
- repeatable tests and a Windows x64 build job.

## Automated checks

Use Node.js 16.20.2, matching `.nvmrc` and `package.json`.

```text
npm run verify
npm ci --no-audit --no-fund
npm run build:win -- --publish never
```

`npm run verify` is dependency-free and checks JavaScript syntax, all bundled `config.json` files, unit coverage, soundpack selection races, timeout cleanup, and a mocked renderer startup.

The GitHub Actions workflow runs verification on Linux and performs the locked dependency install and NSIS build on `windows-latest`. The Windows artifact is retained for 14 days.

## Manual Windows matrix

Run these checks on a clean Windows 10 or Windows 11 x64 VM and on an upgraded profile containing existing settings and custom soundpacks.

| Area | Procedure | Pass condition |
| --- | --- | --- |
| Cold launch | Start Mechvibes with the default pack and inspect `mechvibes.log`. | UI becomes usable, the selected pack loads once, and no unhandled error appears. |
| First sound | Type immediately after launch, then after 1, 5, and 15 minutes idle or minimized. | The first key sound is not perceptibly delayed or dropped. |
| Rapid switching | Alternate among three packs at least 20 times, including large v2 multi-file packs. | The final selected pack wins, stale loads do not replace it, and memory settles after switching. |
| Failed switch | Select a pack with missing or corrupt audio while a valid pack is active. | A clear error is announced and the previous pack continues to play. |
| Startup isolation | Place malformed JSON, an unsupported version, and an oversized ZIP in the custom directory. | Mechvibes starts, skips each invalid pack, and reports the skipped count. |
| Volume | Test configured values 0, 50, 100, and 200 with system volume 0, 1, 50, and 100. | Gain is finite, never exceeds 2.0, mute produces no sound, and value 0 persists after restart. |
| Keyboard UI | Navigate with Tab, Shift+Tab, arrows, Space, and Enter at 100%, 150%, and 200% display scaling. | Every action is reachable, focus is visible, labels are announced, and disabled actions cannot run. |
| High contrast | Enable a Windows high-contrast theme. | Focus, borders, text, slider, and checkbox remain discernible. |
| Installer success | Install a valid pack over an existing pack with the same folder name. | The new pack replaces the old one only after complete download and validation. |
| Installer failure | Interrupt a download and test an invalid manifest/path. | No partial target pack remains and the previous installed pack is preserved. |
| Tray and quit | Toggle the tray icon off/on, minimize, reopen, mute, and quit. | No duplicate tray icon appears; disabling the tray does not recreate it; quit exits cleanly. |

## Performance record

Record three runs before and after the patch using the same VM and soundpack.

| Metric | Baseline median | Patched median | Target |
| --- | ---: | ---: | ---: |
| Initial Howl constructions with a saved pack | 2 | 1 | Exactly one initial load |
| Howl objects for a bundled v2 multi-file pack | 222 | At most 12 | One object per unique audio source |
| Process start to main window usable | TBD | TBD | No regression above 10% |
| Initial bundled pack load duration | TBD | TBD | No regression above 10% |
| Large v2 pack load | TBD | TBD | Complete only after every audio resource loads |
| First-key response after 15 minutes idle | TBD | TBD | No perceptible delay or dropped event |
| Idle CPU after 5 minutes | TBD | TBD | No regression above 1 percentage point |
| Working set after 20 pack switches | TBD | TBD | Settles; no monotonic growth |

Pack-load duration is written to `mechvibes.log`. Capture process timing, CPU, and working set with Windows Performance Recorder or Process Explorer.

## Known verification limitation

The sandbox used to prepare this patch blocks selected npm tarballs with HTTP 403, so a full Electron dependency install and Windows build cannot be completed locally here. Dependency-free verification passes locally; the `windows-build` GitHub Actions job is the required authoritative build gate.

## Rollback

Do not merge directly to `main`. Keep the work in a dedicated branch and merge only after the Windows job and manual matrix pass. If a regression appears, revert the single critical-fix merge commit; soundpack formats, `electron-store` keys, and the custom-pack directory remain backward compatible.

## Stage two: runtime modernization

Treat this as a separate pull request series after the critical patch is stable:

1. Split renderer and preload responsibilities, enable `contextIsolation`, remove `remote`, disable renderer Node integration, and replace broad IPC with a narrow validated API.
2. Remove `webSecurity: false`, tighten Content Security Policy, and move network/file operations to the main process.
3. Upgrade Electron in supported increments and replace `iohook` with a maintained Windows global-input implementation whose native binaries are reproducibly built and signed.
4. Add real Electron smoke tests, Windows code signing, update-channel verification, and CPU/memory performance budgets.
5. Validate settings and soundpack migration against MechvibesDX before ending legacy support.
