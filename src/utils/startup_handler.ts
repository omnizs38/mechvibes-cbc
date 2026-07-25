'use strict';

import type { App } from 'electron';

class StartupHandler {
  readonly app: App;

  constructor(app: App) {
    this.app = app;
  }

  get is_enabled(): boolean {
    return this.app.getLoginItemSettings().openAtLogin;
  }

  get was_started_at_login(): boolean {
    if (process.platform === 'darwin') {
      return Boolean(this.app.getLoginItemSettings().wasOpenedAtLogin);
    }
    return process.argv.includes('--startup');
  }

  enable(): void {
    this.app.setLoginItemSettings({
      openAtLogin: true,
      args: ['--startup'],
    });
  }

  disable(): void {
    this.app.setLoginItemSettings({
      openAtLogin: false,
    });
  }

  toggle(): void {
    if (this.is_enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }
}

export = StartupHandler;
