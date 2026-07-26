'use strict';

import { clamp } from './manifest';

/** Electron exposes setSinkId on AudioContext ahead of the base DOM typings. */
export type SinkCapableAudioContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
  sinkId?: string;
};

export interface AudioGraphOptions {
  contextFactory?: () => AudioContext;
}

/**
 * Owns the Web Audio graph: the `AudioContext`, the master gain node, and the
 * master compressor, plus context lifecycle (create/resume/close) and output
 * device selection. Voices connect to {@link AudioGraph.masterNode}.
 *
 * Gain is the product of the user-controlled master gain and the pack gain, so
 * both are stored here and re-applied together.
 */
export class AudioGraph {
  private readonly contextFactory: () => AudioContext;

  context: SinkCapableAudioContext | null;
  private masterGainNode: GainNode | null;
  private compressorNode: DynamicsCompressorNode | null;
  private masterGain: number;
  private packGain: number;
  private closing: boolean;
  private resuming: Promise<void> | null;

  constructor({
    contextFactory = () => new AudioContext({ latencyHint: 'interactive' }),
  }: AudioGraphOptions = {}) {
    this.contextFactory = contextFactory;
    this.context = null;
    this.masterGainNode = null;
    this.compressorNode = null;
    this.masterGain = 1;
    this.packGain = 1;
    this.closing = false;
    this.resuming = null;
  }

  /**
   * Lazily builds `master gain -> compressor -> destination`. Idempotent.
   * Returns the live context so callers can use it without re-null-checking.
   */
  ensureCreated(): SinkCapableAudioContext {
    if (this.context) return this.context;
    const context = this.contextFactory() as SinkCapableAudioContext;
    this.context = context;
    this.masterGainNode = context.createGain();
    this.compressorNode = context.createDynamicsCompressor();
    this.compressorNode.threshold.value = -3;
    this.compressorNode.knee.value = 6;
    this.compressorNode.ratio.value = 8;
    this.compressorNode.attack.value = 0.003;
    this.compressorNode.release.value = 0.08;
    this.masterGainNode.connect(this.compressorNode);
    this.compressorNode.connect(context.destination);
    // Windows suspends the context when the output device idles or changes.
    // Nothing else would ever bring it back, and a suspended context freezes
    // currentTime, so recovery has to be automatic.
    if (typeof context.addEventListener === 'function') {
      context.addEventListener('statechange', () => this.handleStateChange());
    }
    this.applyGain();
    return context;
  }

  private handleStateChange(): void {
    if (this.closing || !this.context) return;
    if (this.context.state === 'suspended') this.requestResume();
  }

  /** True only when the context is actually rendering audio. */
  get isRunning(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  /** Fire-and-forget resume for callers on the hot path (key events). */
  requestResume(): void {
    void this.resume().catch(() => {
      // Nothing useful to do here; the next state change retries.
    });
  }

  /** The node voices connect their per-voice gain to. */
  get masterNode(): GainNode | null {
    return this.masterGainNode;
  }

  get currentTime(): number {
    return this.context ? this.context.currentTime : 0;
  }

  async resume(): Promise<void> {
    this.ensureCreated();
    const context = this.context as SinkCapableAudioContext;
    if (context.state !== 'suspended') return;
    // Collapse concurrent attempts: a burst of key events must not stack up
    // resume() calls against the same context.
    if (!this.resuming) {
      this.resuming = context.resume().finally(() => {
        this.resuming = null;
      });
    }
    await this.resuming;
  }

  /** Sets the pack-level gain (from the manifest) and re-applies. */
  setPackGain(value: number): void {
    this.packGain = Number.isFinite(value) ? value : 1;
    this.applyGain();
  }

  /** Sets the user-controlled master gain (0..2) and re-applies. */
  setMasterGain(value: number): void {
    this.masterGain = clamp(Number(value) || 0, 0, 2);
    this.applyGain();
  }

  private applyGain(): void {
    if (!this.masterGainNode || !this.context) return;
    this.masterGainNode.gain.setValueAtTime(
      clamp(this.masterGain * this.packGain, 0, 2),
      this.context.currentTime,
    );
  }

  async setOutputDevice(sinkId: string): Promise<string> {
    this.ensureCreated();
    const context = this.context as SinkCapableAudioContext;
    if (typeof context.setSinkId !== 'function') {
      throw new Error('Audio output selection is not supported by this Electron runtime.');
    }
    await context.setSinkId(sinkId || '');
    return context.sinkId || '';
  }

  get contextState(): string {
    return this.context ? this.context.state : 'not-created';
  }

  get outputDevice(): string {
    return this.context && 'sinkId' in this.context ? this.context.sinkId || '' : '';
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.closing = false;
    this.resuming = null;
    this.context = null;
    this.masterGainNode = null;
    this.compressorNode = null;
  }
}
