'use strict';

import { createAudioManifest } from '../../audio-engine/manifest-adapter';
import { WebAudioEngine } from '../../audio-engine/web-audio-engine';
import type { AudioManifest, PlaybackEvent } from '../../audio-engine/web-audio-engine';
import { ClearSoundpackCache } from './file-manager';
import type { ValidatedSoundpackConfig } from './validation';
import type { SoundpackMetadata } from './registry';

export interface WebAudioSoundpackOptions {
  engineFactory?: () => WebAudioEngine;
}

class WebAudioSoundpackConfig {
  readonly config: ValidatedSoundpackConfig;
  readonly metadata: SoundpackMetadata;
  readonly name: string;
  readonly pack_id: string;
  readonly group: string;
  readonly abs_path: string;
  readonly is_archive: boolean;
  readonly is_custom: boolean;
  readonly version: number;

  private readonly engineFactory: () => WebAudioEngine;
  private engine: WebAudioEngine | null;
  private manifest: AudioManifest | null;
  private loadingPromise: Promise<void> | null;
  private audio?: WebAudioEngine;

  constructor(
    config: ValidatedSoundpackConfig,
    metadata: SoundpackMetadata,
    { engineFactory = () => new WebAudioEngine() }: WebAudioSoundpackOptions = {},
  ) {
    this.config = config;
    this.metadata = metadata;
    this.name = config.name;
    this.pack_id = metadata.pack_id;
    this.group = metadata.group;
    this.abs_path = metadata.abs_path;
    this.is_archive = metadata.is_archive;
    this.is_custom = metadata.is_custom;
    this.version = config.version;
    this.engineFactory = engineFactory;
    this.engine = null;
    this.manifest = null;
    this.loadingPromise = null;
  }

  LoadSounds(): Promise<void> {
    if (this.audio !== undefined) return Promise.resolve();
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = this.loadInternal().finally(() => {
      this.loadingPromise = null;
    });
    return this.loadingPromise;
  }

  async loadInternal(): Promise<void> {
    this.manifest = createAudioManifest(this.config, this.metadata);
    this.engine = this.engineFactory();
    await this.engine.loadManifest(this.manifest);
    await this.engine.resume();
    this.audio = this.engine;
  }

  SetMasterGain(gain: number): void {
    if (this.engine) this.engine.setMasterGain(gain);
  }

  HandleEvent(event: PlaybackEvent): void {
    if (!this.engine) return;
    this.engine.play(event).catch(() => {});
  }

  async SetOutputDevice(sinkId: string): Promise<string> {
    if (!this.engine) throw new Error('Soundpack is not loaded.');
    return this.engine.setOutputDevice(sinkId);
  }

  GetAudioStats(): Record<string, unknown> | null {
    return this.engine ? this.engine.getStats() : null;
  }

  UnloadSounds(): void {
    const engine = this.engine;
    this.engine = null;
    this.manifest = null;
    delete this.audio;
    ClearSoundpackCache(this.abs_path);
    if (engine) engine.dispose().catch(() => {});
  }
}

export = WebAudioSoundpackConfig;
