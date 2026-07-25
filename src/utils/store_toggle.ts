'use strict';

import Store from 'electron-store';

const store = new Store();

class StorageToggle {
  readonly key: string;
  readonly default: boolean;

  constructor(key: string, defaultVal: boolean) {
    this.key = key;
    this.default = defaultVal;
  }

  get is_enabled(): boolean {
    if (!store.has(this.key)) return this.default;
    return Boolean(store.get(this.key));
  }

  enable(): void {
    store.set(this.key, true);
  }

  disable(): void {
    store.set(this.key, false);
  }

  toggle(): void {
    if (this.is_enabled) {
      this.disable();
    } else {
      this.enable();
    }
  }
}

export = StorageToggle;
