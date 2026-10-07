const { BrowserWindow } = require('electron');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { lxScriptInfo } = require('./source-metadata.cjs');
const boundedText = (value, max = 200) => String(value ?? '').trim().slice(0,max);

class SourceRunner {
  constructor(manager, record, key = record.id) { this.manager = manager; this.record = record; this.key = key; this.window = null; this.pending = new Map(); this.ready = null; this.idleTimer = null; this.leases = 0; this.networkRequests = new Set(); this.starting = false; }
  async network(operation) {
    if (this.destroyed) throw new Error('音乐源已取消');
    if (this.networkRequests.size >= 8) throw new Error('音乐源请求并发过多');
    const controller = new AbortController(); this.networkRequests.add(controller);
    try { return await operation(controller.signal); }
    finally { this.networkRequests.delete(controller); }
  }
  acquire() { this.leases += 1; clearTimeout(this.idleTimer); }
  release() {
    this.leases = Math.max(0, this.leases - 1);
    if (this.leases || this.pending.size) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (!this.leases && !this.pending.size) this.destroy(); }, 20000);
    this.idleTimer.unref();
  }
  async start(script) {
    if (this.destroyed) throw new Error("音乐源已取消");
    if (this.window) return this.ready;
    this.starting = true;
    if (this.record.kind === 'lx') this.scriptInfo = lxScriptInfo(script);
    this.window = new BrowserWindow({
      show: false, width: 1, height: 1, webPreferences: {
        preload: path.join(__dirname, '..', this.record.kind === 'lx' ? 'lx-source-preload.cjs' : 'source-preload.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        partition: `zenix-source-${createHash('sha256').update(this.record.id).digest('hex').slice(0, 16)}`,
      },
    });
    const contents = this.window.webContents;
    const contentsId = contents.id;
    this.manager.byContents.set(contents.id, this);
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault());
    this.window.on('closed', () => {
      clearTimeout(this.idleTimer);
      this.rejectReady?.(new Error("音乐源已关闭"));
      this.manager.byContents.delete(contentsId);
      for (const pending of this.pending.values()) pending.reject(new Error('音乐源已关闭'));
      this.pending.clear(); this.window = null;
      if (this.manager.runners.get(this.key) === this) this.manager.runners.delete(this.key);
    });
    let resolveReady; let rejectReady;
    this.ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // Cancellation may happen while loadURL is still pending.
    void this.ready.catch(() => {});
    this.rejectReady = rejectReady;
    this.onRegistered = data => {
      if (this.record.kind === 'lx') this.lxInfo = data;
      resolveReady();
    };
    const timer = setTimeout(() => rejectReady(new Error('音乐源初始化超时')), this.record.kind === 'lx' ? 15000 : 6000);
    try {
      await this.window.loadURL('data:text/html;charset=utf-8,<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-eval\'; connect-src \'none\'; img-src \'none\'">');
      await Promise.race([contents.executeJavaScript(script), this.ready.then(() => undefined)]);
      await this.ready;
    } catch (error) { this.destroy(); throw error; }
    finally { clearTimeout(timer); this.starting = false; }
  }
  async invoke(method, payload, settings = {}) {
    if (this.destroyed || !this.window) throw new Error('音乐源尚未启动');
    if (this.pending.size >= 8) throw new Error('音乐源调用并发过多');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 请求超时`)); this.destroy(); }, method === 'search' ? 11000 : 15000);
      this.pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      this.window.webContents.send('source:invoke', { id, method, payload, settings });
    });
  }
  receive(message) {
    const pending = this.pending.get(message?.id);
    if (!pending) return;
    this.pending.delete(message.id);
    const scriptError = boundedText(message.error, 300);
    const reason = this.record.kind === 'lx' && (!scriptError || /^failed$/i.test(scriptError)) && this.lastHttpError ? this.lastHttpError : scriptError || '音乐源请求失败';
    message.ok ? pending.resolve(message.result) : pending.reject(new Error(reason));
  }
  destroy() {
    this.destroyed = true;
    this.rejectReady?.(new Error("音乐源已取消"));
    clearTimeout(this.idleTimer);
    for (const controller of this.networkRequests) controller.abort(); this.networkRequests.clear();
    if (this.manager.runners.get(this.key) === this) this.manager.runners.delete(this.key);
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
  }
}

module.exports = { SourceRunner };
