'use strict';

const fs = require('fs-extra');
const path = require('path');
const electron = require('electron');
electron.remote = require('@electron/remote');
const { ipcRenderer } = electron;
const remote = electron.remote;
const { listReferencedSoundFiles, validateSoundpackConfig } = require('./libs/soundpacks/validation');
const {
  MAX_FILE_BYTES,
  commitDirectoryReplacement,
  enforceDownloadSize,
  parseContentLength,
  readResponseBuffer,
  validateInstallationManifest,
} = require('./utils/installer');

const BASE_URL = 'https://www.mechvibes.com/sound-packs';
const CUSTOM_PACKS_DIR = remote.getGlobal('custom_dir');
const REQUEST_TIMEOUT_MS = 20000;
const MANIFEST_MAX_BYTES = 1024 * 1024;

const errorTranslation = {
  400: 'INVREQ',
  401: 'UNAUTH',
  402: 'PAYMENT',
  403: 'FORBID',
  404: 'NOTFOUND',
  405: 'BADMETH',
  418: 'TEAPOT',
  429: 'TOOFAST',
  451: 'DMCA',
  500: 'SERVERR',
  502: 'SERVBAD',
  503: 'SERVUNAV',
  504: 'SERVSLOW',
  521: 'SERVOFF',
  522: 'SERVSLOW',
  523: 'SERVOFF',
  524: 'SERVSLOW',
  525: 'SERVSSL',
  526: 'SERVSSL',
};

function resizeWindow() {
  setTimeout(() => {
    ipcRenderer.send('resize-installer', document.scrollingElement.scrollHeight);
  }, 5);
}

function displayError(element, error) {
  element.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`;
  element.setAttribute('role', 'alert');
  resizeWindow();
}

async function fetchWithTimeout(url, consume) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    return await consume(response);
  } finally {
    clearTimeout(timer);
  }
}

async function downloadFile(url, destination, currentTotal) {
  return fetchWithTimeout(url, async (response) => {
    if (!response.ok) {
      const code = errorTranslation[response.status] || `HTTP ${response.status}`;
      throw new Error(`Download failed (${code}).`);
    }

    const advertisedSize = parseContentLength(response);
    if (advertisedSize !== null) {
      enforceDownloadSize({ fileBytes: advertisedSize, totalBytes: currentTotal + advertisedSize });
    }
    const buffer = await readResponseBuffer(response, MAX_FILE_BYTES);
    enforceDownloadSize({ fileBytes: buffer.length, totalBytes: currentTotal + buffer.length });
    fs.ensureDirSync(path.dirname(destination));
    fs.writeFileSync(destination, buffer, { flag: 'wx' });
    return buffer.length;
  });
}

function validateDownloadedPack(directory) {
  const configPath = path.join(directory, 'config.json');
  if (!fs.existsSync(configPath) || fs.statSync(configPath).size > MANIFEST_MAX_BYTES) {
    throw new Error('Downloaded soundpack has an invalid config.json.');
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  validateSoundpackConfig(config);
  for (const reference of listReferencedSoundFiles(config)) {
    const filePath = path.join(directory, ...reference.split('/'));
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Downloaded soundpack is missing ${reference}.`);
    }
  }
}

function commitInstallation(tempDirectory, folder) {
  const installDirectory = path.join(CUSTOM_PACKS_DIR, folder);
  commitDirectoryReplacement(fs, {
    tempDirectory,
    installDirectory,
    backupDirectory: `${installDirectory}.backup-${Date.now()}`,
  });
}

let installation = null;
let packUrl = null;
let installing = false;

ipcRenderer.on('install-pack', async (_event, packId) => {
  const logo = document.getElementById('logo');
  const packageNameSection = document.getElementById('package-section');
  const packageNameHolder = document.getElementById('package-name');
  const askPrompt = document.getElementById('ask');
  const yesButton = document.getElementById('answer-yes');
  const noButton = document.getElementById('answer-no');

  try {
    if (typeof packId !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(packId)) {
      throw new Error('Invalid soundpack identifier.');
    }
    packUrl = `${BASE_URL}/${encodeURIComponent(packId)}/dist`;
    const manifestBuffer = await fetchWithTimeout(`${packUrl}/install.json`, async (response) => {
      if (!response.ok) {
        throw new Error(`Manifest request failed (${errorTranslation[response.status] || `HTTP ${response.status}`}).`);
      }
      return readResponseBuffer(response, MANIFEST_MAX_BYTES);
    });
    installation = validateInstallationManifest(JSON.parse(manifestBuffer.toString('utf8')));

    logo.textContent = 'Sound Pack';
    packageNameHolder.textContent = installation.name;
    packageNameSection.style.display = 'block';
    askPrompt.style.display = 'block';
    resizeWindow();
  } catch (error) {
    installation = null;
    displayError(logo, error);
  }

  yesButton.onclick = async () => {
    if (installing || installation === null) {
      return;
    }
    installing = true;
    yesButton.disabled = true;
    noButton.disabled = true;

    const progressStatus = document.getElementById('status-text');
    const progressSection = document.getElementById('prog');
    const progressBar = document.getElementById('prog-bar');
    const tempDirectory = path.join(CUSTOM_PACKS_DIR, `.install-${installation.folder}-${Date.now()}`);
    let totalBytes = 0;

    askPrompt.style.display = 'none';
    progressSection.style.display = 'block';
    resizeWindow();

    try {
      fs.ensureDirSync(tempDirectory);
      for (let index = 0; index < installation.files.length; index += 1) {
        const file = installation.files[index];
        progressStatus.textContent = `Downloading ${file}…`;
        const destination = path.join(tempDirectory, ...file.split('/'));
        totalBytes += await downloadFile(`${packUrl}/${file.split('/').map(encodeURIComponent).join('/')}`, destination, totalBytes);
        const progress = ((index + 1) / installation.files.length) * 100;
        progressBar.style.width = `${progress}%`;
        progressBar.setAttribute('aria-valuenow', String(Math.round(progress)));
      }

      progressStatus.textContent = 'Validating soundpack…';
      validateDownloadedPack(tempDirectory);
      commitInstallation(tempDirectory, installation.folder);
      progressStatus.textContent = 'Installed.';
      ipcRenderer.send('installed', installation.folder);
    } catch (error) {
      fs.removeSync(tempDirectory);
      displayError(progressStatus, error);
      yesButton.disabled = false;
      noButton.disabled = false;
      installing = false;
    }
  };

  noButton.onclick = () => {
    if (!installing) {
      window.close();
    }
  };
});