'use strict';

export const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const INITIAL_CHECK_DELAY_MS = 12 * 1000;

const VALID_CHANNELS: ReadonlySet<string> = new Set(['stable', 'beta']);

export type UpdateChannel = 'stable' | 'beta';

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'development'
  | 'error';

export interface UpdateProgress {
  percent: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
}

export interface UpdateState {
  status: UpdateStatus;
  channel: UpdateChannel;
  currentVersion: string;
  availableVersion: string | null;
  releaseNotes: string;
  progress: UpdateProgress | null;
  error: string | null;
  canCheck: boolean;
  unsignedBuild: boolean;
}

/** Minimal surface of electron-updater's autoUpdater used by this service. */
export interface UpdaterLike {
  logger: unknown;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  fullChangelog: boolean;
  channel: string | null;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface AppLike {
  getVersion(): string;
  isPackaged: boolean;
}

export interface LoggerLike {
  warn(message: string): void;
}

export interface StoreLike {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface TimersLike {
  setTimeout(handler: () => void, timeout: number): unknown;
  setInterval(handler: () => void, timeout: number): unknown;
  clearTimeout(handle: any): void;
  clearInterval(handle: any): void;
}

export interface UpdateServiceOptions {
  autoUpdater: UpdaterLike;
  app: AppLike;
  log: LoggerLike;
  send: (channel: string, payload: UpdateState) => void;
  store: StoreLike;
  checkIntervalMs?: number;
  initialDelayMs?: number;
  timers?: TimersLike;
}

export function normalizeReleaseNotes(releaseNotes: unknown): string {
  if (typeof releaseNotes === 'string') {
    return releaseNotes;
  }
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof (entry as { note?: unknown }).note === 'string') {
          return (entry as { note: string }).note;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown update error.';
}

export class UpdateService {
  private readonly autoUpdater: UpdaterLike;
  private readonly app: AppLike;
  private readonly log: LoggerLike;
  private readonly send: (channel: string, payload: UpdateState) => void;
  private readonly store: StoreLike;
  private readonly checkIntervalMs: number;
  private readonly initialDelayMs: number;
  private readonly timers: TimersLike;
  private started: boolean;
  private checkTimer: unknown;
  private intervalTimer: unknown;
  private state: UpdateState;

  constructor({
    autoUpdater,
    app,
    log,
    send,
    store,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
    initialDelayMs = INITIAL_CHECK_DELAY_MS,
    timers = globalThis as unknown as TimersLike,
  }: UpdateServiceOptions) {
    this.autoUpdater = autoUpdater;
    this.app = app;
    this.log = log;
    this.send = send;
    this.store = store;
    this.checkIntervalMs = checkIntervalMs;
    this.initialDelayMs = initialDelayMs;
    this.timers = timers;
    this.started = false;
    this.checkTimer = null;
    this.intervalTimer = null;
    this.state = {
      status: 'idle',
      channel: this.getDefaultChannel(),
      currentVersion: app.getVersion(),
      availableVersion: null,
      releaseNotes: '',
      progress: null,
      error: null,
      canCheck: Boolean(app.isPackaged),
      unsignedBuild: true,
    };
  }

  getDefaultChannel(): UpdateChannel {
    const stored = this.store.get('mechvibes-update-channel');
    if (typeof stored === 'string' && VALID_CHANNELS.has(stored)) return stored as UpdateChannel;
    return this.app.getVersion().includes('-beta.') ? 'beta' : 'stable';
  }

  configureUpdater(): void {
    this.autoUpdater.logger = this.log;
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;
    this.autoUpdater.allowDowngrade = false;
    this.autoUpdater.fullChangelog = true;
    this.applyChannel(this.state.channel, false);
  }

