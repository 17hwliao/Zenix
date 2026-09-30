// Native cursor coordinates remain available over app-region:drag and transparent edges.
class LyricsHoverTracker {
  constructor({ getBounds, getCursor, onChange, onSample, onStop }) {
    this.getBounds = getBounds;
    this.getCursor = getCursor;
    this.onChange = onChange;
    this.onSample = onSample;
    this.onStop = onStop;
    this.hovered = false;
    this.pinned = false;
    this.outsideSince = null;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.sample();
    this.timer = setInterval(() => this.sample(), 60);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.pinned = false;
    this.outsideSince = null;
    this.setHovered(false);
    this.onStop();
  }

  setHovered(value) {
    if (this.hovered === value) return;
    this.hovered = value;
    this.onChange(value);
  }

  setPinned(value) {
    this.pinned = Boolean(value);
    this.sample();
  }

  sample() {
    const bounds = this.getBounds();
    if (!bounds) return;
    const point = this.getCursor();
    // Enter inside the six-pixel transparent padding. Retain hover across the resize
    // border and a small outer margin, with a short delay after a genuine exit.
    const inset = this.hovered ? -8 : 6;
    const inside = point.x >= bounds.x + inset && point.x < bounds.x + bounds.width - inset
      && point.y >= bounds.y + inset && point.y < bounds.y + bounds.height - inset;
    if (inside || this.pinned) {
      this.outsideSince = null;
      this.setHovered(true);
    } else if (this.hovered) {
      const now = performance.now();
      if (this.outsideSince === null) this.outsideSince = now;
      if (now - this.outsideSince >= 240) {
        this.outsideSince = null;
        this.setHovered(false);
      }
    }
    this.onSample(bounds, this.hovered);
  }
}

module.exports = { LyricsHoverTracker };
