'use strict';

const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

class ClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    if (force === true) {
      this.values.add(value);
      return true;
    }
    if (force === false) {
      this.values.delete(value);
      return false;
    }
    if (this.values.has(value)) {
      this.values.delete(value);
      return false;
    }
    this.values.add(value);
    return true;
  }
}

class Element {
  constructor(id = '') {
    this.id = id;
    this.classList = new ClassList();
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.style = {};
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.disabled = false;
    this.checked = true;
    this.min = '0';
    this.max = '200';
    this.step = '5';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(event, callback) {
    this.listeners.set(event, callback);
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }
}

async function runRendererSmoke(repositoryRoot, { expectedHowlCount = 1 } = {}) {
  const originalLoad = Module._load;
  const originalGlobals = {
    document: global.document,
    fetch: global.fetch,
    Howler: global.Howler,
    window: global.window,
  };
  const customDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'mechvibes-renderer-'));
  const values = new Map([['mechvibes-pack', 'default-cherrymx-black-abs']]);
  const ipcListeners = new Map();
  let howlCount = 0;

  class Store {
    has(key) { return values.has(key); }
    get(key) { return values.get(key); }
    set(key, value) { values.set(key, value); }
  }

  class Howl {
    constructor(options) {
      this.options = options;
      howlCount += 1;
    }
    state() { return 'loaded'; }
    play() {}
    unload() {}
    once() {}
    off() {}
  }

  const howler = {
    Howl,
    Howler: {
      ctx: {
        currentTime: 0,
        state: 'running',
        resume: () => Promise.resolve(),
      },
      masterGain: {
        gain: { setValueAtTime() {} },
      },
    },
  };

  const electron = {
    ipcRenderer: {
      on(channel, callback) { ipcListeners.set(channel, callback); },
      send() {},
    },
    remote: {
      getGlobal(name) {
        return {
          app_version: 'v2.3.5',
          current_pack_store_id: 'mechvibes-pack',
          custom_dir: customDirectory,
        }[name];
      },
    },
    shell: { openExternal: () => Promise.resolve() },
  };

  const elements = new Map();
  const ids = [
    'app-body', 'app-logo', 'app-status', 'app-version', 'debug-options-seperator',
    'logo', 'mechvibes-muted', 'new-version', 'open-debug-options', 'pack-list',
    'quick-disable-remote', 'random-button', 'remote-in-use', 'system-muted',
    'tray_icon_toggle', 'tray_icon_toggle_group', 'update-available', 'volume', 'volume-value-display',
  ];
  for (const id of ids) {
    elements.set(id, new Element(id));
  }
  elements.get('app-body').classList.add('loading');
  elements.get('app-status').classList.add('hidden');
  elements.get('volume').value = '50';

  let domReady = null;
  let beforeUnload = null;
  const document = {
    createElement: () => new Element(),
    getElementById: (id) => elements.get(id) || null,
    getElementsByClassName: () => [],
  };
  const window = {
    addEventListener(event, callback) {
      if (event === 'DOMContentLoaded') {
        domReady = callback;
      } else if (event === 'beforeunload') {
        beforeUnload = callback;
      }
    },
  };

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') return electron;
    if (request === 'electron-store') return Store;
    if (request === 'howler') return howler;
    if (request === 'glob') {
      return {
        sync(pattern) {
          const directory = pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern;
          if (!fs.existsSync(directory)) {
            return [];
          }
          return fs.readdirSync(directory).map((entry) => path.join(directory, entry));
        },
      };
    }
    if (request === 'mime-types') {
      return {
        lookup(file) {
          const extension = path.extname(file).toLowerCase();
          return extension === '.mp3' ? 'audio/mpeg' : `audio/${extension.slice(1) || 'unknown'}`;
        },
        types: {},
      };
    }
    if (request === 'adm-zip') {
      return class UnusedZip {};
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  global.document = document;
  global.window = window;
  global.Howler = howler.Howler;
  global.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => ({ tag_name: 'v2.3.5' }),
    text: async () => url.includes('/debug/status/') ? 'disabled' : '',
  });

  const appPath = path.join(repositoryRoot, 'src', 'app.js');
  delete require.cache[require.resolve(appPath)];
  try {
    require(appPath);
    if (typeof domReady !== 'function') {
      throw new Error('Renderer did not register DOMContentLoaded.');
    }
    await domReady();
    await new Promise((resolve) => setImmediate(resolve));

    const logoText = elements.get('logo').textContent || elements.get('logo').innerHTML;
    if (logoText !== 'Mechvibes') {
      throw new Error(`Renderer did not reach ready state: ${logoText}`);
    }
    if (elements.get('pack-list').children.length === 0) {
      throw new Error('Renderer did not populate the soundpack selector.');
    }
    if (expectedHowlCount !== null && howlCount !== expectedHowlCount) {
      throw new Error(`Expected ${expectedHowlCount} initial Howl instance(s); created ${howlCount}.`);
    }
    if (typeof beforeUnload === 'function') {
      beforeUnload();
    }
    return { howlCount };
  } finally {
    delete require.cache[require.resolve(appPath)];
    Module._load = originalLoad;
    global.document = originalGlobals.document;
    global.fetch = originalGlobals.fetch;
    global.Howler = originalGlobals.Howler;
    global.window = originalGlobals.window;
    fs.rmSync(customDirectory, { recursive: true, force: true });
  }
}

module.exports = { runRendererSmoke };
