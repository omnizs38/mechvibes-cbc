'use strict';

const path = require('path');

const MAX_INSTALL_FILES = 4096;
const MAX_INSTALL_BYTES = 256 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const ALLOWED_FILE_EXTENSIONS = new Set([
  '.aac', '.flac', '.json', '.m4a', '.mp3', '.mp4', '.oga', '.ogg', '.opus', '.wav', '.webm',
]);

function normalizeInstallSegment(value, field) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  const normalized = value.replace(/\\/g, '/');
  const unsafeWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  const unsafeSegment = normalized.split('/').some((segment) => (
    segment === '' ||
    segment === '.' ||
    segment === '..' ||
    /[<>:"|?*\u0000-\u001f]/.test(segment) ||
    /[. ]$/.test(segment) ||
    unsafeWindowsName.test(segment)
  ));
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized) || unsafeSegment) {
    throw new Error(`${field} contains a path that is unsafe on Windows.`);
  }
  return normalized;
}

function validateInstallationManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('install.json must contain an object.');
  }
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    throw new Error('Soundpack name is missing.');
  }
  if (manifest.name.trim().length > 200) {
    throw new Error('Soundpack name must not exceed 200 characters.');
  }

  const folder = normalizeInstallSegment(manifest.folder, 'folder');
  if (folder.includes('/')) {
    throw new Error('folder must contain one directory name.');
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > MAX_INSTALL_FILES) {
    throw new Error(`files must contain between 1 and ${MAX_INSTALL_FILES} entries.`);
  }

  const files = manifest.files.map((file) => {
    const normalized = normalizeInstallSegment(file, 'file');
    const extension = path.posix.extname(normalized).toLowerCase();
    if (!ALLOWED_FILE_EXTENSIONS.has(extension)) {
      throw new Error(`Unsupported soundpack file type: ${extension || 'none'}.`);
    }
    return normalized;
  });
  if (new Set(files.map((file) => file.toLowerCase())).size !== files.length) {
    throw new Error('files contains duplicate Windows paths.');
  }

  if (!files.some((file) => file.toLowerCase() === 'config.json')) {
    throw new Error('Soundpack manifest must include config.json.');
  }

  return {
    ...manifest,
    name: manifest.name.trim(),
    folder,
    files,
  };
}

function parseContentLength(response) {
  const rawLength = response && response.headers ? response.headers.get('content-length') : null;
  if (rawLength === null) {
    return null;
  }
  const value = Number(rawLength);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function enforceDownloadSize({ fileBytes, totalBytes }) {
  if (fileBytes > MAX_FILE_BYTES) {
    throw new Error(`A soundpack file exceeds the ${MAX_FILE_BYTES} byte limit.`);
  }
  if (totalBytes > MAX_INSTALL_BYTES) {
    throw new Error(`The soundpack exceeds the ${MAX_INSTALL_BYTES} byte limit.`);
  }
}

function commitDirectoryReplacement(fileSystem, { tempDirectory, installDirectory, backupDirectory }) {
  let movedExisting = false;
  let installedReplacement = false;

  try {
    if (fileSystem.existsSync(installDirectory)) {
      fileSystem.moveSync(installDirectory, backupDirectory, { overwrite: false });
      movedExisting = true;
    }
    fileSystem.moveSync(tempDirectory, installDirectory, { overwrite: false });
    installedReplacement = true;
    if (movedExisting) {
      fileSystem.removeSync(backupDirectory);
    }
  } catch (error) {
    if (installedReplacement || movedExisting) {
      fileSystem.removeSync(installDirectory);
    }
    if (movedExisting && fileSystem.existsSync(backupDirectory)) {
      fileSystem.moveSync(backupDirectory, installDirectory, { overwrite: false });
    }
    throw error;
  }
}

async function readResponseBuffer(response, maxBytes) {
  const advertisedSize = parseContentLength(response);
  if (advertisedSize !== null && advertisedSize > maxBytes) {
    throw new Error(`Response exceeds the ${maxBytes} byte limit.`);
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`Response exceeds the ${maxBytes} byte limit.`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const chunk = Buffer.from(value);
    receivedBytes += chunk.length;
    if (receivedBytes > maxBytes) {
      try {
        await reader.cancel('Response is too large.');
      } catch (_) {
        // The size error below is the actionable failure.
      }
      throw new Error(`Response exceeds the ${maxBytes} byte limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, receivedBytes);
}

module.exports = {
  ALLOWED_FILE_EXTENSIONS,
  MAX_FILE_BYTES,
  MAX_INSTALL_BYTES,
  MAX_INSTALL_FILES,
  commitDirectoryReplacement,
  enforceDownloadSize,
  normalizeInstallSegment,
  parseContentLength,
  readResponseBuffer,
  validateInstallationManifest,
};
