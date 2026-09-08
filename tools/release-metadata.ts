import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha256File } from './prepare-windows-runtime';

export async function writeChecksums(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(?:exe|dmg|deb|snap|AppImage|blockmap|yml|json|zip)$/.test(entry.name) &&
        !entry.name.startsWith('builder-'),
    )
    .map((entry) => entry.name)
    .sort();
  if (!files.some((name) => /\.(?:exe|dmg|deb|snap|AppImage)$/.test(name))) {
    throw new Error('No distributable installers were found; refusing to stage empty release metadata.');
  }
  const lines: string[] = [];
  for (const name of files) {
    if (/[\r\n\\]/.test(name)) throw new Error('Unsafe release asset filename.');
    lines.push(`${await sha256File(path.join(directory, name))}  ${name}`);
  }
  await fs.writeFile(path.join(directory, 'SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8');
  return files;
}

export async function writeReleaseMetadata(directory: string): Promise<void> {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run this tool through npm run release:metadata.');
  const result = spawnSync(process.execPath, [npmCli, 'sbom', '--sbom-format', 'cyclonedx'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(`SBOM generation failed: ${result.error?.message ?? result.stderr}`);
  const sbom = JSON.parse(result.stdout);
  if (sbom.bomFormat !== 'CycloneDX' || !Array.isArray(sbom.components)) throw new Error('Invalid CycloneDX SBOM.');
  // Generate the SBOM first so that it, too, is covered by the checksum manifest.
  await fs.writeFile(path.join(directory, 'sbom.cdx.json'), JSON.stringify(sbom, null, 2) + '\n');
  const files = await writeChecksums(directory);
  console.log(`Wrote SBOM and SHA256SUMS.txt covering ${files.length} release assets.`);
}

if (require.main === module) {
  writeReleaseMetadata(path.resolve(process.argv[2] || 'dist')).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
