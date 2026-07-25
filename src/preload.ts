'use strict';

// The renderer windows are bundled as ES modules by Vite. Electron only exposes
// `require` to classic scripts, so the preload script republishes it (plus a few
// helpers) on `window` before any bundle executes.

export interface MechvibesPreloadApi {
  versions: NodeJS.ProcessVersions;
  platform: NodeJS.Platform;
}

declare global {
  interface Window {
    require: NodeRequire;
    __mechvibes__: MechvibesPreloadApi;
  }
}

window.require = require;
window.__mechvibes__ = {
  versions: process.versions,
  platform: process.platform,
};

export {};
