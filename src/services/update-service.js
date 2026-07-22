'use strict';

const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 12 * 1000;
const VALID_CHANNELS = new Set(['stable', 'beta']);

function normalizeReleaseNotes(releaseNotes) {
  if (typeof releaseNotes === 'string') {
    return releaseNotes;
  }
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry.note === 'string') return entry.note;
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

function safeErrorMessage(error) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown update error.';
}

class UpdateService {
  constructor({
    autoUpdater,
    app,
    log,
    send,
    store,
    checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
    initialDelayMs = INITIAL_CHECK_DELAY_MS,
    timers = globalThis,
  }) {
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

  getDefaultChannel() {
    const stored = this.store.get('mechvibes-update-channel');
    if (VALID_CHANNELS.has(stored)) return stored;
    return this.app.getVersion().includes('-beta.') ? 'beta' : 'stable';
  }

  configureUpdater() {
    this.autoUpdater.logger = this.log;
    this.autoUpdater.autoDownload = false;
    this.autoUpdater.autoInstallOnAppQuit = false;
    this.autoUpdater.allowDowngrade = false;
    this.autoUpdater.fullChangelog = true;
    this.applyChannel(this.state.channel, false);
  }

  bindEvents() {
    this.autoUpdater.on('checking-for-update', () => {
      this.patchState({ status: 'checking', error: null, progress: null });
    });
    this.autoUpdater.on('update-available', (info) => {
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
    this.autoUpdater.on('download-progress', (progress) => {
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
    });
    this.autoUpdater.on('update-downloaded', (info) => {
      this.patchState({
        status: 'downloaded',
        availableVersion: info && info.version ? info.version : this.state.availableVersion,
        progress: { percent: 100 },
        error: null,
      });
    });
    this.autoUpdater.on('error', (error) => {
      const message = safeErrorMessage(error);
      this.log.warn(`Updater error: ${message}`);
      this.patchState({ status: 'error', error: message, progress: null });
    });
  }

  start() {
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

  stop() {
    if (this.checkTimer !== null) this.timers.clearTimeout(this.checkTimer);
    if (this.intervalTimer !== null) this.timers.clearInterval(this.intervalTimer);
    this.checkTimer = null;
    this.intervalTimer = null;
  }

  getState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  patchState(patch) {
    this.state = { ...this.state, ...patch };
    this.emitState();
  }

  emitState() {
    this.send('updater-state', this.getState());
  }

  applyChannel(channel, persist = true) {
    if (!VALID_CHANNELS.has(channel)) {
      throw new Error(`Unsupported update channel: ${channel}`);
    }
    this.state.channel = channel;
    this.autoUpdater.channel = channel === 'beta' ? 'beta' : 'latest';
    this.autoUpdater.allowPrerelease = channel === 'beta';
    if (persist) this.store.set('mechvibes-update-channel', channel);
    this.emitState();
  }

  async check() {
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

  async download() {
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

  install() {
    if (this.state.status !== 'downloaded') {
      throw new Error('No downloaded update is ready to install.');
    }
    this.autoUpdater.quitAndInstall(false, true);
  }
}

module.exports = {
  DEFAULT_CHECK_INTERVAL_MS,
  INITIAL_CHECK_DELAY_MS,
  UpdateService,
  normalizeReleaseNotes,
  safeErrorMessage,
};
