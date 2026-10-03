const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, createPublicKey, verify } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { fetchAllowed, readLimited, checkLxUrl } = require('./source-network.cjs');
const config = require('../../config/distribution.json');
const hosts = ['raw.githubusercontent.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'];
const LIMIT = 512 * 1024 * 1024;
function newer(version, current) {
  const parse = value => /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(value);
  const a = parse(version), b = parse(current); if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) if (+a[i] !== +b[i]) return +a[i] > +b[i];
  if (!a[4] || !b[4]) return !a[4] && !!b[4];
  const av = a[4].split('.'), bv = b[4].split('.');
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    if (av[i] === bv[i]) continue;
    if (av[i] === undefined || bv[i] === undefined) return bv[i] === undefined;
    const an = /^\d+$/.test(av[i]), bn = /^\d+$/.test(bv[i]);
    return an && bn ? +av[i] > +bv[i] : an !== bn ? !an : av[i] > bv[i];
  } return false;
}
class Updates {
  constructor(app) {
    this.app = app; this.directory = path.join(app.getPath('userData'), 'updates');
    this.state = { status: 'idle', currentVersion: app.getVersion(), progress: 0, message: '尚未检查更新' };
  }
  async text(url, limit = 4 * 1024 * 1024, restricted = false) {
    if (new URL(url).protocol !== 'https:') throw new Error('请使用 HTTPS 地址');
    await checkLxUrl(url);
    const response = await fetchAllowed(url, restricted ? hosts : [...hosts, new URL(url).hostname], { signal: AbortSignal.timeout(25000) });
    if (!response.ok) { await response.body?.cancel(); const error = new Error(`连接失败（HTTP ${response.status}）`); error.status = response.status; throw error; }
    return (await readLimited(response, limit)).toString('utf8');
  }
  async check(channel) {
    if (this.downloading || ['checking', 'downloading', 'installing'].includes(this.state.status)) return this.state;
    if (!['stable', 'preview'].includes(channel)) throw new Error('更新通道无效');
    this.state = { status: 'checking', currentVersion: this.app.getVersion(), progress: 0, message: '正在检查更新' };
    this.artifact = null; this.file = null;
    try {
      const envelope = JSON.parse(await this.text(config.feeds[channel], 256 * 1024, true));
      const payload = Buffer.from(envelope.payload || '', 'base64'), signature = Buffer.from(envelope.signature || '', 'base64');
      const key = createPublicKey({ key: Buffer.from(config.publicKeySpki, 'base64'), type: 'spki', format: 'der' });
      if (envelope.format !== 'zenix-signed-release' || !verify('RSA-SHA256', payload, key, signature)) throw new Error('发布签名校验失败，已停止更新');
      const manifest = JSON.parse(payload.toString('utf8'));
      if (manifest.schemaVersion !== 1 || manifest.channel !== channel) throw new Error('更新清单格式错误');
      const item = manifest.artifacts?.windows;
      if (!item) { this.state.status = 'unpublished'; this.state.message = '当前通道尚未发布 Windows 更新'; return this.state; }
      if (!newer(item.version, this.app.getVersion())) { this.state.status = 'current'; this.state.message = '已是此通道的最新版本'; return this.state; }
      const url = new URL(item.url);
      if (url.origin !== 'https://github.com' || !url.pathname.startsWith('/17hwliao/Zenix/releases/download/') || !url.pathname.endsWith('.exe') || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > LIMIT) throw new Error('安装包信息无效');
      this.artifact = item;
      this.state = { ...this.state, status: 'available', version: item.version, notes: String(manifest.notes || '').slice(0, 4000), message: `发现新版本 ${item.version}` };
    } catch (error) { this.state.status = error.status === 404 ? 'unpublished' : 'error'; this.state.message = error.status === 404 ? '此通道尚未发布更新清单' : error.message; }
    return this.state;
  }
  async download() {
    if (this.downloading || !this.artifact || !['available', 'error', 'ready'].includes(this.state.status)) return this.state;
    this.downloading = true;
    const item = this.artifact; this.state.status = 'downloading'; this.state.progress = 0; this.state.message = '正在下载更新，音乐继续播放';
    const target = path.join(this.directory, item.sha256 + '.exe'), partial = target + '.part';
    const controller = new AbortController(); this.controller = controller; const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000); timer.unref();
    let reader, handle, complete = false;
    try {
      await fs.mkdir(this.directory, { recursive: true });
      if (await this.matches(target, item)) { this.file = target; this.state.status = 'ready'; this.state.progress = 100; this.state.message = '已读取校验通过的更新包，确认后重启安装'; return this.state; }
      const response = await fetchAllowed(item.url, hosts, { signal: controller.signal });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`下载失败（HTTP ${response.status}）`); }
      if (Number(response.headers.get('content-length')) > item.size) { await response.body?.cancel(); throw new Error('安装包大小与发布记录不一致'); }
      reader = response.body.getReader(); handle = await fs.open(partial, 'w'); const hash = createHash('sha256'); let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) { complete = true; break; } size += value.length; if (size > item.size) throw new Error('安装包超过声明大小'); hash.update(value); await handle.writeFile(value); this.state.progress = Math.round(size / item.size * 100); }
      await handle.close(); handle = null;
      if (size !== item.size || hash.digest('hex') !== item.sha256) throw new Error('安装包校验失败，请重新下载');
      await fs.rename(partial, target); this.file = target;
      for (const file of await fs.readdir(this.directory)) if (file !== path.basename(target) && /^(?:[a-f0-9]{64}\.exe)(?:\.part)?$/.test(file)) await fs.unlink(path.join(this.directory, file)).catch(() => {});
      this.state.status = 'ready'; this.state.message = '更新已就绪，确认后重启安装';
    } catch (error) { this.state.status = 'error'; this.state.message = controller.signal.aborted ? '下载已取消或超时，可重新尝试' : error.message; }
    finally { clearTimeout(timer); if (reader) { if (!complete) await reader.cancel().catch(() => {}); reader.releaseLock(); } await handle?.close().catch(() => {}); await fs.unlink(partial).catch(() => {}); this.controller = null; this.downloading = false; }
    return this.state;
  }
  async matches(file, item) {
    let handle;
    try { if ((await fs.stat(file)).size !== item.size) return false; handle = await fs.open(file, 'r'); const hash = createHash('sha256'); for await (const chunk of handle.createReadStream()) hash.update(chunk); return hash.digest('hex') === item.sha256; }
    catch { return false; } finally { await handle?.close().catch(() => {}); }
  }
  async install() {
    if (!this.app.isPackaged) throw new Error('开发模式不能覆盖安装，请使用发行版');
    if (process.platform !== 'win32' || !this.file || this.state.status !== 'ready') throw new Error('安装包尚未就绪');
    const hash = createHash('sha256'); const file = await fs.open(this.file, 'r');
    try { for await (const chunk of file.createReadStream()) hash.update(chunk); } finally { await file.close().catch(() => {}); }
    if (hash.digest('hex') !== this.artifact.sha256) throw new Error('安装包发生变化，请重新下载');
    // Authenticode identity is distinct from our update-manifest signature.
    if (!config.windowsPublisher) throw new Error('当前发行配置尚未设置 Windows 代码签名发行方');
    const script = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $s=Get-AuthenticodeSignature -LiteralPath '" + this.file.replace(/'/g, "''") + "'; @{status=[string]$s.Status; subject=$s.SignerCertificate.Subject} | ConvertTo-Json -Compress";
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000 });
    const signing = JSON.parse(stdout.trim());
    if (signing.status !== 'Valid' || signing.subject !== config.windowsPublisher) throw new Error('Windows 安装包签名或发行方不匹配');
    // NSIS --updated preserves app data; interactive installation respects user choices.
    const child = spawn(this.file, ['--updated'], { detached: true, stdio: 'ignore', windowsHide: true });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
    this.state.status = 'installing'; this.app.quit(); return this.state;
  }
  async invoke(args) {
    switch (args.operation) {
      case 'state': return this.state;
      case 'check': return this.check(args.channel || 'stable');
      case 'download': return this.download();
      case 'cancel': this.controller?.abort(); return this.state;
      case 'install': return this.install();
      case 'sourceBundle': return this.text(args.url || config.managedSourcesUrl || (() => { throw new Error('尚未配置专用源分享地址，可导入分享包文件或粘贴链接'); })());
      default: throw new Error('无效更新操作');
    }
  }
  stop() { this.controller?.abort(); }
}
module.exports = { Updates };
