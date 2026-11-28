const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

class PetMotion {
  constructor({getWindow, screen, canWalk, isPaused, reduced, changed, settled, now = () => performance.now()}) {
    Object.assign(this, {getWindow, screen, canWalk, isPaused, reduced, changed, settled, now});
    this.direction = 1;
    this.mode = 'idle';
    this.velocity = {x: 0, y: 0};
    this.last = now();
    this.restUntil = 0;
  }

  bounds() {
    const window = this.getWindow();
    if (!window || window.isDestroyed() || !this.screen?.getDisplayMatching) return null;
    const bounds = window.getBounds();
    const area = this.screen.getDisplayMatching(bounds).workArea;
    return {window, bounds, area, floor: area.y + Math.max(0, area.height - bounds.height), right: area.x + Math.max(0, area.width - bounds.width)};
  }

  publish() {
    const value = {mode: this.mode, direction: this.direction, tilt: clamp(this.velocity.x / 55, -18, 18)};
    const signature = JSON.stringify(value);
    if (signature !== this.signature) {this.signature = signature; this.changed(value);}
  }

  start() {
    this.stop();
    this.last = this.now();
    const current = this.bounds();
    if (current) {
      const {window, bounds, area, floor, right} = current;
      window.setPosition(Math.round(clamp(bounds.x, area.x, right)), Math.round(floor), false);
    }
    this.mode = 'idle';
    this.publish();
    this.timer = setInterval(() => this.tick(), 32);
    this.timer.unref?.();
  }

  stop() {clearInterval(this.timer); this.timer = undefined;}

  dragStart() {
    this.dragging = true;
    this.velocity = {x: 0, y: 0};
    this.mode = 'dragged';
    this.publish();
  }

  dragEnd(velocity = {x: 0, y: 0}, cancelled = false) {
    this.dragging = false;
    this.velocity = cancelled || this.reduced() ? {x: 0, y: 0} : {x: clamp(velocity.x || 0, -900, 900), y: clamp(velocity.y || 0, -1000, 1000)};
    if (Math.abs(this.velocity.x) > 30) this.direction = Math.sign(this.velocity.x);
    this.mode = 'falling';
    this.restUntil = this.now() + 1400;
    this.publish();
  }

  interact(action) {
    if (this.dragging) return;
    this.restUntil = this.now() + (action === 'sleep' || action === 'sit' ? 60000 : 1800);
    this.mode = action;
    if (action === 'jump') {this.velocity.y = this.reduced() ? 0 : -440;this.mode = 'falling';}
    this.publish();
  }

  tick() {
    const now = this.now();
    const seconds = clamp((now - this.last) / 1000, 0, .05);
    this.last = now;
    const current = this.bounds();
    if (!current || this.dragging) return;
    const {window, bounds, area, floor, right} = current;
    let x = clamp(bounds.x, area.x, right), y = clamp(bounds.y, area.y, floor);
    const airborne = y < floor || this.velocity.y < 0 || this.mode === 'falling';
    if (airborne) {
      if (this.reduced()) {y = floor;this.velocity = {x: 0, y: 0};}
      else {
        this.velocity.y += 1450 * seconds;
        x += this.velocity.x * seconds;
        y += this.velocity.y * seconds;
        this.velocity.x *= Math.exp(-seconds * .7);
      }
      this.mode = 'falling';
      if (y >= floor) {
        y = floor;
        this.velocity = {x: 0, y: 0};
        this.mode = 'landed';
        this.restUntil = now + 650;
        this.settled?.();
      }
    } else if (now >= this.restUntil) {
      this.mode = this.canWalk() && !this.isPaused() && !this.reduced() ? 'walk' : 'idle';
      if (this.mode === 'walk') x += this.direction * 34 * seconds;
    }
    if (x <= area.x || x >= right) {
      x = clamp(x, area.x, right);
      this.direction = x <= area.x ? 1 : -1;
      this.velocity.x *= -.35;
    }
    x = Math.round(x); y = Math.round(clamp(y, area.y, floor));
    if (x !== bounds.x || y !== bounds.y) window.setPosition(x, y, false);
    this.publish();
  }
}

module.exports = {PetMotion};
