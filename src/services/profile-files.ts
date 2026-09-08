import fs from 'node:fs/promises';
import { MAX_PROFILE_BYTES, parseProfileBackup } from '../utils/profiles';
export async function readProfileBackup(file: string) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_PROFILE_BYTES)
      throw new Error('Profile backup exceeds 64 KiB or is not a file.');
    const bytes = Buffer.alloc(MAX_PROFILE_BYTES + 1);
    let total = 0;
    while (total < bytes.length) {
      const part = await handle.read(bytes, total, bytes.length - total, null);
      if (!part.bytesRead) break;
      total += part.bytesRead;
    }
    if (total > MAX_PROFILE_BYTES) throw new Error('Profile backup exceeds 64 KiB.');
    return parseProfileBackup(bytes.toString('utf8', 0, total));
  } finally {
    await handle.close();
  }
}
