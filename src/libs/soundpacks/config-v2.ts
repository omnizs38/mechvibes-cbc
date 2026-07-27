'use strict';

/**
 * Legacy Config Version 2 (Multi-file with keyup support)
 * Supports individual files per keycode with optional keyup sounds
 */

export interface LegacyV2Config {
  /** Key definition type (always 'multi' in v2) */
  key_define_type: 'multi';

  /** Fallback sound for keydown if keycode is not defined. Supports {0-n} patterns for random selection */
  sound?: string;

  /** Fallback sound for keyup if keycode-up is not defined. Supports {0-n} patterns for random selection */
  soundup?: string;

  /** Key definitions: keycode -> filename or keycode-up -> filename-up. Supports {0-n} patterns for random selection */
  defines: Record<string, string>;

  /** Version marker */
  version: 2;

  /** Optional author */
  author?: string;

  /** Optional license */
  license?: string;

  /** Optional metadata */
  [key: string]: unknown;
}

export function isLegacyV2Config(config: unknown): config is LegacyV2Config {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return false;
  }

  const c = config as Record<string, unknown>;

  // Required fields
  if (c.key_define_type !== 'multi') {
    return false;
  }

  if (typeof c.defines !== 'object' || c.defines === null || Array.isArray(c.defines)) {
    return false;
  }

  if (c.version !== 2) {
    return false;
  }

  // Validate defines: all values should be strings (filenames)
  const defines = c.defines as Record<string, unknown>;
  for (const value of Object.values(defines)) {
    if (typeof value !== 'string') {
      return false;
    }
  }

  return true;
}

/**
 * Expands patterns like "file{0-2}.mp3" to ["file0.mp3", "file1.mp3", "file2.mp3"]
 */
export function expandRandomPattern(pattern: string): string[] {
  const match = pattern.match(/^(.+?)\{(\d+)-(\d+)\}(.*)$/);
  if (!match) {
    return [pattern];
  }

  const [, prefix, startStr, endStr, suffix] = match;
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);
  const files: string[] = [];

  for (let i = start; i <= end; i++) {
    files.push(`${prefix}${i}${suffix}`);
  }

  return files;
}
