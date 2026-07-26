'use strict';

type StoreLike = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
};

type StoreConstructor = new () => StoreLike;

type RemoteModule = {
  app: { getAppPath(): string };
  require(id: string): unknown;
};

let cachedStore: StoreLike | null = null;

/**
 * Resolve the settings store for whichever process we are running in.
 *
 * electron-store reads `app.getPath('userData')` on construction. That only
 * works in the main process; elsewhere it falls back to `electron.remote.app`,
 * removed from Electron in v14, and throws before anything else runs. This
 * module is loaded from both sides — directly by the main process, and through
 * `requireFromSrc` by the renderer — so the constructor must be picked at call
 * time rather than at import time.
 *
 * On the renderer side the package is resolved from the application root:
 * @electron/remote resolves bare specifiers relative to itself and would not
 * find it otherwise.
 */
function getStore(): StoreLike {
  if (cachedStore) return cachedStore;

  const electron = require('electron') as { app?: unknown };

  // electron-store v9+ is an ES module whose class is the default export.
  // require()/remote.require() returns the module namespace under Node's
  // require(ESM), so unwrap `.default` (with a fallback for older CJS builds).
  const unwrap = (mod: unknown): StoreConstructor =>
    ((mod as { default?: StoreConstructor }).default ?? mod) as StoreConstructor;

  let StoreCtor: StoreConstructor;
  if (electron.app) {
    StoreCtor = unwrap(require('electron-store'));
  } else {
    const remote = require('@electron/remote') as RemoteModule;
    const path = require('path') as typeof import('node:path');
    const absolute = path.join(remote.app.getAppPath(), 'node_modules', 'electron-store');
    try {
      StoreCtor = unwrap(remote.require(absolute));
    } catch {
      StoreCtor = unwrap(remote.require('electron-store'));
    }
  }

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
