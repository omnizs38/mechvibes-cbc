import { remote } from './electron';

type ElectronStore = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
};

/**
 * electron-store must be instantiated in the main process.
 *
 * The library derives its default `cwd` from `app.getPath('userData')`, and
 * when `app` is absent it falls back to `electron.remote.app` — a module that
 * was removed from Electron in v14. Requiring it straight from the renderer
 * therefore throws "Cannot read properties of undefined (reading 'app')"
 * before a single component renders.
 *
 * `remote.require` loads the module on the other side of the bridge, so the
 * constructor sees a real `app` object. The returned proxy keeps the same
 * synchronous get/set/has API the components expect, and both processes end
 * up reading the very same config.json.
 */
const Store = remote.require('electron-store');
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
