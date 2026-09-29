const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const EXTENSIONS = new Set(['mp3', 'flac', 'm4a', 'wav', 'ogg', 'opus', 'aac']);

class DownloadManager {
  constructor(sourceManager, userDataPath, broadcast) {
    this.sources = sourceManager;
    this.folder = path.join(userDataPath, 'downloads');
    this.file = path.join(this.folder, 'tasks.json');
    this.broadcast = broadcast;
    this.tasks = [];
    this.controllers = new Map();
    this.saveTimer = null;
  }
  async load() {
    await fs.mkdir(this.folder, { recursive: true });
    try { const data = JSON.parse(await fs.readFile(this.file, 'utf8')); this.tasks = Array.isArray(data) ? data.filter(task => task?.id && task?.track?.id) : []; } catch { this.tasks = []; }
    for (const task of this.tasks) {
      if (['queued', 'resolving', 'downloading'].includes(task.status)) { task.status = 'queued'; void this.run(task); }
      if (task.status === 'completed' && !(await this.offlinePath(task.track.id))) task.status = 'failed';
    }
    this.changed(); return this.list();
  }
  list() { return this.tasks.map(({ id, track, quality, status, received, total, error }) => ({ id, track, quality, status, received, total, error })); }
  changed() {
    this.broadcast('downloads:changed', this.list());
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.save().catch(() => {}); }, 350);
  }
  async save() { await fs.mkdir(this.folder, { recursive: true }); const temp = `${this.file}.${randomUUID()}.tmp`; await fs.writeFile(temp, JSON.stringify(this.tasks), 'utf8'); await fs.rename(temp, this.file); }
  async offlinePath(trackId) {
    const task = this.tasks.find(item => item.track.id === trackId && item.status === 'completed');
    if (!task?.file) return null;
    try { const stat = await fs.stat(task.file); return stat.isFile() ? task.file : null; } catch { return null; }
  }
  async enqueue(track, quality = 'high') {
    if (track?.source !== 'custom' || !track.providerId || !track.remoteId || !track.id) throw new Error('这首歌不能通过音乐源下载');
    const record = this.sources.record(track.providerId);
    if (!record.manifest.capabilities.includes('resolveDownload')) throw new Error('这个音乐源未提供下载');
    const id = createHash('sha256').update(`${track.providerId}\0${track.remoteId}\0${quality}`).digest('hex').slice(0, 32);
    let task = this.tasks.find(item => item.id === id);
    if (!task) {
      task = { id, track: { id: track.id, source: 'custom', providerId: track.providerId, remoteId: track.remoteId, title: track.title, artist: track.artist, duration: track.duration, coverUrl: track.coverUrl }, quality, status: 'queued', received: 0, total: 0, error: '', file: '', part: path.join(this.folder, `${id}.part`) };
      this.tasks.unshift(task);
    } else if (task.status === 'failed' || task.status === 'paused') { task.status = 'queued'; task.error = ''; }
    this.changed(); if (task.status === 'queued') void this.run(task);
    return this.list();
  }
  async pause(id) {
    const task = this.tasks.find(item => item.id === id); if (!task) return this.list();
    task.status = 'paused'; this.controllers.get(id)?.abort(); this.changed(); return this.list();
  }
  async resume(id) {
    const task = this.tasks.find(item => item.id === id); if (!task || !['paused', 'failed'].includes(task.status)) return this.list();
    task.status = 'queued'; task.error = ''; this.changed(); void this.run(task); return this.list();
  }
  async run(task) {
    if (this.controllers.has(task.id) || task.status !== 'queued') return;
    const controller = new AbortController(); this.controllers.set(task.id, controller);
    let fileHandle;
    try {
      task.status = 'resolving'; this.changed();
      const info = await this.sources.downloadInfo(task.track, task.quality);
      if (task.status === 'paused') return;
      let offset = 0;
      try { offset = (await fs.stat(task.part)).size; } catch {}
      let response = await this.sources.fetchDownload(info, offset ? `bytes=${offset}-` : null, controller.signal);
      if (offset && response.status === 206 && !response.headers.get('content-range')?.startsWith(`bytes ${offset}-`)) throw new Error('下载续传位置无效');
      if (offset && response.status === 200) offset = 0;
      if (![200, 206].includes(response.status)) throw new Error(`下载失败：HTTP ${response.status}`);
      const contentType = response.headers.get('content-type') || '';
      if (/text\/html|application\/json/i.test(contentType)) throw new Error('音乐源返回的不是音频文件');
      const detected = /audio\/mpeg/i.test(contentType) ? 'mp3' : /audio\/(?:mp4|x-m4a)/i.test(contentType) ? 'm4a' : /audio\/(?:flac|x-flac)/i.test(contentType) ? 'flac' : /audio\/(?:wav|x-wav)/i.test(contentType) ? 'wav' : /audio\/ogg/i.test(contentType) ? 'ogg' : '';
      const format = String(info.format || detected || path.extname(new URL(info.url).pathname).slice(1)).toLowerCase().replace(/^\./, '');
      if (!EXTENSIONS.has(format)) throw new Error('音乐源返回了不支持的音频格式');
      const contentLength = Number(response.headers.get('content-length')) || 0;
      task.total = contentLength ? offset + contentLength : Number(info.size) || 0;
      task.received = offset; task.status = 'downloading'; this.changed();
      fileHandle = await fs.open(task.part, offset ? 'a' : 'w');
      const reader = response.body?.getReader(); if (!reader) throw new Error('下载响应没有音频内容');
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        if (controller.signal.aborted) throw new Error('下载已暂停');
        await fileHandle.write(value); task.received += value.byteLength;
        if (task.received > 1024 * 1024 * 1024 * 4) throw new Error('音频文件超过 4 GB');
        this.changed();
      }
      await fileHandle.close(); fileHandle = null;
      if (task.total && task.received !== task.total) throw new Error('下载未完成，请重试');
      const target = path.join(this.folder, `${task.id}.${format}`);
      await fs.rename(task.part, target); task.file = target; task.status = 'completed'; task.error = ''; this.changed();
    } catch (error) {
      if (task.status !== 'paused') { task.status = 'failed'; task.error = error instanceof Error ? error.message : String(error); this.changed(); }
    } finally { await fileHandle?.close().catch(() => {}); this.controllers.delete(task.id); if (task.status === 'queued') void this.run(task); }
  }
}

module.exports = { DownloadManager };
