'use strict';

class SampleSelector {
  constructor(random = Math.random) {
    this.random = random;
    this.indices = new Map();
    this.lastSamples = new Map();
  }

  choose(eventKey, samples, mode = 'round-robin') {
    if (!Array.isArray(samples) || samples.length === 0) return null;
    if (samples.length === 1) {
      this.lastSamples.set(eventKey, samples[0]);
      return samples[0];
    }

    let selected;
    if (mode === 'random') {
      const previous = this.lastSamples.get(eventKey);
      const candidates = samples.filter((sample) => sample !== previous);
      selected = candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];
    } else {
      const index = this.indices.get(eventKey) || 0;
      selected = samples[index % samples.length];
      this.indices.set(eventKey, (index + 1) % samples.length);
    }

    this.lastSamples.set(eventKey, selected);
    return selected;
  }

  reset() {
    this.indices.clear();
    this.lastSamples.clear();
  }
}

module.exports = { SampleSelector };
