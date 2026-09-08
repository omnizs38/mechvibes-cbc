'use strict';

import fs from 'node:fs/promises';
import path from 'node:path';

/** Resolve from this tool, never from an arbitrary caller's package.json. */
export async function cleanDist(root = path.resolve(__dirname, '..')): Promise<void> {
  const directory = path.join(root, 'dist');
  // rm removes links rather than following them; recreation never empties a
  // directory elsewhere, without traversing a dist symlink.
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });
  console.log('Project dist directory cleaned.');
}

if (require.main === module)
  cleanDist().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
