const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { BoundedCache } = require('./bounded-cache.cjs');
const { readBoundedFile } = require('./bounded-file.cjs');
const { fetchAllowed, readLimited } = require('./source-network.cjs');

// Artwork owns its queue and cancellation. It never borrows a playback token,
// changes source health, or writes personal-library / audio-cache records.
class SourceArtwork {
  constructor({ folder, metadataCache, resolve }) {
    this.folder = folder; this.metadataCache = metadataCache; this.resolve = resolve;
    this.cache = new BoundedCache({ maxEntries: 32, maxBytes: 8 * 1024 * 1024, sizeOf: value => value.data.byteLength });
    this.hints = new BoundedCache({ maxEntries: 500, ttl: 30 * 60 * 1000 });
    this.pending = new Map(); this.controllers = new Set(); this.waiters = []; this.active = 0; this.closed = false;
  }
  async cover(_request, id, remoteId) {
    const result = await this.get(id, remoteId);
    const ok = Boolean(result.data?.length);
    return new Response(ok ? result.data : null, {
      status: ok ? 200 : result.status || 404,
      headers: { 'Content-Type': ok ? result.type : 'text/plain', 'Access-Control-Allow-Origin': '*',
        'Cache-Control': ok ? 'private, max-age=86400' : 'no-store' },
    });
  }
  get(id, remoteId) {
    const key = `${this.metadataCache.epoch}:${id}:${remoteId}`;
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.closed || this.pending.size >= 128) return Promise.resolve({ status: 503 });
    const task = this.read(id, remoteId).catch(() => ({ status: 404 })).finally(() => this.pending.delete(key));
    this.pending.set(key, task); return task;
  }
  async slot(operation) {
    if (this.closed) throw Error('封面请求已关闭');
    if (this.active >= 2) await new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    else this.active++;
    try { if (this.closed) throw Error('封面请求已关闭'); return await operation(); }
    finally {
      const next = this.waiters.shift();
      if (next) next.resolve(); else this.active--;
    }
  }
  async read(id, remoteId) {
    const epoch = this.metadataCache.epoch, key = `${id}:${remoteId}`;
    const hit = this.cache.get(key); if (hit) return hit;
    const hash = createHash('sha256').update(key).digest('hex');
    const files = [path.join(this.folder, `${hash}.bin`), path.join(this.folder, `${hash}.type`)];
    await this.metadataCache.pending.catch(() => {});
    try {
      const [data, type] = await Promise.all([readBoundedFile(files[0], 5 * 1024 * 1024), readBoundedFile(files[1], 256, 'utf8')]);
      if (data.length && type.startsWith('image/')) {
        const value = { data, type }; if (epoch === this.metadataCache.epoch) this.cache.set(key, value);
        return value;
      }
    } catch {}
    return this.slot(async () => {
      const controller = new AbortController(); this.controllers.add(controller);
      try {
        const { url, patterns, options } = await this.resolve(id, remoteId, this.hints.get(key), controller.signal);
        controller.signal.throwIfAborted();
        // The image budget begins after queueing, never while waiting for a slot.
        const response = await fetchAllowed(url, patterns, { ...options, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        if (!response.ok) { await response.body?.cancel().catch(() => {}); return { status: response.status >= 400 ? response.status : 502 }; }
        const type = response.headers.get('content-type') || '';
        if (!type.toLowerCase().startsWith('image/')) { await response.body?.cancel().catch(() => {}); return { status: 502 }; }
        const data = await readLimited(response, 5 * 1024 * 1024);
        if (!data.length) return { status: 502 };
        const value = { data, type };
        if (epoch === this.metadataCache.epoch) {
          this.cache.set(key, value);
          await this.metadataCache.write([[files[0], data], [files[1], type]], epoch);
          this.metadataCache.schedule();
        }
        return value;
      } finally { this.controllers.delete(controller); }
    });
  }
  close() {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    for (const waiter of this.waiters.splice(0)) waiter.reject(Error('封面请求已关闭'));
    this.cache.clear(); this.hints.clear();
  }
  clearMemory() { this.cache.clear(); }
}
module.exports = { SourceArtwork };
