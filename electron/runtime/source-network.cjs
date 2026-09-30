const { lookup } = require('node:dns/promises');
const { isIP } = require('node:net');
const dnsPending = new Map();
function matchesHost(host, pattern) { return pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) && host !== pattern.slice(2) : host === pattern; }

function checkUrl(raw, patterns) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('音乐源返回了无效 URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('音乐源返回了不支持的 URL');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('远程音乐源只能使用 HTTPS');
  if (!patterns.some(pattern => matchesHost(url.hostname.toLowerCase(), pattern))) throw new Error(`音乐源未授权访问 ${url.hostname}`);
  return url;
}

async function fetchAllowed(raw, patterns, options = {}) {
  let url = patterns === null ? await checkLxUrl(raw) : checkUrl(raw, patterns);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(url, { ...options, redirect: 'manual' });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    await response.body?.cancel().catch(() => {});
    url = patterns === null ? await checkLxUrl(new URL(location, url).href) : checkUrl(new URL(location, url).href, patterns);
  }
  throw new Error('音乐源重定向次数过多');
}

function isPrivateAddress(address) {
  if (address.includes(':')) return /^(::|fe80:|fc|fd|2001:db8:|::ffff:(?:10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.))/i.test(address);
  const [a, b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224;
}
async function checkLxUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('音乐源脚本返回了无效 URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname || /(?:^localhost$|\.localhost$|\.local$|\.internal$)/i.test(url.hostname)) throw new Error('音乐源脚本请求了不允许的地址');
  if (isIP(url.hostname) && isPrivateAddress(url.hostname)) throw new Error('音乐源脚本不能访问本机或私有网络');
  let pending = dnsPending.get(url.hostname);
  if (!pending) {
    pending = (async () => {
      let timer;
      try { return await Promise.race([lookup(url.hostname, { all: true }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('音乐源域名查询超时')), 5000); })]); }
      finally { clearTimeout(timer); dnsPending.delete(url.hostname); }
    })();
    // Share only concurrent validation; do not retain an old public address across
    // requests when the domain may subsequently resolve into a private network.
    if (dnsPending.size < 64) dnsPending.set(url.hostname, pending);
  }
  const addresses = await pending;
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) throw new Error('音乐源脚本不能访问本机或私有网络');
  return url;
}

async function readLimited(response, maxBytes) {
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel().catch(() => {}); throw new Error('音乐源响应过大'); }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = []; let length = 0; let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      length += value.byteLength;
      if (length > maxBytes) throw new Error('音乐源响应过大');
      chunks.push(value);
    }
  } finally { if (!complete) await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

module.exports = { checkUrl, checkLxUrl, fetchAllowed, readLimited };
