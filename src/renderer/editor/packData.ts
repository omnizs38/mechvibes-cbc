import { nodeRequire, requireFromSrc } from '../shared/electron';

const layouts = requireFromSrc('libs/layouts');
const keycodes = requireFromSrc('libs/keycodes');
const remapper = requireFromSrc<
  (from: string, to: string, defines: PackDefines) => PackDefines
>('utils/remapper');

export const fs = nodeRequire('fs');

export type KeyZone = 'main' | 'edit' | 'numpad';
export type SoundDefinition = string | [number, number] | null;
export type PackDefines = Record<string, SoundDefinition>;
export type KeyDefineType = 'single' | 'multi';
export type EditMode = 'visual' | 'manual';

export type PackData = {
  id: string;
  name: string;
  key_define_type: KeyDefineType;
  includes_numpad: boolean;
  sound: string;
  defines: PackDefines;
};

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
    id: `custom-sound-pack-${Date.now()}`,
    name: 'Untitled',
    key_define_type: 'single',
    includes_numpad: false,
    sound: 'sound.ogg',
    defines: emptyDefines(),
  };
}

/** Converts the in-memory (platform specific) pack into its exportable form. */
export function toExportable(pack: PackData): PackData {
  return { ...pack, defines: remapper(platform, 'standard', { ...pack.defines }) };
}

/** Converts an imported (standard) pack into the platform specific form. */
export function fromImported(imported: Partial<PackData>): PackData {
  const base = createPack();
  const merged: PackData = {
    ...base,
    ...imported,
    key_define_type: (imported.key_define_type as KeyDefineType) || 'single',
    defines: { ...base.defines, ...(imported.defines ?? {}) },
  };
  return { ...merged, defines: remapper('standard', platform, merged.defines) };
}

export function isMultiDefinition(value: SoundDefinition): value is string {
  return typeof value === 'string';
}

export function hasSound(value: SoundDefinition): boolean {
  if (value === null) return false;
  if (typeof value === 'string') return value !== '';
  return value[0] !== 0 || value[1] !== 0;
}
