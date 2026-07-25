'use strict';

export interface HotkeyEvent {
  keycode: number;
}

export interface HotkeyTrackerOptions {
  onMuteToggle: () => void;
}

export class HotkeyTracker {
  private readonly onMuteToggle: () => void;
  private readonly pressed: Set<number>;
  private muteLatched: boolean;
  private readonly ctrlKeys: Set<number>;
  private readonly shiftKeys: Set<number>;
  private readonly mKey: number;

  constructor({ onMuteToggle }: HotkeyTrackerOptions) {
    this.onMuteToggle = onMuteToggle;
    this.pressed = new Set();
    this.muteLatched = false;
    this.ctrlKeys = new Set([29, 3613]);
    this.shiftKeys = new Set([42, 54]);
    this.mKey = 50;
  }

  hasAny(keys: Iterable<number>): boolean {
    return [...keys].some((key) => this.pressed.has(key));
  }

  handleKeydown(event: HotkeyEvent): boolean {
    this.pressed.add(event.keycode);
    const matches =
      event.keycode === this.mKey && this.hasAny(this.ctrlKeys) && this.hasAny(this.shiftKeys);
    if (!matches || this.muteLatched) return false;
    this.muteLatched = true;
    this.onMuteToggle();
    return true;
  }

  handleKeyup(event: HotkeyEvent): void {
    this.pressed.delete(event.keycode);
    if (event.keycode === this.mKey) this.muteLatched = false;
  }

  reset(): void {
    this.pressed.clear();
    this.muteLatched = false;
  }
}
