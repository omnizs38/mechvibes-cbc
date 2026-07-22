'use strict';

// Resolves the electron-log "sender" label for a webContents IPC event.
//
// `event.sender.browserWindowOptions` is an internal, undocumented Electron
// property that is `undefined` for webContents not created directly via
// `new BrowserWindow(...)` (e.g. guest/offscreen content or early-lifecycle
// timing). The options object itself must be guarded before dereferencing
// `.name`, otherwise the log handler throws `TypeError: Cannot read properties
// of undefined (reading 'name')` and crashes the app on startup.
function resolveLogSenderName(event) {
  const window_options = event.sender.browserWindowOptions;
  if (window_options && typeof window_options.name === 'string') {
    return window_options.name;
  }
  return 'u/w';
}

module.exports = { resolveLogSenderName };
