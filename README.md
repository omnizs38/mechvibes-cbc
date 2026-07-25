# Mechvibes-cbc

<p align="center">
  <img src="https://mechvibes.com/images/icon.png" alt="Mechvibes-cbc Logo" width="128">
</p>

<h3 align="center">A modern, open-source application that brings the sound of mechanical keyboards to any keyboard on Windows, macOS, and Linux.</h3>

---

<p align="center">
  <a href="https://mechvibes-cbc.pages.dev/">
    <img src="https://img.shields.io/badge/Website-mechvibes--cbc.pages.dev-8A2BE2?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Website">
  </a>
  <a href="https://github.com/omnizs38/mechvibes-cbc/releases/latest">
    <img src="https://img.shields.io/github/v/release/omnizs38/mechvibes-cbc?style=for-the-badge&color=2ECC71&logo=github&logoColor=white&label=Release" alt="Latest Release">
  </a>
  <a href="https://github.com/omnizs38/mechvibes-cbc/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/omnizs38/mechvibes-cbc?style=for-the-badge&color=3498DB&label=License" alt="License">
  </a>
  <a href="https://github.com/omnizs38/mechvibes-cbc/actions/workflows/ci.yml">
    <img src="https://img.shields.io/github/actions/workflow/status/omnizs38/mechvibes-cbc/ci.yml?branch=main&label=CI&style=for-the-badge&logo=github-actions&logoColor=white&color=2ECC71" alt="CI Status">
  </a>
</p>

<p align="center">
  <a href="https://github.com/omnizs38/mechvibes-cbc/releases">
    <img src="https://img.shields.io/github/downloads/omnizs38/mechvibes-cbc/total?style=flat-square&color=orange&logo=github&label=Downloads" alt="Downloads">
  </a>
  <a href="https://github.com/omnizs38/mechvibes-cbc/stargazers">
    <img src="https://img.shields.io/github/stars/omnizs38/mechvibes-cbc?style=flat-square&color=yellow&logo=github&label=Stars" alt="Stars">
  </a>
  <a href="https://github.com/omnizs38/mechvibes-cbc/issues">
    <img src="https://img.shields.io/github/issues/omnizs38/mechvibes-cbc?style=flat-square&color=red&logo=github&label=Issues" alt="Issues">
  </a>
  <a href="https://github.com/omnizs38/mechvibes-cbc/pulls">
    <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square&logo=github" alt="PRs Welcome">
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows Support">
  <img src="https://img.shields.io/badge/macOS-000000?style=flat-square&logo=apple&logoColor=white" alt="macOS Support">
  <img src="https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black" alt="Linux Support">
  <img src="https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/React-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React">
</p>

---

This repository is an actively maintained fork of the original Mechvibes project with numerous improvements, fixes, and new features.

