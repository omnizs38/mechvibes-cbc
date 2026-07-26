'use strict';

// Public API surface of the audio engine (v4). Import from here rather than
// reaching into individual modules.

export { WebAudioEngine } from './engine';
export type { WebAudioEngineOptions, EngineMetrics } from './engine';

export { AudioGraph } from './audio-graph';
export type { AudioGraphOptions, SinkCapableAudioContext } from './audio-graph';

export { VoiceScheduler } from './voice-scheduler';
export type { VoiceSchedulerOptions } from './voice-scheduler';

export { VoicePool } from './voice-pool';
export type { Voice, VoiceRequest, VoicePoolStats, StoppableSource } from './voice-pool';

export { SampleCache } from './sample-cache';
export type { SampleFetch, SampleReader, SampleCacheOptions, SampleCacheStats } from './sample-cache';

export { SampleSelector } from './sample-selector';

export { LatencyTracker } from './latency-tracker';
export type { LatencyStats } from './latency-tracker';

export { centsToPlaybackRate, clamp, MANIFEST_FORMAT } from './manifest';
export type {
  AudioManifest,
  ManifestLayer,
  ManifestSample,
  PlaybackEvent,
  SampleSelectionMode,
} from './manifest';

export { createAudioManifest } from './manifest-adapter';
