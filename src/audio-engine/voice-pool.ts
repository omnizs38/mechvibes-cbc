'use strict';

export interface StoppableSource {
  stop(when?: number): void;
  onended?: ((this: any, event: any) => any) | null;
}

export interface VoiceRequest {
  source: StoppableSource;
  priority?: number;
  startedAt?: number;
  onEnded?: (() => void) | null;
}

export interface Voice {
  source: StoppableSource;
  priority: number;
  startedAt: number;
  onEnded: (() => void) | null;
}

export interface VoicePoolStats {
  activeVoices: number;
  maxVoices: number;
  stolenVoices: number;
}

export class VoicePool {
  readonly maxVoices: number;
  private readonly voices: Set<Voice>;
  stolenVoices: number;

  constructor(maxVoices = 64) {
    if (!Number.isInteger(maxVoices) || maxVoices < 1) {
      throw new Error('maxVoices must be a positive integer.');
    }
    this.maxVoices = maxVoices;
    this.voices = new Set();
    this.stolenVoices = 0;
  }

  /**
   * Picks the voice to sacrifice when the pool is saturated: lowest priority
   * first, then the oldest start time. A single linear scan keeps the same
   * result as sorting a materialised copy of the Set, without the array
   * allocation or the O(n log n) sort, because strict comparisons keep the
   * first candidate on ties exactly as the previous stable sort did.
   */
  selectVoiceToSteal(): Voice | null {
    let candidate: Voice | null = null;
    for (const voice of this.voices) {
      if (
        candidate === null ||
        voice.priority < candidate.priority ||
        (voice.priority === candidate.priority && voice.startedAt < candidate.startedAt)
      ) {
        candidate = voice;
      }
    }
    return candidate;
  }

  reserve({ source, priority = 0, startedAt = 0, onEnded = null }: VoiceRequest): Voice {
    if (!source || typeof source.stop !== 'function') {
      throw new Error('A stoppable audio source is required.');
    }
    if (this.voices.size >= this.maxVoices) {
      const stolen = this.selectVoiceToSteal();
      if (stolen) {
        this.release(stolen);
        try {
          stolen.source.stop();
        } catch {
          // A source may have ended between selection and stop.
        }
        this.stolenVoices += 1;
      }
    }

    const voice: Voice = { source, priority, startedAt, onEnded };
    this.voices.add(voice);
    source.onended = () => this.release(voice);
    return voice;
  }

  release(voice: Voice | null | undefined): void {
    if (!voice || !this.voices.delete(voice)) return;
    if (typeof voice.onEnded === 'function') voice.onEnded();
  }

  stopAll(): void {
    const voices = [...this.voices];
    this.voices.clear();
    for (const voice of voices) {
      try {
        voice.source.stop();
      } catch {
        // Already-ended sources require no further cleanup.
      }
      if (typeof voice.onEnded === 'function') voice.onEnded();
    }
  }

  get size(): number {
    return this.voices.size;
  }

  getStats(): VoicePoolStats {
    return {
      activeVoices: this.voices.size,
      maxVoices: this.maxVoices,
      stolenVoices: this.stolenVoices,
    };
  }
}
