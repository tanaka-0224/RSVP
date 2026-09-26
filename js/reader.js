/**
 * RSVP再生コントローラ
 */
export class RsvpPlayer {
  /**
   * @param {{
   *   onTick: (index: number, unit: string) => void,
   *   onState: (playing: boolean) => void,
   * }} hooks
   */
  constructor(hooks) {
    this.hooks = hooks;
    /** @type {string[]} */
    this.units = [];
    this.index = 0;
    this.cpm = 400;
    this.playing = false;
    /** @type {number|null} */
    this._timer = null;
  }

  /**
   * @param {string[]} units
   * @param {number} index
   * @param {number} cpm
   */
  load(units, index = 0, cpm = 400) {
    this.stopTimer();
    this.units = units;
    this.index = clamp(index, 0, Math.max(0, units.length - 1));
    this.cpm = cpm;
    this.playing = false;
    this.emit();
    this.hooks.onState(false);
  }

  play() {
    if (!this.units.length) return;
    if (this.index >= this.units.length - 1 && !this.playing) {
      // 末尾で再生したら次はないのでそのまま表示維持
    }
    this.playing = true;
    this.hooks.onState(true);
    this.schedule();
  }

  pause() {
    this.playing = false;
    this.stopTimer();
    this.hooks.onState(false);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  next() {
    if (this.index < this.units.length - 1) {
      this.index += 1;
      this.emit();
      if (this.playing) this.schedule();
    } else {
      this.pause();
    }
  }

  prev() {
    if (this.index > 0) {
      this.index -= 1;
      this.emit();
      if (this.playing) this.schedule();
    }
  }

  restart() {
    this.index = 0;
    this.emit();
    if (this.playing) this.schedule();
  }

  /**
   * @param {number} index
   */
  jump(index) {
    this.index = clamp(index, 0, Math.max(0, this.units.length - 1));
    this.emit();
    if (this.playing) this.schedule();
  }

  /**
   * @param {number} cpm
   */
  setCpm(cpm) {
    this.cpm = Math.max(60, Math.min(2000, cpm));
    if (this.playing) this.schedule();
  }

  get currentUnit() {
    return this.units[this.index] ?? "";
  }

  emit() {
    this.hooks.onTick(this.index, this.currentUnit);
  }

  schedule() {
    this.stopTimer();
    if (!this.playing) return;

    const unit = this.currentUnit;
    const delay = unitDelayMs(unit, this.cpm);

    this._timer = window.setTimeout(() => {
      if (!this.playing) return;
      if (this.index >= this.units.length - 1) {
        this.pause();
        return;
      }
      this.index += 1;
      this.emit();
      this.schedule();
    }, delay);
  }

  stopTimer() {
    if (this._timer != null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  destroy() {
    this.pause();
    this.units = [];
  }
}

/**
 * @param {string} unit
 * @param {number} cpm characters per minute
 */
function unitDelayMs(unit, cpm) {
  const chars = Math.max(1, [...unit].length);
  const base = (chars / cpm) * 60_000;

  // 句読点で少し間を入れる
  let bonus = 0;
  if (/[。．！？!?…]/.test(unit)) bonus += 180;
  else if (/[、，,]/.test(unit)) bonus += 80;

  return Math.max(80, Math.round(base + bonus));
}

/**
 * @param {number} n
 * @param {number} min
 * @param {number} max
 */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
