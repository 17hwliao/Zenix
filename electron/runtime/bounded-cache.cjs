// Small TTL/LRU stores: no background timer and no unbounded retained buffers.
class BoundedCache {
  constructor({ maxEntries = 64, maxBytes = Infinity, ttl = 300000, sizeOf = () => 1 } = {}) {
    this.entries = new Map(); this.bytes = 0;
    Object.assign(this, { maxEntries, maxBytes, ttl, sizeOf });
  }
  get size() { return this.entries.size; }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) { this.delete(key); return undefined; }
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  has(key) { return this.get(key) !== undefined; }
  set(key, value, ttl = this.ttl) {
    this.delete(key);
    const size = this.sizeOf(value);
    if (size > this.maxBytes) return this;
    this.entries.set(key, { value, size, expires: Date.now() + ttl }); this.bytes += size;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) this.delete(this.entries.keys().next().value);
    return this;
  }
  delete(key) { const entry = this.entries.get(key); if (!entry) return false; this.bytes -= entry.size; return this.entries.delete(key); }
  keys() { return this.entries.keys(); }
  clear() { this.entries.clear(); this.bytes = 0; }
}
module.exports = { BoundedCache };
