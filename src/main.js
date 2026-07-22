// Modules to control application life and create native browser window
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, dialog } = require('electron');
const remoteMain = require('@electron/remote/main');
remoteMain.initialize();
const { getVolume, getMute } = require('easy-volume');
const path = require('path');
const os = require("os");
const fs = require('fs-extra');
// NOTE: Do not update electron-log, as we have a custom transport override which may not be compatible with newer versions.
const log = require("electron-log");
const Store = require("electron-store");
const store = new Store();
const iohook = require('uiohook-napi').uIOhook;

const StartupHandler = require('./utils/startup_handler');
const StoreToggle = require('./utils/store_toggle');
const { HotkeyTracker } = require('./services/hotkey-tracker');
const { UpdateService } = require('./services/update-service');

const SYSTRAY_ICON = path.join(__dirname, '/assets/system-tray-icon.png');
const user_dir = app.getPath("userData");
const custom_dir = path.join(user_dir, '/custom');
const current_pack_store_id = 'mechvibes-pack';

const mute = new StoreToggle("mechvibes-muted", false);
const start_minimized = new StoreToggle("mechvibes-start-minimized", false);
const active_volume = new StoreToggle("mechvibes-active-volume", true);
const storage_prompted = new StoreToggle("mechvibes-migrate-asked", false);

// Remote debugging defaults
const IpcServer = require("./utils/ipc");
let debug = {
  enabled: false, // the user must enable remote debugging via the debug options window
  identifier: undefined, // the ipc server should be configured to provide unique identifiers for live debugging sessions
  remoteUrl: "https://beta.mechvibes.com/debug/ipc/",
  async enable() {
    this.enabled = true;
    const userInfo = {
      hostname: os.hostname(), // Lunas-Macbook-Pro.local
      username: os.userInfo().username, // lunaalfien
      platform: os.platform(), // darwin
      version: app.getVersion() // v2.3.5
    };

    if(this.identifier === undefined){
      const json = await IpcServer.identify(userInfo);
      if(json.success){
        this.identifier = json.identifier;
        fs.writeJsonSync(debugConfigFile, {enabled: true, identifier: json.identifier});
        log.transports.remote.client.identifier = this.identifier;
        // TODO: set the level based on what the debugger wants
        // We're going to set the level to silly for now, because we don't have a way to live-update the level,
        // when the debugger changes the level, so we'll just set it to the most verbose level.
        // But this should absolutely be changed, and soon because it is an unnecessary load on the server.
        log.transports.remote.level = "silly";
        // NOTE: Remote debugging will include a websocket connection in the future, but it wasn't implemented
        // yet due to weird issues with the version of electron we use, and the version of node it uses,
        // causing an SSL error saying that the certificate was expired when it wasn't.
        // TODO: Check if the electron update fixed the above mentioned issue.
        const options = {
          enabled: debug.enabled,
          level: log.transports.remote.level,
          identifier: debug.identifier
        };
        if (debugWindow && !debugWindow.isDestroyed()) {
          debugWindow.webContents.send("debug-update", options);
        }
      }else{
        this.enabled = false;
        console.log(json);
      }
    }else{
      // TODO: set the level based on what the debugger wants
      console.log("enabling early");
      log.transports.remote.client.identifier = this.identifier;
      log.transports.remote.level = "silly";
      const json = await IpcServer.validate(this.identifier, userInfo);
      if(!json.success){
        console.log("Failed validation");
        log.transports.remote.level = false;
        this.enabled = false;
        this.identifier = undefined;
        fs.removeSync(debugConfigFile);
      }
    }
    if (win && !win.isDestroyed()) {
      win.webContents.send("debug-in-use", true);
    }
  },
  disable() {
    this.enabled = false;
    this.identifier = undefined; // clear identifier, for user privacy
    log.transports.remote.level = false;
    log.transports.remote.client.identifier = undefined;
    fs.removeSync(debugConfigFile);
    // send a request to the ipc server to remove the user's information immediately.
    // NOTE: if the ipc server fails to process the delete request, user logs might not be removed,
    // depending on ipc server implementation. For this reason, users should only use the official ipc server,
    // which is bound by the debug data retention policy.
    // https://beta.mechvibes.com/blog/debug-data-retention-policy/
    // transport.clear();

    if (win && !win.isDestroyed()) {
      win.webContents.send("debug-in-use", false);
    }
  }
}
IpcServer.setRemoteUrl(debug.remoteUrl);

