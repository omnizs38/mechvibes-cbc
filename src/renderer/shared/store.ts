import { appRoot, nodePath, remote } from './electron';

type ElectronStore = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
};

type StoreConstructor = new () => ElectronStore;

/**
 * Load electron-store inside the main process.
 *
 * Two separate traps have to be avoided here.
 *
 * The library reads `app.getPath('userData')` when constructed, and falls back
 * to `electron.remote.app` when `app` is missing. That fallback disappeared in
 * Electron 14, so constructing the store in the renderer throws
 * "Cannot read properties of undefined (reading 'app')" at module scope, long
 * before React can mount — which paints the window blank.
 *
 * Going through `remote.require` fixes that, but a bare specifier is resolved
 * relative to @electron/remote itself (the require stack reads just
 * "electron"), so the package is not found. Resolving it from the application
 * root works in development and inside app.asar alike, because Node reads asar
 * archives transparently.
 */
function loadStoreConstructor(): StoreConstructor {
  const candidates = [nodePath.join(appRoot, 'node_modules', 'electron-store'), 'electron-store'];
  const failures: string[] = [];

  for (const id of candidates) {
    try {
      // electron-store v9+ is an ES module whose class is the default export;
      // remote.require() returns the module namespace under require(ESM), so
      // unwrap `.default` (falling back to the module for older CJS builds).
      const mod = remote.require(id) as { default?: StoreConstructor };
      return (mod.default ?? mod) as StoreConstructor;
    } catch (error) {
      failures.push(id + ': ' + (error as Error).message);
    }
  }

  throw new Error(
    'electron-store could not be loaded in the main process.\n' + failures.join('\n'),
  );
}

const Store = loadStoreConstructor();

/** Settings store living in the main process, proxied over @electron/remote. */
export const store: ElectronStore = new Store();

export function readString(key: string, fallback = ''): string {
  const value = store.get(key);
  return typeof value === 'string' ? value : fallback;
}

export function readNumber(key: string, fallback: number): number {
  if (!store.has(key)) return fallback;
  const value = Number(store.get(key));
  return Number.isFinite(value) ? value : fallback;
}

export function readBoolean(key: string, fallback: boolean): boolean {
  return store.has(key) ? Boolean(store.get(key)) : fallback;
}
