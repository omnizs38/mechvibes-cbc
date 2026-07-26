'use strict';

const DEFAULT_SYSTEM_VOLUME = 50;
const MIN_SYSTEM_VOLUME = 1;
export const MAX_GAIN = 2;

export interface GainInput {
  configuredVolume?: unknown;
  systemVolume?: unknown;
  activeAdjustment?: boolean;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function calculateGain({
  configuredVolume,
  systemVolume,
  activeAdjustment,
}: GainInput): number {
  const userVolume = clamp(toFiniteNumber(configuredVolume, 50), 0, 200);
  if (!activeAdjustment) {
    return userVolume / 100;
  }

  const safeSystemVolume = clamp(
    toFiniteNumber(systemVolume, DEFAULT_SYSTEM_VOLUME),
    MIN_SYSTEM_VOLUME,
    100,
  );
  return clamp(userVolume / safeSystemVolume, 0, MAX_GAIN);
}

export function calculateAdjustedDisplay({
  configuredVolume,
  systemVolume,
  activeAdjustment,
}: GainInput): number {
  return Math.round(calculateGain({ configuredVolume, systemVolume, activeAdjustment }) * 100);
}
