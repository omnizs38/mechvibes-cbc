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

/** Minimal WHATWG `fetch` response surface consumed by {@link readResponseBuffer}. */
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
  if (!/^[0-9]+$/.test(rawLength)) return null;
  const value = Number(rawLength);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function enforceDownloadSize({ fileBytes, totalBytes }: DownloadSizeInput): void {
  if (!Number.isSafeInteger(fileBytes) || fileBytes < 0 ||
    !Number.isSafeInteger(totalBytes) || totalBytes < fileBytes) {
    throw new Error('Invalid download byte count.');
  }
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

  try {
    if (fileSystem.existsSync(installDirectory)) {
      fileSystem.moveSync(installDirectory, backupDirectory, { overwrite: false });
      movedExisting = true;
    }
    fileSystem.moveSync(tempDirectory, installDirectory, { overwrite: false });
  } catch (error) {
    if (movedExisting) {
      fileSystem.removeSync(installDirectory);
    }
    if (movedExisting && fileSystem.existsSync(backupDirectory)) {
      fileSystem.moveSync(backupDirectory, installDirectory, { overwrite: false });
    }
    throw error;
  }

  // The replacement is committed. Cleanup can partially delete the backup:
  // never remove a good installation to restore that now-incomplete backup.
  if (movedExisting) {
    try {
      fileSystem.removeSync(backupDirectory);
    } catch {
      // Keep the installed pack; leftover .backup-* entries are ignored by
      // discovery and can be removed manually once filesystem access recovers.
    }
  }
}

export async function readResponseBuffer(
  response: SizedResponse,
  maxBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('Invalid response byte limit.');
  }
  const advertisedSize = parseContentLength(response);
  if (advertisedSize !== null && advertisedSize > maxBytes) {
    throw new Error(`Response exceeds the ${maxBytes} byte limit.`);
  }

  if (!response.body || typeof response.body.getReader !== 'function') {
    // No readable stream is available: decoded audio, data: URL responses and
    // mocked fetch expose only arrayBuffer(). Materialize it but still enforce
    // the limit. The decimal Content-Length pre-check above already rejects an
    // oversized advertised size before this allocation, and the materialized
    // length is re-checked so a missing/lying header cannot bypass the cap.
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error(`Response exceeds the ${maxBytes} byte limit.`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Check before copying an oversized chunk into another allocation.
      if (value.byteLength > maxBytes - receivedBytes) {
        try {
          await reader.cancel('Response is too large.');
        } catch {
          // Preserve the size error even if cancellation fails.
        }
        throw new Error(`Response exceeds the ${maxBytes} byte limit.`);
      }
      receivedBytes += value.byteLength;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, receivedBytes);
  } finally {
    reader.releaseLock?.();
  }
}
