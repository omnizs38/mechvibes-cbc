'use strict';

import type { SampleSelectionMode } from './sample-selector';

export type { SampleSelectionMode } from './sample-selector';

/**
 * Schema version of the in-memory audio manifest. This is the canonical "v4"
 * format that every engine module depends on. It is distinct from a soundpack's
 * source config `version` (1/2/3/4), which records the on-disk format that the
 * manifest was adapted from.
 */
export const MANIFEST_FORMAT = 4;

export interface ManifestSample {
  source: string;
  file?: string;
  gain?: number;
  pitch?: number;
  weight?: number;
  offsetSeconds?: number;
  durationSeconds?: number;
  [key: string]: unknown;
}

export interface ManifestLayer {
  samples: ManifestSample[];
  mode: SampleSelectionMode;
  gain: number;
  pitchVariationCents: number;
  priority: number;
  envelope: { attackMs: number; releaseMs: number };
  [key: string]: unknown;
}

export interface AudioManifest {
  id: string;
  name: string;
  version: number;
  maxVoices: number;
  cacheBudgetBytes: number;
  preload: 'all' | 'priority' | 'lazy';
  gain: number;
  events: Record<string, ManifestLayer>;
  checksums: Record<string, string>;
  author?: string;
  license?: string;
  sampleRate?: number | null;
}

export interface PlaybackEvent {
  type: 'keydown' | 'keyup';
  keycode: string | number;
  gain?: number;
}

/** Converts a pitch shift in cents to an `AudioBufferSourceNode` playback rate. */
export function centsToPlaybackRate(cents: number | undefined | null): number {
  return 2 ** (Number(cents || 0) / 1200);
}

/** Clamps `value` into the inclusive `[minimum, maximum]` range. */
export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
