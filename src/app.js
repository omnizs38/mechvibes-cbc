'use strict';

// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
// const gkm = require('gkm');
const electron = require('electron');
electron.remote = require('@electron/remote');
const Store = require('electron-store');
const store = new Store();
const { Howler } = require('howler');
const { shell, ipcRenderer } = electron;
const remote = electron.remote;
const path = require('path');
const { LatencyTracker } = require('./audio-engine/latency-tracker');
const { SoundpackManager } = require('./libs/soundpacks/pack-manager');
const { discoverSoundpacks } = require('./libs/soundpacks/registry');
const { calculateAdjustedDisplay, calculateGain } = require('./utils/volume');
const { chooseRandomPackIndex } = require('./utils/random-pack');

const MV_PACK_LSID = remote.getGlobal("current_pack_store_id");
const MV_VOL_LSID = 'mechvibes-volume';
const MV_TRAY_LSID = 'mechvibes-hidden';

const CUSTOM_PACKS_DIR = remote.getGlobal('custom_dir');
const OFFICIAL_PACKS_DIR = path.join(__dirname, 'audio');
const APP_VERSION = remote.getGlobal('app_version');
const OUTPUT_DEVICE_LSID = 'mechvibes-output-device';
const THEME_LSID = 'mechvibes-theme';

let active_volume = true;
let output_device_id = store.get(OUTPUT_DEVICE_LSID) || '';
let system_volume = 50;
let is_system_muted = false;
let is_mechvibes_muted = false;
let current_pack = null;
let last_applied_gain = null;
let pack_selection_ui_id = 0;
const packs = [];
const pack_manager = new SoundpackManager(packs);
const latency_tracker = new LatencyTracker();

const log = {
  silly(message){
    raise_log_message("silly", message);
  },
  debug(message){
    raise_log_message("debug", message);
  },
  verbose(message){
    raise_log_message("verbose", message);
  },
  info(message){
    raise_log_message("info", message);
  },
  warn(message){
    raise_log_message("warn", message);
  },
  error(message){
    raise_log_message("error", message);
  }
}
function raise_log_message(level, message){
  ipcRenderer.send("electron-log", message, level);
}

function setStatus(message, state = 'info') {
  const status = document.getElementById('app-status');
  if (!status) {
    return;
  }
  status.textContent = message;
  status.dataset.state = state;
  status.classList.toggle('hidden', message === '');
}

async function selectPack(packId, { persist = true } = {}) {
  const appLogo = document.getElementById('logo');
  const appBody = document.getElementById('app-body');
  const packList = document.getElementById('pack-list');
  const randomButton = document.getElementById('random-button');
  const previousPack = pack_manager.current;
  const startedAt = performance.now();
  const uiRequestId = ++pack_selection_ui_id;

  appLogo.textContent = 'Loading...';
  appBody.classList.add('loading');
  packList.disabled = true;
  randomButton.disabled = true;
  setStatus('Loading soundpack…');

  try {
    const loadedPack = await pack_manager.select(packId);
    if (uiRequestId !== pack_selection_ui_id) {
      return loadedPack;
    }
    current_pack = loadedPack;
    packList.value = loadedPack.pack_id;
    ipcRenderer.send('pack-changed', { name: loadedPack.name, version: loadedPack.version });
    const deleteButton = document.getElementById('delete-pack-button');
    if (deleteButton) deleteButton.disabled = !loadedPack.is_custom;
    if (output_device_id && typeof loadedPack.SetOutputDevice === 'function') {
      try {
        await loadedPack.SetOutputDevice(output_device_id);
      } catch (error) {
        log.warn(`Saved output device is unavailable: ${error.message}`);
      }
    }
    if (persist) {
      store.set(MV_PACK_LSID, loadedPack.pack_id);
    }
    if (Howler.ctx && Howler.ctx.state === 'suspended') {
      Howler.ctx.resume().catch(() => {});
    }
    appLogo.textContent = 'Mechvibes';
    appBody.classList.remove('loading');
    setStatus('', 'success');
    log.info(`Loaded ${loadedPack.pack_id} in ${Math.round(performance.now() - startedAt)}ms`);
    return loadedPack;
  } catch (error) {
    if (uiRequestId !== pack_selection_ui_id) {
      throw error;
    }
    current_pack = previousPack;
    if (previousPack) {
      packList.value = previousPack.pack_id;
      appLogo.textContent = 'Mechvibes';
      setStatus(`Could not load that soundpack. Continuing with ${previousPack.name}.`, 'error');
    } else {
      appLogo.textContent = 'Sound unavailable';
      setStatus('No soundpack could be loaded. Check the soundpack files and try again.', 'error');
    }
    appBody.classList.remove('loading');
    log.warn(`Failed to load ${packId}: ${error instanceof Error ? error.message : error}`);
    throw error;
  } finally {
    if (uiRequestId === pack_selection_ui_id) {
      packList.disabled = packs.length === 0;
      randomButton.disabled = packs.length < 2;
    }
  }
}

