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
const { readBoundedFile } = require('./runtime/bounded-file.cjs');
const { encodeProtected, decodeProtected } = require('./runtime/protected-json.cjs');
const lxCatalog = require('./lx-catalog.cjs');
const { sourcePolicy, policyOptions } = require('./runtime/source-policy.cjs');

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
    this.metadataCache = new (require('./runtime/metadata-cache.cjs').MetadataCache)(path.join(userDataPath, 'source-cache'));
    this.saveQueue = Promise.resolve();
    this.requests = new Map();
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
    await this.metadataCache.prune({ bestEffort: true });
    let indexRead = false;
    try {
      const text = await readBoundedFile(this.indexFile, 32 * 1024 * 1024, 'utf8'); indexRead = true;
      const decoded = await decodeProtected(text);
      const data = decoded.value;
      if (!Array.isArray(data.records) || !data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) throw new Error('音乐源配置结构无效');
      this.records = data.records.map(record => {
        const manifest = record.kind === 'lx' ? validateLxManifest(record.manifest) : validateManifest(record.manifest);
        if (!SOURCE_ID.test(record.id) || record.id !== manifest.id) throw new Error('音乐源配置 ID 无效');
        return { ...record, manifest, networkPolicy: sourcePolicy(record.networkPolicy, { allowHttp: true, hosts: null }), enabled: record.enabled === true };
      });
      this.settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
      let migrated = decoded.legacy || decoded.rotate || data.records.some(record => record.networkPolicy === undefined);
      this.records = await Promise.all(this.records.map(async (record, index) => {
        if (Number.isFinite(record.installedAt) && record.installedAt > 0) return record;
        const stat = await fs.stat(path.join(this.folder, record.id)).catch(() => null);
        migrated = true;
        return { ...record, installedAt: stat?.birthtimeMs || Date.now() + index };
      }));
      this.records.sort((left, right) => left.installedAt - right.installedAt);
      if (migrated) await this.save();
    } catch (error) {
      if (indexRead || error.code !== 'ENOENT') { this.storageError = '音乐源配置无法读取或解密，已保留原文件并停止写入'; this.records = []; this.settings = {}; }
    }
    return this.list();
  }
  list() { return this.records.map(({ id, kind, manifest, enabled, origin, sha256, installedAt, networkPolicy }) => ({ networkPolicy, id, kind: kind || 'zenix', manifest, enabled, origin, sha256, installedAt, status: this.errors.has(id) ? 'error' : [...this.runners.values()].some(runner => runner.record.id === id) ? 'ready' : 'idle', lastError: this.errors.get(id) || '' })); }
  async save() {
    this.assertWritable();
    const task = this.saveQueue.catch(() => {}).then(async () => {
      const temp = `${this.indexFile}.${randomUUID()}.tmp`;
      const value = JSON.parse(JSON.stringify({ records: this.records, settings: this.settings }));
      try { await fs.writeFile(temp, await encodeProtected(value), 'utf8'); await fs.rename(temp, this.indexFile); }
      finally { await fs.rm(temp, { force: true }).catch(() => {}); }
      this.broadcast('sources:changed', this.list());
    }); this.saveQueue = task; return task;
  }
  assertWritable() { if (this.storageError) throw new Error(this.storageError); }
  record(id) {
    const record = this.records.find(item => item.id === id);
    if (!record || !record.enabled) throw new Error('该音乐源已停用或未安装');
    return record;
  }
  async installPackage(packageText, origin, permission) {
    this.assertWritable();
    if (Buffer.byteLength(packageText, 'utf8') > MAX_PACKAGE) throw new Error('音乐源包过大');
    if (!packageText.trimStart().startsWith('{') && (isLxScript(packageText) || /\.js(?:$|[?#])/i.test(origin.label))) return this.installLx(packageText, origin, permission);
    const sourcePackage = parseSourcePackage(packageText);
    const manifest = validateManifest(sourcePackage.manifest);
    const script = sourcePackage.script;
    if (typeof script !== 'string' || !script.includes('zenix.register') || Buffer.byteLength(script, 'utf8') > MAX_PACKAGE) throw new Error('音乐源脚本无效');
    const sha256 = createHash('sha256').update(packageText).digest('hex');
    const index = this.records.findIndex(item => item.id === manifest.id);
    const next = { id: manifest.id, manifest, enabled: true, networkPolicy: sourcePolicy(permission, this.records[index]?.networkPolicy), origin, sha256, installedAt: this.records[index]?.installedAt || Date.now() };
    const runner = new SourceRunner(this, next);
    await runner.start(script);
    runner.destroy();
    const target = path.join(this.folder, manifest.id, manifest.version);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    await fs.writeFile(path.join(target, 'index.js'), script, 'utf8');
    this.retireSource(manifest.id);
    if (index >= 0) this.records[index] = next; else this.records.push(next);
    await this.save();
    return this.list();
  }
  previewPackage(packageText, origin) {
    if (Buffer.byteLength(packageText, 'utf8') > MAX_PACKAGE) throw new Error('音乐源包过大');
    if (!packageText.trimStart().startsWith('{') && (isLxScript(packageText) || /\.js(?:$|[?#])/i.test(origin.label))) return this.previewLx(packageText, origin);
    const sourcePackage = parseSourcePackage(packageText);
    const manifest = validateManifest(sourcePackage.manifest);
    if (typeof sourcePackage.script !== 'string' || !sourcePackage.script.includes('zenix.register') || Buffer.byteLength(sourcePackage.script, 'utf8') > MAX_PACKAGE) throw new Error('音乐源脚本无效');
    const token = randomUUID();
    this.pendingImports.set(token, { packageText, origin, expiresAt: Date.now() + 10 * 60 * 1000 });
    return { token, manifest, origin, sha256: createHash('sha256').update(packageText).digest('hex'), previousVersion: this.records.find(item => item.id === manifest.id)?.manifest.version || null };
  }
  async confirmImport(token, permission) {
    const pending = this.pendingImports.get(token);
    if (!pending || Date.now() > pending.expiresAt) throw new Error('音乐源预览已过期，请重新导入');
    const installed = await this.installPackage(pending.packageText, pending.origin, permission);
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
  async installLx(script, origin, permission) {
    const id = `lx.${createHash('sha256').update(origin.label.toLowerCase()).digest('hex').slice(0, 24)}`;
    const policy = sourcePolicy(permission, this.records.find(record => record.id === id)?.networkPolicy);
    const candidate = { kind: 'lx', id, networkPolicy: policy };
    const runner = new SourceRunner(this, candidate);
    let manifest;
    try { await runner.start(script); manifest = lxManifest(origin, script, runner.lxInfo); }
    finally { runner.destroy(); }
    const index = this.records.findIndex(item => item.id === id);
    const next = { kind: 'lx', id, manifest, enabled: true, networkPolicy: policy, origin, sha256: createHash('sha256').update(script).digest('hex'), installedAt: this.records[index]?.installedAt || Date.now() };
    const target = path.join(this.folder, id, manifest.version);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    await fs.writeFile(path.join(target, 'index.js'), script, 'utf8');
    this.retireSource(id);
    if (index >= 0) this.records[index] = next; else this.records.push(next);
    if (!manifest.lxPlatforms[this.settings[id]?.lxCatalog]) delete this.settings[id];
    await this.save();
    return this.list();
  }
  cancelImport(token) { this.pendingImports.delete(token); }
  async shareBundle() {
    this.assertWritable();
    const records = JSON.parse(JSON.stringify(this.records));
    return require('./runtime/source-share.cjs').sourceShare(records, async record => ({
      manifest: record.manifest,
      script: await readBoundedFile(path.join(this.folder, record.id, record.manifest.version, 'index.js'), MAX_PACKAGE, 'utf8'),
    }));
  }
  async importFile(filePath) {
    return this.previewPackage(await readBoundedFile(filePath, MAX_PACKAGE, 'utf8'), { kind: 'file', label: path.basename(filePath) });
  }
  async importUrl(raw) {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('请填写不含账号密码的 HTTP / HTTPS 音乐源地址');
    const response = await fetchAllowed(url.href, null, { allowHttp: url.protocol === 'http:', signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error('无法下载音乐源包');
    const body = (await readLimited(response, MAX_PACKAGE)).toString('utf8');
    return this.previewPackage(body, { kind: 'url', label: /\.js$/i.test(url.pathname) ? url.href : url.origin });
  }
  async setEnabled(id, enabled) {
    this.assertWritable();
    const record = this.records.find(item => item.id === id); if (!record) throw new Error('音乐源不存在');
    record.enabled = Boolean(enabled);
    this.errors.delete(id);
    if (!record.enabled) this.retireSource(id);
    await this.save(); return this.list();
  }
  async configure(id, values) {
    this.assertWritable();
    const record = this.records.find(item => item.id === id); if (!record) throw new Error('音乐源不存在');
    const next = {};
    for (const field of record.manifest.settings) {
      const value = boundedText(values?.[field.key] ?? field.default, 200);
      if (field.type === 'select' && !field.options.includes(value)) throw new Error(`${field.label} 的选项无效`);
      next[field.key] = value;
    }
    if (values?.__allowHttp !== undefined || values?.__allowedHosts !== undefined) record.networkPolicy = sourcePolicy({ allowHttp: values.__allowHttp === 'true', hosts: String(values.__allowedHosts || '').trim() ? String(values.__allowedHosts).split(/[\s,]+/).filter(Boolean) : null });
    this.settings[id] = next; this.retireSource(id);
    await this.save(); return next;
  }
  getSettings(id) {
    const record = this.records.find(item => item.id === id); if (!record) throw new Error('音乐源不存在');
    const policy = sourcePolicy(record.networkPolicy);
    return { ...Object.fromEntries(record.manifest.settings.map(field => [field.key, this.settings[id]?.[field.key] ?? field.default])), __allowHttp: String(policy.allowHttp), __allowedHosts: policy.hosts?.join(', ') || '' };
  }
  async remove(id) {
    this.assertWritable();
    const index = this.records.findIndex(item => item.id === id); if (index < 0) return this.list();
    this.retireSource(id); this.errors.delete(id); this.records.splice(index, 1);
    for (const key of this.coverHints.keys()) if (key.startsWith(`${id}:`)) this.coverHints.delete(key);
    await this.save(); await fs.rm(path.join(this.folder, id), { recursive: true, force: true }); return this.list();
  }
  retireSource(id) { for (const runner of this.runners.values()) if (runner.record.id === id) runner.destroy(); }
  close() { this.stopping = true; for (const request of this.requests.values()) request.abort(new Error('应用正在退出')); for (const runner of this.runners.values()) runner.destroy(); }
  runner(id) {
    if (this.stopping) throw new Error('应用正在退出');
    const record = this.record(id);
    // Each active operation owns its renderer. Cancellation must never kill a
    // different search/lyric/playback request sharing the same provider.
    for (const runner of this.runners.values()) if (runner.record.id === id && !runner.destroyed && !runner.leases && !runner.pending.size) return runner;
    for (const runner of this.runners.values()) if (!runner.leases && !runner.pending.size && !runner.starting) runner.destroy();
    if (this.runners.size >= 8) throw new Error('音乐源任务并发过多，请稍后重试');
    const key = this.runners.has(id) ? `${id}:${randomUUID()}` : id;
    const runner = new SourceRunner(this, record, key);
    this.runners.set(key, runner);
    runner.startTask = fs.readFile(path.join(this.folder, id, record.manifest.version, 'index.js'), 'utf8').then(script => runner.start(script));
    return runner;
  }
  async request(sender, requestId, operation) {
    if (!requestId) return operation(undefined);
    if (!/^[a-f0-9-]{36}$/i.test(requestId) || this.requests.size >= 64) throw new Error('请求令牌无效或并发过多');
    const key = `${sender}:${requestId}`; if (this.requests.has(key)) throw new Error('请求令牌已使用');
    const controller = new AbortController();this.requests.set(key, controller);
    const timer = setTimeout(() => controller.abort(new Error('连接超时')), 25000);timer.unref();
    try { return await operation(controller.signal); }
    finally { clearTimeout(timer);this.requests.delete(key); }
  }
  cancelRequest(sender, requestId) { this.requests.get(`${sender}:${requestId}`)?.abort(new Error('已取消')); }
  async call(id, method, payload, signal) {
    const record = this.record(id);
    if (!record.manifest.capabilities.includes(method)) throw new Error(`该源未提供 ${method}`);
    let runner;
    const cancel = () => runner?.destroy();
    signal?.throwIfAborted();signal?.addEventListener('abort', cancel, { once: true });
    try {
      runner = this.runner(id);
      runner.acquire();
      await runner.startTask;
      signal?.throwIfAborted();
      const result = await runner.invoke(method, payload, this.settings[id] || {});
      if (this.errors.delete(id)) this.broadcast('sources:changed', this.list());
      return result;
    } catch (error) {
      if (signal?.aborted) throw signal.reason || error;
      if (runner && !runner.window) runner.destroy();
      this.errors.set(id, boundedText(error instanceof Error ? error.message : String(error), 180));
      this.broadcast('sources:changed', this.list());
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
      runner?.release();
      // Keep one warm idle script, without interrupting concurrent active requests.
      for (const other of this.runners.values()) if (other !== runner && !other.starting && !other.leases && !other.pending.size) other.destroy();
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
      const buffer = value => {
        if (!(value instanceof Uint8Array) && !Array.isArray(value) || value.length > 1024 * 1024) throw new Error('加密数据无效或过大');
        return Buffer.from(value);
      };
      switch (request?.action) {
        case 'md5': return { value: createHash('md5').update(values.bytes != null ? buffer(values.bytes) : String(values.value || '').slice(0, 1024 * 1024)).digest('hex') };
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
    const runner = this.lxRunner(contentsId);
    if (!(request?.bytes instanceof Uint8Array) && !Array.isArray(request?.bytes) || request.bytes.length > 2 * 1024 * 1024) throw new Error('脚本压缩输入无效或过大');
    const input = Buffer.from(request.bytes);
    const operation = request?.action === 'inflate' ? zlib.inflate : request?.action === 'deflate' ? zlib.deflate : null;
    if (!operation) throw new Error('不支持的 脚本压缩操作');
    const sourceId = runner.record.id;
    this.zlibBySource ||= new Map();
    if (this.zlibActive >= 2 || this.zlibBySource.has(sourceId)) throw new Error('脚本压缩并发过多');
    this.zlibBySource.set(sourceId, true);
    this.zlibActive = (this.zlibActive || 0) + 1;
    let output;
    try { output = await promisify(operation)(input, { maxOutputLength: 4 * 1024 * 1024 }); }
    finally { this.zlibActive -= 1; this.zlibBySource.delete(sourceId); }
    if (output.length > 4 * 1024 * 1024) throw new Error('脚本压缩结果过大');
    return new Uint8Array(output);
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
        const response = await fetchAllowed(request?.url, null, { ...policyOptions(runner.record), method, headers, body, signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) });
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
  async search(id, keyword, cursor = null, pageSize = 25, signal) {
    const record = this.record(id);
    const size = Math.max(1, Math.min(50, Number(pageSize) || 25));
    const platform = this.settings[id]?.lxCatalog || record.manifest.settings[0]?.default;
    const page = Math.max(1, Math.min(100, Number(cursor) || 1));
    const query = boundedText(keyword, 150);
    const catalogKey = JSON.stringify([platform, query, page, size]);
    let result;
    if (record.kind === 'lx') {
      result = this.catalogCache.get(catalogKey);
      if (!result && signal) result = await lxCatalog.search(platform, query, page, size, signal);
      if (!result) {
        let pending = this.catalogPending.get(catalogKey);
        if (!pending) {
          pending = lxCatalog.search(platform, query, page, size).then(value => { this.catalogCache.set(catalogKey, value); return value; }).finally(() => this.catalogPending.delete(catalogKey));
          this.catalogPending.set(catalogKey, pending);
        }
        result = await pending;
      }
    } else result = await this.call(id, 'search', { keyword: query, cursor: cursor == null ? null : boundedText(cursor, 300), pageSize: size }, signal);
    signal?.throwIfAborted();
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
  async resolve(track, quality = 'high', cacheAsId = '', skipCache = false, signal) {
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
    const result = record.kind === 'lx' ? await this.lxPlayback(id, remoteId, quality, signal) : await this.call(id, 'resolvePlayback', { remoteId, quality }, signal);
    if (!result || typeof result.url !== 'string') throw new Error('音乐源没有返回播放地址');
    if (record.kind === 'lx') await checkLxUrl(result.url, sourcePolicy(record.networkPolicy)); else checkUrl(result.url, record.manifest.network.mediaHosts);
    signal?.throwIfAborted();
    const token = randomUUID();
    const headers = this.mediaHeaders(result.headers);
    this.sessions.set(token, { id, remoteId, trackId: cacheId, quality, url: result.url, headers, expiresAt: Number(result.expiresAt) || 0, refreshes: 0 });
    return { audioUrl: `yzqxy://stream/${token}`, actualQuality: boundedText(result.actualQuality || quality, 30), coverUrl, playbackProviderId: id };
  }
  async lxPlayback(id, remoteId, quality, signal) {
    const record = this.record(id);
    const musicInfo = lxCatalog.readInfo(remoteId);
    const supported = record.manifest.lxPlatforms[musicInfo.source]?.qualitys || [];
    if (!supported.length) throw new Error(`音乐源不支持 ${musicInfo.source} 平台`);
    const order = quality === 'lossless24' ? ['flac24bit'] : quality === 'lossless' ? ['flac'] : quality === 'standard' ? ['128k'] : ['320k'];
    let lastError;
    for (const type of order.filter(item => supported.includes(item))) {
      try {
        const answer = await this.call(id, 'resolvePlayback', { source: musicInfo.source, action: 'musicUrl', info: { type, musicInfo } }, signal);
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
      try { return await fetchAllowed(session.url, record.kind === 'lx' ? null : record.manifest.network.mediaHosts, { ...policyOptions(record), headers: requestHeaders, signal: AbortSignal.any([request.signal, controller.signal]) }); }
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
      ? this.audioCache?.captureResponse(session.trackId, session.quality, response, signal => fetchAllowed(session.url, record.kind === 'lx' ? null : record.manifest.network.mediaHosts, { ...policyOptions(record), headers: session.headers, signal })) || response.body
      : response.body;
    return new Response(body, { status: response.status, headers: outgoing });
  }
  async refresh(session) {
    if (session.refreshes >= 1) return;
    session.refreshes += 1;
    const record = this.record(session.id);
    const result = record.kind === 'lx' ? await this.lxPlayback(session.id, session.remoteId, session.quality) : await this.call(session.id, 'resolvePlayback', { remoteId: session.remoteId, quality: session.quality });
    if (record.kind === 'lx') await checkLxUrl(result?.url, sourcePolicy(record.networkPolicy)); else checkUrl(result?.url, record.manifest.network.mediaHosts);
    session.url = result.url; session.headers = this.mediaHeaders(result.headers); session.expiresAt = Number(result.expiresAt) || 0;
  }
  async lyrics(track) {
    const epoch = this.metadataCache.epoch;
    if (!track?.providerId || !track?.remoteId) return null;
    const file = path.join(this.lyricFolder, `${createHash('sha256').update(`${track.providerId}:${track.remoteId}`).digest('hex')}.json`);
    const record = this.records.find(item => item.id === track.providerId);
    if (record?.kind === 'lx') {
      try { return JSON.parse(await readBoundedFile(file, 1024 * 1024, 'utf8')); } catch {}
    }
    if (!record?.enabled || (record.kind !== 'lx' && !record.manifest.capabilities.includes('lyrics'))) {
      try { return JSON.parse(await readBoundedFile(file, 1024 * 1024, 'utf8')); } catch { return null; }
    }
    try {
      const result = record.kind === 'lx' ? await lxCatalog.lyrics(lxCatalog.readInfo(track.remoteId)) : await this.call(track.providerId, 'lyrics', { remoteId: track.remoteId });
      const lyrics = typeof result === 'string' ? { text: result.slice(0, 200000), format: 'lrc', source: 'custom' }
        : result && typeof result.text === 'string' ? { text: result.text.slice(0, 200000), translationText: typeof result.translationText === 'string' ? result.translationText.slice(0, 100000) : undefined, format: boundedText(result.format || 'lrc', 15), source: 'custom' } : null;
      if (lyrics && this.metadataCache.writeEnabled && epoch === this.metadataCache.epoch) { await fs.writeFile(file, JSON.stringify(lyrics), 'utf8').catch(() => this.metadataCache.failWrite()); if (epoch !== this.metadataCache.epoch) await fs.rm(file, { force: true }); }
      this.metadataCache.schedule();
      return lyrics;
    } catch (error) {
      try { return JSON.parse(await readBoundedFile(file, 1024 * 1024, 'utf8')); } catch { throw error; }
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
    const epoch = this.metadataCache.epoch;
    try {
      const key = `${id}:${remoteId}`;
      if (this.coverCache.has(key)) { const hit = this.coverCache.get(key); return hit; }
      const hash = createHash('sha256').update(key).digest('hex');
      try {
        const [data, type] = await Promise.all([readBoundedFile(path.join(this.coverFolder, `${hash}.bin`), 5 * 1024 * 1024), readBoundedFile(path.join(this.coverFolder, `${hash}.type`), 256, 'utf8')]);
        if (data.length && data.length <= 5 * 1024 * 1024 && type.startsWith('image/')) { const value = { data, type }; if (epoch === this.metadataCache.epoch) this.coverCache.set(key, value); return value; }
      } catch {}
      const record = this.record(id);
      const url = this.coverHints.get(key) || (record.kind === 'lx' ? await lxCatalog.artwork(lxCatalog.readInfo(remoteId)) : (await this.call(id, 'artwork', { remoteId }))?.url);
      if (record.kind === 'lx') await checkLxUrl(url, sourcePolicy(record.networkPolicy)); else checkUrl(url, record.manifest.network.artworkHosts);
      const response = await fetchAllowed(url, record.kind === 'lx' ? null : record.manifest.network.artworkHosts, { ...policyOptions(record), signal: AbortSignal.timeout(10000) });
      if (!response.ok) { await response.body?.cancel().catch(() => {}); return { status: response.status }; }
      const type = response.headers.get('content-type') || 'image/jpeg';
      if (!type.startsWith('image/')) { await response.body?.cancel().catch(() => {}); throw new Error('封面格式无效'); }
      const data = await readLimited(response, 5 * 1024 * 1024);
      if (epoch !== this.metadataCache.epoch) return { data, type };
      this.coverCache.set(key, { data, type });
      if (!this.metadataCache.writeEnabled) { this.metadataCache.schedule(); return { data, type }; }
      const files = [path.join(this.coverFolder, `${hash}.bin`), path.join(this.coverFolder, `${hash}.type`)];
      await Promise.all([fs.writeFile(files[0], data), fs.writeFile(files[1], type)]).catch(() => this.metadataCache.failWrite());
      if (epoch !== this.metadataCache.epoch) await Promise.all(files.map(file => fs.rm(file, { force: true })));
      this.metadataCache.schedule();
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
    const manifest = await readBoundedFile(path.join(folder, 'manifest.json'), MAX_PACKAGE, 'utf8');
    const script = await readBoundedFile(path.join(folder, 'index.js'), MAX_PACKAGE - Buffer.byteLength(manifest), 'utf8');
    return this.previewPackage(JSON.stringify({ manifest: JSON.parse(manifest), script }), { kind: 'file', label: folder });
  }
}

module.exports = { SourceManager };
