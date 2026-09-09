'use strict';

/**
 * Clicky Engine — the in-app soundpack format converter.
 *
 * Promotes soundpacks to the modern v4 schema. Design goals, in priority
 * order:
 *   1. Instant speed — a single validation pass, no disk or network I/O, no
 *      dynamic code (no eval/Function), the caller's object is never mutated,
 *      and an already-v4 pack takes a fast path.
 *   2. Minimal attack surface — every conversion routes through the hardened
 *      validator, so path traversal, Windows-unsafe names, unknown audio
 *      types, and malformed playback windows are all rejected there. The
 *      engine adds no new file access of its own.
 *
 * Modern v3 and v4 share one schema (v4 = v3 plus optional per-sample
 * offset/duration windows), and legacy v3 (original mechvibes clips/cycles) is
 * bridged by the validator. Clicky Engine is the single named entry point that
 * ties those paths together for the v3 → v4 migration.
 */

import { isLegacyV3Config } from './config-v3-legacy';
import {
  validateSoundpackConfig,
  SoundpackValidationError,
  isPlainObject,
  type ValidatedSoundpackConfig,
} from './validation';

export const CLICKY_ENGINE_NAME = 'Clicky Engine';
export const CLICKY_ENGINE_VERSION = '1.0.0';

/** Upper bound so a single batch cannot be used to exhaust memory or CPU. */
export const CLICKY_MAX_BATCH = 10_000;

export type SoundpackDialect = 'modern-v4' | 'modern-v3' | 'legacy-v3';

export interface ClickyConversionResult {
  /** Always normalized to the v4 schema. */
  readonly config: ValidatedSoundpackConfig;
  /** The detected input dialect before conversion. */
  readonly dialect: SoundpackDialect;
  /** True when the input was already a modern v4 pack (fast path). */
  readonly alreadyV4: boolean;
  /** Wall-clock conversion time in milliseconds. */
  readonly durationMs: number;
}

export interface ClickyBatchItem {
  readonly id: string;
  readonly config: unknown;
}

export type ClickyBatchOutcome =
  | { readonly id: string; readonly ok: true; readonly result: ClickyConversionResult }
  | { readonly id: string; readonly ok: false; readonly error: string; readonly code: string };

function monotonicNow(): number {
  // Prefer performance.now (monotonic) when available in the renderer or main
  // process; fall back to Date.now. Neither touches disk or network.
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Classify the input format cheaply, before any heavy validation runs.
 * Detection is read-only and never trusts the input for anything beyond
 * routing — the validator remains the sole authority on safety.
 */
export function detectDialect(config: unknown): SoundpackDialect {
  if (isLegacyV3Config(config)) {
    return 'legacy-v3';
  }
  if (isPlainObject(config) && Number(config['version']) === 4) {
    return 'modern-v4';
  }
  return 'modern-v3';
}

/**
 * Convert a single soundpack config to the modern v4 schema.
 *
 * Throws {@link SoundpackValidationError} for unsupported (v1/v2) or malformed
 * packs; the error carries a machine-readable `code` (e.g. UNSUPPORTED_VERSION).
 */
export function convertToV4(config: unknown): ClickyConversionResult {
  const started = monotonicNow();
  const dialect = detectDialect(config);
  // Defensive copy: validation may re-shape the object, and callers must never
  // observe their input being mutated underneath them.
  const input =
    isPlainObject(config) && typeof structuredClone === 'function'
      ? structuredClone(config)
      : config;
  const validated = validateSoundpackConfig(input);
  return {
    config: validated,
    dialect,
    alreadyV4: dialect === 'modern-v4',
    durationMs: monotonicNow() - started,
  };
}

/**
 * Convert many packs without throwing: each failure is captured per item so a
 * single broken pack cannot abort a whole library migration. Use this for
 * batch/offline conversion; use {@link convertToV4} on the hot load path.
 */
export function convertMany(items: readonly ClickyBatchItem[]): ClickyBatchOutcome[] {
  if (!Array.isArray(items)) {
    throw new SoundpackValidationError('Clicky Engine batch input must be an array.');
  }
  if (items.length > CLICKY_MAX_BATCH) {
    throw new SoundpackValidationError(
      `Clicky Engine batch is limited to ${CLICKY_MAX_BATCH} packs per call.`,
    );
  }
  const outcomes: ClickyBatchOutcome[] = [];
  for (const item of items) {
    try {
      outcomes.push({ id: item.id, ok: true, result: convertToV4(item.config) });
    } catch (error) {
      const code =
        error instanceof SoundpackValidationError ? error.code : 'CLICKY_CONVERSION_FAILED';
      const message = error instanceof Error ? error.message : String(error);
      outcomes.push({ id: item.id, ok: false, error: message, code });
    }
  }
  return outcomes;
}
