# Public website: real repository data, Lucide icons, performance

Date: 2026-07-26
Scope: `public/` (the marketing site published to https://mechvibes-cbc.pages.dev/)

## Problem

The site was inherited from the upstream Mechvibes project and still describes
that project rather than this fork. Everything below is currently wrong:

| Claim on the site | Reality (GitHub API, 2026-07-26) |
| --- | --- |
| `10K+` downloads | 35, summed over the assets of all 5 releases |
| `5+ Years Active` | repository created 2026-07-18 |
| "started in 2021 ... trusted by thousands" | describes upstream Mechvibes, not this fork |
| `v2.4.2` hardcoded in the hero | latest release is v2.5.1 |
| `© 2021-2026` | inherited, never updated |

Two further problems motivated the same pass:

- The site renders emoji (`⚡ 🎛️ 🔊 🛠️ 🎮 📦 🌙 ⌨️`) as its icon set. Emoji
  render differently on every platform and cannot inherit text colour.
- The critical path is slower than it needs to be, and the release data is
  fetched twice.

## Goals

1. No fact about the project is stated in two places. Anything that can change
   is read from the GitHub API at runtime.
2. Icons are real vector icons, consistent in weight, and cost nothing to load.
3. Measurably shorter critical path and no layout shift when data arrives.

## Non-goals

- Redesigning the visual language. Layout, type scale and colour stay as they are.
- Changing the "for Windows" product positioning. The releases do ship macOS
  and Linux artifacts, and the download button will honour that, but the
  marketing copy is a product decision and is left alone.
- Showing download counts or star counts. The user chose product facts over
  vanity metrics.

## Design

### Data layer — `public/github.ts`

A new module owns every piece of remote data. One constant identifies the
repository; URLs, versions, release notes and installer links derive from it.

```ts
export const GITHUB_REPO = 'omnizs38/mechvibes-cbc';
export function loadProjectData(): Promise<ProjectData>;
export function detectPlatform(): Platform;
export function pickInstaller(release: Release, platform: Platform): ReleaseAsset | null;
```

`ProjectData` carries the latest non-draft, non-prerelease release, the release
count, the SPDX licence id and the last push timestamp.

Three properties matter:

- **One request per endpoint per page load.** `loadProjectData` memoises its
  in-flight promise. Today the hero and the download button each issue their
  own `fetch`, and the button's request only starts on click, so the first
  click stalls on a round trip.
- **`sessionStorage` cache, 10 minute TTL.** Unauthenticated GitHub allows 60
  requests/hour/IP; a few reloads during development currently burn through it.
- **Failure is not fatal.** Every consumer renders a static fallback, so the
  page is fully usable when the API is unreachable or rate-limited.

### What the DOM binds to

Elements that display remote data are marked `data-gh="<field>"` and populated
after `loadProjectData` resolves. Static markup keeps a sensible fallback value
so the page is meaningful without JS and for crawlers.

| Slot | Source |
| --- | --- |
| hero "Latest Release" | `latest.tag_name` |
| hero "License" | `repo.license.spdx_id` |
| hero "Status" | derived from `pushed_at` (Active under 90 days, else Maintenance) |
| stat card 1 | release count |
| stat card 2 | latest version |
| stat card 3 | relative "last updated", via `Intl.RelativeTimeFormat` |
| release card | `latest` name, date, truncated body, link |
| Download button | `pickInstaller(latest, detectPlatform())`, falling back to the release page |

The eight hardcoded `https://github.com/omnizs38/...` links are marked
`data-gh-link="repo|issues|releases|readme|license"` and their `href` is set
from `GITHUB_REPO`, so the slug lives in exactly one place.

Release bodies are written with `textContent`, never `innerHTML` — the body is
attacker-controllable by anyone who can publish a release.

### Copy corrections

The About prose is rewritten to describe this fork honestly and to credit
upstream Mechvibes (Hai Nguyen, 2021, MPL-2.0). The footer year is computed.

### Icons — Lucide, inlined

Twelve Lucide icons (`zap`, `sliders-horizontal`, `volume-2`, `code-xml`,
`gamepad-2`, `feather`, `moon`, `sun`, `github`, `circle-alert`, `download`,
`keyboard`) are inlined once as `<symbol>`s in a hidden sprite and referenced
with `<use href="#i-...">`.

The request was for icons "from the internet". Fetching them at runtime from a
CDN would add a DNS lookup, a TLS handshake and a request to the critical path,
and make icons pop in after paint — directly against the performance goal. The
icons still come from Lucide; they are just resolved at authoring time instead
of at page load. Lucide is ISC licensed; attribution is kept in the sprite.

The sprite also replaces the emoji favicon with the `keyboard` glyph.

### Performance

1. **Drop Google Fonts.** The current `<link>` is render-blocking and has no
   `preconnect`, costing two cross-origin round trips before first paint.
   Inter is self-hosted from `public/fonts/inter.woff2` with `font-display: swap`
   and a `<link rel="preload">`.
2. **`preconnect` to `api.github.com`** so the release request starts against a
   warm connection.
3. **`transition: all` replaced with explicit property lists** and a
   `prefers-reduced-motion: reduce` block added.
4. **`content-visibility: auto`** with `contain-intrinsic-size` on the sections
   below the fold.
5. **Reserved space** for every async-populated element, so filling in the
   version and release notes causes no layout shift.

### Responsive

The mobile navigation currently only shrinks its font to 0.75rem at 480px while
competing with the logo and the theme toggle. It gets a proper layout, touch
targets are raised to 44px, and `hero-meta` overflow is fixed.

## Verification

- `npm run build:web` compiles `public/*.ts` without errors.
- `npm run typecheck` passes.
- The page renders correct live values against the real repository.
- With the network blocked, the page still renders with fallbacks and no errors.
- No `\p{Extended_Pictographic}` character remains anywhere under `public/`.
