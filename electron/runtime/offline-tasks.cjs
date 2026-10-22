const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { safeRecording } = require('../audio-cache.cjs');

const CATEGORIES = ['audio', 'lyrics', 'artwork', 'preload'];
const MODES = ['always', 'unmetered', 'never'];
const ACTIVE = new Set(['queued', 'running', 'waiting']);
const text = (value, max = 150) => String(value || '').slice(0, max);
function song(value) {
  if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 2000) throw Error('歌曲标识无效');
  return { id: value.id, title: text(value.title), artist: text(value.artist), album: text(value.album), duration: Math.max(0, Number(value.duration) || 0), source: value.source === 'local' ? 'local' : 'custom', providerId: text(value.providerId, 100), remoteId: text(value.remoteId, 8000) };
}
function actualRecording(value) { return safeRecording(value); }
class NetworkPreferences {
  constructor() { this.policy = Object.fromEntries(CATEGORIES.map(key => [key, 'always'])); this.network = 'unknown'; }
  configure(value) { for (const key of CATEGORIES) if (MODES.includes(value?.[key])) this.policy[key] = value[key]; }
  allows(category) { const mode = this.policy[category] || 'always'; return mode !== 'never' && (mode !== 'unmetered' || this.network === 'unmetered'); }
  require(category) { if (!this.allows(category)) throw Error(`网络偏好限制了${category === 'audio' ? '音频播放' : category === 'lyrics' ? '歌词联网' : category === 'artwork' ? '封面联网' : '后台离线准备'}${this.network === 'unknown' ? '；当前网络计费状态未知' : ''}`); }
}
class OfflineTasks {
  constructor({ folder, sources, cache, network }) {
    this.file = path.join(folder, 'offline-tasks.json'); this.sources = sources; this.cache = cache;
    this.network = network || new NetworkPreferences(); this.tasks = []; this.writes = Promise.resolve();
    sources.networkPreferences = this.network; cache.backgroundAllowed = () => this.network.allows('preload');
  }
  async load() {
    try {
      const stat = await fs.stat(this.file); if (stat.size > 8 * 1024 * 1024) throw Error('后台任务资料过大');
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'));
      if (data.schema !== 1 || !Array.isArray(data.tasks)) throw Error('后台任务资料格式无效');
      this.network.configure(data.policy);
      this.tasks = data.tasks.slice(-20).map(task => ({ id: text(task.id, 80), name: text(task.name, 80), quality: ['standard', 'high', 'lossless', 'lossless24'].includes(task.quality) ? task.quality : 'high', group: text(task.group, 80), pin: task.pin === true, status: ACTIVE.has(task.status) ? 'paused' : task.status, createdAt: Number(task.createdAt) || Date.now(), items: (Array.isArray(task.items) ? task.items : []).slice(0, 2000).map(item => ({ track: song(item.track), status: item.status === 'running' ? 'pending' : item.status, received: Number(item.received) || 0, total: Number(item.total) || 0, error: text(item.error, 200), recording: actualRecording(item.recording) })) }));
    } catch (error) { if (error.code !== 'ENOENT') { this.readOnly = true; this.loadError = '后台任务资料无法读取，原文件已保留'; } }
    return this.state();
  }
  state() { return JSON.parse(JSON.stringify({ tasks: this.tasks, policy: this.network.policy, network: this.network.network, cache: this.cache.stats(), clearing: this.clearing === true, error: this.loadError || '' })); }
  async save() {
    if (this.readOnly) throw Error(this.loadError);
    const bytes = JSON.stringify({ schema: 1, policy: this.network.policy, tasks: this.tasks });
    if (Buffer.byteLength(bytes) > 8 * 1024 * 1024) throw Error('后台任务资料过大，请减少歌曲数量');
    this.writes = this.writes.catch(() => {}).then(async () => {
      if (this.readOnly) throw Error(this.loadError);
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try { await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(temporary, bytes, 'utf8'); await fs.rename(temporary, this.file); }
      catch (error) { this.readOnly = true; this.loadError = '后台任务无法保存，已暂停任务并保留原文件'; this.active?.controller.abort(); throw Error(this.loadError, { cause: error }); }
      finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    });
    return this.writes;
  }
  async invoke(args = {}) {
    if (args.action === 'state' || !args.action) return this.state();
    if (this.backupBarrier && args.backupRestore !== true) await this.backupBarrier;
    if (this.readOnly) throw Error(this.loadError);
    if (this.clearing && ['prepare', 'resume', 'retry', 'pin', 'unpin'].includes(args.action)) throw Error('缓存正在清理，请完成后再开始离线任务');
    if (args.action === 'policy') { const previous = { ...this.network.policy }; this.network.configure(args.policy); try { await this.save(); } catch (error) { this.network.policy = previous; throw error; } if (!this.network.allows('preload') || !this.network.allows('audio')) { const task = this.tasks.find(value => value.id === this.active?.id); if (task) task.status = 'waiting'; this.active?.controller.abort(); } this.pump(); return this.state(); }
    if (args.action === 'pin') { await this.cache.pin(args.trackId, args.quality || 'high', args.group, args.keep !== false); return this.state(); }
    if (args.action === 'prepare') {
      if (!this.cache.enabled) throw Error('请先在设置中开启音频缓存');
      if (!Array.isArray(args.tracks) || !args.tracks.length || args.tracks.length > 2000) throw Error('每次请选择 1 至 2000 首歌曲');
      const nextTasks = [...this.tasks];
      if (nextTasks.length >= 20) { const index = nextTasks.findIndex(task => ['complete', 'cancelled'].includes(task.status)); if (index < 0) throw Error('任务过多，请先取消不需要的任务'); nextTasks.splice(index, 1); }
      const seen = new Set(); const tracks = args.tracks.map(song).filter(track => !seen.has(track.id) && seen.add(track.id));
      const quality = ['standard', 'high', 'lossless', 'lossless24'].includes(args.quality) ? args.quality : 'high';
      const task = { id: randomUUID(), name: text(args.name || '离线收纳', 80), quality, group: text(args.group || args.name || '离线收纳', 80), pin: args.pin !== false, status: 'queued', createdAt: Date.now(), items: tracks.map(track => ({ track, status: 'pending', received: 0, total: 0 })) };
      if (Buffer.byteLength(JSON.stringify([...nextTasks, task])) > 8 * 1024 * 1024 - 1024) throw Error('后台任务资料过大，请减少歌曲数量');
      this.tasks = [...nextTasks, task];
    } else {
      const task = this.tasks.find(task => task.id === args.id); if (!task) throw Error('任务已不存在');
      if (args.action === 'unpin') { for (const item of task.items) if (item.track.source !== 'local') await this.cache.pin(item.track.id, task.quality, task.group, false); task.pin = false; }
      else if (args.action === 'pause' || args.action === 'cancel') { task.status = args.action === 'pause' ? 'paused' : 'cancelled'; if (this.active?.id === task.id) this.active.controller.abort(); }
      else if (args.action === 'resume' || args.action === 'retry') { if (this.active?.id === task.id) throw Error('任务正在结束，请稍后继续'); for (const item of task.items) if (item.status === 'running' || item.status === 'failed') { item.status = 'pending'; delete item.error; } task.status = 'queued'; }
      else throw Error('未知任务操作');
    }
    await this.save(); this.pump(); return this.state();
  }
  pump() { if (this.active || this.closed || this.readOnly || this.clearing) return; const task = this.tasks.find(value => ACTIVE.has(value.status)); if (!task) return;
    if (!this.network.allows('preload') || !this.network.allows('audio')) { task.status = 'waiting'; return; }
    const controller = new AbortController(); this.active = { id: task.id, controller };
    this.active.finished = this.run(task, controller.signal).catch(error => { task.status = 'paused'; task.error = text(error.message, 200); }).finally(async () => { this.active = undefined; await this.save().catch(() => {}); this.pump(); });
  }
  async run(task, signal) {
    task.status = 'running'; await this.save();
    for (const item of task.items) {
      if (signal.aborted) break;
      if (item.status === 'complete' || item.status === 'local') { if (item.status === 'local' || await this.cache.find(item.track.id, task.quality)) continue; item.status = 'pending'; }
      if (!['pending', 'running'].includes(item.status)) continue;
      if (item.track.source === 'local') { item.status = 'local'; await this.save(); continue; }
      try {
        item.status = 'running'; delete item.error;
        if (task.pin) await this.cache.pin(item.track.id, task.quality, task.group, true);
        const prepared = await this.sources.prepareOffline(item.track, task.quality, signal, (received, total) => { item.received = received; item.total = total; });
        item.recording = actualRecording(prepared?.recording);
        signal.throwIfAborted(); item.status = 'complete';
      } catch (error) { item.status = signal.aborted ? 'pending' : 'failed'; if (!signal.aborted) item.error = text(error.message, 200); }
      await this.save();
    }
    if (!signal.aborted) task.status = task.items.some(item => item.status === 'failed') ? 'failed' : 'complete';
  }
  async pauseForCacheClear() {
    this.clearing = true;
    for (const task of this.tasks) if (ACTIVE.has(task.status)) task.status = 'paused';
    const active = this.active; active?.controller.abort(); await active?.finished;
    if (!this.readOnly) await this.save();
  }
  endCacheClear() { this.clearing = false; }
  close() { this.closed = true; this.active?.controller.abort(); }
}
module.exports = { OfflineTasks, NetworkPreferences };
