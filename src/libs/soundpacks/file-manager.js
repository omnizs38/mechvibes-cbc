'use strict';

const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const Zip = require('adm-zip');
const { normalizeSoundReference } = require('./validation');

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 4096;
const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const fileCache = new Map();

mime.types.mp4 = 'audio/mp4';
mime.types.wav = 'audio/wav';

function IsArchivePath(folder) {
  return path.extname(folder).toLowerCase() === '.zip';
}

function normalizeArchivePath(value) {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new Error('Archive file path is invalid.');
  }
  const slashPath = value.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  const unsafeWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  const unsafeSegment = slashPath.split('/').some((segment) => (
    segment === '' ||
    segment === '.' ||
    segment === '..' ||
    /[<>:"|?*\u0000-\u001f]/.test(segment) ||
    /[. ]$/.test(segment) ||
    unsafeWindowsName.test(segment)
  ));
  if (path.posix.isAbsolute(slashPath) || /^[a-zA-Z]:\//.test(slashPath) || unsafeSegment) {
    throw new Error('Archive file path is unsafe on Windows.');
  }
  return path.posix.normalize(slashPath).toLowerCase();
}

function openArchive(folder) {
  const stat = fs.statSync(folder);
  if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`Soundpack archive exceeds the ${MAX_ARCHIVE_BYTES} byte limit.`);
  }
  const archive = new Zip(folder);
  const entries = archive.getEntries();
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`Soundpack archive exceeds the ${MAX_ARCHIVE_ENTRIES} entry limit.`);
  }

  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    if (entry.isDirectory) {
      continue;
    }
    normalizeArchivePath(entry.entryName);
    const size = entrySize(entry);
    if (size !== null) {
      totalUncompressedBytes += size;
      if (totalUncompressedBytes > MAX_ARCHIVE_BYTES) {
        throw new Error(`Soundpack archive expands beyond the ${MAX_ARCHIVE_BYTES} byte limit.`);
      }
    }
  }
  return entries;
}

function entrySize(entry) {
  const size = entry && entry.header ? Number(entry.header.size) : NaN;
  return Number.isFinite(size) && size >= 0 ? size : null;
}

function readArchiveEntry(entry, isConfig) {
  const advertisedSize = entrySize(entry);
  const sizeLimit = isConfig ? MAX_CONFIG_BYTES : MAX_FILE_BYTES;
  if (advertisedSize !== null && advertisedSize > sizeLimit) {
    throw new Error(`Soundpack file "${entry.entryName}" exceeds the ${sizeLimit} byte limit.`);
  }

  const data = entry.getData();
  if (data.length > sizeLimit) {
    throw new Error(`Soundpack file "${entry.entryName}" exceeds the ${sizeLimit} byte limit.`);
  }
  if (isConfig) {
    return data.toString('utf8');
  }

  const mimeType = mime.lookup(entry.entryName);
  if (!mimeType || !String(mimeType).startsWith('audio/')) {
    throw new Error(`Unsupported audio type in "${entry.entryName}".`);
  }
  return `data:${mimeType};base64,${data.toString('base64')}`;
}

function findArchiveEntry(entries, search) {
  const normalizedSearch = normalizeArchivePath(search);
  const exact = entries.find((entry) => !entry.isDirectory && normalizeArchivePath(entry.entryName) === normalizedSearch);
  if (exact) {
    return exact;
  }

  if (!normalizedSearch.includes('/')) {
    const basenameMatches = entries.filter(
      (entry) => !entry.isDirectory && path.posix.basename(normalizeArchivePath(entry.entryName)) === normalizedSearch,
    );
    if (basenameMatches.length === 1) {
      return basenameMatches[0];
    }
  }
  return null;
}

function GetFilesFromArchive(folder) {
  const files = {};
  for (const entry of openArchive(folder)) {
    if (entry.isDirectory) {
      continue;
    }
    const normalizedName = normalizeArchivePath(entry.entryName);
    const isConfig = normalizedName === 'config.json' || path.posix.basename(normalizedName) === 'config.json';
    files[normalizedName] = readArchiveEntry(entry, isConfig);
  }
  return files;
}

function GetFileFromArchive(folder, search) {
  const cacheKey = `archive:${folder}:${normalizeArchivePath(search)}`;
  if (fileCache.has(cacheKey)) {
    return fileCache.get(cacheKey);
  }

  const entry = findArchiveEntry(openArchive(folder), search);
  if (!entry) {
    return null;
  }
  const isConfig = normalizeArchivePath(search) === 'config.json';
  const value = readArchiveEntry(entry, isConfig);
  fileCache.set(cacheKey, value);
  return value;
}

function resolveContainedFile(folder, file) {
  const safeReference = normalizeSoundReference(file);
  const root = fs.realpathSync(folder);
  const candidate = path.resolve(root, ...safeReference.split('/'));
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error('Soundpack file path escapes the soundpack folder.');
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    return null;
  }
  const realCandidate = fs.realpathSync(candidate);
  if (realCandidate !== root && !realCandidate.startsWith(`${root}${path.sep}`)) {
    throw new Error('Soundpack file resolves outside the soundpack folder.');
  }
  return realCandidate;
}

function GetFileFromFolder(folder, file) {
  const cacheKey = `folder:${folder}:${file}`;
  if (fileCache.has(cacheKey)) {
    return fileCache.get(cacheKey);
  }

  const filePath = resolveContainedFile(folder, file);
  if (filePath === null) {
    return null;
  }
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`Soundpack file exceeds the ${MAX_FILE_BYTES} byte limit.`);
  }
  const mimeType = mime.lookup(filePath);
  if (!mimeType || !String(mimeType).startsWith('audio/')) {
    throw new Error(`Unsupported audio type in "${file}".`);
  }
  const value = `data:${mimeType};base64,${fs.readFileSync(filePath, 'base64')}`;
  fileCache.set(cacheKey, value);
  return value;
}

function GetSoundpackFile(absPath, sound) {
  const safeSound = normalizeSoundReference(sound);
  const value = IsArchivePath(absPath)
    ? GetFileFromArchive(absPath, safeSound)
    : GetFileFromFolder(absPath, safeSound);
  if (value === null) {
    throw new Error(`Soundpack audio file is missing: ${safeSound}.`);
  }
  return value;
}

function ClearSoundpackCache(absPath) {
  for (const cacheKey of fileCache.keys()) {
    if (cacheKey.startsWith(`archive:${absPath}:`) || cacheKey.startsWith(`folder:${absPath}:`)) {
      fileCache.delete(cacheKey);
    }
  }
}

module.exports = {
  ClearSoundpackCache,
  GetFileFromArchive,
  GetFileFromFolder,
  GetFilesFromArchive,
  GetSoundpackFile,
  IsArchivePath,
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_CONFIG_BYTES,
  MAX_FILE_BYTES,
};