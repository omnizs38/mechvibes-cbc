# Modernization: behavior changes and verification

This change is intentionally a reviewable maintenance update, not a release tag
or a claim that all historical issues are fixed. Existing soundpack formats and
settings keys remain compatible; favorites add the `mechvibes-favorite-packs` key.

## Changes

### Desktop reliability and security

- All four windows use the existing shared preload and absolute renderer paths.
  The debug window previously pointed at an absent `debug.js`; the editor did
  not configure its shared preload.
- Added navigation/redirect/popup/webview guards, stricter CSP and checked
  HTTP(S) external-link IPC. Privileged handlers validate their owning main frame.
- Invalid update-install requests no longer set the application quitting flag.
- Remote debugging is an explicit Advanced setting, not gated behind an automatic
  backend status request. A canceled enable operation cannot later reactivate
  local remote logging. Existing opted-in startup behavior is retained.
- Recoverable React render failures show a reload screen. Import-time bridge
  failures, preload failures and native crashes are **not** caught by a React
  error boundary; diagnose those using the CLI and native tests below.

### Audio and soundpacks

- Input received while an output is suspended is dropped, not queued for a
  delayed burst. Fresh input plays when the output resumes.
- Clearing the sample cache invalidates in-flight results, including an older
  load completing after a replacement request for the same source.
- Concurrent pinned requests share one decode and preserve the pin.
- Preloading uses up to four simultaneous workers, with deduplication and stable
  result order; clearing prevents queued workers from starting more samples.
- Network sample reads enforce byte limits while streaming and release reader
  locks on failure. Local source reads are size-checked before allocation.
- Removed the redundant unbounded base64 cache; decoded audio remains cached.
  At most two compressed ZIP entry sets are retained. Pinned decoded samples may
  still exceed the configured eviction budget by design.
- ZIPs reject duplicate case-insensitive paths; folder configs have a 1 MiB limit.
  Hidden/interrupted installation folders are excluded from discovery.
- ZIP import checks size before copying. Installation has a cancellation control
  and a unique staging directory; closing the window cancels active downloads.
  Abrupt process termination can leave a hidden staging directory, but it will
  not be offered as a playable soundpack.

### Library and maintenance

- Persistent favorites, Favorites only, Clear filters, and multi-word search over
  pack name, group and ID. The active selection remains visible in its own group
  when it does not match; it is not counted as a search result.
- Fixed the false “Nothing matches” message for a single valid search result.
- Fork links now point to this repository/site; upstream attribution is retained.
- Updated compatible Electron 43, electron-builder and Node type packages with a
  synchronized lockfile. Electron 44 is deliberately deferred until native testing.
- Repaired diagnose/soundpack CLI scripts. Verification includes renderer assets
  and website compilation, with Node 22 and 24 CI coverage and dependency auditing.

## Automated checks

```sh
npm ci
npm run verify
npm run benchmark:audio
npm audit --audit-level=high
npm run diagnose
```

There are 43 existing tests plus 21 focused regression tests in this change.
The benchmark uses a simulated AudioContext and measures JavaScript scheduling
cost only. It does not measure real end-to-end sound latency. Renderer asset
checks are static, not a GUI integration test.

## Required native acceptance checklist

Run on Windows x64, Intel macOS (or x64 under Rosetta), and Linux X11 before release:

- [ ] Clean `npm ci`, `npm start`, and a packaged build start without preload errors.
- [ ] App, Advanced, soundpack installer and editor all mount with no blank windows.
- [ ] First-launch settings and existing user settings both work.
- [ ] Keyboard/mouse sounds, mute hotkey and tray actions work; no burst after sleep.
- [ ] Sustained typing stays responsive with a large pack; switching packs mid-load
      and closing the app during a load produce no unhandled errors.
- [ ] Output-device selection, unplug/replug and system-default fallback work.
- [ ] Search with one match, zero matches, multi-word queries and favorites works;
      favorites survive restart; an active pack outside a filter stays selected.
- [ ] Valid ZIP import succeeds; malformed, oversized and duplicate-path ZIPs fail
      without replacing an installed soundpack.
- [ ] Cancel a download and close its window mid-install; installed content is
      unchanged and hidden staging content is not listed as a pack.
- [ ] Remote debugging remains off until opted in; disable during enable does not
      reactivate logging. Test only with explicit consent to send diagnostic data.
- [ ] Installer/uninstaller, update consent and all three package jobs pass.

Not included: a fully sandboxed Electron architecture, native Apple Silicon
release artifacts, guaranteed Wayland global hooks, signing/notarization changes,
or a real-hardware latency certification.
