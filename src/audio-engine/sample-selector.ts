'use strict';

export type SampleSelectionMode = 'round-robin' | 'random';

export class SampleSelector<TSample = unknown> {
  private readonly random: () => number;
  private readonly indices: Map<string, number>;
  private readonly lastSamples: Map<string, TSample>;

  constructor(random: () => number = Math.random) {
    this.random = random;
    this.indices = new Map();
    this.lastSamples = new Map();
  }

  choose(
    eventKey: string,
    samples: ReadonlyArray<TSample>,
    mode: SampleSelectionMode = 'round-robin',
  ): TSample | null {
    if (!Array.isArray(samples) || samples.length === 0) return null;
    if (samples.length === 1) {
      const only = samples[0] as TSample;
      this.lastSamples.set(eventKey, only);
      return only;
    }

    let selected: TSample | undefined;
    if (mode === 'random') {
      const previous = this.lastSamples.get(eventKey);
      const candidates = samples.filter((sample) => sample !== previous);
      selected =
        candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))];
    } else {
      const index = this.indices.get(eventKey) ?? 0;
      selected = samples[index % samples.length];
      this.indices.set(eventKey, (index + 1) % samples.length);
    }

    if (selected === undefined) return null;
    this.lastSamples.set(eventKey, selected);
    return selected;
  }

  reset(): void {
    this.indices.clear();
    this.lastSamples.clear();
  }
}
