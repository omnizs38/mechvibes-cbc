'use strict';

import path from 'path';

export const MAX_INSTALL_FILES = 4096;
export const MAX_INSTALL_BYTES = 256 * 1024 * 1024;
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const ALLOWED_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.aac',
  '.flac',
  '.json',
  '.m4a',
  '.mp3',
  '.mp4',
  '.oga',
  '.ogg',
  '.opus',
  '.wav',
  '.webm',
]);

export interface InstallationManifest {
  name: string;
  folder: string;
  files: string[];
  [key: string]: unknown;
}

export interface DownloadSizeInput {
  fileBytes: number;
  totalBytes: number;
}

export interface DirectoryReplacement {
  tempDirectory: string;
  installDirectory: string;
  backupDirectory: string;
}

/** Minimal `fs-extra` surface used by {@link commitDirectoryReplacement}. */
export interface ReplacementFileSystem {
  existsSync(target: string): boolean;
  moveSync(source: string, destination: string, options?: { overwrite?: boolean }): void;
  removeSync(target: string): void;
}

/** Minimal response surface shared by `fetch` and `electron-fetch`. */
export interface SizedResponse {
  headers?: { get(name: string): string | null } | undefined;
  body?: { getReader?: () => ReadableStreamDefaultReader<Uint8Array> } | null | undefined;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export function normalizeInstallSegment(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.includes('\0')) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  const normalized = value.replace(/\\/g, '/');
  const unsafeWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  const unsafeSegment = normalized
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
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized) || unsafeSegment) {
    throw new Error(`${field} contains a path that is unsafe on Windows.`);
  }
  return normalized;
}

export function validateInstallationManifest(manifest: unknown): InstallationManifest {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('install.json must contain an object.');
  }
  const candidate = manifest as Record<string, unknown>;
  const name = candidate['name'];
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error('Soundpack name is missing.');
  }
  if (name.trim().length > 200) {
    throw new Error('Soundpack name must not exceed 200 characters.');
  }

  const folder = normalizeInstallSegment(candidate['folder'], 'folder');
  if (folder.includes('/')) {
    throw new Error('folder must contain one directory name.');
  }

  const rawFiles = candidate['files'];
  if (!Array.isArray(rawFiles) || rawFiles.length === 0 || rawFiles.length > MAX_INSTALL_FILES) {
    throw new Error(`files must contain between 1 and ${MAX_INSTALL_FILES} entries.`);
  }

  const files = rawFiles.map((file) => {
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
    ...candidate,
    name: name.trim(),
    folder,
    files,
  };
}

export function parseContentLength(response: SizedResponse | null | undefined): number | null {
  const rawLength = response && response.headers ? response.headers.get('content-length') : null;
  if (rawLength === null || rawLength === undefined) {
    return null;
  }
  const value = Number(rawLength);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function enforceDownloadSize({ fileBytes, totalBytes }: DownloadSizeInput): void {
  if (fileBytes > MAX_FILE_BYTES) {
    throw new Error(`A soundpack file exceeds the ${MAX_FILE_BYTES} byte limit.`);
  }
  if (totalBytes > MAX_INSTALL_BYTES) {
    throw new Error(`The soundpack exceeds the ${MAX_INSTALL_BYTES} byte limit.`);
  }
}

export function commitDirectoryReplacement(
  fileSystem: ReplacementFileSystem,
  { tempDirectory, installDirectory, backupDirectory }: DirectoryReplacement,
): void {
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

export async function readResponseBuffer(
  response: SizedResponse,
  maxBytes: number,
): Promise<Buffer> {
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
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  let readResult = await reader.read();
  while (!readResult.done) {
    const chunk = Buffer.from(readResult.value);
    receivedBytes += chunk.length;
    if (receivedBytes > maxBytes) {
      try {
        await reader.cancel('Response is too large.');
      } catch {
        // The size error below is the actionable failure.
      }
      throw new Error(`Response exceeds the ${maxBytes} byte limit.`);
    }
    chunks.push(chunk);
    readResult = await reader.read();
  }
  return Buffer.concat(chunks, receivedBytes);
}
