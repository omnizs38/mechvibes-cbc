'use strict';

const DEFAULT_SYSTEM_VOLUME = 50;
const MIN_SYSTEM_VOLUME = 1;
const MAX_GAIN = 2;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function toFiniteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function calculateGain({ configuredVolume, systemVolume, activeAdjustment }) {
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

function calculateAdjustedDisplay({ configuredVolume, systemVolume, activeAdjustment }) {
  return Math.round(calculateGain({ configuredVolume, systemVolume, activeAdjustment }) * 100);
}

module.exports = {
  MAX_GAIN,
  calculateAdjustedDisplay,
  calculateGain,
  clamp,
};
