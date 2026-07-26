'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import mime from 'mime-types';
import Zip from 'adm-zip';
import { normalizeSoundReference } from './validation';

type ArchiveEntry = Zip.IZipEntry;

export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 4096;
export const MAX_CONFIG_BYTES = 1024 * 1024;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

const fileCache = new Map<string, string>();
const archiveEntriesCache = new Map<
  string,
  { size: number; mtimeMs: number; entries: ArchiveEntry[] }
>();

(mime.types as Record<string, string>)['mp4'] = 'audio/mp4';
(mime.types as Record<string, string>)['wav'] = 'audio/wav';

export function IsArchivePath(folder: string): boolean {
  return path.extname(folder).toLowerCase() === '.zip';
}

function normalizeArchivePath(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new Error('Archive file path is invalid.');
  }
  const slashPath = value.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  const unsafeWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  const unsafeSegment = slashPath
    .split('/')
    .some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        /[<>:"|?*]|\p{Cc}/u.test(segment) ||
        /[. ]$/.test(segment) ||
        unsafeWindowsName.test(segment),
    );
  if (path.posix.isAbsolute(slashPath) || /^[a-zA-Z]:\//.test(slashPath) || unsafeSegment) {
    throw new Error('Archive file path is unsafe on Windows.');
  }
  return path.posix.normalize(slashPath).toLowerCase();
}

function entrySize(entry: ArchiveEntry | null | undefined): number | null {
  const size = entry && entry.header ? Number(entry.header.size) : NaN;
  return Number.isFinite(size) && size >= 0 ? size : null;
}

function openArchive(folder: string): ArchiveEntry[] {
  const stat = fs.statSync(folder);
  if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES) {
    throw new Error(`Soundpack archive exceeds the ${MAX_ARCHIVE_BYTES} byte limit.`);
  }
  const cached = archiveEntriesCache.get(folder);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.entries;
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
  archiveEntriesCache.set(folder, { size: stat.size, mtimeMs: stat.mtimeMs, entries });
  return entries;
}

function readArchiveEntry(entry: ArchiveEntry, isConfig: boolean): string {
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

function findArchiveEntry(entries: ArchiveEntry[], search: string): ArchiveEntry | null {
  const normalizedSearch = normalizeArchivePath(search);
  const exact = entries.find(
    (entry) => !entry.isDirectory && normalizeArchivePath(entry.entryName) === normalizedSearch,
  );
  if (exact) {
    return exact;
  }

  if (!normalizedSearch.includes('/')) {
    const basenameMatches = entries.filter(
      (entry) =>
        !entry.isDirectory &&
        path.posix.basename(normalizeArchivePath(entry.entryName)) === normalizedSearch,
    );
    if (basenameMatches.length === 1) {
      return basenameMatches[0] as ArchiveEntry;
    }
  }
  return null;
}

export function GetFilesFromArchive(folder: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of openArchive(folder)) {
    if (entry.isDirectory) {
      continue;
    }
    const normalizedName = normalizeArchivePath(entry.entryName);
    const isConfig =
      normalizedName === 'config.json' || path.posix.basename(normalizedName) === 'config.json';
    files[normalizedName] = readArchiveEntry(entry, isConfig);
  }
  return files;
}

export function GetFileFromArchive(folder: string, search: string): string | null {
  const cacheKey = `archive:${folder}:${normalizeArchivePath(search)}`;
  const cached = fileCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
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

function resolveContainedFile(folder: string, file: unknown): string | null {
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

export function GetFileFromFolder(folder: string, file: string): string | null {
  const cacheKey = `folder:${folder}:${file}`;
  const cached = fileCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
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

export function GetSoundpackFile(absPath: string, sound: unknown): string {
  const safeSound = normalizeSoundReference(sound);
  const value = IsArchivePath(absPath)
    ? GetFileFromArchive(absPath, safeSound)
    : GetFileFromFolder(absPath, safeSound);
  if (value === null) {
    throw new Error(`Soundpack audio file is missing: ${safeSound}.`);
  }
  return value;
}

export function GetSoundpackSource(absPath: string, sound: unknown): string {
  const safeSound = normalizeSoundReference(sound);
  if (IsArchivePath(absPath)) {
    const entry = findArchiveEntry(openArchive(absPath), safeSound);
    if (!entry) throw new Error(`Soundpack audio file is missing: ${safeSound}.`);
    const payload = Buffer.from(
      JSON.stringify({ archive: absPath, file: safeSound }),
      'utf8',
    ).toString('base64url');
    return `mechvibes-archive:${payload}`;
  }
  const filePath = resolveContainedFile(absPath, safeSound);
  if (filePath === null) throw new Error(`Soundpack audio file is missing: ${safeSound}.`);
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`Soundpack file exceeds the ${MAX_FILE_BYTES} byte limit.`);
  }
  const mimeType = mime.lookup(filePath);
  if (!mimeType || !String(mimeType).startsWith('audio/')) {
    throw new Error(`Unsupported audio type in "${safeSound}".`);
  }
  return pathToFileURL(filePath).href;
}

export async function ReadSoundpackSource(source: unknown): Promise<Buffer | null> {
  const value = String(source);
  if (value.startsWith('file:')) {
    return fs.promises.readFile(fileURLToPath(value));
  }
  if (value.startsWith('mechvibes-archive:')) {
    let descriptor: { archive: string; file: string };
    try {
      descriptor = JSON.parse(
        Buffer.from(value.slice('mechvibes-archive:'.length), 'base64url').toString('utf8'),
      );
    } catch {
      throw new Error('Invalid archived soundpack source.');
    }
    const dataUrl = GetFileFromArchive(descriptor.archive, descriptor.file);
    if (dataUrl === null) throw new Error(`Soundpack audio file is missing: ${descriptor.file}.`);
    const commaIndex = dataUrl.indexOf(',');
    return Buffer.from(dataUrl.slice(commaIndex + 1), 'base64');
  }
  if (value.startsWith('data:')) {
    const commaIndex = value.indexOf(',');
    if (commaIndex < 0) throw new Error('Invalid data URL soundpack source.');
    return Buffer.from(value.slice(commaIndex + 1), 'base64');
  }
  return null;
}

export function ClearSoundpackCache(absPath: string): void {
  archiveEntriesCache.delete(absPath);
  for (const cacheKey of fileCache.keys()) {
    if (cacheKey.startsWith(`archive:${absPath}:`) || cacheKey.startsWith(`folder:${absPath}:`)) {
      fileCache.delete(cacheKey);
    }
  }
}
