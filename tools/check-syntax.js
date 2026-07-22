'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { listReferencedSoundFiles, validateSoundpackConfig } = require('../src/libs/soundpacks/validation');

const root = path.resolve(__dirname, '..');
const sourceRoots = ['src', 'tools', 'tests'];
const failures = [];
let checkedJavaScript = 0;
let checkedSoundpacks = 0;

function walk(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const files = [];
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

for (const relativeRoot of sourceRoots) {
  for (const file of walk(path.join(root, relativeRoot))) {
    if (path.extname(file) !== '.js') {
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
        require.resolve(path.resolve(path.dirname(file), match[1]));
      } catch (_) {
        failures.push(`${path.relative(root, file)}\nUnresolved relative require: ${match[1]}`);
      }
    }
  }
}

for (const directory of fs.readdirSync(path.join(root, 'src', 'audio'), { withFileTypes: true })) {
  if (!directory.isDirectory()) {
    continue;
  }
  const configPath = path.join(root, 'src', 'audio', directory.name, 'config.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    validateSoundpackConfig(config);
    for (const reference of listReferencedSoundFiles(config)) {
      const soundPath = path.join(path.dirname(configPath), ...reference.split('/'));
      if (!fs.existsSync(soundPath) || !fs.statSync(soundPath).isFile()) {
        throw new Error(`Missing referenced audio file: ${reference}`);
      }
    }
    checkedSoundpacks += 1;
  } catch (error) {
    failures.push(`${path.relative(root, configPath)}\n${error.message}`);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const lockRoot = packageLock.packages && packageLock.packages[''];
if (!lockRoot || packageJson.version !== packageLock.version || packageJson.version !== lockRoot.version) {
  failures.push('package.json and package-lock.json versions must match.');
}
for (const section of ['dependencies', 'devDependencies']) {
  const declared = packageJson[section] || {};
  const locked = (lockRoot && lockRoot[section]) || {};
  for (const [name, range] of Object.entries(declared)) {
    if (locked[name] !== range) {
      failures.push(`package-lock root mismatch for ${section}.${name}.`);
    }
    if (!packageLock.packages[`node_modules/${name}`]) {
      failures.push(`package-lock is missing node_modules/${name}.`);
    }
  }
  for (const name of Object.keys(locked)) {
    if (!(name in declared)) failures.push(`package-lock has undeclared root ${section}.${name}.`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n\n'));
  process.exit(1);
}

console.log(`Checked ${checkedJavaScript} JavaScript files and ${checkedSoundpacks} bundled soundpacks.`);
