'use strict';

import type { AudioGraph } from './audio-graph';
import { centsToPlaybackRate, clamp } from './manifest';
import type { ManifestLayer, ManifestSample, PlaybackEvent } from './manifest';
import type { VoicePool } from './voice-pool';

export interface VoiceSchedulerOptions {
  graph: AudioGraph;
  voicePool: VoicePool;
  random?: () => number;
  now?: () => number;
}

/**
 * What the scheduler needs from a decoded sample: its duration. At runtime this
 * is a real Web Audio `AudioBuffer` (structurally a superset), but the engine
 * keeps buffers behind the abstract {@link DecodedBuffer} type for testability,
 * so the scheduler accepts that shape and narrows to `AudioBuffer` only at the
 * single point where it assigns the buffer to a source node.
 */
export interface SchedulableBuffer {
  duration?: number;
}

/**
 * Schedules a single decoded buffer as one voice: pitch (with optional random
 * variation), an attack/release amplitude envelope, sample offset/duration
 * windowing, and reservation in the {@link VoicePool}. Returns the wall-clock
 * scheduling delay in milliseconds so the caller can record engine metrics.
 */
export class VoiceScheduler {
  private readonly graph: AudioGraph;
  private readonly voicePool: VoicePool;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor({
    graph,
    voicePool,
    random = Math.random,
    now = () => performance.now(),
  }: VoiceSchedulerOptions) {
    this.graph = graph;
    this.voicePool = voicePool;
    this.random = random;
    this.now = now;
  }

  schedule(
    buffer: SchedulableBuffer,
    sample: ManifestSample,
    layer: ManifestLayer,
    event: PlaybackEvent,
  ): number {
    const schedulingStarted = this.now();
    const context = this.graph.context;
    const masterNode = this.graph.masterNode;
    if (!context || !masterNode) return 0;

    const source = context.createBufferSource();
    const gainNode = context.createGain();
    // Abstract decoded buffer -> DOM AudioBuffer boundary: at runtime this is a
    // real AudioBuffer produced by AudioContext.decodeAudioData.
    source.buffer = buffer as unknown as AudioBuffer;

    const variation =
      layer.pitchVariationCents > 0 ? (this.random() * 2 - 1) * layer.pitchVariationCents : 0;
    source.playbackRate.value = centsToPlaybackRate((sample.pitch || 0) + variation);
    source.connect(gainNode);
    gainNode.connect(masterNode);

    const now = context.currentTime;
    const sampleGain = sample.gain === undefined ? 1 : sample.gain;
    const gain = clamp(sampleGain * layer.gain * (event.gain === undefined ? 1 : event.gain), 0, 2);
    const attackSeconds = layer.envelope.attackMs / 1000;
    const releaseSeconds = layer.envelope.releaseMs / 1000;
    const offset = Math.max(0, sample.offsetSeconds || 0);
    const availableDuration = Math.max(0.001, (buffer.duration ?? 0) - offset);
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
        try {
          source.disconnect();
        } catch {
          // The node may already be disconnected.
        }
        try {
          gainNode.disconnect();
        } catch {
          // The node may already be disconnected.
        }
      },
    });
    source.start(now, offset, duration);

    return Math.max(0, this.now() - schedulingStarted);
  }
}
