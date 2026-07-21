'use strict';

// All of the Node.js APIs are available in the preload process.
// It has the same sandbox as a Chrome extension.
// const gkm = require('gkm');
const Store = require('electron-store');
const store = new Store();
const { Howler } = require('howler');
const { shell, remote, ipcRenderer } = require('electron');
const path = require('path');
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

let active_volume = true;
let system_volume = 50;
let is_system_muted = false;
let current_pack = null;
let last_applied_gain = null;
let pack_selection_ui_id = 0;
const packs = [];
const pack_manager = new SoundpackManager(packs);

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
    const update_available = document.getElementById('update-available');
    const debug_in_use = document.getElementById('remote-in-use');
    const quick_disable_remote = document.getElementById('quick-disable-remote');
    const mechvibes_muted = document.getElementById('mechvibes-muted');
    const system_muted = document.getElementById('system-muted');
    const new_version = document.getElementById('new-version');
    const app_logo = document.getElementById('logo');
    const app_body = document.getElementById('app-body');
    const pack_list = document.getElementById('pack-list');
    const random_button = document.getElementById('random-button');
    const debug_button = document.getElementById('open-debug-options');
    const debug_button_seperator = document.getElementById('debug-options-seperator');
    const volume_value = document.getElementById('volume-value-display');
    const volume = document.getElementById('volume');
    const tray_icon_toggle = document.getElementById('tray_icon_toggle');

    app_logo.textContent = 'Loading...';
    version.textContent = APP_VERSION;

    const discovery = loadPacks();
    packsToOptions(packs, pack_list);
    random_button.disabled = packs.length < 2;

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

    fetch('https://api.github.com/repos/hainguyents13/mechvibes/releases/latest')
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Update check failed with HTTP ${res.status}.`);
        }
        return res.json();
      })
      .then((json) => {
        if (json.tag_name && json.tag_name.localeCompare(APP_VERSION, undefined, { numeric: true }) === 1) {
          new_version.textContent = json.tag_name;
          update_available.classList.remove('hidden');
        }
      })
      .catch((error) => log.debug(error.message));

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

    ipcRenderer.on('keyup', (_, { keycode }) => {
      pressedKeys.delete(keycode);
      playSound({ type: 'keyup', keycode }, volume.value);
      if (pressedKeys.size === 0) {
        app_logo.classList.remove('pressed');
      }
    });

    ipcRenderer.on('keydown', (_, { keycode }) => {
      if (pressedKeys.has(keycode)) {
        return;
      }
      pressedKeys.add(keycode);
      app_logo.classList.add('pressed');
      playSound({ type: 'keydown', keycode }, volume.value);
    });

    random_button.addEventListener('click', () => {
      const packIndex = chooseRandomPackIndex(packs, current_pack ? current_pack.pack_id : null);
      if (packIndex === null) {
        return;
      }
      setPackByIndex(packIndex);
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
  if (current_pack === null || current_pack.audio === undefined || is_system_muted) {
    return;
  }

  const gain = calculateGain({
    configuredVolume: volume,
    systemVolume: system_volume,
    activeAdjustment: active_volume,
  });
  if (gain !== last_applied_gain) {
    Howler.masterGain.gain.setValueAtTime(gain, Howler.ctx.currentTime);
    last_applied_gain = gain;
  }

  if (typeof current_pack.HandleEvent === 'function') {
    current_pack.HandleEvent(event, volume);
  }
}
