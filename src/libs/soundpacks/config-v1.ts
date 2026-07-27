'use strict';

/**
 * Legacy Config Version 1 (Original mechvibes format)
 * Supports simple single-file or multi-file per keycode definitions
 */

export interface LegacyV1Config {
  /** Unique identifier (usually assigned by server) */
  id?: string;

  /** Pack name */
  name: string;

  /** How keys are defined: 'single' (all keys use clips from one file) or 'multi' (each keycode has its own file) */
  key_define_type: 'single' | 'multi';

  /** Unused but required for backwards compatibility */
  includes_numpad?: boolean;

  /** Sound file to use when key_define_type is 'single'. Still required when 'multi' but unused. */
  sound?: string;

  /** Key definitions: keyCode -> filename or [start, length] clip */
  defines: Record<string, string | number[]>;

  /** Version marker */
  version: 1;

  /** Optional author */
  author?: string;

  /** Optional license */
  license?: string;

  /** Optional metadata */
  [key: string]: unknown;
}

export function isLegacyV1Config(config: unknown): config is LegacyV1Config {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return false;
  }

  const c = config as Record<string, unknown>;

  // Required fields
  if (typeof c.name !== 'string' || !c.name.trim()) {
    return false;
  }

  if (c.key_define_type !== 'single' && c.key_define_type !== 'multi') {
    return false;
  }

  if (typeof c.defines !== 'object' || c.defines === null || Array.isArray(c.defines)) {
    return false;
  }

  if (c.version !== 1) {
    return false;
  }

  // Validate defines structure
  const defines = c.defines as Record<string, unknown>;
  for (const value of Object.values(defines)) {
    if (c.key_define_type === 'single') {
      // Single mode: value should be [start, length]
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'number' || typeof value[1] !== 'number') {
        return false;
      }
    } else {
      // Multi mode: value should be filename string
      if (typeof value !== 'string') {
        return false;
      }
    }
  }

  return true;
}
