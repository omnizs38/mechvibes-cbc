'use strict';

const fs = require('fs');
const path = require('path');
const { validateSoundpackConfig } = require('./validation');

const CONFIG_FACTORIES = {
  1: () => require('./config-v1'),
  2: () => require('./config-v2'),
};

function listSoundpackCandidates(rootDirectory) {
  if (!fs.existsSync(rootDirectory)) {
    return [];
  }

  return fs.readdirSync(rootDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || (entry.isFile() && path.extname(entry.name).toLowerCase() === '.zip'))
    .map((entry) => path.join(rootDirectory, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

function readSoundpackConfig(candidatePath) {
  if (path.extname(candidatePath).toLowerCase() === '.zip') {
    const { GetFileFromArchive } = require('./file-manager');
    const configText = GetFileFromArchive(candidatePath, 'config.json');
    if (configText === null) {
      throw new Error('Archive does not contain config.json.');
    }
    return JSON.parse(configText);
  }

  const configPath = path.join(candidatePath, 'config.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Soundpack folder does not contain config.json.');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function buildMetadata(candidatePath, isCustom) {
  const folderName = path.basename(candidatePath);
  return {
    pack_id: `${isCustom ? 'custom' : 'default'}-${folderName}`,
    group: isCustom ? 'Custom' : 'Default',
    abs_path: candidatePath,
    folder_name: folderName,
    is_custom: isCustom,
    is_archive: path.extname(candidatePath).toLowerCase() === '.zip',
  };
}

function loadSoundpackCandidate(candidatePath, isCustom, factories = CONFIG_FACTORIES) {
  const metadata = buildMetadata(candidatePath, isCustom);
  const config = validateSoundpackConfig(readSoundpackConfig(candidatePath));
  const createConfig = factories[config.version];
  if (typeof createConfig !== 'function') {
    throw new Error(`Unsupported soundpack config version: ${config.version}.`);
  }
  const SoundpackConfig = createConfig();
  return new SoundpackConfig(config, metadata);
}

function discoverSoundpacks({ officialDirectory, customDirectory, factories = CONFIG_FACTORIES }) {
  const sources = [
    ...listSoundpackCandidates(officialDirectory).map((candidatePath) => ({ candidatePath, isCustom: false })),
    ...listSoundpackCandidates(customDirectory).map((candidatePath) => ({ candidatePath, isCustom: true })),
  ];

  const packs = [];
  const errors = [];
  const packIds = new Set();

  for (const source of sources) {
    try {
      const pack = loadSoundpackCandidate(source.candidatePath, source.isCustom, factories);
      if (packIds.has(pack.pack_id)) {
        throw new Error(`Duplicate soundpack identifier: ${pack.pack_id}.`);
      }
      packIds.add(pack.pack_id);
      packs.push(pack);
    } catch (error) {
      errors.push({
        path: source.candidatePath,
        name: path.basename(source.candidatePath),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { packs, errors };
}

module.exports = {
  buildMetadata,
  discoverSoundpacks,
  listSoundpackCandidates,
  loadSoundpackCandidate,
  readSoundpackConfig,
};
