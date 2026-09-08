# Changelog

## 3.0.0-beta.1 — unreleased

### Desktop
- Named sound profiles for soundpack, volume and output device; apply, delete,
  export and merge/import JSON backups without overwriting existing profile IDs.
- Validate profile schema, count (32), text lengths, numeric ranges and backup
  size (64 KiB). Read imports through one descriptor with a bounded byte budget.
- Explicit recovery action for corrupt profile settings; existing settings are
  never reset implicitly.
- Quick mute/resume in the main window, synchronized with the tray checkbox and
  mute hotkey. Reset held-key/modifier state after system suspend/resume.
- Stable output-device hook dependencies to prevent repeated enumeration caused
  by a newly created callback on every render.
- Visible startup/discovery failure messages instead of an unhandled promise;
  reject non-finite volume changes. Increase the main window's starting size.

### Website
- Minimal liquid-glass design with a new local SVG mark, restrained color,
  translucent surfaces, readable type, and desktop/mobile layouts.
- Light, dark and system themes, with pre-paint initialization and optional
  storage; reduced motion/transparency and forced-color fallbacks.
- Opt-in, synthesized browser sound preview with three characters, volume,
  clickable keys and a scoped typing field. No microphone, typing persistence,
  analytics, or global key capture. It is not the desktop sound engine.
- Explicit Windows/macOS/Linux downloads from validated published release assets;
  stable preference, mobile/iPad detection, timeouts, retry and labeled stale-cache
  fallback. The site never claims this unreleased 3.0 build is a published download.
- Safe release-note DOM rendering retained; Cloudflare CSP/permissions headers,
  canonical/Open Graph metadata, robots and sitemap added. Correct upstream
  attribution (original MIT; fork modifications MPL-2.0).

### Quality and compatibility
- Profile/file/import/release-data tests and a dedicated Playwright/axe CI job
  covering desktop light, desktop dark and mobile browsers.
- Static website asset/anchor/ID verification included in `npm run verify`.
- Keep application ID, product name, user-data location and soundpack formats
  unchanged so existing installations retain settings and packs.
- This is a beta source change, not a release tag or a published update. Existing
  Electron renderer Node integration and @electron/remote remain; no complete
  sandbox migration is claimed.
