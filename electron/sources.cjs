const { BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const CAPABILITIES = new Set(['search', 'resolvePlayback', 'lyrics', 'artwork', 'resolveDownload', 'playlistDetail', 'albumDetail', 'artistDetail', 'discover']);
const HOST = /^(?:\*\.)?[a-z0-9.-]+$/i;
const SOURCE_ID = /^[a-z0-9][a-z0-9._-]{2,79}$/i;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,39}$/i;
const MAX_PACKAGE = 512 * 1024;

function boundedText(value, max = 200) { return String(value ?? '').trim().slice(0, max); }
function matchesHost(host, pattern) { return pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) && host !== pattern.slice(2) : host === pattern; }

function validateManifest(raw) {
  if (!raw || raw.schemaVersion !== 1 || !SOURCE_ID.test(raw.id) || !VERSION.test(raw.version)) throw new Error('音乐源清单的 ID、版本或协议版本无效');
  const capabilities = [...new Set(Array.isArray(raw.capabilities) ? raw.capabilities : [])];
  if (!capabilities.length || capabilities.some(item => !CAPABILITIES.has(item))) throw new Error('音乐源能力声明无效');
  const network = {};
  for (const key of ['apiHosts', 'mediaHosts', 'artworkHosts']) {
    const hosts = raw.network?.[key];
    if (!Array.isArray(hosts) || hosts.length > 30 || hosts.some(host => typeof host !== 'string' || !HOST.test(host) || host.includes('..'))) throw new Error(`音乐源 ${key} 域名声明无效`);
    network[key] = [...new Set(hosts.map(host => host.toLowerCase()))];
  }
  if (capabilities.includes('search') && !network.apiHosts.length) throw new Error('可搜索的音乐源必须声明 API 域名');
  if ((capabilities.includes('resolvePlayback') || capabilities.includes('resolveDownload')) && !network.mediaHosts.length) throw new Error('可播放或下载的音乐源必须声明媒体域名');
  return {
    schemaVersion: 1, id: raw.id, name: boundedText(raw.name, 60) || raw.id,
    version: raw.version, entry: 'index.js', capabilities,
    qualities: [...new Set((Array.isArray(raw.qualities) ? raw.qualities : []).filter(value => typeof value === 'string').map(value => boundedText(value, 30)))].slice(0, 12),
    network,
    settings: (Array.isArray(raw.settings) ? raw.settings : []).filter(item => item && /^[a-z][a-z0-9_-]{0,39}$/i.test(item.key) && ['text', 'select'].includes(item.type)).slice(0, 20).map(item => ({
      key: item.key, label: boundedText(item.label, 50) || item.key, type: item.type,
      options: Array.isArray(item.options) ? item.options.map(option => boundedText(option, 80)).slice(0, 30) : [],
      default: boundedText(item.default, 200),
    })),
  };
}

function checkUrl(raw, patterns) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('音乐源返回了无效 URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('音乐源返回了不支持的 URL');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('远程音乐源只能使用 HTTPS');
  if (!patterns.some(pattern => matchesHost(url.hostname.toLowerCase(), pattern))) throw new Error(`音乐源未授权访问 ${url.hostname}`);
  return url;
}

