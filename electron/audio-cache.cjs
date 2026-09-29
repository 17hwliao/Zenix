const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const DAY = 24 * 60 * 60 * 1000;
const MIB = 1024 * 1024;
const LIMITS = [512, 1024, 2048, 5120];
const MAX_TRACK_BYTES = 200 * MIB;

class AudioCache {
  constructor(userDataPath) {
    this.folder = path.join(userDataPath, 'audio-cache');
    this.indexFile = path.join(this.folder, 'index.json');
    this.entries = new Map();
    this.aliases = new Map();
    this.enabled = true;
    this.limitMiB = 1024;
    this.jobs = new Map();
    this.captureQueue = Promise.resolve();
    this.pendingSave = Promise.resolve();
  }
  key(trackId, quality) { return createHash('sha256').update(`${trackId}\0${quality}`).digest('hex'); }
  file(key) { return path.join(this.folder, `${key}.bin`); }
  async load() {
    await fs.mkdir(this.folder, { recursive: true });
    try {
      const data = JSON.parse(await fs.readFile(this.indexFile, 'utf8'));
      this.enabled = data.enabled !== false;
      this.limitMiB = LIMITS.includes(data.limitMiB) ? data.limitMiB : 1024;
      for (const entry of Array.isArray(data.entries) ? data.entries : []) {
        if (!/^[a-f0-9]{64}$/.test(entry.key) || !Number.isSafeInteger(entry.size) || entry.size <= 0) continue;
        try {
          const stat = await fs.stat(this.file(entry.key));
          if (stat.isFile() && stat.size === entry.size) this.entries.set(entry.key, entry);
        } catch {}
      }
      for (const [alias, target] of Object.entries(data.aliases || {})) {
        if (/^[a-f0-9]{64}$/.test(alias) && this.entries.has(target)) this.aliases.set(alias, target);
      }
    } catch {}
    await this.prune();
    const files = await fs.readdir(this.folder).catch(() => []);
    await Promise.all(files.filter(name => (/^[a-f0-9]{64}\.bin$/.test(name) && !this.entries.has(name.slice(0, 64))) || /^[a-f0-9]{64}\.[a-f0-9-]+\.part$/.test(name)).map(name => fs.rm(path.join(this.folder, name), { force: true }).catch(() => {})));
    return this.stats();
  }
  stats() {
    return { enabled: this.enabled, limitMiB: this.limitMiB, usedBytes: [...this.entries.values()].reduce((sum, entry) => sum + entry.size, 0), trackCount: this.entries.size };
  }
  async save() {
    this.pendingSave = this.pendingSave.catch(() => {}).then(async () => {
      const temporary = `${this.indexFile}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({ enabled: this.enabled, limitMiB: this.limitMiB, entries: [...this.entries.values()], aliases: Object.fromEntries(this.aliases) }), 'utf8');
      await fs.rename(temporary, this.indexFile);
    });
    await this.pendingSave;
  }
  async find(trackId, quality) {
    const requested = this.key(trackId, quality);
    const key = this.aliases.get(requested) || requested;
    const entry = this.entries.get(key);
    if (!entry) return null;
    try {
      const stat = await fs.stat(this.file(key));
      if (stat.isFile() && stat.size === entry.size) {
        entry.lastAccess = Date.now();
        void this.save().catch(() => {});
        return { key, path: this.file(key), contentType: entry.contentType };
      }
    } catch {}
    this.entries.delete(key);
    for (const [alias, target] of this.aliases) if (target === key) this.aliases.delete(alias);
    void this.save().catch(() => {});
    return null;
  }
  async byKey(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) return null;
    const entry = this.entries.get(key);
    if (!entry) return null;
    try {
      const stat = await fs.stat(this.file(key));
      if (stat.isFile() && stat.size === entry.size) return { path: this.file(key), contentType: entry.contentType };
    } catch {}
    return null;
  }
  async configure(options) {
    if (typeof options?.enabled === 'boolean') this.enabled = options.enabled;
    if (LIMITS.includes(options?.limitMiB)) this.limitMiB = options.limitMiB;
    await this.prune();
    await this.save();
    return this.stats();
  }
  async link(trackId, quality, existingKey) {
    if (!this.entries.has(existingKey)) return;
    this.aliases.set(this.key(trackId, quality), existingKey);
    await this.save();
  }
  async clear() {
    for (const controller of this.jobs.values()) controller.abort();
    this.entries.clear();
    this.aliases.clear();
    const files = await fs.readdir(this.folder).catch(() => []);
    await Promise.all(files.filter(name => /^[a-f0-9]{64}\.bin$/.test(name) || /^[a-f0-9]{64}\.[a-f0-9-]+\.part$/.test(name)).map(name => fs.rm(path.join(this.folder, name), { force: true }).catch(() => {})));
    await this.save();
    return this.stats();
  }
  async prune() {
    const now = Date.now();
    let used = this.stats().usedBytes;
    const candidates = [...this.entries.values()].sort((a, b) => (a.lastAccess || a.cachedAt || 0) - (b.lastAccess || b.cachedAt || 0));
    for (const entry of candidates) {
      if (now - (entry.lastAccess || entry.cachedAt || 0) <= 30 * DAY && used <= this.limitMiB * MIB) continue;
      this.entries.delete(entry.key);
      for (const [alias, target] of this.aliases) if (target === entry.key) this.aliases.delete(alias);
      used -= entry.size;
      await fs.rm(this.file(entry.key), { force: true }).catch(() => {});
    }
    await this.save();
  }
  schedule(trackId, quality, fetchAudio) {
    if (!this.enabled || !trackId) return;
    const key = this.key(trackId, quality);
    if (this.entries.has(key) || this.jobs.has(key)) return;
    const controller = new AbortController();
    this.jobs.set(key, controller);
    const job = this.captureQueue.catch(() => {}).then(() => controller.signal.aborted ? undefined : this.capture(key, quality, fetchAudio, controller)).catch(() => {}).finally(() => this.jobs.delete(key));
    this.captureQueue = job;
  }
  async capture(key, quality, fetchAudio, controller) {
    const temporary = path.join(this.folder, `${key}.${randomUUID()}.part`);
    let handle;
    try {
      const response = await fetchAudio(controller.signal);
      if (response.status !== 200 || !response.body) return;
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (/text\/(html|plain)|json|mpegurl|dash\+xml/i.test(contentType)) return;
      if (contentType && !/^audio\/|^application\/(octet-stream|binary)$/.test(contentType)) return;
      const declared = Number(response.headers.get('content-length')) || 0;
      if (declared > MAX_TRACK_BYTES) return;
      const reader = response.body.getReader();
      handle = await fs.open(temporary, 'w');
      let size = 0;
      let firstBytes;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (controller.signal.aborted) return;
        if (!firstBytes) firstBytes = value.subarray(0, 64);
        size += value.byteLength;
        if (size > MAX_TRACK_BYTES) return;
        await handle.write(value);
      }
      if (size < 1024 || (declared && size !== declared) || controller.signal.aborted || /^[\s\u0000]*[<{[]/.test(Buffer.from(firstBytes || []).toString('utf8'))) return;
      await handle.close(); handle = null;
      await fs.rename(temporary, this.file(key));
      const now = Date.now();
      this.entries.set(key, { key, quality, size, contentType: contentType || 'application/octet-stream', cachedAt: now, lastAccess: now });
      await this.prune();
    } finally {
      await handle?.close().catch(() => {});
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }
}

module.exports = { AudioCache };
