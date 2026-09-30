const { checkUrl, checkLxUrl, fetchAllowed, readLimited } = require('./runtime/source-network.cjs');
const { SourceRunner } = require('./runtime/source-runner.cjs');
const { BoundedCache } = require('./runtime/bounded-cache.cjs');
const { lxScriptInfo } = require('./runtime/source-metadata.cjs');
const { ipcMain, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, createCipheriv, publicEncrypt, constants, randomBytes, randomUUID } = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const lxCatalog = require('./lx-catalog.cjs');

const CAPABILITIES = new Set(['search', 'resolvePlayback', 'lyrics', 'artwork', 'resolveDownload', 'playlistDetail', 'albumDetail', 'artistDetail', 'discover']);
const HOST = /^(?:\*\.)?[a-z0-9.-]+$/i;
const SOURCE_ID = /^[a-z0-9][a-z0-9._-]{2,79}$/i;
const VERSION = /^[a-z0-9][a-z0-9._-]{0,39}$/i;
const MAX_PACKAGE = 512 * 1024;
const LX_PLATFORM_KEYS = Object.keys(lxCatalog.PLATFORMS);

function isLxScript(text) { return typeof text === 'string' && (/globalThis\s*(?:\.lx|\[\s*['"]lx['"]\s*\])|EVENT_NAMES\.inited/.test(text) || /^\s*\/\*\*[\s\S]{0,500}@name\s+/m.test(text)); }
function lxManifest(origin, script, initialized) {
  const info = lxScriptInfo(script);
  const cleanedVersion = boundedText(info.version, 40).replace(/[^a-z0-9._-]/gi, '_').replace(/^[^a-z0-9]+/i, '');
  const version = VERSION.test(cleanedVersion) ? cleanedVersion : '1';
  const platforms = Object.fromEntries(Object.entries(initialized?.sources || {}).filter(([key, value]) => LX_PLATFORM_KEYS.includes(key) && value?.type === 'music' && Array.isArray(value.actions) && value.actions.includes('musicUrl')).map(([key, value]) => [key, { name: boundedText(value.name, 40) || lxCatalog.PLATFORMS[key], qualitys: (value.qualitys || []).filter(type => ['128k', '320k', 'flac', 'flac24bit'].includes(type)) }]));
  if (!Object.keys(platforms).length) throw new Error('音乐源脚本没有声明 Zenix 可搜索的音乐平台');
  const id = `lx.${createHash('sha256').update(origin.label.toLowerCase()).digest('hex').slice(0, 24)}`;
  return { schemaVersion: 1, id, name: boundedText(info.name, 60), version, entry: 'index.js', capabilities: ['search', 'resolvePlayback', 'lyrics'], qualities: ['standard', 'high', 'lossless'], network: { apiHosts: [], mediaHosts: [], artworkHosts: [] }, settings: [{ key: 'lxCatalog', label: '搜索平台', type: 'select', options: Object.keys(platforms), default: Object.keys(platforms)[0] }], lxPlatforms: platforms };
}
function validateLxManifest(raw) {
  if (!raw || !SOURCE_ID.test(raw.id) || !raw.id.startsWith('lx.') || !VERSION.test(raw.version) || !raw.lxPlatforms || typeof raw.lxPlatforms !== 'object') throw new Error('音乐源记录无效');
  const platforms = Object.fromEntries(Object.entries(raw.lxPlatforms).filter(([key, value]) => LX_PLATFORM_KEYS.includes(key) && Array.isArray(value?.qualitys)));
  if (!Object.keys(platforms).length) throw new Error('音乐源缺少可用搜索目录');
  return { ...raw, capabilities: [...new Set([...(Array.isArray(raw.capabilities) ? raw.capabilities : []).filter(value => value !== 'resolveDownload'), 'lyrics'])], lxPlatforms: platforms };
}

function boundedText(value, max = 200) { return String(value ?? '').trim().slice(0, max); }
function parseSourcePackage(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    throw new Error('无法识别音乐源：需要 .zenixsource JSON 包或 自定义 .js 脚本');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('音乐源包必须包含 manifest 和 script');
  return parsed;
}
function matchesHost(host, pattern) { return pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) && host !== pattern.slice(2) : host === pattern; }

function validateManifest(raw) {
  if (!raw || raw.schemaVersion !== 1 || !SOURCE_ID.test(raw.id) || !VERSION.test(raw.version)) throw new Error('音乐源清单的 ID、版本或协议版本无效');
  const declared = [...new Set(Array.isArray(raw.capabilities) ? raw.capabilities : [])];
  if (declared.some(item => !CAPABILITIES.has(item))) throw new Error('音乐源能力声明无效');
  // Older packages may declare download support; playback/cache is the only media flow now.
  const capabilities = declared.filter(item => item !== 'resolveDownload');
  if (!capabilities.length || capabilities.some(item => !CAPABILITIES.has(item))) throw new Error('音乐源能力声明无效');
  const network = {};
  for (const key of ['apiHosts', 'mediaHosts', 'artworkHosts']) {
    const hosts = raw.network?.[key];
    if (!Array.isArray(hosts) || hosts.length > 30 || hosts.some(host => typeof host !== 'string' || !HOST.test(host) || host.includes('..'))) throw new Error(`音乐源 ${key} 域名声明无效`);
    network[key] = [...new Set(hosts.map(host => host.toLowerCase()))];
  }
  if (capabilities.includes('search') && !network.apiHosts.length) throw new Error('可搜索的音乐源必须声明 API 域名');
  if (capabilities.includes('resolvePlayback') && !network.mediaHosts.length) throw new Error('可播放的音乐源必须声明媒体域名');
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

class SourceManager {
  constructor(userDataPath, broadcast) {
    this.folder = path.join(userDataPath, 'sources'); this.indexFile = path.join(this.folder, 'index.json');
    this.coverFolder = path.join(userDataPath, 'source-cache', 'covers');
    this.lyricFolder = path.join(userDataPath, 'source-cache', 'lyrics');
    this.broadcast = broadcast; this.records = []; this.runners = new Map(); this.byContents = new Map();
    this.sessions = new BoundedCache({ maxEntries: 48, ttl: 6 * 60 * 60 * 1000 });
    this.coverCache = new BoundedCache({ maxEntries: 32, maxBytes: 8 * 1024 * 1024, sizeOf: value => value.data.byteLength });
    this.catalogCache = new BoundedCache({ maxEntries: 12, ttl: 60000 }); this.catalogPending = new Map(); this.coverPending = new Map();
    this.coverHints = new BoundedCache({ maxEntries: 500, ttl: 30 * 60 * 1000 }); this.settings = {}; this.pendingImports = new BoundedCache({ maxEntries: 6, ttl: 10 * 60 * 1000 }); this.errors = new Map();
    ipcMain.on('source:registered', event => this.byContents.get(event.sender.id)?.onRegistered?.());
    ipcMain.on('source:lx-inited', (event, data) => {
      const runner = this.byContents.get(event.sender.id);
      if (runner?.record.kind === 'lx') runner.onRegistered?.(data);
    });
    ipcMain.on('source:lx-info', event => { event.returnValue = this.byContents.get(event.sender.id)?.scriptInfo || {}; });
    ipcMain.on('source:result', (event, message) => this.byContents.get(event.sender.id)?.receive(message));
    ipcMain.handle('source:http', (event, options) => this.http(event.sender.id, options));
    ipcMain.handle('source:lx-http', (event, request) => this.lxHttp(event.sender.id, request));
    ipcMain.handle('source:lx-zlib', (event, request) => this.lxZlib(event.sender.id, request));
    ipcMain.on('source:lx-crypto', (event, request) => { event.returnValue = this.lxCrypto(event.sender.id, request); });
  }
  async load() {
    await fs.mkdir(this.folder, { recursive: true });
    await fs.mkdir(this.coverFolder, { recursive: true });
    await fs.mkdir(this.lyricFolder, { recursive: true });
    try {
      const data = JSON.parse(await fs.readFile(this.indexFile, 'utf8'));
      this.records = (Array.isArray(data.records) ? data.records : []).map(record => {
        try { return { ...record, manifest: record.kind === 'lx' ? validateLxManifest(record.manifest) : validateManifest(record.manifest), enabled: record.enabled === true }; } catch { return null; }
      }).filter(Boolean);
      this.settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
      let migrated = false;
      this.records = await Promise.all(this.records.map(async (record, index) => {
        if (Number.isFinite(record.installedAt) && record.installedAt > 0) return record;
        const stat = await fs.stat(path.join(this.folder, record.id)).catch(() => null);
        migrated = true;
        return { ...record, installedAt: stat?.birthtimeMs || Date.now() + index };
      }));
      this.records.sort((left, right) => left.installedAt - right.installedAt);
      if (migrated) await this.save();
    } catch { this.records = []; }
    return this.list();
  }
  list() { return this.records.map(({ id, kind, manifest, enabled, origin, sha256, installedAt }) => ({ id, kind: kind || 'zenix', manifest, enabled, origin, sha256, installedAt, status: this.errors.has(id) ? 'error' : this.runners.has(id) ? 'ready' : 'idle', lastError: this.errors.get(id) || '' })); }
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
    if (isLxScript(packageText) || /\.js(?:$|[?#])/i.test(origin.label)) return this.installLx(packageText, origin);
    const sourcePackage = parseSourcePackage(packageText);
    const manifest = validateManifest(sourcePackage.manifest);
    const script = sourcePackage.script;
    if (typeof script !== 'string' || !script.includes('zenix.register') || Buffer.byteLength(script, 'utf8') > MAX_PACKAGE) throw new Error('音乐源脚本无效');
    const sha256 = createHash('sha256').update(packageText).digest('hex');
    const index = this.records.findIndex(item => item.id === manifest.id);
    const next = { id: manifest.id, manifest, enabled: true, origin, sha256, installedAt: this.records[index]?.installedAt || Date.now() };
    const runner = new SourceRunner(this, next);
    await runner.start(script);
    runner.destroy();
    const target = path.join(this.folder, manifest.id, manifest.version);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    await fs.writeFile(path.join(target, 'index.js'), script, 'utf8');
    const old = this.runners.get(manifest.id); old?.destroy(); this.runners.delete(manifest.id);
    if (index >= 0) this.records[index] = next; else this.records.push(next);
    await this.save();
    return this.list();
  }
  previewPackage(packageText, origin) {
    if (Buffer.byteLength(packageText, 'utf8') > MAX_PACKAGE) throw new Error('音乐源包过大');
    if (isLxScript(packageText) || /\.js(?:$|[?#])/i.test(origin.label)) return this.previewLx(packageText, origin);
    const sourcePackage = parseSourcePackage(packageText);
    const manifest = validateManifest(sourcePackage.manifest);
    if (typeof sourcePackage.script !== 'string' || !sourcePackage.script.includes('zenix.register') || Buffer.byteLength(sourcePackage.script, 'utf8') > MAX_PACKAGE) throw new Error('音乐源脚本无效');
    const token = randomUUID();
    this.pendingImports.set(token, { packageText, origin, expiresAt: Date.now() + 10 * 60 * 1000 });
    return { token, manifest, origin, sha256: createHash('sha256').update(packageText).digest('hex'), previousVersion: this.records.find(item => item.id === manifest.id)?.manifest.version || null };
  }
  async confirmImport(token) {
    const pending = this.pendingImports.get(token);
    if (!pending || Date.now() > pending.expiresAt) throw new Error('音乐源预览已过期，请重新导入');
    const installed = await this.installPackage(pending.packageText, pending.origin);
    this.pendingImports.delete(token);
    return installed;
  }
  previewLx(script, origin) {
    const info = lxScriptInfo(script);
    const id = `lx.${createHash('sha256').update(origin.label.toLowerCase()).digest('hex').slice(0, 24)}`;
    const manifest = { id, name: info.name, version: info.version, capabilities: ['search', 'resolvePlayback'], qualities: [], network: { apiHosts: [], mediaHosts: [], artworkHosts: [] }, settings: [], lxPlatforms: {} };
    const token = randomUUID();
    this.pendingImports.set(token, { packageText: script, origin, expiresAt: Date.now() + 10 * 60 * 1000 });
    return { token, kind: 'lx', manifest, origin, sha256: createHash('sha256').update(script).digest('hex'), previousVersion: this.records.find(item => item.id === id)?.manifest.version || null };
  }
  async installLx(script, origin) {
    const id = `lx.${createHash('sha256').update(origin.label.toLowerCase()).digest('hex').slice(0, 24)}`;
    const candidate = { kind: 'lx', id };
    const runner = new SourceRunner(this, candidate);
    let manifest;
    try { await runner.start(script); manifest = lxManifest(origin, script, runner.lxInfo); }
    finally { runner.destroy(); }
    const index = this.records.findIndex(item => item.id === id);
    const next = { kind: 'lx', id, manifest, enabled: true, origin, sha256: createHash('sha256').update(script).digest('hex'), installedAt: this.records[index]?.installedAt || Date.now() };
    const target = path.join(this.folder, id, manifest.version);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    await fs.writeFile(path.join(target, 'index.js'), script, 'utf8');
    this.runners.get(id)?.destroy(); this.runners.delete(id);
    if (index >= 0) this.records[index] = next; else this.records.push(next);
    if (!manifest.lxPlatforms[this.settings[id]?.lxCatalog]) delete this.settings[id];
    await this.save();
    return this.list();
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
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!response.ok || new URL(response.url).protocol !== 'https:') throw new Error('无法下载音乐源包');
    const body = (await readLimited(response, MAX_PACKAGE)).toString('utf8');
    return this.previewPackage(body, { kind: 'url', label: /\.js$/i.test(url.pathname) ? url.href : url.origin });
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
      if (existing.startTask && (!existing.window || !existing.window.isDestroyed())) { await existing.startTask; return existing; }
      if (existing.window && !existing.window.isDestroyed()) { await existing.ready; return existing; }
      this.runners.delete(id);
    }
    const runner = new SourceRunner(this, record);
    this.runners.set(id, runner);
    runner.startTask = fs.readFile(path.join(this.folder, id, record.manifest.version, 'index.js'), 'utf8').then(script => runner.start(script));
    try { await runner.startTask; return runner; }
    catch (error) { this.runners.delete(id); throw error; }
  }
  async call(id, method, payload) {
    const record = this.record(id);
    if (!record.manifest.capabilities.includes(method)) throw new Error(`该源未提供 ${method}`);
    let runner;
    try {
      runner = await this.runner(id);
      runner.acquire();
      const result = await runner.invoke(method, payload, this.settings[id] || {});
      if (this.errors.delete(id)) this.broadcast('sources:changed', this.list());
      return result;
    } catch (error) {
      if (!this.runners.get(id)?.window) this.runners.delete(id);
      this.errors.set(id, boundedText(error instanceof Error ? error.message : String(error), 180));
      this.broadcast('sources:changed', this.list());
      throw error;
    } finally {
      runner?.release();
      // Keep one warm idle script, without interrupting concurrent active requests.
      for (const [otherId, other] of this.runners) if (otherId !== id && !other.starting && !other.leases && !other.pending.size) other.destroy();
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
    const { response, data } = await runner.network(async signal => {
      const response = await fetchAllowed(url, record.manifest.network.apiHosts, { method, headers, body, signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
      return { response, data: await readLimited(response, 2 * 1024 * 1024) };
    });
    const text = data.toString('utf8');
    let result = text; try { result = JSON.parse(text); } catch {}
    if (options?.responseType === 'full') return { status: response.status, headers: Object.fromEntries(response.headers), body: result };
    if (!response.ok) throw new Error(`源接口返回 HTTP ${response.status}`);
    return result;
  }
  lxRunner(contentsId) {
    const runner = this.byContents.get(contentsId);
    if (!runner || runner.record.kind !== 'lx') throw new Error('未授权的 音乐源请求');
    return runner;
  }
  lxCrypto(contentsId, request) {
    try {
      this.lxRunner(contentsId);
      const values = request?.values || {};
      const buffer = value => Buffer.from(Array.isArray(value) ? value.slice(0, 1024 * 1024) : []);
      switch (request?.action) {
        case 'md5': return { value: createHash('md5').update(Array.isArray(values.bytes) ? buffer(values.bytes) : String(values.value || '').slice(0, 1024 * 1024)).digest('hex') };
        case 'randomBytes': return { bytes: [...randomBytes(Math.min(4096, Math.max(0, Number(values.size) || 0)))] };
        case 'aesEncrypt': {
          const cipher = createCipheriv(String(values.mode), buffer(values.key), values.iv == null ? null : buffer(values.iv));
          return { bytes: [...Buffer.concat([cipher.update(buffer(values.buffer)), cipher.final()])] };
        }
        case 'rsaEncrypt': {
          const input = buffer(values.buffer);
          const padded = Buffer.concat([Buffer.alloc(Math.max(0, 128 - input.length)), input]);
          return { bytes: [...publicEncrypt({ key: String(values.key).slice(0, 10000), padding: constants.RSA_NO_PADDING }, padded)] };
        }
        default: throw new Error('不支持的 脚本加密操作');
      }
    } catch (error) { return { error: boundedText(error instanceof Error ? error.message : String(error), 180) }; }
  }
  async lxZlib(contentsId, request) {
    this.lxRunner(contentsId);
    const input = Buffer.from(Array.isArray(request?.bytes) ? request.bytes.slice(0, 2 * 1024 * 1024) : []);
    const operation = request?.action === 'inflate' ? zlib.inflate : request?.action === 'deflate' ? zlib.deflate : null;
    if (!operation) throw new Error('不支持的 脚本压缩操作');
    const output = await promisify(operation)(input);
    if (output.length > 4 * 1024 * 1024) throw new Error('脚本压缩结果过大');
    return [...output];
  }
  async lxHttp(contentsId, request) {
    const runner = this.lxRunner(contentsId);
    const options = request?.options || {};
    const method = String(options.method || 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) throw new Error('音乐源使用了不支持的 HTTP 方法');
    const headers = {};
    for (const [key, value] of Object.entries(options.headers || {})) {
      if (!/^[a-z0-9-]{1,50}$/i.test(key) || /^(host|proxy-|sec-)/i.test(key) || String(value).length > 2000) continue;
      headers[key] = String(value);
    }
    let body;
    if (method === 'POST') {
      if (options.formData && typeof options.formData === 'object') {
        const form = new FormData();
        for (const [key, value] of Object.entries(options.formData)) form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
        body = form;
      } else if (options.form && typeof options.form === 'object') {
        body = new URLSearchParams(options.form).toString();
        headers['Content-Type'] ||= 'application/x-www-form-urlencoded';
      } else if (typeof options.body === 'string') body = options.body;
      else if (options.body && typeof options.body === 'object') body = JSON.stringify(options.body);
      if (body instanceof FormData ? [...body].reduce((sum, [key, value]) => sum + key.length + String(value).length, 0) > 256 * 1024 : body?.length > 256 * 1024) throw new Error('音乐源请求内容过大');
    }
    const timeout = Math.max(1000, Math.min(15000, Number(options.timeout) || 10000));
    let response, data;
    try {
      ({ response, data } = await runner.network(async signal => {
        const response = await fetchAllowed(request?.url, null, { method, headers, body, signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) });
        return { response, data: await readLimited(response, 4 * 1024 * 1024) };
      }));
    }
    catch (error) { runner.lastHttpError = `音乐源脚本网络请求失败：${boundedText(error instanceof Error ? error.message : String(error), 100)}`; throw error; }
    runner.lastHttpError = response.ok ? '' : `音乐源脚本服务 ${new URL(request.url).hostname} 返回 HTTP ${response.status}`;
    const contentType = response.headers.get('content-type') || '';
    const binary = /(?:image|audio|octet-stream|gzip|zip)/i.test(contentType) || options.responseType === 'arraybuffer';
    let result = binary ? [...data] : data.toString('utf8');
    if (!binary && (/json/i.test(contentType) || /^[\s]*[\[{]/.test(result))) {
      try { result = JSON.parse(result); } catch {}
    }
    return { status: response.status, headers: Object.fromEntries(response.headers), binary, body: result };
  }
  makeCoverUrl(sourceId, remoteId) {
    return `yzqxy://source-cover/${encodeURIComponent(sourceId)}/${encodeURIComponent(remoteId)}`;
  }
  async search(id, keyword, cursor = null, pageSize = 25) {
    const record = this.record(id);
    const size = Math.max(1, Math.min(50, Number(pageSize) || 25));
    const platform = this.settings[id]?.lxCatalog || record.manifest.settings[0]?.default;
    const page = Math.max(1, Math.min(100, Number(cursor) || 1));
    const query = boundedText(keyword, 150);
    const catalogKey = JSON.stringify([platform, query, page, size]);
    let result;
    if (record.kind === 'lx') {
      result = this.catalogCache.get(catalogKey);
      if (!result) {
        let pending = this.catalogPending.get(catalogKey);
        if (!pending) {
          pending = lxCatalog.search(platform, query, page, size).then(value => { this.catalogCache.set(catalogKey, value); return value; }).finally(() => this.catalogPending.delete(catalogKey));
          this.catalogPending.set(catalogKey, pending);
        }
        result = await pending;
      }
    } else result = await this.call(id, 'search', { keyword: query, cursor: cursor == null ? null : boundedText(cursor, 300), pageSize: size });
    if (!result || !Array.isArray(result.items)) throw new Error('音乐源搜索返回的数据格式错误');
    const seen = new Set();
    const items = result.items.slice(0, 50).map(item => {
      const remoteId = boundedText(item?.remoteId, record.kind === 'lx' ? 6000 : 200);
      const title = boundedText(item?.title, 200);
      if (!remoteId || !title || seen.has(remoteId)) return null;
      seen.add(remoteId);
      const hint = typeof item.coverUrl === 'string' ? item.coverUrl.slice(0, 1500) : '';
      const coverKey = `${id}:${remoteId}`;
      this.coverHints.delete(coverKey);
      if (hint && (record.kind === 'lx' || record.manifest.network.artworkHosts.length)) {
        try { if (record.kind === 'lx') new URL(hint); else checkUrl(hint, record.manifest.network.artworkHosts); this.coverHints.set(coverKey, hint); } catch {}
      }
      if (this.coverHints.size > 500) this.coverHints.delete(this.coverHints.keys().next().value);
      const canLoadArtwork = record.kind === 'lx' || (record.manifest.network.artworkHosts.length && (this.coverHints.has(coverKey) || record.manifest.capabilities.includes('artwork')));
      const coverUrl = canLoadArtwork ? this.makeCoverUrl(id, remoteId) : undefined;
      return { id: `source:${encodeURIComponent(id)}:${encodeURIComponent(remoteId)}`, source: 'custom', providerId: id, remoteId, path: '', audioUrl: '', title, artist: boundedText(item.artist, 150), album: boundedText(item.album, 150), duration: Math.max(0, Number(item.duration) || 0), coverUrl };
    }).filter(Boolean);
    return { items, nextCursor: result.nextCursor == null ? null : boundedText(result.nextCursor, 300) };
  }
  async cached(track, quality = 'high', cacheAsId = '') {
    const id = track?.providerId, remoteId = track?.remoteId;
    if (!id || !remoteId) throw new Error('歌曲缺少来源 ID');
    const coverUrl = id.startsWith('lx.') ? this.makeCoverUrl(id, remoteId) : track.coverUrl;
    const cacheId = typeof cacheAsId === 'string' && cacheAsId.startsWith('source:') ? cacheAsId : track.id;
    const cached = await this.audioCache?.find(cacheId, quality) || (cacheId !== track.id ? await this.audioCache?.find(track.id, quality) : null);
    if (cached && cacheId !== track.id) await this.audioCache?.link(cacheId, quality, cached.key);
    return cached ? { audioUrl: `yzqxy://cached-audio/${cached.key}`, actualQuality: '本地缓存', coverUrl, playbackProviderId: 'cache' } : null;
  }
  async cachedBest(track, qualities) {
    // One IPC; preserve the caller's quality preference while looking up disk cache.
    const tiers = [...new Set(Array.isArray(qualities) ? qualities : ['high'])].filter(tier => ['lossless24', 'lossless', 'high', 'standard'].includes(tier));
    for (let index = 0; index < tiers.length; index += 1) { const result = await this.cached(track, tiers[index]); if (result) return { ...result, playbackQuality: tiers[index] }; }
    return null;
  }
  async resolve(track, quality = 'high', cacheAsId = '', skipCache = false) {
    const id = track?.providerId, remoteId = track?.remoteId;
    if (!id || !remoteId) throw new Error('歌曲缺少来源 ID');
    const coverUrl = id.startsWith('lx.') ? this.makeCoverUrl(id, remoteId) : track.coverUrl;
    if (!skipCache) {
      const local = await this.cached(track, quality, cacheAsId);
      if (local) return local;
    }
    const cacheId = typeof cacheAsId === 'string' && cacheAsId.startsWith('source:') ? cacheAsId : track.id;
    const record = this.record(id);
    quality = record.kind === 'lx' && quality === 'lossless24' ? quality : record.manifest.qualities.includes(quality) ? quality : record.manifest.qualities[0] || quality;
    const result = record.kind === 'lx' ? await this.lxPlayback(id, remoteId, quality) : await this.call(id, 'resolvePlayback', { remoteId, quality });
    if (!result || typeof result.url !== 'string') throw new Error('音乐源没有返回播放地址');
    if (record.kind === 'lx') await checkLxUrl(result.url); else checkUrl(result.url, record.manifest.network.mediaHosts);
    const token = randomUUID();
    const headers = this.mediaHeaders(result.headers);
    this.sessions.set(token, { id, remoteId, trackId: cacheId, quality, url: result.url, headers, expiresAt: Number(result.expiresAt) || 0, refreshes: 0 });
    return { audioUrl: `yzqxy://stream/${token}`, actualQuality: boundedText(result.actualQuality || quality, 30), coverUrl, playbackProviderId: id };
  }
  async lxPlayback(id, remoteId, quality) {
    const record = this.record(id);
    const musicInfo = lxCatalog.readInfo(remoteId);
    const supported = record.manifest.lxPlatforms[musicInfo.source]?.qualitys || [];
    if (!supported.length) throw new Error(`音乐源不支持 ${musicInfo.source} 平台`);
    const order = quality === 'lossless24' ? ['flac24bit'] : quality === 'lossless' ? ['flac'] : quality === 'standard' ? ['128k'] : ['320k'];
    let lastError;
    for (const type of order.filter(item => supported.includes(item))) {
      try {
        const answer = await this.call(id, 'resolvePlayback', { source: musicInfo.source, action: 'musicUrl', info: { type, musicInfo } });
        const url = typeof answer === 'string' ? answer : answer?.url;
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('音乐源未返回可播放地址');
        return { url, actualQuality: type, headers: answer?.headers };
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error(`音乐源不支持所选 ${quality} 音质`);
  }
  mediaHeaders(raw) {
    const headers = {};
    for (const [key, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
      if (!/^[a-z0-9-]{1,40}$/i.test(key) || /^(host|cookie|set-cookie|proxy-|sec-|range)$/i.test(key) || String(value).length > 1000) continue;
      headers[key] = String(value);
    }
    return headers;
  }
  async stream(request, token) {
    const session = this.sessions.get(token); if (!session) return new Response('音频会话已过期', { status: 404 });
    const record = this.record(session.id);
    if (session.expiresAt && Date.now() >= session.expiresAt - 15000) await this.refresh(session);
    const headers = { ...session.headers };
    if (request.headers.has('range')) headers.Range = request.headers.get('range');
    const fetchMedia = async requestHeaders => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('音频连接超时')), 8000);
      try { return await fetchAllowed(session.url, record.kind === 'lx' ? null : record.manifest.network.mediaHosts, { headers: requestHeaders, signal: AbortSignal.any([request.signal, controller.signal]) }); }
      finally { clearTimeout(timer); }
    };
    let response;
    try { response = await fetchMedia(headers); } catch { return new Response(null, { status: 504 }); }
    if ([401, 403, 410].includes(response.status) && session.refreshes < 1) {
      await response.body?.cancel().catch(() => {});
      await this.refresh(session);
      try { response = await fetchMedia({ ...session.headers, ...(headers.Range ? { Range: headers.Range } : {}) }); } catch { return new Response(null, { status: 504 }); }
    }
    if (/text\/html|application\/json/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel().catch(() => {}); return new Response(null, { status: 502 }); }
    const outgoing = new Headers();
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = response.headers.get(key); if (value) outgoing.set(key, value);
    }
    outgoing.set('Access-Control-Allow-Origin', '*');
    if (request.method === 'HEAD') { await response.body?.cancel().catch(() => {}); return new Response(null, { status: response.status, headers: outgoing }); }
    const body = [200, 206].includes(response.status)
      ? this.audioCache?.captureResponse(session.trackId, session.quality, response, signal => fetchAllowed(session.url, record.kind === 'lx' ? null : record.manifest.network.mediaHosts, { headers: session.headers, signal })) || response.body
      : response.body;
    return new Response(body, { status: response.status, headers: outgoing });
  }
  async refresh(session) {
    if (session.refreshes >= 1) return;
    session.refreshes += 1;
    const record = this.record(session.id);
    const result = record.kind === 'lx' ? await this.lxPlayback(session.id, session.remoteId, session.quality) : await this.call(session.id, 'resolvePlayback', { remoteId: session.remoteId, quality: session.quality });
    if (record.kind === 'lx') await checkLxUrl(result?.url); else checkUrl(result?.url, record.manifest.network.mediaHosts);
    session.url = result.url; session.headers = this.mediaHeaders(result.headers); session.expiresAt = Number(result.expiresAt) || 0;
  }
  async lyrics(track) {
    if (!track?.providerId || !track?.remoteId) return null;
    const file = path.join(this.lyricFolder, `${createHash('sha256').update(`${track.providerId}:${track.remoteId}`).digest('hex')}.json`);
    const record = this.records.find(item => item.id === track.providerId);
    if (record?.kind === 'lx') {
      try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
    }
    if (!record?.enabled || (record.kind !== 'lx' && !record.manifest.capabilities.includes('lyrics'))) {
      try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
    }
    try {
      const result = record.kind === 'lx' ? await lxCatalog.lyrics(lxCatalog.readInfo(track.remoteId)) : await this.call(track.providerId, 'lyrics', { remoteId: track.remoteId });
      const lyrics = typeof result === 'string' ? { text: result.slice(0, 200000), format: 'lrc', source: 'custom' }
        : result && typeof result.text === 'string' ? { text: result.text.slice(0, 200000), translationText: typeof result.translationText === 'string' ? result.translationText.slice(0, 100000) : undefined, format: boundedText(result.format || 'lrc', 15), source: 'custom' } : null;
      if (lyrics) await fs.writeFile(file, JSON.stringify(lyrics), 'utf8').catch(() => {});
      return lyrics;
    } catch (error) {
      try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw error; }
    }
  }
  async cover(request, id, remoteId) {
    const key = `${id}:${remoteId}`;
    let pending = this.coverPending.get(key);
    if (!pending) { pending = this.coverBytes(id, remoteId).finally(() => this.coverPending.delete(key)); this.coverPending.set(key, pending); }
    const result = await pending;
    return new Response(result.data || null, { status: result.status || 200, headers: { 'Content-Type': result.type || 'image/jpeg', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'private, max-age=86400' } });
  }
  async coverBytes(id, remoteId) {
    try {
      const key = `${id}:${remoteId}`;
      if (this.coverCache.has(key)) { const hit = this.coverCache.get(key); return hit; }
      const hash = createHash('sha256').update(key).digest('hex');
      try {
        const [data, type] = await Promise.all([fs.readFile(path.join(this.coverFolder, `${hash}.bin`)), fs.readFile(path.join(this.coverFolder, `${hash}.type`), 'utf8')]);
        if (data.length && data.length <= 5 * 1024 * 1024 && type.startsWith('image/')) { const value = { data, type }; this.coverCache.set(key, value); return value; }
      } catch {}
      const record = this.record(id);
      const url = this.coverHints.get(key) || (record.kind === 'lx' ? await lxCatalog.artwork(lxCatalog.readInfo(remoteId)) : (await this.call(id, 'artwork', { remoteId }))?.url);
      if (record.kind === 'lx') await checkLxUrl(url); else checkUrl(url, record.manifest.network.artworkHosts);
      const response = await fetchAllowed(url, record.kind === 'lx' ? null : record.manifest.network.artworkHosts, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); return { status: response.status }; }
      const type = response.headers.get('content-type') || 'image/jpeg';
      if (!type.startsWith('image/')) { await response.body?.cancel().catch(() => {}); throw new Error('封面格式无效'); }
      const data = await readLimited(response, 5 * 1024 * 1024);
      this.coverCache.set(key, { data, type });
      await Promise.all([fs.writeFile(path.join(this.coverFolder, `${hash}.bin`), data), fs.writeFile(path.join(this.coverFolder, `${hash}.type`), type)]).catch(() => {});
      return { data, type };
    } catch { return { status: 404 }; }
  }
  async choosePackage(window) {
    const result = await dialog.showOpenDialog(window, { title: '导入音乐源', properties: ['openFile'], filters: [{ name: '音乐源包或脚本', extensions: ['zenixsource', 'json', 'js'] }] });
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
