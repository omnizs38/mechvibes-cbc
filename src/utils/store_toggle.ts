'use strict';

type StoreLike = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
};

type StoreConstructor = new () => StoreLike;

let cachedStore: StoreLike | null = null;

/**
 * Resolve the settings store for whichever process we are running in.
 *
 * electron-store reads `app.getPath('userData')` when it is constructed. That
 * only works in the main process; elsewhere the library falls back to
 * `electron.remote.app`, which Electron removed in v14, and the module throws
 * before anything else can run. This file is loaded from both sides — the main
 * process requires it directly, the renderer through `requireFromSrc` — so the
 * constructor has to be chosen at call time, not at import time.
 *
 * Building it lazily also keeps a stray import from touching the filesystem.
 */
function getStore(): StoreLike {
  if (cachedStore) return cachedStore;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electron = require('electron') as { app?: unknown };
  const StoreCtor: StoreConstructor = electron.app
    ? // eslint-disable-next-line @typescript-eslint/no-var-requires
      (require('electron-store') as StoreConstructor)
    : // eslint-disable-next-line @typescript-eslint/no-var-requires
      (require('@electron/remote').require('electron-store') as StoreConstructor);

  cachedStore = new StoreCtor();
  return cachedStore;
}

class StorageToggle {
  readonly key: string;
  readonly default: boolean;

  constructor(key: string, defaultVal: boolean) {
    this.key = key;
    this.default = defaultVal;
  }

  get is_enabled(): boolean {
    const store = getStore();
    if (!store.has(this.key)) return this.default;
    return Boolean(store.get(this.key));
  }

  enable(): void {
    getStore().set(this.key, true);
  }

  disable(): void {
    getStore().set(this.key, false);
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
