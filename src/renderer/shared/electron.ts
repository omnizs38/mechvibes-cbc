/**
 * Runtime bridge to Node/Electron.
 *
 * The renderer windows run with `nodeIntegration: true` and
 * `contextIsolation: false`, and `src/preload.js` guarantees that
 * `window.require` exists even inside ES module bundles. Nothing here is
 * bundled by Vite: every module is resolved by Node at runtime.
 */
type RequireFn = (id: string) => any;

const runtimeRequire: RequireFn | undefined = (globalThis as any).require;

if (typeof runtimeRequire !== 'function') {
  throw new Error('Node integration is unavailable in this window.');
}

export function nodeRequire<T = any>(id: string): T {
  return (runtimeRequire as RequireFn)(id) as T;
}

const electron = nodeRequire('electron');

export const ipcRenderer = electron.ipcRenderer;
export const shell = electron.shell;
export const remote = nodeRequire('@electron/remote');
export const nodePath = nodeRequire<typeof import('node:path')>('path');

/** Absolute path of the packaged/unpacked application root. */
export const appRoot: string = remote.app.getAppPath();

/** Require a module that lives inside `src/` by its path relative to `src/`. */
export function requireFromSrc<T = any>(relativePath: string): T {
  return nodeRequire<T>(nodePath.join(appRoot, 'src', relativePath));
}

export function getGlobal<T = unknown>(name: string): T {
  return remote.getGlobal(name) as T;
}

export function openExternal(url: string): void {
  void shell.openExternal(url);
}

export type LogLevel = 'silly' | 'debug' | 'verbose' | 'info' | 'warn' | 'error';

export const log = {
  send(level: LogLevel, message: string): void {
    ipcRenderer.send('electron-log', message, level);
  },
  debug: (message: string) => log.send('debug', message),
  info: (message: string) => log.send('info', message),
  warn: (message: string) => log.send('warn', message),
  error: (message: string) => log.send('error', message),
};

/** Subscribe to an IPC channel and return an unsubscribe function. */
export function onIpc<T extends unknown[]>(
  channel: string,
  handler: (...args: T) => void,
): () => void {
  const listener = (_event: unknown, ...args: unknown[]) => handler(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