  bindEvents(): void {
    this.autoUpdater.on('checking-for-update', () => {
      this.patchState({ status: 'checking', error: null, progress: null });
    });
    this.autoUpdater.on('update-available', (info: { version?: string; releaseNotes?: unknown }) => {
      this.patchState({
        status: 'available',
        availableVersion: info && info.version ? info.version : null,
        releaseNotes: normalizeReleaseNotes(info && info.releaseNotes),
        error: null,
        progress: null,
      });
    });
    this.autoUpdater.on('update-not-available', () => {
      this.patchState({
        status: 'not-available',
        availableVersion: null,
        releaseNotes: '',
        error: null,
        progress: null,
      });
    });
    this.autoUpdater.on(
      'download-progress',
      (progress: {
        percent?: number;
        bytesPerSecond?: number;
        transferred?: number;
        total?: number;
      }) => {
        this.patchState({
          status: 'downloading',
          progress: {
            percent: Number(progress && progress.percent) || 0,
            bytesPerSecond: Number(progress && progress.bytesPerSecond) || 0,
            transferred: Number(progress && progress.transferred) || 0,
            total: Number(progress && progress.total) || 0,
          },
          error: null,
        });
      },
    );
    this.autoUpdater.on('update-downloaded', (info: { version?: string }) => {
      this.patchState({
        status: 'downloaded',
        availableVersion: info && info.version ? info.version : this.state.availableVersion,
        progress: { percent: 100 },
        error: null,
      });
    });
    this.autoUpdater.on('error', (error: unknown) => {
      const message = safeErrorMessage(error);
      this.log.warn(`Updater error: ${message}`);
      this.patchState({ status: 'error', error: message, progress: null });
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.configureUpdater();
    this.bindEvents();
    this.emitState();
    if (!this.app.isPackaged) {
      this.patchState({ status: 'development', canCheck: false });
      return;
    }
    this.checkTimer = this.timers.setTimeout(() => {
      this.check().catch(() => {});
    }, this.initialDelayMs);
    this.intervalTimer = this.timers.setInterval(() => {
      this.check().catch(() => {});
    }, this.checkIntervalMs);
  }

  stop(): void {
    if (this.checkTimer !== null) this.timers.clearTimeout(this.checkTimer);
    if (this.intervalTimer !== null) this.timers.clearInterval(this.intervalTimer);
    this.checkTimer = null;
    this.intervalTimer = null;
  }

  getState(): UpdateState {
    return JSON.parse(JSON.stringify(this.state)) as UpdateState;
  }

  patchState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.emitState();
  }

  emitState(): void {
    this.send('updater-state', this.getState());
  }

  applyChannel(channel: UpdateChannel, persist = true): void {
    if (!VALID_CHANNELS.has(channel)) {
      throw new Error(`Unsupported update channel: ${channel}`);
    }
    this.state.channel = channel;
    this.autoUpdater.channel = channel === 'beta' ? 'beta' : 'latest';
    this.autoUpdater.allowPrerelease = channel === 'beta';
    if (persist) this.store.set('mechvibes-update-channel', channel);
    this.emitState();
  }

  async check(): Promise<unknown> {
    if (!this.app.isPackaged) {
      this.patchState({ status: 'development', canCheck: false });
      return null;
    }
    if (this.state.status === 'checking' || this.state.status === 'downloading') {
      return null;
    }
    this.patchState({ status: 'checking', error: null, progress: null });
    try {
      return await this.autoUpdater.checkForUpdates();
    } catch (error) {
      const message = safeErrorMessage(error);
      this.patchState({ status: 'error', error: message, progress: null });
      throw error;
    }
  }

  async download(): Promise<unknown> {
    if (this.state.status !== 'available') {
      throw new Error('No confirmed update is ready to download.');
    }
    this.patchState({ status: 'downloading', progress: { percent: 0 }, error: null });
    try {
      return await this.autoUpdater.downloadUpdate();
    } catch (error) {
      const message = safeErrorMessage(error);
      this.patchState({ status: 'error', error: message, progress: null });
      throw error;
    }
  }

  install(): void {
    if (this.state.status !== 'downloaded') {
      throw new Error('No downloaded update is ready to install.');
    }
    this.autoUpdater.quitAndInstall(false, true);
  }
}
