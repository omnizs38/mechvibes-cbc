'use strict';

const { Howl } = require('howler');
const { keycodesRemap, keycodesFill } = require('../keycodes');
const { loadHowls, loadSharedHowls } = require('./audio-loader');
const { ClearSoundpackCache, GetSoundpackFile } = require('./file-manager');
const { resolveSoundReference } = require('./reference-resolver');
const { expandNumberTemplate } = require('./validation');

class SoundpackConfig {
  constructor(config, meta) {
    this.name = config.name;
    this.key_define_type = config.key_define_type;
    this.sound = config.sound;
    this.soundup = config.soundup;
    this.defines = { ...config.defines };

    this.pack_id = meta.pack_id;
    this.group = meta.group;
    this.abs_path = meta.abs_path;
    this.is_archive = meta.is_archive;
    this.is_custom = meta.is_custom;
    this.version = 2;
    this.loadingPromise = null;

    for (const keycode of Object.keys(keycodesFill(this.defines))) {
      const upKey = `${keycode}-up`;
      this.defines[keycode] = expandNumberTemplate(this.defines[keycode] || this.sound);
      this.defines[upKey] = expandNumberTemplate(this.defines[upKey] || this.soundup);
    }
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
      const audio = new Howl({ src: [sound], sprite: keycodesRemap(this.defines) });
      const loaded = await loadHowls([{ key: 'audio', audio }]);
      this.audio = loaded.audio;
      return;
    }

    const soundData = {};
    for (const [keycode, soundReference] of Object.entries(this.defines)) {
      if (!soundReference) {
        continue;
      }
      const fallback = keycode.endsWith('-up') ? this.soundup : this.sound;
      const source = resolveSoundReference(
        soundReference,
        fallback,
        (reference) => GetSoundpackFile(this.abs_path, reference),
      );
      soundData[keycode] = { src: [source] };
    }
    const remapped = keycodesRemap(soundData);
    this.audio = await loadSharedHowls(remapped, (options) => new Howl(options));
  }

  HandleEvent(event) {
    const keycode = event.type === 'keyup' ? `${event.keycode}-up` : event.keycode;
    const soundId = `keycode-${keycode}`;
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
	// ^ If you're going to choose "single" you should just use a version 1 config.

	// the sound file to use when key_define_type is "single".
	// or when key_define_type is "multi", the sound file to fallback on
	// when a key doesn't have a sound defined.
	"sound": "sound.ogg",
	// the fallback key_up sound file to use when key_define_type is "multi".
	// Note that, this is not supported when key_define_type is "single", and will be ignored,
	// but is still required.
	"soundup": "sound_up.ogg",

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
		"3-up": "sound_up.ogg",
		"4": "sound.ogg",
		"4-up": "sound_up.ogg"
	},

	// required
	"version": 2
}