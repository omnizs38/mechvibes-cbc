import { nodeRequire } from './electron';

type ElectronStore = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  has(key: string): boolean;
};

const Store = nodeRequire('electron-store');
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
