'use strict';

class HotkeyTracker {
  constructor({ onMuteToggle }) {
    this.onMuteToggle = onMuteToggle;
    this.pressed = new Set();
    this.muteLatched = false;
    this.ctrlKeys = new Set([29, 3613]);
    this.shiftKeys = new Set([42, 54]);
    this.mKey = 50;
  }

  hasAny(keys) {
    return [...keys].some((key) => this.pressed.has(key));
  }

  handleKeydown(event) {
    this.pressed.add(event.keycode);
    const matches = event.keycode === this.mKey
      && this.hasAny(this.ctrlKeys)
      && this.hasAny(this.shiftKeys);
    if (!matches || this.muteLatched) return false;
    this.muteLatched = true;
    this.onMuteToggle();
    return true;
  }

  handleKeyup(event) {
    this.pressed.delete(event.keycode);
    if (event.keycode === this.mKey) this.muteLatched = false;
  }

  reset() {
    this.pressed.clear();
    this.muteLatched = false;
  }
}

module.exports = { HotkeyTracker };
