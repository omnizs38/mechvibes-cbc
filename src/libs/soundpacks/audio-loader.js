'use strict';

const DEFAULT_LOAD_TIMEOUT_MS = 10000;

function waitForHowl(audio) {
  return new Promise((resolve, reject) => {
    if (!audio || typeof audio.state !== 'function') {
      reject(new Error('Invalid audio resource.'));
      return;
    }
    if (audio.state() === 'loaded') {
      resolve();
      return;
    }

    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = (_id, error) => {
      cleanup();
      reject(new Error(`Audio failed to load${error ? `: ${error}` : '.'}`));
    };
    const cleanup = () => {
      if (typeof audio.off === 'function') {
        audio.off('load', onLoad);
        audio.off('loaderror', onError);
      }
    };

    audio.once('load', onLoad);
    audio.once('loaderror', onError);
  });
}

function withTimeout(promise, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS, message = 'The soundpack took too long to load.') {
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  });
}

async function loadHowls(entries, { timeoutMs = DEFAULT_LOAD_TIMEOUT_MS } = {}) {
  const resources = entries.map(({ key, audio }) => ({ key, audio }));
  try {
    await withTimeout(
      Promise.all(resources.map(({ audio }) => waitForHowl(audio))),
      timeoutMs,
    );
    return Object.fromEntries(resources.map(({ key, audio }) => [key, audio]));
  } catch (error) {
    for (const audio of new Set(resources.map((resource) => resource.audio))) {
      if (audio && typeof audio.off === 'function') {
        audio.off('load');
        audio.off('loaderror');
      }
      if (audio && typeof audio.unload === 'function') {
        audio.unload();
      }
    }
    throw error;
  }
}

async function loadSharedHowls(soundData, createHowl, options = {}) {
  const audioBySource = new Map();
  const sourceEntries = [];
  const audioByKey = {};

  try {
    for (const [key, howlOptions] of Object.entries(soundData)) {
      const sources = Array.isArray(howlOptions.src) ? howlOptions.src : [howlOptions.src];
      const sourceKey = JSON.stringify(sources);
      let audio = audioBySource.get(sourceKey);
      if (!audio) {
        audio = createHowl(howlOptions);
        audioBySource.set(sourceKey, audio);
        sourceEntries.push({ key: sourceKey, audio });
      }
      audioByKey[key] = audio;
    }
    if (sourceEntries.length === 0) {
      throw new Error('Soundpack does not define any playable audio.');
    }
  } catch (error) {
    for (const audio of audioBySource.values()) {
      if (audio && typeof audio.unload === 'function') {
        audio.unload();
      }
    }
    throw error;
  }

  await loadHowls(sourceEntries, options);
  return audioByKey;
}

module.exports = {
  DEFAULT_LOAD_TIMEOUT_MS,
  loadHowls,
  loadSharedHowls,
  waitForHowl,
  withTimeout,
};
