'use strict';

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { validateSoundpackConfig } from './validation';
import type { ValidatedSoundpackConfig } from './validation';

export interface SoundpackMetadata {
  pack_id: string;
  group: 'Custom' | 'Default';
  abs_path: string;
  folder_name: string;
  is_custom: boolean;
  is_archive: boolean;
}

/** Config classes are constructed dynamically per soundpack version. */
export type SoundpackConfigConstructor = new (
  config: ValidatedSoundpackConfig,
  metadata: SoundpackMetadata,
) => { pack_id: string; [key: string]: unknown };

export type ConfigFactories = Record<number, () => SoundpackConfigConstructor>;

export interface ChecksumOptions {
  getFile?: (candidatePath: string, reference: string) => string;
  clearCache?: (candidatePath: string) => void;
}

export interface DiscoveryOptions {
  officialDirectory: string;
  customDirectory: string;
  factories?: ConfigFactories;
}

export interface DiscoveryError {
  path: string;
  name: string;
  message: string;
}

export interface DiscoveryResult {
  packs: Array<{ pack_id: string; [key: string]: unknown }>;
  errors: DiscoveryError[];
}

const CONFIG_FACTORIES: ConfigFactories = {
  1: () => require('./config-web-audio') as SoundpackConfigConstructor,
  2: () => require('./config-web-audio') as SoundpackConfigConstructor,
  3: () => require('./config-v3') as SoundpackConfigConstructor,
  4: () => require('./config-web-audio') as SoundpackConfigConstructor,
};

export function listSoundpackCandidates(rootDirectory: string): string[] {
  if (!fs.existsSync(rootDirectory)) {
    return [];
  }

  return fs
    .readdirSync(rootDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() ||
        (entry.isFile() && path.extname(entry.name).toLowerCase() === '.zip'),
    )
    .map((entry) => path.join(rootDirectory, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

export function readSoundpackConfig(candidatePath: string): unknown {
  if (path.extname(candidatePath).toLowerCase() === '.zip') {
    const { GetFileFromArchive } = require('./file-manager') as typeof import('./file-manager');
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

export function buildMetadata(candidatePath: string, isCustom: boolean): SoundpackMetadata {
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

export function verifySoundpackChecksums(
  candidatePath: string,
  config: ValidatedSoundpackConfig,
  options: ChecksumOptions = {},
): void {
  const checksums = (config as { checksums?: Record<string, string> }).checksums;
  if (!checksums || Object.keys(checksums).length === 0) return;
  const fileManager =
    options.getFile && options.clearCache
      ? null
      : (require('./file-manager') as typeof import('./file-manager'));
  const getFile = options.getFile || (fileManager as typeof import('./file-manager')).GetSoundpackFile;
  const clearCache =
    options.clearCache || (fileManager as typeof import('./file-manager')).ClearSoundpackCache;
  try {
    for (const [reference, expected] of Object.entries(checksums)) {
      const source = getFile(candidatePath, reference);
      const commaIndex = source.indexOf(',');
      if (!source.startsWith('data:') || commaIndex < 0) {
        throw new Error(`Cannot verify checksum for ${reference}.`);
      }
      const actual = crypto
        .createHash('sha256')
        .update(Buffer.from(source.slice(commaIndex + 1), 'base64'))
        .digest('hex');
      if (actual !== expected) {
        throw new Error(`Checksum mismatch for ${reference}.`);
      }
    }
  } catch (error) {
    clearCache(candidatePath);
    throw error;
  }
}

export function loadSoundpackCandidate(
  candidatePath: string,
  isCustom: boolean,
  factories: ConfigFactories = CONFIG_FACTORIES,
): { pack_id: string; [key: string]: unknown } {
  const metadata = buildMetadata(candidatePath, isCustom);
  const config = validateSoundpackConfig(readSoundpackConfig(candidatePath));
  verifySoundpackChecksums(candidatePath, config);
  const createConfig = factories[config.version];
  if (typeof createConfig !== 'function') {
    throw new Error(`Unsupported soundpack config version: ${config.version}.`);
  }
  const SoundpackConfig = createConfig();
  return new SoundpackConfig(config, metadata);
}

export function discoverSoundpacks({
  officialDirectory,
  customDirectory,
  factories = CONFIG_FACTORIES,
}: DiscoveryOptions): DiscoveryResult {
  const sources = [
    ...listSoundpackCandidates(officialDirectory).map((candidatePath) => ({
      candidatePath,
      isCustom: false,
    })),
    ...listSoundpackCandidates(customDirectory).map((candidatePath) => ({
      candidatePath,
      isCustom: true,
    })),
  ];

  const packs: DiscoveryResult['packs'] = [];
  const errors: DiscoveryError[] = [];
  const packIds = new Set<string>();

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