function loadPacks() {
  const result = discoverSoundpacks({
    officialDirectory: OFFICIAL_PACKS_DIR,
    customDirectory: CUSTOM_PACKS_DIR,
  });
  packs.splice(0, packs.length, ...result.packs);
  for (const error of result.errors) {
    log.warn(`Skipped soundpack ${error.name}: ${error.message}`);
  }
  if (result.errors.length > 0) {
    setStatus(`${result.errors.length} invalid soundpack${result.errors.length === 1 ? '' : 's'} skipped.`, 'warning');
  }
  log.info(`Discovered ${packs.length} valid soundpacks`);
  return result;
}

function getPack(pack_id){
  return packs.find((pack) => pack.pack_id == pack_id);
}

function getSavedPack() {
  if (store.has(MV_PACK_LSID)) {
    const pack_id = store.get(MV_PACK_LSID);
    const pack = getPack(pack_id);
    if (!pack) {
      return packs[0];
    }else{
      return pack;
    }
  } else {
    return packs[0];
  }
}

function setPack(packId) {
  return selectPack(packId).catch(() => null);
}

function setPackByIndex(index) {
  const pack = packs[index];
  if (!pack) {
    return Promise.resolve(null);
  }
  return setPack(pack.pack_id);
}

// ==================================================
// transform pack to select option list
function packsToOptions(soundpacks, packList) {
  packList.textContent = '';
  const selectedPackId = store.get(MV_PACK_LSID);
  const groups = [];

  for (const pack of soundpacks) {
    let group = groups.find((candidate) => candidate.id === pack.group);
    if (!group) {
      group = { id: pack.group, name: pack.group || 'Default', packs: [] };
      groups.push(group);
    }
    group.packs.push(pack);
  }

  for (const group of groups) {
    const optionGroup = document.createElement('optgroup');
    optionGroup.label = group.name;
    for (const pack of group.packs) {
      const option = document.createElement('option');
      option.text = pack.name;
      option.value = pack.pack_id;
      option.selected = selectedPackId === pack.pack_id;
      optionGroup.appendChild(option);
    }
    packList.appendChild(optionGroup);
  }

  packList.disabled = soundpacks.length === 0;
  packList.addEventListener('change', (event) => {
    setPack(event.target.value);
  });
}

