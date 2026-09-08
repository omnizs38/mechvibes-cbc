import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';

export interface RuntimePin {
  version: string;
  url: string;
  sha256: string;
  bytes: number;
}
const root = path.resolve(__dirname, '..');
export const runtimePin: RuntimePin = require('../build/windows-runtime.json');

export async function sha256File(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(file, 'r');
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

export function verifyMicrosoftSignature(file: string): void {
  if (process.platform !== 'win32') return;
  const script =
    '$s = Get-AuthenticodeSignature -LiteralPath $env:MECHVIBES_RUNTIME_FILE; ' +
    "if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch '(^|,\\s*)CN=Microsoft Corporation(,|$)') " +
    "{ throw 'Visual C++ Runtime must have a valid Microsoft Authenticode signature' }";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, MECHVIBES_RUNTIME_FILE: file },
    encoding: 'utf8',
    timeout: 60000,
  });
  if (result.error || result.status !== 0)
    throw new Error(`Runtime signature verification failed: ${result.error?.message ?? result.stderr}`);
}

export async function prepareWindowsRuntime(
  directory = path.join(root, 'build', 'vendor'),
  pin = runtimePin,
  fetchImpl: typeof fetch = fetch,
  verifySignature = verifyMicrosoftSignature,
): Promise<string> {
  if (
    !/^\d+\.\d+\.\d+\.\d+$/.test(pin.version) ||
    !/^https:\/\/download\.visualstudio\.microsoft\.com\//.test(pin.url) ||
    !/^[a-f0-9]{64}$/.test(pin.sha256) ||
    !Number.isSafeInteger(pin.bytes) ||
    pin.bytes <= 0 ||
    pin.bytes > 64 * 1024 * 1024
  ) {
    throw new Error('Invalid pinned Microsoft Runtime metadata.');
  }
  await fs.mkdir(directory, { recursive: true });
  const destination = path.join(directory, 'vc_redist.x64.exe');
  let existing: string | undefined;
  try {
    existing = await sha256File(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing !== undefined) {
    if (existing !== pin.sha256) throw new Error('Cached Runtime checksum mismatch. Remove build/vendor and retry.');
    verifySignature(destination);
    return destination;
  }
  const temporary = await fs.mkdtemp(path.join(directory, '.download-'));
  try {
    const response = await fetchImpl(pin.url, { signal: AbortSignal.timeout(120000), redirect: 'error' });
    if (!response.ok || !response.body) throw new Error(`Runtime download failed: HTTP ${response.status}`);
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > pin.bytes ? new Error('Runtime download exceeds pinned size.') : null, chunk);
      },
    });
    const download = path.join(temporary, 'runtime.exe');
    await pipeline(Readable.fromWeb(response.body as never), limiter, createWriteStream(download, { flags: 'wx' }));
    if (bytes !== pin.bytes || (await sha256File(download)) !== pin.sha256)
      throw new Error('Downloaded Runtime checksum/size mismatch.');
    verifySignature(download);
    await fs.rename(download, destination);
    return destination;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) {
  prepareWindowsRuntime()
    .then((file) => console.log(`Verified Microsoft Runtime ${runtimePin.version}: ${file}`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