function enableDebugSafely() {
  debug.enable().catch((error) => {
    debug.enabled = false;
    log.error(`Remote debugging could not be enabled: ${error}`);
  });
}

// Override the default remote logger, to use our own implementation.
// TODO: you know what, just move everything inside this tbh.
log.transports.remote = require("./libs/electron-log/transports/remote")(log, debug.remoteUrl);

// fix so we can detect transport type from within transport hook (see log.hooks.push(...))
for (const transportName in log.transports) {
  log.transports[transportName].transportName = transportName;
}

// parse debugging options
const debugConfigFile = path.join(user_dir, "/remote-debug.json");
if (fs.existsSync(debugConfigFile)) {
  try {
    const json = fs.readJsonSync(debugConfigFile);
    if (json && typeof json.identifier === 'string') {
      debug.identifier = json.identifier;
      if (json.enabled === true) {
        enableDebugSafely();
      }
    } else {
      fs.removeSync(debugConfigFile);
    }
  } catch (error) {
    fs.removeSync(debugConfigFile);
    log.warn(`Removed invalid remote debug configuration: ${error}`);
  }
}

// Default log file paths
// On Windows: %appdata%\Mechvibes\logs\mechvibes.log
// On macOS: ~/Library/Logs/Mechvibes/mechvibes.log
// On Linux: ~/.config/Mechvibes/logs/mechvibes.log
//           $XDG_CONFIG_HOME/Mechvibes/logs/mechvibes.log
log.transports.file.fileName = "mechvibes.log";
log.transports.file.level = "info";
log.transports.file.resolvePath = (variables) => {
  return path.join(variables.libraryDefaultDir, variables.fileName);
}
log.variables.sender = "main";
// console.log(log.transports.console.format); // uncomment to see default formats in console
// console.log(log.transports.file.format); // uncomment to see default formats in console
log.transports.console.format = "%c{h}:{i}:{s}.{ms}%c {sender} › {text}"
log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]({sender}) {text}"

const LogTransportMap = { error: 'red', warn: 'yellow', info: 'cyan', debug: 'magenta', silly: 'green', default: 'unset' };
log.hooks.push((msg, {transportName}) => {
  if (transportName === 'console') {
    // apply color, only to console transport
    return {
      ...msg,
      data: [`color: ${LogTransportMap[msg.level]}`, 'color: unset', ...msg.data]
    };
  }
  return msg;
});

// const custom_dir = path.join(user_dir, "/custom");

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
var win = null;
var tray = null;
var updateService = null;
global.app_version = app.getVersion();
global.custom_dir = custom_dir;
global.current_pack_store_id = current_pack_store_id;
global.debug_config_path = debugConfigFile;
// create custom sound folder if not exists
fs.ensureDirSync(custom_dir);

function createWindow(show = false) {
  // Create the browser window.
  win = new BrowserWindow({
    name: "app", // used by logger to differentiate messages sent by different windows.
    width: 400,
    height: 600,
    backgroundThrottling: false,
    webSecurity: false,
    // resizable: false,
    // fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'app.js'),
      contextIsolation: false,
      nodeIntegration: true,
    },
    show: false,
  });
  remoteMain.enable(win.webContents);

  // remove menu bar
  win.removeMenu();

  // and load the index.html of the app.
  win.loadFile('./src/app.html');

  // Open the DevTools.
  // win.openDevTools();
  // win.webContents.openDevTools();

  win.webContents.on("did-finish-load", () => {
    if(debug.enabled){
      win.webContents.send("debug-in-use", true);
    }
    win.webContents.send("ava-toggle", active_volume.is_enabled);
    win.webContents.send("mechvibes-mute-status", mute.is_enabled);
  })

  // Emitted when the window is closed.
  win.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null;
  });

  win.on('close', function (event) {
    if (!app.isQuiting) {
      if (process.platform === 'darwin') {
        app.dock.hide();
      }
      event.preventDefault();
      win.hide();
    }
    return false;
  });

  win.on("unresponsive", () => {
    log.warn("Window has entered unresponsive state");
    console.log("unresponsive");
  })

  // condition for start_minimized
  if (show) {
    win.show();
  } else {
    win.close();
  }

  return win;
}

