'use strict';

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

import {
  listReferencedSoundFiles,
  validateSoundpackConfig,
} from '../src/libs/soundpacks/validation';

const root = path.resolve(__dirname, '..');
const sourceRoots = ['src', 'tools', 'tests'];
const failures: string[] = [];
let checkedJavaScript = 0;
let checkedSoundpacks = 0;

function walk(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

// The project is TypeScript-first: `tsc` emits JavaScript next to each source
// file. This check validates the emitted JavaScript (and any remaining plain
// JavaScript) so packaging never ships a file Node cannot parse.
for (const relativeRoot of sourceRoots) {
  for (const file of walk(path.join(root, relativeRoot))) {
    if (
      path.extname(file) !== '.js' ||
      file.includes(`${path.sep}renderer-dist${path.sep}`) ||
      file.includes(`${path.sep}renderer${path.sep}`)
    ) {
      continue;
    }
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    checkedJavaScript += 1;
    if (result.status !== 0) {
      failures.push(`${path.relative(root, file)}\n${result.stderr || result.stdout}`);
    }

    const source = fs.readFileSync(file, 'utf8');
    const relativeRequires = source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g);
    for (const match of relativeRequires) {
      try {
        require.resolve(path.resolve(path.dirname(file), match[1] as string));
      } catch {
        failures.push(
          `${path.relative(root, file)}\nUnresolved relative require: ${match[1]}`,
        );
      }
    }
  }
}

for (const directory of fs.readdirSync(path.join(root, 'src', 'audio'), {
  withFileTypes: true,
})) {
  if (!directory.isDirectory()) {
    continue;
  }
  const configPath = path.join(root, 'src', 'audio', directory.name, 'config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
    validateSoundpackConfig(config);
    for (const reference of listReferencedSoundFiles(config)) {
      const soundPath = path.join(path.dirname(configPath), ...reference.split('/'));
      if (!fs.existsSync(soundPath) || !fs.statSync(soundPath).isFile()) {
        throw new Error(`Missing referenced audio file: ${reference}`);
      }
    }
    checkedSoundpacks += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${path.relative(root, configPath)}\n${message}`);
  }
}

type DependencyMap = Record<string, string>;

interface PackageJson {
  version: string;
  dependencies?: DependencyMap;
  devDependencies?: DependencyMap;
  [key: string]: unknown;
}

interface LockRoot {
  version?: string;
  dependencies?: DependencyMap;
  devDependencies?: DependencyMap;
}

interface PackageLock {
  version: string;
  packages?: Record<string, LockRoot | undefined>;
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
) as PackageJson;
const packageLock = JSON.parse(
  fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'),
) as PackageLock;
const lockRoot = packageLock.packages && packageLock.packages[''];
if (
  !lockRoot ||
  packageJson.version !== packageLock.version ||
  packageJson.version !== lockRoot.version
) {
  failures.push('package.json and package-lock.json versions must match.');
}
for (const section of ['dependencies', 'devDependencies'] as const) {
  const declared: DependencyMap = packageJson[section] || {};
  const locked: DependencyMap = (lockRoot && lockRoot[section]) || {};
  for (const [name, range] of Object.entries(declared)) {
    if (locked[name] !== range) {
      failures.push(`package-lock root mismatch for ${section}.${name}.`);
    }
    if (!packageLock.packages || !packageLock.packages[`node_modules/${name}`]) {
      failures.push(`package-lock is missing node_modules/${name}.`);
    }
  }
  for (const name of Object.keys(locked)) {
    if (!(name in declared)) {
      failures.push(`package-lock has undeclared root ${section}.${name}.`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n\n'));
  process.exit(1);
}

console.log(
  `Checked ${checkedJavaScript} JavaScript files and ${checkedSoundpacks} bundled soundpacks.`,
);
