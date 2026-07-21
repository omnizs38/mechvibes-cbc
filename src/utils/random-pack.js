'use strict';

function chooseRandomPackIndex(packs, currentPackId, random = Math.random) {
  if (!Array.isArray(packs) || packs.length < 2) {
    return null;
  }

  const candidates = [];
  for (let index = 0; index < packs.length; index += 1) {
    if (packs[index] && packs[index].pack_id !== currentPackId) {
      candidates.push(index);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  const candidateIndex = Math.floor(random() * candidates.length);
  return candidates[Math.min(candidateIndex, candidates.length - 1)];
}

module.exports = { chooseRandomPackIndex };
