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
      // Counting candidates and then walking to the chosen one avoids building
      // a filtered array for every event. The distribution is identical to
      // picking an index into that array, including the null result when every
      // sample is the previously played one.
      const previous = this.lastSamples.get(eventKey);
      let candidateCount = 0;
      for (const sample of samples) {
        if (sample !== previous) candidateCount += 1;
      }
      if (candidateCount === 0) return null;

      let remaining = Math.min(candidateCount - 1, Math.floor(this.random() * candidateCount));
      for (const sample of samples) {
        if (sample === previous) continue;
        if (remaining === 0) {
          selected = sample;
          break;
        }
        remaining -= 1;
      }
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
