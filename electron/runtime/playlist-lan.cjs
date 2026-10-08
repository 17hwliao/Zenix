const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const { decodeBundle, MAX_BYTES } = require('../playlist-format.cjs');
const WIRE_LIMIT = 3 * 1024 * 1024;
function privateAddress(address, loopback = false) {
  const ip = String(address || '').replace(/^::ffff:/, '');
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some(x => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || loopback && a === 127;
}
function key(code) { if (!/^[a-f0-9]{16}$/i.test(code)) throw Error('请输入接收端的 16 位配对码'); return crypto.createHash('sha256').update(code.toLowerCase()).digest(); }
function seal(text, code) {
  const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(code), nonce);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return JSON.stringify({ nonce: nonce.toString('base64'), data: data.toString('base64') });
}
function unseal(text, code) {
  const value = JSON.parse(text), nonce = Buffer.from(value.nonce || '', 'base64'), data = Buffer.from(value.data || '', 'base64');
  if (nonce.length !== 12 || data.length < 16 || data.length > MAX_BYTES + 16) throw Error('无效迁移请求');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(code), nonce); decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString('utf8');
}
class PlaylistLan {
  constructor(onIncoming) { this.onIncoming = onIncoming; this.server = null; this.info = { listening: false, addresses: [] }; }
  status() { return { ...this.info }; }
  stop() { clearTimeout(this.expiry); this.server?.close(); this.server?.closeAllConnections(); this.server = null; this.info = { listening: false, addresses: [] }; }
  async start() {
    this.stop(); const code = crypto.randomBytes(8).toString('hex'); let attempts = 0, busy = false;
    const server = http.createServer(async (request, response) => {
      const reply = (status, message) => { if (!response.destroyed) { response.writeHead(status, { 'Content-Type': 'application/json', 'Connection': 'close' }); response.end(JSON.stringify({ message })); } };
      if (request.method !== 'POST' || request.url !== '/zenix/playlist' || !privateAddress(request.socket.remoteAddress, true)) { reply(403, '请求不允许'); return; }
      if (busy) { reply(409, '接收端正在处理歌单'); return; }
      if (++attempts > 20) { reply(429, '配对尝试过多，请重新开启接收'); setImmediate(() => this.stop()); return; }
      busy = true;
      try {
        const chunks = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; if (size > WIRE_LIMIT) throw Error('请求太大'); chunks.push(chunk); }
        const bundle = decodeBundle(unseal(Buffer.concat(chunks).toString('utf8'), code));
        this.onIncoming(bundle); reply(200, '已送达，请在接收端确认导入');
        setImmediate(() => this.stop());
      } catch { reply(400, '配对码不匹配或歌单无效'); } finally { busy = false; }
    });
    server.requestTimeout = 10000; server.headersTimeout = 5000; server.maxConnections = 2;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', resolve); });
    server.on('error', () => this.stop()); this.server = server;
    const port = server.address().port;
    const addresses = Object.values(os.networkInterfaces()).flat().filter(x => x && x.family === 'IPv4' && !x.internal && privateAddress(x.address)).map(x => `${x.address}:${port}`);
    this.info = { listening: true, addresses: [...new Set(addresses)], code, expiresAt: Date.now() + 15 * 60000 };
    this.expiry = setTimeout(() => this.stop(), 15 * 60000); this.expiry.unref(); return this.status();
  }
  async send(address, code, bundle) {
    const match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(address.trim());
    if (!match || !privateAddress(match[1], true) || +match[2] < 1 || +match[2] > 65535) throw Error('请输入接收端显示的局域网 IP:端口');
    const body = seal(JSON.stringify(bundle), code);
    return new Promise((resolve, reject) => {
      const request = http.request({ hostname: match[1], port: +match[2], path: '/zenix/playlist', method: 'POST', timeout: 10000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > 8192) response.destroy(Error('回复过大')); else chunks.push(chunk); });
        response.on('error', reject); response.on('end', () => {
          if (response.statusCode === 200) resolve(true); else reject(Error('发送未成功，请核对配对码并重新开启接收'));
        });
      });
      request.on('timeout', () => request.destroy(Error('连接超时，请检查同一 Wi-Fi、接收状态与防火墙'))); request.on('error', reject); request.end(body);
    });
  }
}
module.exports = { PlaylistLan, privateAddress, seal, unseal };
