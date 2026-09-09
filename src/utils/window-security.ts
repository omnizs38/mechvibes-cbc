import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';

/** Never hand file:, javascript:, or custom OS protocol handlers to the shell. */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function isWindowEvent(
  event: Pick<IpcMainEvent | IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  window: BrowserWindow | null | undefined,
): boolean {
  // Electron frame getters may throw after a frame has been disposed.
  // A missing frame must never compare equal to another missing frame.
  try {
    if (!window || window.isDestroyed() || event.sender.isDestroyed() ||
      event.sender !== window.webContents) return false;
    const frame = event.senderFrame;
    return frame != null && frame === event.sender.mainFrame;
  } catch {
    return false;
  }
}

/** Defense in depth for the legacy Node-enabled renderers, not a sandbox. */
export function protectWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-frame-navigate', (event) => event.preventDefault());
  contents.on('will-redirect', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
}