async function fetchAllowed(raw, patterns, options = {}) {
  let url = checkUrl(raw, patterns);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(url, { ...options, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    url = checkUrl(new URL(location, url).href, patterns);
  }
  throw new Error('音乐源重定向次数过多');
}

async function readLimited(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('音乐源响应过大');
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error('音乐源响应过大');
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

class SourceRunner {
  constructor(manager, record) { this.manager = manager; this.record = record; this.window = null; this.pending = new Map(); this.ready = null; }
  async start(script) {
    if (this.window) return this.ready;
    this.window = new BrowserWindow({
      show: false, width: 1, height: 1, webPreferences: {
        preload: path.join(__dirname, 'source-preload.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        partition: `zenix-source-${createHash('sha256').update(this.record.id).digest('hex').slice(0, 16)}`,
      },
    });
    const contents = this.window.webContents;
    this.manager.byContents.set(contents.id, this);
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    contents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault());
    this.window.on('closed', () => {
      this.manager.byContents.delete(contents.id);
      for (const pending of this.pending.values()) pending.reject(new Error('音乐源已关闭'));
      this.pending.clear(); this.window = null;
    });
    let resolveReady; let rejectReady;
    this.ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    this.onRegistered = () => resolveReady();
    const timer = setTimeout(() => rejectReady(new Error('音乐源初始化超时')), 6000);
    try {
      await this.window.loadURL('data:text/html;charset=utf-8,<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-eval\'; connect-src \'none\'; img-src \'none\'">');
      await Promise.race([contents.executeJavaScript(script), this.ready.then(() => undefined)]);
      await this.ready;
    } catch (error) { this.destroy(); throw error; }
    finally { clearTimeout(timer); }
  }
  async invoke(method, payload, settings = {}) {
    if (!this.window) throw new Error('音乐源尚未启动');
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
    message.ok ? pending.resolve(message.result) : pending.reject(new Error(boundedText(message.error, 300) || '音乐源请求失败'));
  }
  destroy() { if (this.window && !this.window.isDestroyed()) this.window.destroy(); }
}

class SourceManager {
  constructor(userDataPath, broadcast) {
    this.folder = path.join(userDataPath, 'sources'); this.indexFile = path.join(this.folder, 'index.json');
    this.coverFolder = path.join(userDataPath, 'source-cache', 'covers');
    this.lyricFolder = path.join(userDataPath, 'source-cache', 'lyrics');
    this.broadcast = broadcast; this.records = []; this.runners = new Map(); this.byContents = new Map();
    this.sessions = new Map(); this.coverCache = new Map(); this.coverHints = new Map(); this.settings = {}; this.pendingImports = new Map(); this.errors = new Map();
    ipcMain.on('source:registered', event => this.byContents.get(event.sender.id)?.onRegistered?.());
    ipcMain.on('source:result', (event, message) => this.byContents.get(event.sender.id)?.receive(message));
    ipcMain.handle('source:http', (event, options) => this.http(event.sender.id, options));
  }
  async load() {
    await fs.mkdir(this.folder, { recursive: true });
    await fs.mkdir(this.coverFolder, { recursive: true });
    await fs.mkdir(this.lyricFolder, { recursive: true });
    try {
      const data = JSON.parse(await fs.readFile(this.indexFile, 'utf8'));
      this.records = (Array.isArray(data.records) ? data.records : []).map(record => {
        try { return { ...record, manifest: validateManifest(record.manifest), enabled: record.enabled === true }; } catch { return null; }
      }).filter(Boolean);
      this.settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
    } catch { this.records = []; }
    return this.list();
  }
  list() { return this.records.map(({ id, manifest, enabled, origin, sha256 }) => ({ id, manifest, enabled, origin, sha256, status: this.errors.has(id) ? 'error' : this.runners.has(id) ? 'ready' : 'idle', lastError: this.errors.get(id) || '' })); }
  async save() {
    const temp = `${this.indexFile}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ records: this.records, settings: this.settings }), 'utf8');
    await fs.rename(temp, this.indexFile);
    this.broadcast('sources:changed', this.list());
  }
  record(id) {
    const record = this.records.find(item => item.id === id);
    if (!record || !record.enabled) throw new Error('该音乐源已停用或未安装');
    return record;
  }
  async installPackage(packageText, origin) {
    if (Buffer.byteLength(packageText, 'utf8') > MAX_PACKAGE) throw new Error('音乐源包过大');
    let sourcePackage;
    try { sourcePackage = JSON.parse(packageText); } catch { throw new Error('音乐源包必须是 JSON 格式'); }
    const manifest = validateManifest(sourcePackage.manifest);
    const script = sourcePackage.script;
    if (typeof script !== 'string' || !script.includes('zenix.register') || Buffer.byteLength(script, 'utf8') > MAX_PACKAGE) throw new Error('音乐源脚本无效');
    const sha256 = createHash('sha256').update(packageText).digest('hex');
    const next = { id: manifest.id, manifest, enabled: true, origin, sha256 };
    const runner = new SourceRunner(this, next);
    await runner.start(script);
    runner.destroy();
    const target = path.join(this.folder, manifest.id, manifest.version);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    await fs.writeFile(path.join(target, 'index.js'), script, 'utf8');
    const old = this.runners.get(manifest.id); old?.destroy(); this.runners.delete(manifest.id);
    const index = this.records.findIndex(item => item.id === manifest.id);
    if (index >= 0) this.records[index] = next; else this.records.push(next);
    await this.save();
    return this.list();
  }
  previewPackage(packageText, origin) {
    if (Buffer.byteLength(packageText, 'utf8') > MAX_PACKAGE) throw new Error('音乐源包过大');
    let sourcePackage;
    try { sourcePackage = JSON.parse(packageText); } catch { throw new Error('音乐源包必须是 JSON 格式'); }
    const manifest = validateManifest(sourcePackage.manifest);
    if (typeof sourcePackage.script !== 'string' || !sourcePackage.script.includes('zenix.register') || Buffer.byteLength(sourcePackage.script, 'utf8') > MAX_PACKAGE) throw new Error('音乐源脚本无效');
    const token = randomUUID();
    this.pendingImports.set(token, { packageText, origin, expiresAt: Date.now() + 10 * 60 * 1000 });
    return { token, manifest, origin, sha256: createHash('sha256').update(packageText).digest('hex'), previousVersion: this.records.find(item => item.id === manifest.id)?.manifest.version || null };
  }
  async confirmImport(token) {
    const pending = this.pendingImports.get(token);
    this.pendingImports.delete(token);
    if (!pending || Date.now() > pending.expiresAt) throw new Error('音乐源预览已过期，请重新导入');
    return this.installPackage(pending.packageText, pending.origin);
  }
  cancelImport(token) { this.pendingImports.delete(token); }
  async importFile(filePath) {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_PACKAGE) throw new Error('音乐源包过大');
    return this.previewPackage(await fs.readFile(filePath, 'utf8'), { kind: 'file', label: path.basename(filePath) });
  }
  async importUrl(raw) {
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new Error('网络导入只接受 HTTPS 地址');
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok || new URL(response.url).protocol !== 'https:') throw new Error('无法下载音乐源包');
    return this.previewPackage((await readLimited(response, MAX_PACKAGE)).toString('utf8'), { kind: 'url', label: url.origin });
  }
  async setEnabled(id, enabled) {
    const record = this.records.find(item => item.id === id); if (!record) throw new Error('音乐源不存在');
    record.enabled = Boolean(enabled);
    this.errors.delete(id);
    if (!record.enabled) { this.runners.get(id)?.destroy(); this.runners.delete(id); }
    await this.save(); return this.list();
  }
  async configure(id, values) {
    const record = this.records.find(item => item.id === id); if (!record) throw new Error('音乐源不存在');
    const next = {};
    for (const field of record.manifest.settings) {
      const value = boundedText(values?.[field.key] ?? field.default, 200);
      if (field.type === 'select' && !field.options.includes(value)) throw new Error(`${field.label} 的选项无效`);
      next[field.key] = value;
    }
    this.settings[id] = next;
    await this.save(); return next;
  }
  getSettings(id) {
    const record = this.records.find(item => item.id === id); if (!record) throw new Error('音乐源不存在');
    return Object.fromEntries(record.manifest.settings.map(field => [field.key, this.settings[id]?.[field.key] ?? field.default]));
  }
  async move(id, direction) {
    const index = this.records.findIndex(item => item.id === id);
    const target = index + (direction < 0 ? -1 : 1);
    if (index < 0 || target < 0 || target >= this.records.length) return this.list();
    [this.records[index], this.records[target]] = [this.records[target], this.records[index]];
    await this.save(); return this.list();
  }
  async remove(id) {
    const index = this.records.findIndex(item => item.id === id); if (index < 0) return this.list();
    this.runners.get(id)?.destroy(); this.runners.delete(id); this.errors.delete(id); this.records.splice(index, 1);
    for (const key of this.coverHints.keys()) if (key.startsWith(`${id}:`)) this.coverHints.delete(key);
    await this.save(); await fs.rm(path.join(this.folder, id), { recursive: true, force: true }); return this.list();
  }
  async runner(id) {
    const record = this.record(id);
    if (this.runners.has(id)) {
      const existing = this.runners.get(id);
      await existing.ready;
      return existing;
    }
    const runner = new SourceRunner(this, record);
    this.runners.set(id, runner);
    try { await runner.start(await fs.readFile(path.join(this.folder, id, record.manifest.version, 'index.js'), 'utf8')); return runner; }
    catch (error) { this.runners.delete(id); throw error; }
  }
  async call(id, method, payload) {
    const record = this.record(id);
    if (!record.manifest.capabilities.includes(method)) throw new Error(`该源未提供 ${method}`);
    try {
      const result = await (await this.runner(id)).invoke(method, payload, this.settings[id] || {});
      if (this.errors.delete(id)) this.broadcast('sources:changed', this.list());
      return result;
    } catch (error) {
      if (!this.runners.get(id)?.window) this.runners.delete(id);
      this.errors.set(id, boundedText(error instanceof Error ? error.message : String(error), 180));
      this.broadcast('sources:changed', this.list());
      throw error;
    }
  }
  async http(contentsId, options) {
    const runner = this.byContents.get(contentsId); if (!runner) throw new Error('未授权的音乐源请求');
    const record = this.record(runner.record.id);
    const url = checkUrl(options?.url, record.manifest.network.apiHosts);
    const method = String(options?.method || 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) throw new Error('不支持的请求方法');
    const headers = {};
    for (const [key, value] of Object.entries(options?.headers || {})) {
      if (!/^[a-z0-9-]{1,40}$/i.test(key) || /^(host|cookie|set-cookie|proxy-|sec-)/i.test(key) || String(value).length > 1000) throw new Error('不支持的请求头');
      headers[key] = String(value);
    }
    const body = method === 'POST' ? String(options?.body ?? '').slice(0, 256 * 1024) : undefined;
    const response = await fetchAllowed(url, record.manifest.network.apiHosts, { method, headers, body, signal: AbortSignal.timeout(10000) });
    const text = (await readLimited(response, 2 * 1024 * 1024)).toString('utf8');
    let result = text; try { result = JSON.parse(text); } catch {}
    if (options?.responseType === 'full') return { status: response.status, headers: Object.fromEntries(response.headers), body: result };
    if (!response.ok) throw new Error(`源接口返回 HTTP ${response.status}`);
    return result;
  }
  makeCoverUrl(sourceId, remoteId) {
    return `yzqxy://source-cover/${encodeURIComponent(sourceId)}/${encodeURIComponent(remoteId)}`;
  }
  async search(id, keyword, cursor = null, pageSize = 25) {
    const record = this.record(id);
    const result = await this.call(id, 'search', { keyword: boundedText(keyword, 150), cursor: cursor == null ? null : boundedText(cursor, 300), pageSize: Math.max(1, Math.min(50, Number(pageSize) || 25)) });
    if (!result || !Array.isArray(result.items)) throw new Error('音乐源搜索返回的数据格式错误');
    const seen = new Set();
    const items = result.items.slice(0, 50).map(item => {
      const remoteId = boundedText(item?.remoteId, 200);
      const title = boundedText(item?.title, 200);
      if (!remoteId || !title || seen.has(remoteId)) return null;
      seen.add(remoteId);
      const hint = typeof item.coverUrl === 'string' ? item.coverUrl.slice(0, 1500) : '';
      const coverKey = `${id}:${remoteId}`;
      this.coverHints.delete(coverKey);
      if (hint && record.manifest.network.artworkHosts.length) {
        try { checkUrl(hint, record.manifest.network.artworkHosts); this.coverHints.set(coverKey, hint); } catch {}
      }
      if (this.coverHints.size > 500) this.coverHints.delete(this.coverHints.keys().next().value);
      const coverUrl = record.manifest.network.artworkHosts.length && (this.coverHints.has(coverKey) || record.manifest.capabilities.includes('artwork')) ? this.makeCoverUrl(id, remoteId) : undefined;
      return { id: `source:${encodeURIComponent(id)}:${encodeURIComponent(remoteId)}`, source: 'custom', providerId: id, remoteId, path: '', audioUrl: '', title, artist: boundedText(item.artist, 150), album: boundedText(item.album, 150), duration: Math.max(0, Number(item.duration) || 0), coverUrl };
    }).filter(Boolean);
    return { items, nextCursor: result.nextCursor == null ? null : boundedText(result.nextCursor, 300) };
  }
  async resolve(track, quality = 'high') {
    const id = track?.providerId, remoteId = track?.remoteId;
    if (!id || !remoteId) throw new Error('歌曲缺少来源 ID');
    if (await this.downloads?.offlinePath(track.id)) return { audioUrl: `yzqxy://offline/${encodeURIComponent(track.id)}`, actualQuality: 'offline' };
    const record = this.record(id);
    quality = record.manifest.qualities.includes(quality) ? quality : record.manifest.qualities[0] || quality;
    const result = await this.call(id, 'resolvePlayback', { remoteId, quality });
    if (!result || typeof result.url !== 'string') throw new Error('音乐源没有返回播放地址');
    checkUrl(result.url, record.manifest.network.mediaHosts);
    const token = randomUUID();
    const headers = this.mediaHeaders(result.headers);
    this.sessions.set(token, { id, remoteId, quality, url: result.url, headers, expiresAt: Number(result.expiresAt) || 0, refreshes: 0 });
    setTimeout(() => this.sessions.delete(token), 6 * 60 * 60 * 1000).unref();
    return { audioUrl: `yzqxy://stream/${token}`, actualQuality: boundedText(result.actualQuality || quality, 30) };
  }
  mediaHeaders(raw) {
    const headers = {};
    for (const [key, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
      if (!/^[a-z0-9-]{1,40}$/i.test(key) || /^(host|cookie|set-cookie|proxy-|sec-|range)$/i.test(key) || String(value).length > 1000) continue;
      headers[key] = String(value);
    }
    return headers;
  }
  async downloadInfo(track, quality = 'high') {
    if (!track?.providerId || !track?.remoteId) throw new Error('歌曲缺少来源 ID');
    const record = this.record(track.providerId);
    quality = record.manifest.qualities.includes(quality) ? quality : record.manifest.qualities[0] || quality;
    const result = await this.call(track.providerId, 'resolveDownload', { remoteId: track.remoteId, quality });
    checkUrl(result?.url, record.manifest.network.mediaHosts);
    return { url: result.url, patterns: record.manifest.network.mediaHosts, headers: this.mediaHeaders(result.headers), format: boundedText(result.format, 10), size: Number(result.size) || 0 };
  }
  fetchDownload(info, range, signal) {
    const headers = { ...info.headers };
    if (range) headers.Range = range;
    return fetchAllowed(info.url, info.patterns, { headers, signal });
  }
  async stream(request, token) {
    const session = this.sessions.get(token); if (!session) return new Response('音频会话已过期', { status: 404 });
    const record = this.record(session.id);
    if (session.expiresAt && Date.now() >= session.expiresAt - 15000) await this.refresh(session);
    const headers = { ...session.headers };
    if (request.headers.has('range')) headers.Range = request.headers.get('range');
    let response = await fetchAllowed(session.url, record.manifest.network.mediaHosts, { headers, signal: request.signal });
    if ([401, 403, 410].includes(response.status) && session.refreshes < 1) {
      await this.refresh(session);
      response = await fetchAllowed(session.url, record.manifest.network.mediaHosts, { headers: { ...session.headers, ...(headers.Range ? { Range: headers.Range } : {}) }, signal: request.signal });
    }
    const outgoing = new Headers();
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = response.headers.get(key); if (value) outgoing.set(key, value);
    }
    outgoing.set('Access-Control-Allow-Origin', '*');
    return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers: outgoing });
  }
  async refresh(session) {
    if (session.refreshes >= 1) return;
    session.refreshes += 1;
    const record = this.record(session.id);
    const result = await this.call(session.id, 'resolvePlayback', { remoteId: session.remoteId, quality: session.quality });
    checkUrl(result?.url, record.manifest.network.mediaHosts);
    session.url = result.url; session.headers = this.mediaHeaders(result.headers); session.expiresAt = Number(result.expiresAt) || 0;
  }
  async lyrics(track) {
    if (!track?.providerId || !track?.remoteId) return null;
    const file = path.join(this.lyricFolder, `${createHash('sha256').update(`${track.providerId}:${track.remoteId}`).digest('hex')}.json`);
    const record = this.records.find(item => item.id === track.providerId);
    if (!record?.enabled || !record.manifest.capabilities.includes('lyrics')) {
      try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
    }
    try {
      const result = await this.call(track.providerId, 'lyrics', { remoteId: track.remoteId });
      const lyrics = typeof result === 'string' ? { text: result.slice(0, 200000), format: 'lrc', source: 'custom' }
        : result && typeof result.text === 'string' ? { text: result.text.slice(0, 200000), translationText: typeof result.translationText === 'string' ? result.translationText.slice(0, 100000) : undefined, format: boundedText(result.format || 'lrc', 15), source: 'custom' } : null;
      if (lyrics) await fs.writeFile(file, JSON.stringify(lyrics), 'utf8').catch(() => {});
      return lyrics;
    } catch (error) {
      try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw error; }
    }
  }
  async cover(request, id, remoteId) {
    try {
      const key = `${id}:${remoteId}`;
      if (this.coverCache.has(key)) { const hit = this.coverCache.get(key); return new Response(hit.data, { headers: { 'Content-Type': hit.type, 'Access-Control-Allow-Origin': '*' } }); }
      const hash = createHash('sha256').update(key).digest('hex');
      try {
        const [data, type] = await Promise.all([fs.readFile(path.join(this.coverFolder, `${hash}.bin`)), fs.readFile(path.join(this.coverFolder, `${hash}.type`), 'utf8')]);
        if (data.length && data.length <= 5 * 1024 * 1024 && type.startsWith('image/')) return new Response(data, { headers: { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' } });
      } catch {}
      const record = this.record(id);
      const url = this.coverHints.get(key) || (await this.call(id, 'artwork', { remoteId }))?.url;
      checkUrl(url, record.manifest.network.artworkHosts);
      const response = await fetchAllowed(url, record.manifest.network.artworkHosts, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return new Response(null, { status: response.status });
      const type = response.headers.get('content-type') || 'image/jpeg';
      if (!type.startsWith('image/')) throw new Error('封面格式无效');
      const data = await readLimited(response, 5 * 1024 * 1024);
      if (this.coverCache.size > 100) this.coverCache.delete(this.coverCache.keys().next().value);
      this.coverCache.set(key, { data, type });
      await Promise.all([fs.writeFile(path.join(this.coverFolder, `${hash}.bin`), data), fs.writeFile(path.join(this.coverFolder, `${hash}.type`), type)]).catch(() => {});
      return new Response(data, { headers: { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' } });
    } catch { return new Response(null, { status: 404 }); }
  }
  async choosePackage(window) {
    const result = await dialog.showOpenDialog(window, { title: '导入 Zenix 音乐源', properties: ['openFile'], filters: [{ name: 'Zenix 音乐源', extensions: ['zenixsource', 'json'] }] });
    return result.canceled || !result.filePaths[0] ? null : this.importFile(result.filePaths[0]);
  }
  async chooseFolder(window) {
    const result = await dialog.showOpenDialog(window, { title: '选择 Zenix 源文件夹', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const folder = result.filePaths[0];
    const [manifestStat, scriptStat] = await Promise.all([fs.stat(path.join(folder, 'manifest.json')), fs.stat(path.join(folder, 'index.js'))]);
    if (manifestStat.size + scriptStat.size > MAX_PACKAGE) throw new Error('音乐源文件夹过大');
    const manifest = await fs.readFile(path.join(folder, 'manifest.json'), 'utf8');
    const script = await fs.readFile(path.join(folder, 'index.js'), 'utf8');
    return this.previewPackage(JSON.stringify({ manifest: JSON.parse(manifest), script }), { kind: 'file', label: folder });
  }
}

module.exports = { SourceManager };
