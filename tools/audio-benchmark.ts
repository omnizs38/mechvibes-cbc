'use strict';

import { performance } from 'perf_hooks';

import { WebAudioEngine, type AudioManifest } from '../src/audio-engine/web-audio-engine';

const parameter = () => ({
  value: 0,
  cancelScheduledValues(): void {},
  setValueAtTime(): void {},
  linearRampToValueAtTime(): void {},
});
const node = () => ({ connect(): void {}, disconnect(): void {} });

const context = {
  currentTime: 1,
  state: 'running',
  destination: {},
  createGain: () => ({ ...node(), gain: parameter() }),
  createDynamicsCompressor: () => ({
    ...node(),
    threshold: parameter(),
    knee: parameter(),
    ratio: parameter(),
    attack: parameter(),
    release: parameter(),
  }),
  createBufferSource: () => ({
    ...node(),
    playbackRate: { value: 1 },
    start(): void {},
    stop(): void {},
    onended: null,
  }),
  async decodeAudioData() {
    return { length: 2400, numberOfChannels: 1, duration: 0.05 };
  },
  async resume(): Promise<void> {},
  async close(): Promise<void> {
    this.state = 'closed';
  },
};

const manifest: AudioManifest = {
  version: 3,
  checksums: {},
  id: 'benchmark',
  name: 'Benchmark',
  maxVoices: 64,
  cacheBudgetBytes: 32 * 1024 * 1024,
  preload: 'all',
  gain: 1,
  events: {
    'keydown:30': {
      samples: [{ source: 'benchmark.wav', gain: 1, pitch: 0 }],
      mode: 'round-robin',
      gain: 1,
      pitchVariationCents: 0,
      priority: 5,
      envelope: { attackMs: 0, releaseMs: 10 },
    },
  },
};

void (async () => {
  const engine = new WebAudioEngine({
    contextFactory: () => context as unknown as AudioContext,
    readSourceImpl: async () => null,
    fetchImpl: (async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(16),
    })) as never,
    random: () => 0.5,
    now: () => performance.now(),
  });
  await engine.loadManifest(manifest);

  const iterations = 10000;
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    await engine.play({ type: 'keydown', keycode: 30 });
  }
  const durationMs = performance.now() - startedAt;
  const averageMs = durationMs / iterations;
  const stats = engine.getStats();
  console.log(JSON.stringify({ iterations, durationMs, averageMs, stats }, null, 2));

  await engine.dispose();

  if (averageMs > 2) {
    console.error(`Scheduler average ${averageMs.toFixed(3)}ms exceeded the 2ms CI budget.`);
    process.exit(1);
  }
})();
