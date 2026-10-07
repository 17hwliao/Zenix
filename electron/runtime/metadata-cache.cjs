const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const DAY = 86400000;
class MetadataCache {
  constructor(root) { this.root = root; this.limit = 64 * 1024 * 1024; this.pending = Promise.resolve(); this.timer = null; this.epoch = 0; this.writeEnabled = true; this.error = ''; this.nextRetryAt = 0; }
  async probeWritable() {
    for (const folder of ['covers', 'lyrics']) {
      const directory = path.join(this.root, folder); await fs.mkdir(directory, { recursive: true });
      const file = path.join(directory, `.probe-${randomUUID()}`);
      try { await fs.writeFile(file, 'zenix', { flag: 'wx' }); } finally { await fs.rm(file, { force: true }); }
    }
  }
  async files() {
    const groups = await Promise.all(['covers', 'lyrics'].map(async folder => {
      const directory = path.join(this.root, folder);
      const names = await fs.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      const result = [];
      for (const name of names.filter(name => /^[a-f0-9]{64}\.(bin|type|json)$/.test(name))) {
        const file = path.join(directory, name); const stat = await fs.stat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (stat?.isFile()) result.push({ file, size: stat.size, at: stat.mtimeMs });
      }
      return result;
    }));
    return groups.flat().filter(Boolean);
  }
  async prune({ bestEffort = false } = {}) {
    const task = this.pending.catch(() => {}).then(async () => {
      const files = (await this.files()).sort((a, b) => a.at - b.at); let used = files.reduce((sum, file) => sum + file.size, 0);
      for (const file of files) if (used > this.limit || Date.now() - file.at > 30 * DAY) { await fs.rm(file.file, { force: true }); used -= file.size; }
      if (!this.writeEnabled) await this.probeWritable();
    }).then(() => { this.writeEnabled = true; this.error = ''; this.nextRetryAt = 0; }, error => {
      this.writeEnabled = false; this.error = '封面与歌词缓存无法清理，已暂停写入';
      this.nextRetryAt = Date.now() + 30000;
      if (!bestEffort) throw error;
    }); this.pending = task; return task;
  }
  schedule() { if (this.timer) return; this.timer = setTimeout(() => { this.timer = null; void this.prune().catch(() => {}); }, Math.max(300, this.nextRetryAt - Date.now())); this.timer.unref(); }
  failWrite() { this.writeEnabled = false; this.error = '封面与歌词缓存无法保存，已暂停写入'; this.nextRetryAt = Date.now() + 30000; }
  async clear() { this.epoch++; clearTimeout(this.timer); this.timer = null; const task = this.pending.catch(() => {}).then(async () => { for (const file of await this.files()) await fs.rm(file.file, { force: true }); await this.probeWritable(); }).then(() => { this.writeEnabled = true; this.error = ''; this.nextRetryAt = 0; }, error => { this.writeEnabled = false; this.error = '封面与歌词缓存无法清理，已暂停写入'; this.nextRetryAt = Date.now() + 30000; throw error; }); this.pending = task; return task; }
  async stats() { const files = await this.files().catch(() => { this.writeEnabled = false; this.error = '封面与歌词缓存无法读取，已暂停写入'; return []; }); return { metadataBytes: files.reduce((sum, file) => sum + file.size, 0), metadataLimitMiB: Math.round(this.limit / 1024 / 1024), metadataError: this.error }; }
}
module.exports = { MetadataCache };