Official website: **[mechvibes-cbc.pages.dev](https://mechvibes-cbc.pages.dev/)**

---

## System Requirements / Системные требования

This project runs natively across major platforms. Below are the minimal OS and runtime version requirements:

* **Windows**:
  * **OS Version**: Windows 10 (Build 1903/19H1) or later (64-bit).
  * **Runtime**: Electron 43.1+ base, Node.js 22.

* **macOS**:
  * **OS Version**: macOS 10.15 (Catalina) or later.
  * **Architecture**: Intel (`x64`) & Apple Silicon natively compatible.

* **Linux**:
  * **Linux Kernel**: Kernel version **5.4** or newer (with standard user namespaces enabled for Electron sandbox).
  * **GLIBC Requirement**: **`glibc 2.31`** or newer (Ubuntu 20.04+, Debian 11+, Fedora 32+).
  * **Formats**: Available as Debian packages (`.deb`), snappy packages (`.snap`), and universal standalone `.AppImage` runtimes.

---

## Features

- 🎹 Realistic mechanical keyboard sound simulation
- 🎵 Support for Soundpack v1, v2 and v3
- ⚡ Low-latency Web Audio playback engine
- 🎧 Output device selection
- 🌙 Dark mode support
- 📦 Easy soundpack installation and management
- 🖱️ Keyboard and mouse sound support
- 🔄 Stable and beta update channels
- 🪟 Improved Windows compatibility
- 🚀 Modern Electron runtime
- 🛠️ Continuous fixes and improvements

---

## What's New in This Fork

This fork focuses on improving the original Mechvibes experience while remaining compatible with the existing ecosystem.

Highlights include:

- Modernized Electron runtime
- Fully typed TypeScript codebase and a React user interface
- Updated global input hook
- Improved Windows stability
- Better release automation
- Soundpack v3 support
- Lower audio latency
- Safer soundpack management
- Numerous bug fixes and performance improvements
- Ongoing maintenance and feature development

Additional documentation:

- `docs/soundpack-v3.md`
- `docs/releases.md`
- `docs/windows-critical-fixes.md`

---

## Installation

Download the latest release from:

https://github.com/omnizs38/mechvibes-cbc/releases/latest

Run the installer and enjoy.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Desktop shell | Electron 43 |
| Main process | TypeScript 7, compiled with `tsc` to CommonJS next to the sources |
| Renderer | React 19 + TypeScript, bundled by Vite into `src/renderer-dist/` |
| Windows | `app`, `install`, `debug`, `editor` — one HTML entry point each |
| Audio | Web Audio engine with sample cache, voice pool and latency tracking |
| Global input | `uiohook-napi` |
| Packaging | electron-builder (NSIS, DMG, deb/snap/AppImage) |

Every source file under `src/`, `tools/` and `tests/` is TypeScript. The compiled
JavaScript (`src/**/*.js`, `tools/**/*.js`, `tests/**/*.js`) and the renderer
bundle (`src/renderer-dist/`) are build artefacts: they are ignored by git and
regenerated by the scripts below, so always build before running or packaging.

---

## Building from Source

Requires **Node.js 22.22.0** (see `.nvmrc`).

```sh
npm ci
npm run verify
npm start
```

`npm start` compiles the main process, bundles the renderer and launches
Electron. The individual steps are also available:

| Script | Purpose |
| --- | --- |
| `npm run build:main` | Compile `src/`, `tools/` and `tests/` with `tsc` |
| `npm run build:renderer` | Bundle the four renderer windows with Vite |
| `npm run dev:renderer` | Vite dev server for renderer work |
| `npm run typecheck` | Type-check the main process and the renderer |
| `npm run check` | Syntax and soundpack sanity checks |
| `npm test` | Run the test suite |
| `npm run verify` | `check` + `test` + `typecheck` + `lint` (the CI gate) |
| `npm run format` | Format sources with Prettier |

Build installers (each target compiles the sources first):

```sh
npm run build:win
npm run build:mac
npm run build:linux
```

On Windows, packaging rebuilds the native `uiohook-napi` module, which requires
**Visual Studio Build Tools** with the "Desktop development with C++" workload.
Without it electron-builder fails with `Could not find any Visual Studio
installation to use`. The release workflow builds all three platforms on GitHub
Actions, where the toolchains are preinstalled.

---

## Documentation

- Soundpack v3 Specification
- Release Process
- Windows Critical Fix Verification

See the `docs/` directory.

---

## Contributing

Contributions are welcome.

If you find a bug or have an idea for a new feature, feel free to open an issue or submit a pull request.

Before opening a pull request, run `npm run verify` — the same script gates CI.

---

## License

This repository is a fork of the original **Mechvibes** project created by **Hai Nguyen**.

- The original upstream source code is licensed under the **MIT License**.
  See **LICENSE.MIT**.

- Modifications and new contributions made by **omnizs38** are licensed under the **Mozilla Public License Version 2.0 (MPL-2.0)**.
  See **LICENSE**.

Additional copyright and licensing information is available in the **NOTICE** file.

---

## Credits

Original project:

https://github.com/hainguyents13/mechvibes

Thanks to Hai Nguyen for creating the original Mechvibes project and to everyone who has contributed to both the upstream project and this fork.
