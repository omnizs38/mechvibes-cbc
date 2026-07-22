'use strict';

const { SampleCache } = require('./sample-cache');
const { SampleSelector } = require('./sample-selector');
const { VoicePool } = require('./voice-pool');

function centsToPlaybackRate(cents) {
  return 2 ** (Number(cents || 0) / 1200);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

class WebAudioEngine {
  constructor({
    contextFactory = () => new AudioContext({ latencyHint: 'interactive' }),
    fetchImpl = globalThis.fetch,
    readSourceImpl = undefined,
    random = Math.random,
    now = () => performance.now(),
  } = {}) {
    this.contextFactory = contextFactory;
    this.fetchImpl = fetchImpl;
    this.readSourceImpl = readSourceImpl;
    this.random = random;
    this.now = now;
    this.context = null;
    this.masterGainNode = null;
    this.compressorNode = null;
    this.cache = null;
    this.voicePool = null;
    this.selector = new SampleSelector(random);
    this.manifest = null;
    this.masterGain = 1;
    this.metrics = {
      playRequests: 0,
      cacheMisses: 0,
      droppedEvents: 0,
      lastSchedulingDelayMs: 0,
      maximumSchedulingDelayMs: 0,
    };
  }

  createGraph() {
    if (this.context) return;
    this.context = this.contextFactory();
    this.masterGainNode = this.context.createGain();
    this.compressorNode = this.context.createDynamicsCompressor();
    this.compressorNode.threshold.value = -3;
    this.compressorNode.knee.value = 6;
    this.compressorNode.ratio.value = 8;
    this.compressorNode.attack.value = 0.003;
    this.compressorNode.release.value = 0.08;
    this.masterGainNode.connect(this.compressorNode);
    this.compressorNode.connect(this.context.destination);
  }

  async loadManifest(manifest) {
    this.createGraph();
    this.stopAll();
    this.selector.reset();
    this.manifest = manifest;
    this.voicePool = new VoicePool(manifest.maxVoices || 64);
    this.cache = new SampleCache({
      context: this.context,
      fetchImpl: this.fetchImpl,
      readSourceImpl: this.readSourceImpl,
      budgetBytes: manifest.cacheBudgetBytes,
    });
    this.applyMasterGain();

    const layers = Object.values(manifest.events);
    const sources = [];
    for (const layer of layers) {
      if (manifest.preload === 'all' || (manifest.preload === 'priority' && layer.priority >= 5)) {
        layer.samples.forEach((sample) => sources.push(sample.source));
      }
    }
    if (sources.length > 0) {
      await this.cache.preload(sources, { pinned: manifest.preload === 'all' });
    }
  }

  async resume() {
    this.createGraph();
    if (this.context.state === 'suspended') await this.context.resume();
  }

  setMasterGain(value) {
    this.masterGain = clamp(Number(value) || 0, 0, 2);
    this.applyMasterGain();
  }

  applyMasterGain() {
    if (!this.masterGainNode || !this.context) return;
    const packGain = this.manifest ? this.manifest.gain : 1;
    this.masterGainNode.gain.setValueAtTime(clamp(this.masterGain * packGain, 0, 2), this.context.currentTime);
  }

  play(event) {
    if (!this.manifest || !this.cache || !this.voicePool) return Promise.resolve(false);
    this.metrics.playRequests += 1;
    const eventKey = `${event.type}:${event.keycode}`;
    const layer = this.manifest.events[eventKey];
    if (!layer) {
      this.metrics.droppedEvents += 1;
      return Promise.resolve(false);
    }
    const sample = this.selector.choose(eventKey, layer.samples, layer.mode);
    if (!sample) {
      this.metrics.droppedEvents += 1;
      return Promise.resolve(false);
    }

    const cached = this.cache.get(sample.source);
    if (cached) return Promise.resolve(this.playBuffer(cached, sample, layer, event));
    this.metrics.cacheMisses += 1;
    return this.cache.load(sample.source).then((buffer) => this.playBuffer(buffer, sample, layer, event));
  }

  playBuffer(buffer, sample, layer, event) {
    const schedulingStarted = this.now();
    const source = this.context.createBufferSource();
    const gainNode = this.context.createGain();
    source.buffer = buffer;

    const variation = layer.pitchVariationCents > 0
      ? (this.random() * 2 - 1) * layer.pitchVariationCents
      : 0;
    source.playbackRate.value = centsToPlaybackRate((sample.pitch || 0) + variation);
    source.connect(gainNode);
    gainNode.connect(this.masterGainNode);

    const now = this.context.currentTime;
    const sampleGain = sample.gain === undefined ? 1 : sample.gain;
    const gain = clamp(sampleGain * layer.gain * (event.gain === undefined ? 1 : event.gain), 0, 2);
    const attackSeconds = layer.envelope.attackMs / 1000;
    const releaseSeconds = layer.envelope.releaseMs / 1000;
    const offset = Math.max(0, sample.offsetSeconds || 0);
    const availableDuration = Math.max(0.001, buffer.duration - offset);
    const duration = sample.durationSeconds
      ? Math.min(sample.durationSeconds, availableDuration)
      : availableDuration;
    const releaseStart = Math.max(now + attackSeconds, now + duration - releaseSeconds);
    const stopAt = now + duration;

    gainNode.gain.cancelScheduledValues(now);
    if (attackSeconds > 0) {
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(gain, now + attackSeconds);
    } else {
      gainNode.gain.setValueAtTime(gain, now);
    }
    if (releaseSeconds > 0) {
      gainNode.gain.setValueAtTime(gain, releaseStart);
      gainNode.gain.linearRampToValueAtTime(0.0001, stopAt);
    }

    this.voicePool.reserve({
      source,
      priority: layer.priority,
      startedAt: now,
      onEnded: () => {
        try { source.disconnect(); } catch (_) {}
        try { gainNode.disconnect(); } catch (_) {}
      },
    });
    source.start(now, offset, duration);

    const schedulingDelay = Math.max(0, this.now() - schedulingStarted);
    this.metrics.lastSchedulingDelayMs = schedulingDelay;
    this.metrics.maximumSchedulingDelayMs = Math.max(this.metrics.maximumSchedulingDelayMs, schedulingDelay);
    return true;
  }

  async setOutputDevice(sinkId) {
    this.createGraph();
    if (typeof this.context.setSinkId !== 'function') {
      throw new Error('Audio output selection is not supported by this Electron runtime.');
    }
    await this.context.setSinkId(sinkId || '');
    return this.context.sinkId || '';
  }

  stopAll() {
    if (this.voicePool) this.voicePool.stopAll();
    if (this.cache) this.cache.clear();
  }

  async dispose() {
    this.stopAll();
    this.manifest = null;
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = null;
    this.cache = null;
    this.voicePool = null;
  }

  getStats() {
    return {
      ...this.metrics,
      contextState: this.context ? this.context.state : 'not-created',
      outputDevice: this.context && 'sinkId' in this.context ? this.context.sinkId : '',
      cache: this.cache ? this.cache.getStats() : null,
      voices: this.voicePool ? this.voicePool.getStats() : null,
    };
  }
}

module.exports = {
  WebAudioEngine,
  centsToPlaybackRate,
  clamp,
};