let installer = null;
function openInstallWindow(packId){
  // Create the browser window.
  installer = new BrowserWindow({
    width: 300,
    height: 200,
    useContentSize: false,
    webSecurity: false,
    // resizable: false,
    // fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'install.js'),
      contextIsolation: false,
      nodeIntegration: true,
    },
    show: false,
    parent: win,
  });
  remoteMain.enable(installer.webContents);

  // remove menu bar
  installer.removeMenu();

  // and load the index.html of the app.
  installer.loadFile('./src/install.html');

  installer.webContents.on("did-finish-load", () => {
    installer.webContents.send("install-pack", packId);
  })

  installer.on("ready-to-show", () => {
    installer.show();
  })

  // Emitted when the window is closed.
  installer.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    installer = null;
  });
}

let debugWindow = null;
function createDebugWindow(){
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.focus();
    return;
  }
  // Create the browser window.
  debugWindow = new BrowserWindow({
    width: 350,
    height: 500,
    useContentSize: false,
    webSecurity: false,
    // resizable: false,
    // fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'debug.js'),
      contextIsolation: false,
      nodeIntegration: true,
    },
    show: false,
    parent: win,
  });
  remoteMain.enable(debugWindow.webContents);

  // remove menu bar
  debugWindow.removeMenu();

  // and load the index.html of the app.
  debugWindow.loadFile('./src/debug.html');

  debugWindow.webContents.on("did-finish-load", () => {
    const options = {
      enabled: debug.enabled,
      level: log.transports.remote.level,
      identifier: debug.identifier
    };
    debugWindow.webContents.send("debug-options", options);
  })

  debugWindow.on("ready-to-show", () => {
    debugWindow.show();
  })

  // Emitted when the window is closed.
  debugWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    debugWindow = null;
  });
}

function validateSoundpackCandidate(candidatePath) {
  const { readSoundpackConfig, verifySoundpackChecksums } = require('./libs/soundpacks/registry');
  const { listReferencedSoundFiles, validateSoundpackConfig } = require('./libs/soundpacks/validation');
  const { ClearSoundpackCache, GetSoundpackFile } = require('./libs/soundpacks/file-manager');
  const config = validateSoundpackConfig(readSoundpackConfig(candidatePath));
  try {
    listReferencedSoundFiles(config).forEach((reference) => GetSoundpackFile(candidatePath, reference));
    verifySoundpackChecksums(candidatePath, config);
  } finally {
    ClearSoundpackCache(candidatePath);
  }
  return config;
}

function customPackPath(packId) {
  if (typeof packId !== 'string' || !packId.startsWith('custom-')) return null;
  const folderName = packId.slice('custom-'.length);
  if (!folderName || path.basename(folderName) !== folderName) return null;
  const candidate = path.resolve(custom_dir, folderName);
  const root = path.resolve(custom_dir);
  return candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
}

const gotTheLock = app.requestSingleInstanceLock();

const protocolCommands = {
  install(packId){
    if(installer === null){
      log.debug(`Processing request to install ${packId}...`);
      openInstallWindow(packId);
    }else{
      installer.focus();
      installer.webContents.send("install-pack", packId);
    }
  }
};

