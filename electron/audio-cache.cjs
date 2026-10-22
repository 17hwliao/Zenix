const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { captureBody, audioHeader } = require('./runtime/audio-capture.cjs');

const DAY = 24 * 60 * 60 * 1000;
const MIB = 1024 * 1024;
const LIMITS = [512, 1024, 2048, 5120];
const MAX_TRACK_BYTES = 200 * MIB;

function safeRecording(value) {
  if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 32768 || typeof value.providerId !== 'string' || !value.providerId || value.providerId.length > 240 || typeof value.remoteId !== 'string' || !value.remoteId || value.remoteId.length > 32768) return undefined;
  const duration = Number(value.duration);
  return { id: value.id, source: 'custom', providerId: value.providerId, remoteId: value.remoteId, title: String(value.title || '').slice(0, 300), artist: String(value.artist || '').slice(0, 300), album: String(value.album || '').slice(0, 300), duration: Number.isFinite(duration) ? Math.max(0, Math.min(86400, duration)) : 0, ...(value.actualQuality ? { actualQuality: String(value.actualQuality).slice(0, 40) } : {}) };
}

class AudioCache {
  constructor(userDataPath) {
    this.folder = path.join(userDataPath, 'audio-cache');
    this.indexFile = path.join(this.folder, 'index.json');
    this.entries = new Map();
    this.aliases = new Map();
    this.pins = new Map();
    this.enabled = true;
    this.limitMiB = 1024;
    this.jobs = new Map();
    this.discarding = new Set();
    this.captureQueue = Promise.resolve();
    this.pendingSave = Promise.resolve();
    this.fileQueue = Promise.resolve();
  }
  key(trackId, quality) { return createHash('sha256').update(`${trackId}\0${quality}`).digest('hex'); }
  file(key) { return path.join(this.folder, `${key}.bin`); }
  async load() {
    await fs.mkdir(this.folder, { recursive: true });
    try {
      const indexStat = await fs.stat(this.indexFile);
      if (indexStat.size > 16 * MIB) throw Error('音频缓存索引过大');
      const data = JSON.parse(await fs.readFile(this.indexFile, 'utf8'));
      if (!data || !Array.isArray(data.entries) || data.entries.length > 50000 || data.pins && (typeof data.pins !== 'object' || Array.isArray(data.pins)) || data.aliases && (typeof data.aliases !== 'object' || Array.isArray(data.aliases))) throw Error('音频缓存索引格式无效');
      if (data.entries.some(entry => !entry || !/^[a-f0-9]{64}$/.test(entry.key) || !Number.isSafeInteger(entry.size) || entry.size <= 0)) throw Error('音频缓存记录格式无效');
      this.enabled = data.enabled !== false;
      this.limitMiB = LIMITS.includes(data.limitMiB) ? data.limitMiB : 1024;
      for (const [key, groups] of Object.entries(data.pins || {})) if (/^[a-f0-9]{64}$/.test(key) && Array.isArray(groups)) this.pins.set(key, groups.filter(value => typeof value === 'string').map(value => value.slice(0, 80)).slice(0, 20));
      for (const entry of Array.isArray(data.entries) ? data.entries : []) {
        if (!/^[a-f0-9]{64}$/.test(entry.key) || !Number.isSafeInteger(entry.size) || entry.size <= 0) continue;
        try {
          const stat = await fs.stat(this.file(entry.key));
          if (stat.isFile() && stat.size === entry.size) this.entries.set(entry.key, { ...entry, recording: safeRecording(entry.recording) });
        } catch {}
      }
      for (const [alias, target] of Object.entries(data.aliases || {})) {
        if (/^[a-f0-9]{64}$/.test(alias) && this.entries.has(target)) this.aliases.set(alias, target);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') { this.readOnly = true; this.cacheError = '音频缓存索引无法读取，原索引和音频文件已保留，暂停缓存写入；在线播放仍可使用'; return this.stats(); }
      const existing = await fs.readdir(this.folder);
      if (existing.some(name => /^[a-f0-9]{64}\.bin$/.test(name))) { this.readOnly = true; this.cacheError = '音频缓存索引缺失，已有音频文件已保留，暂停缓存写入；在线播放仍可使用'; return this.stats(); }
    }
    await this.prune();
    const files = await fs.readdir(this.folder).catch(() => []);
    await Promise.all(files.filter(name => (/^[a-f0-9]{64}\.bin$/.test(name) && !this.entries.has(name.slice(0, 64))) || /^[a-f0-9]{64}\.[a-f0-9-]+\.part$/.test(name)).map(name => fs.rm(path.join(this.folder, name), { force: true }).catch(() => {})));
    return this.stats();
  }
  stats() {
    return { enabled: this.enabled, writable: !this.readOnly, error: this.cacheError || '', limitMiB: this.limitMiB, usedBytes: [...this.entries.values()].reduce((sum, entry) => sum + entry.size, 0), trackCount: this.entries.size, pinnedCount: [...this.entries.keys()].filter(key => this.isPinned(key)).length };
  }
  ensureWritable() { if (this.readOnly) throw Error(this.cacheError); }
  mutateFiles(operation) { const result = this.fileQueue.catch(() => {}).then(operation); this.fileQueue = result.catch(() => {}); return result; }
  async save() {
    this.ensureWritable();
    this.pendingSave = this.pendingSave.catch(() => {}).then(async () => {
      const temporary = `${this.indexFile}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify({ enabled: this.enabled, limitMiB: this.limitMiB, entries: [...this.entries.values()], aliases: Object.fromEntries(this.aliases), pins: Object.fromEntries(this.pins) }), 'utf8');
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
        if (Date.now() - (entry.lastAccess || 0) > 30000) {
          entry.lastAccess = Date.now();
          clearTimeout(this.touchTimer);
          this.touchTimer = setTimeout(() => { void this.save().catch(() => {}); }, 1000);
          this.touchTimer.unref();
        }
        return { key, path: this.file(key), contentType: entry.contentType, recording: entry.recording };
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
  async discard(trackId, quality) {
    this.ensureWritable();
    const requested = this.key(trackId, quality), key = this.aliases.get(requested) || requested;
    if (!this.entries.has(key)) return;
    this.discarding.add(key);
    try { await this.mutateFiles(async () => { this.entries.delete(key); for (const [alias, target] of this.aliases) if (target === key) this.aliases.delete(alias); await fs.rm(this.file(key), { force: true }).catch(() => {}); await this.save().catch(() => {}); }); }
    finally { this.discarding.delete(key); }
  }
  async configure(options) {
    this.ensureWritable();
    if (typeof options?.enabled === 'boolean') this.enabled = options.enabled;
    if (LIMITS.includes(options?.limitMiB)) this.limitMiB = options.limitMiB;
    if (!this.enabled) for (const controller of this.jobs.values()) controller.abort();
    await this.prune();
    await this.save();
    return this.stats();
  }
  isPinned(key) {
    if (this.pins.get(key)?.length) return true;
    for (const [alias, target] of this.aliases) if (target === key && this.pins.get(alias)?.length) return true;
    return false;
  }
  async pin(trackId, quality, group = '手动保留', keep = true) {
    this.ensureWritable();
    if (typeof trackId !== 'string' || !trackId || trackId.length > 2000) throw Error('歌曲标识无效');
    group = String(group || '手动保留').trim().slice(0, 80);
    const key = this.key(trackId, quality), groups = new Set(this.pins.get(key) || []);
    if (keep) { if (!this.pins.has(key) && this.pins.size >= 20000) throw Error('固定缓存数量过多'); groups.add(group); }
    else groups.delete(group);
    if (groups.size) this.pins.set(key, [...groups].slice(0, 20)); else this.pins.delete(key);
    await this.prune(); return this.stats();
  }
  async makeRoom(size, key) {
    const limit = this.limitMiB * MIB;
    const pinned = [...this.entries.values()].filter(entry => entry.key !== key && this.isPinned(entry.key)).reduce((sum, entry) => sum + entry.size, 0);
    if (size > limit || pinned + size > limit) throw Error('固定缓存已占满可用空间，请释放固定内容或增加缓存上限');
  }
  async link(trackId, quality, existingKey) {
    this.ensureWritable();
    if (!this.entries.has(existingKey)) return;
    this.aliases.set(this.key(trackId, quality), existingKey);
    await this.save();
  }
  async clear(options = {}) {
    this.ensureWritable();
    if (this.clearing) throw Error('缓存正在清理');
    this.clearing = true;
    for (const controller of this.jobs.values()) controller.abort();
    try { return await this.mutateFiles(async () => {
    const keep = new Set(options.includePinned === true ? [] : [...this.entries.keys()].filter(key => this.isPinned(key)));
    for (const key of this.entries.keys()) if (!keep.has(key)) this.entries.delete(key);
    for (const [alias, target] of this.aliases) if (!keep.has(target)) this.aliases.delete(alias);
    if (options.includePinned === true) this.pins.clear();
    const files = await fs.readdir(this.folder).catch(() => []);
    await Promise.all(files.filter(name => /^[a-f0-9]{64}\.bin$/.test(name) && !keep.has(name.slice(0, 64)) || /^[a-f0-9]{64}\.[a-f0-9-]+\.part$/.test(name)).map(name => fs.rm(path.join(this.folder, name), { force: true }).catch(() => {})));
    await this.save();
    return this.stats();
    }); } finally { this.clearing = false; }
  }
  async prune() {
    this.ensureWritable();
    return this.mutateFiles(() => this.pruneUnlocked());
  }
  async pruneUnlocked() {
    const now = Date.now();
    let used = this.stats().usedBytes;
    const candidates = [...this.entries.values()].sort((a, b) => (a.lastAccess || a.cachedAt || 0) - (b.lastAccess || b.cachedAt || 0));
    for (const entry of candidates) {
      if (this.isPinned(entry.key)) continue;
      if (now - (entry.lastAccess || entry.cachedAt || 0) <= 30 * DAY && used <= this.limitMiB * MIB) continue;
      this.entries.delete(entry.key);
      for (const [alias, target] of this.aliases) if (target === entry.key) this.aliases.delete(alias);
      used -= entry.size;
      await fs.rm(this.file(entry.key), { force: true }).catch(() => {});
    }
    await this.save();
  }
  captureResponse(trackId, quality, response, fetchAudio, recording) {
    if (this.clearing || this.readOnly || !this.enabled || !response.body || !trackId) return response.body;
    const key = this.key(trackId, quality);
    if (this.entries.has(this.aliases.get(key) || key) || this.jobs.has(key) || this.discarding.has(key)) return response.body;
    const range = (response.headers.get('content-range') || '').match(/^bytes 0-(\d+)\/(\d+)$/);
    const expected = response.status === 200 ? Number(response.headers.get('content-length')) : range && Number(range[1]) + 1 === Number(range[2]) ? Number(range[2]) : 0;
    const contentType = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    if (!expected || expected > MAX_TRACK_BYTES || !/^audio\/|^application\/(octet-stream|binary)$/.test(contentType)) return response.body;
    const temporary = path.join(this.folder, `${key}.${randomUUID()}.part`);
    recording = safeRecording(recording);
    const controller = new AbortController(); controller.recording = recording; this.jobs.set(key, controller);
    let interrupted = false;
    return captureBody(response.body, {
      temporary, expected, signal: controller.signal,
      commit: async size => {
        await this.mutateFiles(async () => {
        if (this.clearing || !this.enabled || controller.signal.aborted) return;
        try { await this.makeRoom(size, key); } catch { return; }
        await fs.rename(temporary, this.file(key));
        if (controller.signal.aborted || !this.enabled) { await fs.rm(this.file(key), { force: true }).catch(() => {}); return; }
        const now = Date.now(); this.entries.set(key, { key, quality, size, contentType, cachedAt: now, lastAccess: now, ...(recording ? { recording } : {}) });
        await this.pruneUnlocked();
        });
      },
      partial: () => { interrupted = true; },
      finished: () => {
        if (this.jobs.get(key) === controller) this.jobs.delete(key);
        // Metadata-only ranges can be cancelled by Chromium; complete the cache later,
        // after startup, so a second download does not compete with the first audio.
        if (interrupted && this.enabled && !controller.signal.aborted && (!this.backgroundAllowed || this.backgroundAllowed())) this.schedule(trackId, quality, fetchAudio, 6000, recording);
      },
    });
  }
  schedule(trackId, quality, fetchAudio, delay = 0, recording) {
    if (this.clearing || this.readOnly || !this.enabled || !trackId || this.backgroundAllowed && !this.backgroundAllowed()) return;
    const key = this.key(trackId, quality);
    if (this.entries.has(this.aliases.get(key) || key) || this.jobs.has(key) || this.discarding.has(key) || this.jobs.size >= 2) return;
    const controller = new AbortController();
    controller.recording = safeRecording(recording);
    this.jobs.set(key, controller);
    const job = this.captureQueue.catch(() => {}).then(async () => {
      if (delay && !controller.signal.aborted) await new Promise(resolve => {
        const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve(); };
        const timer = setTimeout(finish, delay); timer.unref(); controller.signal.addEventListener('abort', finish, { once: true });
      });
      if (!controller.signal.aborted) await this.capture(key, quality, fetchAudio, controller, undefined, recording);
    }).catch(() => {}).finally(() => { if (this.jobs.get(key) === controller) this.jobs.delete(key); });
    this.captureQueue = job;
  }
  async capture(key, quality, fetchAudio, controller, progress, recording) {
    this.ensureWritable();
    recording = safeRecording(recording);
    const temporary = path.join(this.folder, `${key}.${randomUUID()}.part`);
    let handle, reader, response;
    try {
      response = await fetchAudio(controller.signal);
      if (response.status !== 200 || !response.body) return;
      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (/text\/(html|plain)|json|mpegurl|dash\+xml/i.test(contentType)) return;
      if (contentType && !/^audio\/|^application\/(octet-stream|binary)$/.test(contentType)) return;
      const declared = Number(response.headers.get('content-length')) || 0;
      if (declared > MAX_TRACK_BYTES) return;
      reader = response.body.getReader();
      handle = await fs.open(temporary, 'w');
      let size = 0;
      let firstBytes;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (controller.signal.aborted) return;
        if (!firstBytes || firstBytes.length < 64) firstBytes = Buffer.concat([firstBytes || Buffer.alloc(0), Buffer.from(value.subarray(0, 64 - (firstBytes?.length || 0)))]);
        size += value.byteLength;
        progress?.(size, declared);
        if (size > MAX_TRACK_BYTES) return;
        let offset = 0;
        while (offset < value.byteLength) {
          const written = await handle.write(value, offset, value.byteLength - offset);
          if (!written.bytesWritten) throw new Error('缓存写入未完成');
          offset += written.bytesWritten;
        }
      }
      if (size < 1024 || (declared && size !== declared) || controller.signal.aborted || !audioHeader(firstBytes)) return;
      await handle.close(); handle = null;
      await this.mutateFiles(async () => {
      if (this.clearing || controller.signal.aborted || !this.enabled) return;
      await this.makeRoom(size, key);
      await fs.rename(temporary, this.file(key));
      if (controller.signal.aborted || !this.enabled) { await fs.rm(this.file(key), { force: true }).catch(() => {}); return; }
      const now = Date.now();
      this.entries.set(key, { key, quality, size, contentType: contentType || 'application/octet-stream', cachedAt: now, lastAccess: now, ...(recording ? { recording } : {}) });
      await this.pruneUnlocked();
      });
    } finally {
      await reader?.cancel().catch(() => {});
      if (!reader) await response?.body?.cancel().catch(() => {});
      await handle?.close().catch(() => {});
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  }
  async prepare(trackId, quality, fetchAudio, signal, progress, recording) {
    this.ensureWritable();
    if (this.clearing) throw Error('缓存正在清理');
    signal?.throwIfAborted();
    if (!this.enabled) throw Error('请先开启音频缓存');
    const key = this.key(trackId, quality);
    while (this.jobs.has(key)) {
      signal?.throwIfAborted();
      await new Promise(resolve => { const timer = setTimeout(done, 100); function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); } signal?.addEventListener('abort', done, { once: true }); });
    }
    if (this.clearing) throw Error('缓存正在清理');
    const controller = new AbortController(), cancel = () => controller.abort();
    controller.recording = safeRecording(recording);
    signal?.addEventListener('abort', cancel, { once: true });
    this.jobs.set(key, controller);
    try {
      signal?.throwIfAborted();
      if (await this.find(trackId, quality)) return;
      await this.capture(key, quality, fetchAudio, controller, progress, recording);
      signal?.throwIfAborted();
      if (!await this.find(trackId, quality)) throw Error('未取得完整可识别音频，请重试或更换来源');
    } finally { signal?.removeEventListener('abort', cancel); if (this.jobs.get(key) === controller) this.jobs.delete(key); }
  }
}

module.exports = { AudioCache, safeRecording };
