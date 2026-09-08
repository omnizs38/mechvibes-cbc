# Contributing

Use Node.js from `.nvmrc` (22.22.0) or Node.js 24, and install with `npm ci`.
Do not edit emitted JavaScript or `src/renderer-dist/`: the TypeScript sources
are authoritative. Do not commit generated diagnostics, installers or local logs.

## Before opening a pull request

```sh
npm ci
npm run verify
npm run benchmark:audio
npm audit --audit-level=high
```

`verify` compiles the main process, checks syntax and bundled soundpacks, runs
both test suites, type-checks all TypeScript projects, builds all four renderer
windows, checks their asset references/CSP/preload, and compiles the website.
The legacy integration-style tests live in `tests/run.ts`; focused regressions
use Node's built-in test runner in `tests/modernization.test.ts`.

Format files you change with Prettier. Avoid formatting unrelated files in the
same change. `npm run lint` currently aliases type checking; it is not ESLint.

`npm run dev:renderer` serves assets for renderer development; opening its URL in
an ordinary browser does not supply Electron's runtime bridge. Use `npm start`
for a full application run.

## Native testing

A passing TypeScript build or synthetic audio benchmark is not proof of working
keyboard hooks, audible output, correct device routing, or a working installer.
Use the checklist in [docs/modernization.md](docs/modernization.md). CI packaging
on Windows/macOS/Linux is separate from manual native behavior testing.

## Dependencies and releases

Keep `package.json` and `package-lock.json` synchronized. Prefer compatible
patch/minor updates; do not force major upgrades merely to silence warnings.
Electron major upgrades, removal of `@electron/remote`, signing/notarization and
new target architectures require dedicated validation. Do not publish a release
or merge a broad modernization PR before reviewing native test results.

## Website checks

`npm run verify` also builds and validates the static website and runs release-data
unit tests. For browser coverage, install Chromium with `npx playwright install
--with-deps chromium`, then run `npm run test:site`. CI runs this on desktop light,
desktop dark and mobile, including axe accessibility checks. Review generated
`public/*.js` alongside their TypeScript sources; do not publish an unreleased
version as a download on the landing page.
