'use strict';

const { createAudioManifest } = require('../../audio-engine/manifest-adapter');
const { WebAudioEngine } = require('../../audio-engine/web-audio-engine');
const { ClearSoundpackCache } = require('./file-manager');

class WebAudioSoundpackConfig {
  constructor(config, metadata, { engineFactory = () => new WebAudioEngine() } = {}) {
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

  LoadSounds() {
    if (this.audio !== undefined) return Promise.resolve();
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = this.loadInternal().finally(() => {
      this.loadingPromise = null;
    });
    return this.loadingPromise;
  }

  async loadInternal() {
    this.manifest = createAudioManifest(this.config, this.metadata);
    this.engine = this.engineFactory();
    await this.engine.loadManifest(this.manifest);
    await this.engine.resume();
    this.audio = this.engine;
  }

  SetMasterGain(gain) {
    if (this.engine) this.engine.setMasterGain(gain);
  }

  HandleEvent(event) {
    if (!this.engine) return;
    this.engine.play(event).catch(() => {});
  }

  async SetOutputDevice(sinkId) {
    if (!this.engine) throw new Error('Soundpack is not loaded.');
    return this.engine.setOutputDevice(sinkId);
  }

  GetAudioStats() {
    return this.engine ? this.engine.getStats() : null;
  }

  UnloadSounds() {
    const engine = this.engine;
    this.engine = null;
    this.manifest = null;
    delete this.audio;
    ClearSoundpackCache(this.abs_path);
    if (engine) engine.dispose().catch(() => {});
  }
}

module.exports = WebAudioSoundpackConfig;
