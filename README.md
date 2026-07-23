# Mechvibes-cbc

<p align="center">
  <img src="https://mechvibes.com/images/icon.png" alt="Mechvibes-cbc Logo" width="128">
</p>

A modern, open-source application that brings the sound of mechanical keyboards to any keyboard on Windows, macOS, and Linux.

---

<p align="center">
  <a href="https://mechvibes-cbc.pages.dev/"><img src="https://img.shields.io/badge/Website-mechvibes--cbc.pages.dev-blueviolet?style=for-the-badge&logo=cloudflare&logoColor=white" alt="Website"></a>
  <a href="https://github.com/omnizs38/mechvibes-cbc/releases/latest"><img src="https://img.shields.io/github/v/release/omnizs38/mechvibes-cbc?style=for-the-badge&color=success&logo=github" alt="Latest Release"></a>
  <img src="https://img.shields.io/github/license/omnizs38/mechvibes-cbc?style=for-the-badge&color=blue" alt="License">
  <img src="https://img.shields.io/github/actions/workflow/status/omnizs38/mechvibes-cbc/ci.yml?branch=main&label=CI&style=for-the-badge&logo=github-actions&logoColor=white" alt="CI Status">
</p>

---

This repository is an actively maintained fork of the original Mechvibes project with numerous improvements, fixes, and new features.

Official website: **[mechvibes-cbc.pages.dev](https://mechvibes-cbc.pages.dev/)**

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

## Building from Source

Requires **Node.js 22.22.0**.

```sh
npm ci
npm run verify
npm start
```

Build installers:

```sh
npm run build:win
npm run build:mac
npm run build:linux
```

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
