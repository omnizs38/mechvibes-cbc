import { nodeRequire, requireFromSrc } from '../shared/electron';
import type {
  AuthoringMode,
  DraftKeys,
  PackDefines,
  SoundDefinition,
  V4Config,
} from '../../libs/soundpacks/editor-config';

const layouts = requireFromSrc('libs/layouts');
const keycodes = requireFromSrc('libs/keycodes');
const remapper = requireFromSrc<
  (from: string, to: string, defines: PackDefines) => PackDefines
>('utils/remapper');
const editorConfig = requireFromSrc<typeof import('../../libs/soundpacks/editor-config')>(
  'libs/soundpacks/editor-config',
);

export const fs = nodeRequire('fs');

export type KeyZone = 'main' | 'edit' | 'numpad';
export type EditMode = 'visual' | 'manual';
export type { AuthoringMode, PackDefines, SoundDefinition, V4Config };

/** Editor working state. The exported artifact is a v4 config (see toV4Config). */
export type PackData = DraftKeys;

export const hasSound = editorConfig.hasSound;

export const platform = process.platform;
export const layout = layouts[platform] as Record<KeyZone, Array<Array<string | number>>>;
export const keySizes = layouts.sizes as Record<string, string>;
export const keyLabels = keycodes[platform] as Record<string, string>;
export const ZONES: KeyZone[] = ['main', 'edit', 'numpad'];

export function emptyDefines(): PackDefines {
  const defines: PackDefines = {};
  for (const keycode of Object.keys(keyLabels)) {
    defines[keycode] = null;
  }
  return defines;
}

export function createPack(): PackData {
  return {
    name: 'Untitled',
    mode: 'sprite',
    sound: editorConfig.DEFAULT_SOUND,
    defines: emptyDefines(),
  };
}

/** Converts the in-memory (platform specific) pack into an exportable v4 config. */
export function toV4Config(pack: PackData): V4Config {
  const standardDefines = remapper(platform, 'standard', { ...pack.defines });
  return editorConfig.buildV4Config(pack.name, pack.mode, pack.sound, standardDefines);
}

/** Converts an imported (standard) v4 config into the platform specific pack. */
export function fromV4Config(imported: unknown): PackData {
  const { name, mode, sound, defines } = editorConfig.parseV4Config(imported);
  return {
    name,
    mode,
    sound,
    defines: remapper('standard', platform, { ...defines }),
  };
}
