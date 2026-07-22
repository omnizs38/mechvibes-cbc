'use strict';

class VoicePool {
  constructor(maxVoices = 64) {
    if (!Number.isInteger(maxVoices) || maxVoices < 1) {
      throw new Error('maxVoices must be a positive integer.');
    }
    this.maxVoices = maxVoices;
    this.voices = new Set();
    this.stolenVoices = 0;
  }

  selectVoiceToSteal() {
    return [...this.voices].sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return left.startedAt - right.startedAt;
    })[0] || null;
  }

  reserve({ source, priority = 0, startedAt = 0, onEnded = null }) {
    if (!source || typeof source.stop !== 'function') {
      throw new Error('A stoppable audio source is required.');
    }
    if (this.voices.size >= this.maxVoices) {
      const stolen = this.selectVoiceToSteal();
      if (stolen) {
        this.release(stolen);
        try {
          stolen.source.stop();
        } catch (_) {
          // A source may have ended between selection and stop.
        }
        this.stolenVoices += 1;
      }
    }

    const voice = { source, priority, startedAt, onEnded };
    this.voices.add(voice);
    source.onended = () => this.release(voice);
    return voice;
  }

  release(voice) {
    if (!voice || !this.voices.delete(voice)) return;
    if (typeof voice.onEnded === 'function') voice.onEnded();
  }

  stopAll() {
    const voices = [...this.voices];
    this.voices.clear();
    for (const voice of voices) {
      try {
        voice.source.stop();
      } catch (_) {
        // Already-ended sources require no further cleanup.
      }
      if (typeof voice.onEnded === 'function') voice.onEnded();
    }
  }

  get size() {
    return this.voices.size;
  }

  getStats() {
    return {
      activeVoices: this.voices.size,
      maxVoices: this.maxVoices,
      stolenVoices: this.stolenVoices,
    };
  }
}

module.exports = { VoicePool };
