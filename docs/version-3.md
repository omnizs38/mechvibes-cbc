# Mechvibes-cbc 3.0 beta

Current source version: **3.0.0-beta.1**. This prepares a beta; it does not publish
an installer or change the stable download channel. Only a reviewed, explicitly
created release tag starts the existing release workflow.

## Sound profiles

Choose a soundpack, adjust volume/output, enter a name under **Sound profiles**,
then **Save current**. A profile contains an ID, name, soundpack ID, volume (0–200)
and audio-output device ID. It does not contain audio, typed keys, authentication,
update channels or remote-debug preferences.

**Apply** loads the matching installed soundpack, selects the requested output,
and sets the volume. An unavailable saved output falls back to the system default
with a message when supported. A missing soundpack disables Apply: install the
pack separately. Application is sequential, not a filesystem transaction; if
both requested and default device selection fail, the selected pack may have
changed but the profile volume is not applied, and the error remains visible.

**Export profiles** writes a versioned JSON file using the OS save dialog.
**Import profiles** validates the entire file before writing settings, merges new
IDs, and preserves existing IDs on collisions. Maximum 32 profiles and 64 KiB per
backup. Rename/delete profile entries through the app or edit a backup carefully;
unsupported schema versions and invalid contents are rejected. Corrupt stored
profiles are shown as an error, not silently cleared. Reset is explicit and asks
for confirmation; it touches only profile settings.

Output device identifiers are local preferences and may reveal device metadata.
Review backups before sharing. A backup from another computer does not install
soundpacks or guarantee the same audio devices are available there.

## Compatibility

The app ID, product name and user-data location are unchanged from 2.x. Existing
packs, favorites, volume and update settings stay where they were. The new key is
`mechvibes-profiles`; older versions can ignore it. Keep your profile export if
testing a downgrade. No format conversion or deletion of existing audio occurs.

Quick mute uses an owning-window/main-frame checked IPC message. System
suspend/resume resets both the main-process modifier latch and renderer key set,
so a missing key-up during sleep does not leave a key permanently held.

## Website development

```sh
npm ci
npm run build:web
python3 tools/serve-site.py
```

The server mirrors the Cloudflare response headers. Generated `public/*.js` files
are committed because the static hosting output is `public/`; edit TypeScript,
then rebuild before committing. No bundler or CDN dependency is needed on the
website. Font and mark assets are local.

```sh
npm run verify
npx playwright install --with-deps chromium
npm run test:site
```

The browser suite covers desktop light/dark and 390 px mobile, published download
links, theme persistence, opt-in audio, failure/retry, unsafe release notes, FAQ
keyboard interaction, reduced motion and automated WCAG A/AA checks. Browser
automation does not certify audible hardware playback or every assistive device.
The local visual QA also includes a 320 px viewport.

The sound toy synthesizes noise-based switch-like clicks. It is explicitly
labeled as a browser demo, not a sample of the installed engine or a latency
benchmark. Only its textarea listens for typing; it never sends or stores text.
The only application network request is public GitHub release metadata.

## Required desktop acceptance before release

- [ ] Upgrade an existing 2.x install and confirm packs/settings remain available.
- [ ] Save/apply/delete several profiles and restart the app.
- [ ] Export/import profiles on the same machine and another machine; verify ID
      conflicts, missing packs and unavailable outputs are explained correctly.
- [ ] Mute from the header, hotkey and tray; check all three stay synchronized.
- [ ] Suspend/resume with modifier keys held; no stuck visual keys or mute latch.
- [ ] Repeat native output-device, audio, installer and update acceptance from
      `docs/modernization.md` and `docs/build-and-nsis.md`.

Cloudflare preview deployment and CI packaging are not production release
publication. Do not merge/publish a beta solely because the website looks correct.