// ==================================================
// main
(function (window, document) {
  window.addEventListener('DOMContentLoaded', async () => {
    const version = document.getElementById('app-version');
    const debug_in_use = document.getElementById('remote-in-use');
    const quick_disable_remote = document.getElementById('quick-disable-remote');
    const mechvibes_muted = document.getElementById('mechvibes-muted');
    const system_muted = document.getElementById('system-muted');
    const app_logo = document.getElementById('logo');
    const app_body = document.getElementById('app-body');
    const pack_list = document.getElementById('pack-list');
    const random_button = document.getElementById('random-button');
    const refresh_packs_button = document.getElementById('refresh-packs-button');
    const import_pack_button = document.getElementById('import-pack-button');
    const open_packs_button = document.getElementById('open-packs-button');
    const delete_pack_button = document.getElementById('delete-pack-button');
    const soundpack_manager_status = document.getElementById('soundpack-manager-status');
    const debug_button = document.getElementById('open-debug-options');
    const debug_button_seperator = document.getElementById('debug-options-seperator');
    const volume_value = document.getElementById('volume-value-display');
    const volume = document.getElementById('volume');
    const tray_icon_toggle = document.getElementById('tray_icon_toggle');
    const dark_mode_toggle = document.getElementById('dark_mode_toggle');
    const output_device = document.getElementById('output-device');
    const choose_output_button = document.getElementById('choose-output-button');
    const output_device_status = document.getElementById('output-device-status');
    const update_channel = document.getElementById('update-channel');
    const update_status = document.getElementById('update-status');
    const update_details = document.getElementById('update-details');
    const update_release_notes = document.getElementById('update-release-notes');
    const check_updates_button = document.getElementById('check-updates-button');
    const download_update_button = document.getElementById('download-update-button');
    const install_update_button = document.getElementById('install-update-button');
    const update_progress = document.getElementById('update-progress');
    const update_progress_bar = document.getElementById('update-progress-bar');

    app_logo.textContent = 'Loading...';
    version.textContent = APP_VERSION;

    const discovery = loadPacks();
    packsToOptions(packs, pack_list);
    random_button.disabled = packs.length < 2;
    delete_pack_button.disabled = true;

    const savedPack = getSavedPack();
    if (savedPack) {
      await selectPack(savedPack.pack_id, { persist: true }).catch(() => null);
    } else {
      app_logo.textContent = 'Sound unavailable';
      app_body.classList.remove('loading');
      setStatus('No valid soundpacks were found. Add a valid soundpack and restart Mechvibes.', 'error');
    }
    if (discovery.errors.length > 0 && current_pack) {
      setStatus(`${discovery.errors.length} invalid soundpack${discovery.errors.length === 1 ? '' : 's'} skipped.`, 'warning');
    }

    const renderUpdaterState = (state) => {
      if (!state) return;
      update_channel.value = state.channel || 'stable';
      check_updates_button.disabled = state.status === 'checking' || state.status === 'downloading';
      download_update_button.classList.add('hidden');
      install_update_button.classList.add('hidden');
      update_progress.classList.add('hidden');
      update_details.classList.add('hidden');
      update_release_notes.textContent = '';

      const messages = {
        idle: 'Updates are ready to check.',
        development: 'Automatic updates are available in installed builds.',
        checking: 'Checking for updates…',
        'not-available': `Mechvibes ${state.currentVersion} is up to date.`,
        downloading: 'Downloading update…',
        downloaded: `Mechvibes ${state.availableVersion || ''} is ready to install.`,
        error: `Update failed: ${state.error || 'Unknown error.'}`,
      };
      update_status.textContent = messages[state.status] || 'Update status is unavailable.';

      if (state.status === 'available') {
        update_status.textContent = `Mechvibes ${state.availableVersion} is available. Review the changes before downloading.`;
        update_details.classList.remove('hidden');
        download_update_button.classList.remove('hidden');
        update_release_notes.textContent = state.releaseNotes || 'No release notes were provided.';
      }
      if (state.status === 'downloading') {
        const percent = Math.max(0, Math.min(100, Number(state.progress && state.progress.percent) || 0));
        update_details.classList.remove('hidden');
        update_progress.classList.remove('hidden');
        update_progress.setAttribute('aria-valuenow', String(Math.round(percent)));
        update_progress_bar.style.width = `${percent}%`;
        update_status.textContent = `Downloading update… ${Math.round(percent)}%`;
      }
      if (state.status === 'downloaded') {
        update_details.classList.remove('hidden');
        install_update_button.classList.remove('hidden');
      }
    };

    ipcRenderer.on('updater-state', (_event, state) => renderUpdaterState(state));
    check_updates_button.addEventListener('click', () => ipcRenderer.send('updater-check'));
    download_update_button.addEventListener('click', () => ipcRenderer.send('updater-download'));
    install_update_button.addEventListener('click', () => ipcRenderer.send('updater-install'));
    update_channel.addEventListener('change', () => ipcRenderer.send('updater-set-channel', update_channel.value));
    renderUpdaterState(ipcRenderer.sendSync('updater-get-state'));

    const refreshOutputDevices = async () => {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
        output_device.disabled = true;
        choose_output_button.disabled = true;
        output_device_status.textContent = 'Output selection is not supported by this runtime.';
        return;
      }
      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === 'audiooutput');
      output_device.textContent = '';
      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = 'System default';
      output_device.appendChild(defaultOption);
      devices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Audio output ${index + 1}`;
        output_device.appendChild(option);
      });
      const selectedExists = !output_device_id || devices.some((device) => device.deviceId === output_device_id);
      if (!selectedExists) {
        output_device_id = '';
        store.set(OUTPUT_DEVICE_LSID, '');
        output_device_status.textContent = 'Saved device disconnected; using system default.';
        if (current_pack) {
          Promise.resolve().then(() => applyOutputDevice('')).catch(() => {});
        }
      }
      output_device.value = output_device_id;
    };

    const applyOutputDevice = async (deviceId) => {
      if (!current_pack) throw new Error('No soundpack is active.');
      if (typeof current_pack.SetOutputDevice === 'function') {
        await current_pack.SetOutputDevice(deviceId);
      } else if (Howler.ctx && typeof Howler.ctx.setSinkId === 'function') {
        await Howler.ctx.setSinkId(deviceId || '');
      } else {
        throw new Error('Output selection is not supported by this audio engine.');
      }
      output_device_id = deviceId || '';
      store.set(OUTPUT_DEVICE_LSID, output_device_id);
      output_device.value = output_device_id;
      output_device_status.textContent = output_device_id ? 'Selected output is active.' : 'Using system default output.';
    };

    choose_output_button.addEventListener('click', async () => {
      try {
        let deviceId = output_device.value;
        if (navigator.mediaDevices && typeof navigator.mediaDevices.selectAudioOutput === 'function') {
          const selected = await navigator.mediaDevices.selectAudioOutput(
            output_device_id ? { deviceId: output_device_id } : undefined,
          );
          deviceId = selected.deviceId;
          await refreshOutputDevices();
        }
        await applyOutputDevice(deviceId);
      } catch (error) {
        output_device_status.textContent = `Could not select output: ${error.message}`;
      }
    });
    output_device.addEventListener('change', () => {
      applyOutputDevice(output_device.value).catch((error) => {
        output_device_status.textContent = `Could not select output: ${error.message}`;
      });
    });
    if (navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        refreshOutputDevices().catch((error) => {
          output_device_status.textContent = `Could not refresh outputs: ${error.message}`;
        });
      });
    }
    refreshOutputDevices().catch((error) => {
      output_device_status.textContent = `Could not list outputs: ${error.message}`;
    });

    fetch('https://beta.mechvibes.com/debug/status/', {
      method: 'GET',
      headers: {
        'User-Agent': `Mechvibes/${APP_VERSION} (Electron/${process.versions.electron})`,
      },
    }).then(async (res) => {
      const body = await res.text();
      if (res.status === 200 && body === 'enabled') {
        debug_button.classList.remove('hidden');
        debug_button_seperator.classList.remove('hidden');
      }
    }).catch((error) => log.debug(`Debug status check failed: ${error.message}`));

    Array.from(document.getElementsByClassName('open-in-browser')).forEach((element) => {
      element.addEventListener('click', (event) => {
        event.preventDefault();
        shell.openExternal(event.currentTarget.href);
      });
    });

    if (store.has(MV_TRAY_LSID)) {
      tray_icon_toggle.checked = Boolean(store.get(MV_TRAY_LSID));
    }
    tray_icon_toggle.addEventListener('change', () => {
      ipcRenderer.send('show_tray_icon', tray_icon_toggle.checked);
      store.set(MV_TRAY_LSID, tray_icon_toggle.checked);
    });
    ipcRenderer.send('show_tray_icon', tray_icon_toggle.checked);

    const savedTheme = store.get(THEME_LSID);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    dark_mode_toggle.checked = savedTheme === 'dark' || (savedTheme === undefined && prefersDark);
    const applyTheme = () => {
      const theme = dark_mode_toggle.checked ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
      store.set(THEME_LSID, theme);
    };
    dark_mode_toggle.addEventListener('change', applyTheme);
    applyTheme();

    const displayVolume = () => {
      const configuredVolume = Number(volume.value);
      const adjustedVolume = calculateAdjustedDisplay({
        configuredVolume,
        systemVolume: system_volume,
        activeAdjustment: active_volume,
      });
      volume_value.textContent = active_volume
        ? `${configuredVolume} (adjusted ${adjustedVolume})`
        : String(configuredVolume);
      volume.setAttribute('aria-valuetext', `${configuredVolume} percent${active_volume ? `, adjusted to ${adjustedVolume} percent` : ''}`);
      last_applied_gain = null;
    };
    volume.value = store.has(MV_VOL_LSID) ? store.get(MV_VOL_LSID) : 50;
    displayVolume();
    volume.addEventListener('input', function () {
      store.set(MV_VOL_LSID, Number(this.value));
      displayVolume();
    });

    volume.addEventListener('wheel', (event) => {
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      const nextVolume = Number(volume.value) + direction * Number(volume.step);
      volume.value = Math.min(Number(volume.max), Math.max(Number(volume.min), nextVolume));
      store.set(MV_VOL_LSID, Number(volume.value));
      displayVolume();
    }, { passive: false });

    // warn about debugging
    ipcRenderer.on('debug-in-use', (_event, enabled) => {
      if (enabled) {
        debug_in_use.classList.remove('hidden');
      } else {
        debug_in_use.classList.add('hidden');
      }
    });

    ipcRenderer.on('input-hook-error', (_event, message) => {
      setStatus(message || 'Global keyboard capture is unavailable.', 'error');
    });

    ipcRenderer.on('system-volume-update', (_event, vol) => {
      system_volume = vol;
      displayVolume();
    });

    // warn about muted system
    ipcRenderer.on("system-mute-status", (_event, enabled) => {
      is_system_muted = enabled;
      if(enabled){
        system_muted.classList.remove("hidden");
      }else{
        system_muted.classList.add("hidden");
      }
    });

    // warn about muted mechvibes
    ipcRenderer.on("mechvibes-mute-status", (_event, enabled) => {
      is_mechvibes_muted = enabled;
      if(enabled){
        mechvibes_muted.classList.remove("hidden");
      }else{
        mechvibes_muted.classList.add("hidden");
      }
    });

    ipcRenderer.on("ava-toggle", (_event, enabled) => {
      active_volume = enabled;
      displayVolume();
    });

    const pressedKeys = new Set();

    ipcRenderer.on('keyup', (_, inputEvent) => {
      const { keycode, capturedAtMs } = inputEvent;
      pressedKeys.delete(keycode);
      playSound({ type: 'keyup', keycode, capturedAtMs }, volume.value);
      if (pressedKeys.size === 0) {
        app_logo.classList.remove('pressed');
      }
    });

    ipcRenderer.on('keydown', (_, inputEvent) => {
      const { keycode, capturedAtMs } = inputEvent;
      if (pressedKeys.has(keycode)) {
        return;
      }
      pressedKeys.add(keycode);
      app_logo.classList.add('pressed');
      playSound({ type: 'keydown', keycode, capturedAtMs }, volume.value);
    });

    random_button.addEventListener('click', () => {
      const packIndex = chooseRandomPackIndex(packs, current_pack ? current_pack.pack_id : null);
      if (packIndex === null) {
        return;
      }
      setPackByIndex(packIndex);
    });

    const runSoundpackAction = async (button, action, pendingMessage, refreshAfter = true) => {
      button.disabled = true;
      soundpack_manager_status.textContent = pendingMessage;
      try {
        const result = await action();
        if (!result || !result.ok) {
          soundpack_manager_status.textContent = result && result.canceled ? 'Action canceled.' : `Action failed: ${(result && result.error) || 'Unknown error.'}`;
          return;
        }
        if (refreshAfter) {
          soundpack_manager_status.textContent = 'Soundpack manager updated. Refreshing…';
          window.location.reload();
        } else {
          soundpack_manager_status.textContent = 'Soundpack folder opened.';
        }
      } catch (error) {
        soundpack_manager_status.textContent = `Action failed: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    };

    refresh_packs_button.addEventListener('click', () => {
      runSoundpackAction(refresh_packs_button, () => ipcRenderer.invoke('soundpack-refresh'), 'Refreshing soundpacks…');
    });
    import_pack_button.addEventListener('click', () => {
      runSoundpackAction(import_pack_button, () => ipcRenderer.invoke('soundpack-import'), 'Waiting for a ZIP soundpack…');
    });
    open_packs_button.addEventListener('click', () => {
      runSoundpackAction(open_packs_button, () => ipcRenderer.invoke('soundpack-open-folder'), 'Opening soundpack folder…', false);
    });
    delete_pack_button.addEventListener('click', () => {
      if (!current_pack) return;
      runSoundpackAction(
        delete_pack_button,
        () => ipcRenderer.invoke('soundpack-delete', current_pack.pack_id),
        'Waiting for deletion confirmation…',
      );
    });

    debug_button.addEventListener('click', (e) => {
      e.preventDefault();
      ipcRenderer.send("open-debug-options");
    })

    quick_disable_remote.addEventListener('click', (event) => {
      event.preventDefault();
      ipcRenderer.send('set-debug-options', { enabled: false });
    });

    ipcRenderer.send('renderer-ready');
  });
})(window, document);

window.addEventListener('beforeunload', () => {
  pack_manager.dispose();
});

// ==================================================
// universal play function
function playSound(event, volume) {
  if (current_pack === null || current_pack.audio === undefined || is_system_muted || is_mechvibes_muted) {
    return;
  }

  if (Number.isFinite(event.capturedAtMs)) {
    latency_tracker.record(Date.now() - event.capturedAtMs);
    if (latency_tracker.totalSamples % 1000 === 0) {
      const stats = latency_tracker.getStats();
      log.debug(`Input-to-renderer latency p50=${stats.p50Ms}ms p95=${stats.p95Ms}ms p99=${stats.p99Ms}ms`);
    }
  }

  const gain = calculateGain({
    configuredVolume: volume,
    systemVolume: system_volume,
    activeAdjustment: active_volume,
  });
  if (gain !== last_applied_gain) {
    if (typeof current_pack.SetMasterGain === 'function') {
      current_pack.SetMasterGain(gain);
    } else {
      Howler.masterGain.gain.setValueAtTime(gain, Howler.ctx.currentTime);
    }
    last_applied_gain = gain;
  }

  if (typeof current_pack.HandleEvent === 'function') {
    current_pack.HandleEvent(event, volume);
  }
}
