'use strict';

export interface RandomPackCandidate {
  pack_id?: string;
}

export function chooseRandomPackIndex(
  packs: ReadonlyArray<RandomPackCandidate | null | undefined>,
  currentPackId?: string,
  random: () => number = Math.random,
): number | null {
  if (!Array.isArray(packs) || packs.length < 2) {
    return null;
  }

  const candidates: number[] = [];
  for (let index = 0; index < packs.length; index += 1) {
    const pack = packs[index];
    if (pack && pack.pack_id !== currentPackId) {
      candidates.push(index);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const candidateIndex = Math.floor(random() * candidates.length);
  return candidates[Math.min(candidateIndex, candidates.length - 1)] ?? null;
}
