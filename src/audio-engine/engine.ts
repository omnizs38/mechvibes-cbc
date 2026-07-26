'use strict';

import { AudioGraph } from './audio-graph';
import type { SinkCapableAudioContext } from './audio-graph';
import type { AudioManifest, ManifestSample, PlaybackEvent } from './manifest';
import { SampleCache } from './sample-cache';
import type { SampleFetch, SampleReader } from './sample-cache';
import { SampleSelector } from './sample-selector';
import { VoicePool } from './voice-pool';
import { VoiceScheduler } from './voice-scheduler';

export interface WebAudioEngineOptions {
  contextFactory?: () => AudioContext;
  fetchImpl?: SampleFetch;
  readSourceImpl?: SampleReader | undefined;
  random?: () => number;
  now?: () => number;
}

export interface EngineMetrics {
  playRequests: number;
  cacheMisses: number;
  droppedEvents: number;
  lastSchedulingDelayMs: number;
  maximumSchedulingDelayMs: number;
}

/**
 * Orchestrates the audio-engine modules. It owns no Web Audio nodes directly:
 * the {@link AudioGraph} owns the context and master chain, the
 * {@link VoiceScheduler} turns a decoded buffer into a scheduled voice, and the
 * {@link SampleCache} / {@link SampleSelector} / {@link VoicePool} handle
 * decoding, selection, and polyphony. The engine wires them together and keeps
 * the public playback contract stable.
 */
export class WebAudioEngine {
  private readonly fetchImpl: SampleFetch;
  private readonly readSourceImpl: SampleReader | undefined;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly graph: AudioGraph;
  private readonly selector: SampleSelector<ManifestSample>;
  private scheduler: VoiceScheduler | null;

  cache: SampleCache | null;
  voicePool: VoicePool | null;
  manifest: AudioManifest | null;
  readonly metrics: EngineMetrics;

  constructor({
    contextFactory = () => new AudioContext({ latencyHint: 'interactive' }),
    fetchImpl = globalThis.fetch as unknown as SampleFetch,
    readSourceImpl = undefined,
    random = Math.random,
    now = () => performance.now(),
  }: WebAudioEngineOptions = {}) {
    this.fetchImpl = fetchImpl;
    this.readSourceImpl = readSourceImpl;
    this.random = random;
    this.now = now;
    this.graph = new AudioGraph({ contextFactory });
    this.selector = new SampleSelector<ManifestSample>(random);
    this.scheduler = null;
    this.cache = null;
    this.voicePool = null;
    this.manifest = null;
    this.metrics = {
      playRequests: 0,
      cacheMisses: 0,
      droppedEvents: 0,
      lastSchedulingDelayMs: 0,
      maximumSchedulingDelayMs: 0,
    };
  }

  /** The live AudioContext, or `null` before the graph is created. */
  get context(): SinkCapableAudioContext | null {
    return this.graph.context;
  }

  async loadManifest(manifest: AudioManifest): Promise<void> {
    const context = this.graph.ensureCreated();
    this.stopAll();
    this.selector.reset();
    this.manifest = manifest;
    this.voicePool = new VoicePool(manifest.maxVoices || 64);
    this.scheduler = new VoiceScheduler({
      graph: this.graph,
      voicePool: this.voicePool,
      random: this.random,
      now: this.now,
    });
    this.cache = new SampleCache({
      context,
      fetchImpl: this.fetchImpl,
      readSourceImpl: this.readSourceImpl,
      budgetBytes: manifest.cacheBudgetBytes,
    });
    this.graph.setPackGain(manifest.gain);

    const sources: string[] = [];
    for (const layer of Object.values(manifest.events)) {
      if (manifest.preload === 'all' || (manifest.preload === 'priority' && layer.priority >= 5)) {
        layer.samples.forEach((sample) => sources.push(sample.source));
      }
    }
    if (sources.length > 0) {
      await this.cache.preload(sources, { pinned: manifest.preload === 'all' });
    }
  }

  resume(): Promise<void> {
    return this.graph.resume();
  }

  setMasterGain(value: number): void {
    this.graph.setMasterGain(value);
  }

  play(event: PlaybackEvent): Promise<boolean> {
    if (!this.manifest || !this.cache || !this.voicePool || !this.scheduler) {
      return Promise.resolve(false);
    }
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
    if (cached) {
      this.record(this.scheduler.schedule(cached, sample, layer, event));
      return Promise.resolve(true);
    }
    this.metrics.cacheMisses += 1;
    return this.cache.load(sample.source).then((buffer) => {
      if (!this.scheduler) return false;
      this.record(this.scheduler.schedule(buffer, sample, layer, event));
      return true;
    });
  }

  private record(schedulingDelayMs: number): void {
    this.metrics.lastSchedulingDelayMs = schedulingDelayMs;
    this.metrics.maximumSchedulingDelayMs = Math.max(
      this.metrics.maximumSchedulingDelayMs,
      schedulingDelayMs,
    );
  }

  setOutputDevice(sinkId: string): Promise<string> {
    return this.graph.setOutputDevice(sinkId);
  }

  stopAll(): void {
    if (this.voicePool) this.voicePool.stopAll();
    if (this.cache) this.cache.clear();
  }

  async dispose(): Promise<void> {
    this.stopAll();
    this.manifest = null;
    this.scheduler = null;
    await this.graph.close();
    this.cache = null;
    this.voicePool = null;
  }

  getStats(): Record<string, unknown> {
    return {
      ...this.metrics,
      contextState: this.graph.contextState,
      outputDevice: this.graph.outputDevice,
      cache: this.cache ? this.cache.getStats() : null,
      voices: this.voicePool ? this.voicePool.getStats() : null,
    };
  }
}
