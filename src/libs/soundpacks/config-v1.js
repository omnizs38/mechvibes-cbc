'use strict';

const { Howl } = require('howler');
const { keycodesRemap } = require('../keycodes');
const { loadHowls, loadSharedHowls } = require('./audio-loader');
const { ClearSoundpackCache, GetSoundpackFile } = require('./file-manager');

class SoundpackConfig {
  constructor(config, meta) {
    this.name = config.name;
    this.key_define_type = config.key_define_type;
    this.includes_numpad = Boolean(config.includes_numpad);
    this.sound = config.sound;
    this.defines = config.defines;

    this.pack_id = meta.pack_id;
    this.group = meta.group;
    this.abs_path = meta.abs_path;
    this.is_archive = meta.is_archive;
    this.is_custom = meta.is_custom;
    this.version = 1;
    this.loadingPromise = null;
  }

  LoadSounds() {
    if (this.audio !== undefined) {
      return Promise.resolve();
    }
    if (this.loadingPromise !== null) {
      return this.loadingPromise;
    }

    this.loadingPromise = this.loadSoundsInternal().finally(() => {
      this.loadingPromise = null;
    });
    return this.loadingPromise;
  }

  async loadSoundsInternal() {
    if (this.key_define_type === 'single') {
      const sound = GetSoundpackFile(this.abs_path, this.sound);
      const definedSprites = Object.fromEntries(
        Object.entries(this.defines).filter(([, definition]) => definition !== null && definition !== undefined),
      );
      const audio = new Howl({ src: [sound], sprite: keycodesRemap(definedSprites) });
      const loaded = await loadHowls([{ key: 'audio', audio }]);
      this.audio = loaded.audio;
      return;
    }

    const soundData = {};
    for (const [keycode, soundReference] of Object.entries(this.defines)) {
      if (soundReference) {
        soundData[keycode] = { src: [GetSoundpackFile(this.abs_path, soundReference)] };
      }
    }
    const remapped = keycodesRemap(soundData);
    this.audio = await loadSharedHowls(remapped, (options) => new Howl(options));
  }

  HandleEvent(event) {
    if (event.type === 'keyup') {
      return;
    }
    const soundId = `keycode-${event.keycode}`;
    const sound = this.key_define_type === 'single' ? this.audio : this.audio[soundId];
    if (!sound) {
      return;
    }
    if (this.key_define_type === 'single') {
      sound.play(soundId);
    } else {
      sound.play();
    }
  }

  UnloadSounds() {
    if (this.audio !== undefined) {
      if (this.key_define_type === 'single') {
        this.audio.unload();
      } else {
        new Set(Object.values(this.audio)).forEach((audio) => audio.unload());
      }
      delete this.audio;
    }
    ClearSoundpackCache(this.abs_path);
  }
}

module.exports = SoundpackConfig;


// demo config
let demo_config = {
	// A unique identifier, usually assigned by the server
	"id": "sound-pack-1200000000001",

	// The name of the soundpack
	"name": "CherryMX Black - ABS keycaps",

	// how the key definitions are defined
	"key_define_type": "single" || "multi",

	// if the soundpack includes numpad definitions
	"includes_numpad": false, // unused but required

	// the sound file to use when key_define_type is "single".
	// This property is still required when key_define_type is "multi", but is unused in that mode.
	"sound": "sound.ogg",

	// key definitions
	"defines": {
		// format
		"keyCode": "definition",
		// when key_define_type is "single"
		"1": [
			2894, // start time in milliseconds
			226 // duration in milliseconds
		],
		"2": [
			12946,
			191
		],
		// when key_define_type is "multi"
		"3": "sound.ogg",
		"4": "sound.ogg"
	},

	// though the default assumed version is 1, it's better to define it incase the default ever changes.
	"version": 1
}