function handleProtocolUrl(url) {
  if (typeof url !== 'string' || !url.toLowerCase().startsWith('mechvibes://')) {
    return;
  }
  try {
    const parts = decodeURIComponent(url.slice('mechvibes://'.length)).split(' ').filter(Boolean);
    const command = parts.shift();
    if (command && Object.prototype.hasOwnProperty.call(protocolCommands, command)) {
      protocolCommands[command](...parts);
    }
  } catch (error) {
    log.warn(`Ignored invalid Mechvibes protocol URL: ${error}`);
  }
}

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (win) {
      if (process.platform === 'darwin') {
        app.dock.show();
      } else {
        const protocolUrl = [...commandLine].reverse().find((argument) => argument.toLowerCase().startsWith('mechvibes://'));
        handleProtocolUrl(protocolUrl);
      }
      if (win.isMinimized()) {
        win.restore();
      }
      win.show();
      win.focus();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleProtocolUrl(url);
  });

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  // Don't show the window and create a tray instead
  // create and get window instance
  app.on('ready', () => {
    log.silly("Ready event has fired.");
    app.setAsDefaultProtocolClient('mechvibes');
    const startup_handler = new StartupHandler(app);

    log.silly("Creating main window for the first time...");
    if(startup_handler.was_started_at_login && start_minimized.is_enabled){
      win = createWindow(false);
    }else{
      win = createWindow(true);
    }

    let volume = -1;
    let system_mute = false;
    let system_audio_error = false;
    let system_audio_check_in_flight = false;

    const sendToMainWindow = (channel, value) => {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(channel, value);
      }
    };

    const { autoUpdater } = require('electron-updater');
    updateService = new UpdateService({
      autoUpdater,
      app,
      log,
      send: sendToMainWindow,
      store,
    });
    updateService.start();

    let input_hook_running = false;
    const setInputHookEnabled = (enabled) => {
      try {
        if (enabled && !input_hook_running) {
          iohook.start();
          input_hook_running = true;
        } else if (!enabled && input_hook_running) {
          iohook.stop();
          input_hook_running = false;
        }
        return true;
      } catch (error) {
        input_hook_running = false;
        log.error(`Global keyboard capture failed: ${error}`);
        sendToMainWindow('input-hook-error', 'Global keyboard capture is unavailable. Restart Mechvibes or reinstall the Windows build.');
        return false;
      }
    };

    ipcMain.on('renderer-ready', (event) => {
      if (!win || event.sender !== win.webContents) {
        return;
      }
      sendToMainWindow('ava-toggle', active_volume.is_enabled);
      sendToMainWindow('mechvibes-mute-status', mute.is_enabled);
      if (volume >= 0) {
        sendToMainWindow('system-volume-update', volume);
      }
      sendToMainWindow('system-mute-status', system_mute);
      if (updateService) {
        sendToMainWindow('updater-state', updateService.getState());
      }
      setInputHookEnabled(true);
    });

    const pollSystemAudio = async () => {
      if (mute.is_enabled || system_audio_check_in_flight) {
        return;
      }
      system_audio_check_in_flight = true;
      try {
        const [volumeResult, muteResult] = await Promise.allSettled([getVolume(), getMute()]);
        if (volumeResult.status === 'fulfilled' && volumeResult.value !== volume) {
          volume = volumeResult.value;
          sendToMainWindow('system-volume-update', volume);
        }
        if (muteResult.status === 'fulfilled' && muteResult.value !== system_mute) {
          system_mute = muteResult.value;
          sendToMainWindow('system-mute-status', system_mute);
        }

        const failure = volumeResult.status === 'rejected' ? volumeResult.reason
          : muteResult.status === 'rejected' ? muteResult.reason
            : null;
        if (failure !== null && !system_audio_error) {
          system_audio_error = true;
          log.warn(`System audio status is temporarily unavailable: ${failure}`);
        } else if (failure === null) {
          system_audio_error = false;
        }
      } finally {
        system_audio_check_in_flight = false;
      }
    };

    pollSystemAudio();
    const sys_check_interval = setInterval(pollSystemAudio, 3000);

    const hotkeys = new HotkeyTracker({
      onMuteToggle: () => {
        mute.toggle();
        sendToMainWindow('mechvibes-mute-status', mute.is_enabled);
      },
    });

    iohook.on('keydown', (event) => {
      if (hotkeys.handleKeydown(event)) return;
      sendToMainWindow('keydown', { ...event, capturedAtMs: Date.now() });
    });

    iohook.on('keyup', (event) => {
      hotkeys.handleKeyup(event);
      sendToMainWindow('keyup', { ...event, capturedAtMs: Date.now() });
    });

    function createTrayIcon(){
      // prevent dupe tray icons
      if(tray !== null) return;

      // start tray icon
      tray = new Tray(SYSTRAY_ICON);

      // tray icon tooltip
      tray.setToolTip('Mechvibes');

      // context menu when hover on tray icon
      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Mechvibes',
          click: function () {
            // show app on click
            if (process.platform === 'darwin') {
              app.dock.show();
            }
            win.show();
            win.focus();
          },
        },
        {
          label: 'Editor',
          click: function () {
            openEditorWindow();
          },
        },
        {
          label: 'Folders',
          submenu: [
            {
              label: 'Custom Soundpacks',
              click: function () {
                shell.openPath(custom_dir).then((err) => {
                  if(err){
                    log.error(err);
                  }
                });
              },
            },
            {
              label: 'Application Data',
              click: function () {
                shell.openPath(user_dir).then((err) => {
                  if(err){
                    log.error(err);
                  }
                });
              },
            },
          ],
        },
        {
          label: 'Mute',
          type: 'checkbox',
          checked: mute.is_enabled,
          click: function () {
            mute.toggle();
            sendToMainWindow('mechvibes-mute-status', mute.is_enabled);
          },
        },
        {
          label: 'Extras',
          submenu: [
            {
              label: 'Enable at Startup',
              type: 'checkbox',
              checked: startup_handler.is_enabled,
              click: function () {
                startup_handler.toggle();
              },
            },
            {
              label: 'Start Minimized',
              type: 'checkbox',
              checked: start_minimized.is_enabled,
              click: function () {
                start_minimized.toggle();
              },
            },
            {
              label: 'Active Volume Adjustment',
              type: 'checkbox',
              checked: active_volume.is_enabled,
              click: function () {
                active_volume.toggle();
                win.webContents.send("ava-toggle", active_volume.is_enabled);
              },
            },
          ],
        },
        {
          label: 'Quit',
          click: function () {
            // stop system check interval, because it's an external program, and
            // it doesn't know how to handle shutdowns.
            clearInterval(sys_check_interval);
            setInputHookEnabled(false);
            // quit
            app.isQuiting = true;
            app.quit();
          },
        },
      ]);

      // On macOS double click doesn't work if we use tray.setContextMenu(), so we'll do it manually.
      if(process.platform == "darwin"){
        // click on tray icon, show context menu
        tray.on('click', () => {
          tray.popUpContextMenu(contextMenu);
        });

        // right click on tray icon, show the app
        tray.on("right-click", () => {
          app.dock.show();
          win.show();
          win.focus();
        })
      }else{
        tray.setContextMenu(contextMenu);
        // double click on tray icon, show the app
        tray.on("double-click", () => {
          win.show();
          win.focus();
        })
      }
    }

    ipcMain.on('show_tray_icon', (_event, show) => {
      if (show && tray === null) {
        createTrayIcon();
      } else if (!show && tray !== null) {
        tray.destroy();
        tray = null;
      }
    });

    const isMainWindowEvent = (event) => Boolean(win && !win.isDestroyed() && event.sender === win.webContents);

    ipcMain.on('updater-get-state', (event) => {
      event.returnValue = isMainWindowEvent(event) && updateService ? updateService.getState() : null;
    });
    ipcMain.on('updater-check', (event) => {
      if (isMainWindowEvent(event) && updateService) updateService.check().catch(() => {});
    });
    ipcMain.on('updater-download', (event) => {
      if (isMainWindowEvent(event) && updateService) updateService.download().catch(() => {});
    });
    ipcMain.on('updater-install', (event) => {
      if (isMainWindowEvent(event) && updateService) {
        app.isQuiting = true;
        updateService.install();
      }
    });
    ipcMain.on('updater-set-channel', (event, channel) => {
      if (!isMainWindowEvent(event) || !updateService) return;
      try {
        updateService.applyChannel(channel);
        updateService.check().catch(() => {});
      } catch (error) {
        log.warn(`Rejected update channel: ${error.message}`);
      }
    });

    ipcMain.handle('soundpack-open-folder', async (event) => {
      if (!isMainWindowEvent(event)) return { ok: false, error: 'Invalid window.' };
      const error = await shell.openPath(custom_dir);
      return error ? { ok: false, error } : { ok: true };
    });
    ipcMain.handle('soundpack-refresh', async (event) => {
      if (!isMainWindowEvent(event)) return { ok: false, error: 'Invalid window.' };
      return { ok: true };
    });
    ipcMain.handle('soundpack-import', async (event) => {
      if (!isMainWindowEvent(event)) return { ok: false, error: 'Invalid window.' };
      const result = await dialog.showOpenDialog(win, {
        title: 'Import Mechvibes soundpack',
        properties: ['openFile'],
        filters: [{ name: 'Mechvibes ZIP soundpacks', extensions: ['zip'] }],
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
      const source = result.filePaths[0];
      const fileName = path.basename(source);
      const target = path.join(custom_dir, fileName);
      const temporary = `${target}.import-${Date.now()}.zip`;
      if (fs.existsSync(target)) return { ok: false, error: 'A soundpack with this filename already exists.' };
      try {
        fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
        const config = validateSoundpackCandidate(temporary);
        fs.moveSync(temporary, target, { overwrite: false });
        store.set(current_pack_store_id, `custom-${fileName}`);
        return { ok: true, name: config.name, packId: `custom-${fileName}` };
      } catch (error) {
        fs.removeSync(temporary);
        return { ok: false, error: error.message };
      }
    });
    ipcMain.handle('soundpack-delete', async (event, packId) => {
      if (!isMainWindowEvent(event)) return { ok: false, error: 'Invalid window.' };
      const target = customPackPath(packId);
      if (!target || !fs.existsSync(target)) return { ok: false, error: 'Only installed custom soundpacks can be deleted.' };
      const response = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['Delete', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: 'Delete soundpack',
        message: `Delete ${path.basename(target)} permanently?`,
      });
      if (response.response !== 0) return { ok: false, canceled: true };
      fs.removeSync(target);
      if (store.get(current_pack_store_id) === packId) store.delete(current_pack_store_id);
      return { ok: true };
    });

    ipcMain.on('pack-changed', (event, pack) => {
      if (!isMainWindowEvent(event) || !pack || typeof pack.name !== 'string') return;
      if (tray) tray.setToolTip(`Mechvibes — ${pack.name.slice(0, 120)}`);
    });

    ipcMain.on('electron-log', (event, message, level) => {
      const allowedLevels = new Set(['error', 'warn', 'info', 'verbose', 'debug', 'silly']);
      const safeLevel = allowedLevels.has(level) ? level : 'info';
      const window_options = event.sender.browserWindowOptions;
      if (window_options.name !== undefined && typeof window_options.name === 'string') {
        log.variables.sender = window_options.name;
      } else {
        log.variables.sender = 'u/w';
      }
      log[safeLevel](String(message));
      log.variables.sender = 'main';
    });

    ipcMain.on('open-debug-options', () => {
      createDebugWindow();
    });

    ipcMain.on('fetch-debug-options', (event) => {
      if (!debugWindow || debugWindow.isDestroyed() || event.sender !== debugWindow.webContents) {
        return;
      }
      debugWindow.webContents.send('debug-options', { ...debug, path: debugConfigFile });
    });

    ipcMain.on('set-debug-options', (_event, json) => {
      if (!json || typeof json.enabled !== 'boolean') {
        return;
      }
      if (json.enabled && !debug.enabled) {
        enableDebugSafely();
      } else if (!json.enabled && debug.enabled) {
        debug.disable();
      }
    });

    // allow the installer to set its size using the height of the body so that when content changes,
    // the installer can only be as big or as small as it needs to be.
    ipcMain.on('resize-installer', (_event, size) => {
      if (!installer || installer.isDestroyed()) {
        return;
      }
      const requestedHeight = Math.min(800, Math.max(100, Number(size) || 200));
      const diff = installer.getSize()[1] - installer.getContentSize()[1];
      installer.setSize(300, Math.round(requestedHeight + diff), true);
    });
    ipcMain.on('installed', (_event, packFolder) => {
      if (typeof packFolder !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(packFolder)) {
        log.warn('Installer returned an invalid soundpack folder.');
        return;
      }
      log.silly(`Installed ${packFolder}`);
      store.set(current_pack_store_id, `custom-${packFolder}`);
      win.reload();
      if (installer && !installer.isDestroyed()) {
        installer.close();
      }
      installer = null;
    });

    log.debug(`Platform: ${process.platform}`);
    log.info("App is ready and has been initialized");

    // prevent Electron app from interrupting macOS system shutdown
    if (process.platform == 'darwin') {
      const { powerMonitor } = require('electron');
      powerMonitor.on('shutdown', () => {
        app.quit();
      });
    }

    if(!storage_prompted.is_enabled){
      // check if old custom directory exists
      const home_dir = app.getPath('home');
      const old_custom_dir = path.join(home_dir, "/mechvibes_custom");
      if(fs.existsSync(old_custom_dir)){
        log.debug("Old custom directory exists, prompting user for migration...");
        const { dialog } = require('electron');
        const response = dialog.showMessageBoxSync({
          type: 'question',
          buttons: ['Yes', 'Not right now', "Don't ask again"],
          title: 'Mechvibes',
          message: "Soundpacks have moved to a new location, do you want to migrate your old soundpacks to the new location? We'll only ask you this once.",
          defaultId: 0,
          cancelId: 1,
        });
  
        if (response === 0) {
          log.debug("User requested migration, migrating...");
          const oldCustomFiles = fs.readdirSync(old_custom_dir);
          oldCustomFiles.forEach((file) => {
            const sourcePath = path.join(old_custom_dir, file);
            const destinationPath = path.join(custom_dir, file);
            log.silly(`Moving ${sourcePath.replace(home_dir, "~")} to ${destinationPath.replace(home_dir, "~")}`);
            fs.moveSync(sourcePath, destinationPath, { overwrite: true });
          });
          log.silly("Removing old custom directory...");
          fs.removeSync(old_custom_dir);
          storage_prompted.enable();
          log.debug("Migration complete.");
          win.reload();
        } else if (response === 2) {
          storage_prompted.enable();
        }
      } else {
        storage_prompted.enable();
      }
    }
  });
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  log.silly("All windows were closed.");
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  log.silly("App has been activated")
  if (win === null){
    createWindow(true);
  }else{
    // on macOS clicking the app icon in the launcher or in finder, triggers activate instead of second-instance for some reason.
    if (process.platform === 'darwin') {
      app.dock.show();
    }
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.focus();
  }
});

// ensure app gets unregistered
function OnBeforeQuit(){
  log.silly("Shutting down...");
  if (updateService) updateService.stop();
  app.removeAsDefaultProtocolClient("mechvibes");
}
app.on("before-quit", OnBeforeQuit);

app.on('quit', () => {
  log.silly('Goodbye.');
});

var editor_window = null;

function openEditorWindow() {
  if (editor_window) {
    editor_window.focus();
    return;
  }

  editor_window = new BrowserWindow({
    width: 1200,
    height: 600,
    // resizable: false,
    // minimizable: false,
    // fullscreenable: false,
    // modal: true,
    // parent: win,
    webPreferences: {
      // preload: path.join(__dirname, 'editor.js'),
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  remoteMain.enable(editor_window.webContents);

  // editor_window.openDevTools();

  editor_window.loadFile('./src/editor.html');

  editor_window.on('closed', function () {
    editor_window = null;
  });
}
