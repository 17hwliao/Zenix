const { lookup } = require('node:dns/promises');
const { isIP } = require('node:net');
const { Agent } = require('undici');
const dnsPending = new Map();
const pools = new Map();
function matchesHost(host, pattern) { return pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) && host !== pattern.slice(2) : host === pattern; }

function checkUrl(raw, patterns) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('音乐源返回了无效 URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('音乐源返回了不支持的 URL');
  if (url.protocol === 'http:') throw new Error('远程音乐源只能使用 HTTPS');
  if (!patterns.some(pattern => matchesHost(url.hostname.toLowerCase(), pattern))) throw new Error(`音乐源未授权访问 ${url.hostname}`);
  return url;
}

async function fetchAllowed(raw, patterns, options = {}) {
  const { allowHttp = false, allowedHosts = null, ...transport } = options;
  const policy = { allowHttp, hosts: allowedHosts };
  let url = patterns === null ? publicPolicyUrl(raw, policy) : checkUrl(raw, patterns);
  let request = { ...transport, headers: new Headers(options.headers || {}) };
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const addresses = await resolveAddresses(url.hostname);
    options.signal?.throwIfAborted();
    const dispatcher = pinnedPool(url, addresses);
    const response = await fetch(url, { ...request, dispatcher, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    await response.body?.cancel().catch(() => {});
    const next = patterns === null ? publicPolicyUrl(new URL(location, url).href, policy) : checkUrl(new URL(location, url).href, patterns);
    if (url.protocol === 'https:' && next.protocol !== 'https:') throw new Error('禁止将安全连接重定向到 HTTP');
    if (url.origin !== next.origin) for (const key of [...request.headers.keys()]) {
      if (/authorization|cookie|token|api[-_]?key/i.test(key)) request.headers.delete(key);
    }
    const method = String(request.method || 'GET').toUpperCase();
    if (response.status === 303 && method !== 'HEAD' || ([301, 302].includes(response.status) && method === 'POST')) {
      request = { ...request, method: 'GET', body: undefined };
      request.headers.delete('content-type'); request.headers.delete('content-length');
    }
    url = next;
  }
  throw new Error('音乐源重定向次数过多');
}

function isPrivateAddress(address) {
  // Accept only ordinary global IPv6 unicast. Exclude translation/tunnel and
  // documentation ranges so an embedded private IPv4 cannot bypass the check.
  if (address.includes(':')) { const parts = address.split(':'); const first = parseInt(parts[0], 16) || 0, second = parseInt(parts[1], 16) || 0; return first < 0x2000 || first >= 0x4000 || first === 0x2001 && (second < 0x200 || second === 0xdb8) || first === 0x2002 || first === 0x3fff; }
  const [a, b, c] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113 || a >= 224;
}
function parsePublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('音乐源脚本返回了无效 URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname || /(?:^localhost$|\.localhost$|\.local$|\.internal$)/i.test(url.hostname)) throw new Error('音乐源脚本请求了不允许的地址');
  return url;
}
async function resolveAddresses(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('音乐源脚本不能访问本机或私有网络');
    return [{ address: host, family: isIP(host) }];
  }
  let pending = dnsPending.get(host);
  if (!pending) {
    if (dnsPending.size >= 64) throw new Error('域名查询并发过多，请稍后重试');
    // System lookup cannot be aborted. Hold its slot until it actually settles,
    // even if callers have already timed out, to keep real DNS work bounded.
    pending = lookup(host, { all: true }).finally(() => { if (dnsPending.get(host) === pending) dnsPending.delete(host); });
    // Share only concurrent validation; do not retain an old public address across
    // requests when the domain may subsequently resolve into a private network.
    dnsPending.set(host, pending);
  }
  let timer;
  let addresses;
  try { addresses = await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('音乐源域名查询超时')), 5000); })]); }
  finally { clearTimeout(timer); }
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) throw new Error('音乐源脚本不能访问本机或私有网络');
  return addresses;
}
function publicPolicyUrl(raw, policy = {}) {
  const url = parsePublicUrl(raw);
  if (url.protocol !== 'https:' && !policy.allowHttp) throw new Error('该音乐源尚未授权 HTTP，请在源选项中开启兼容访问');
  if (policy.hosts != null && !policy.hosts.some(pattern => matchesHost(url.hostname.toLowerCase(), pattern))) throw new Error('地址不在该音乐源授权域名范围');
  return url;
}
async function checkLxUrl(raw, policy) {
  const url = publicPolicyUrl(raw, policy);
  await resolveAddresses(url.hostname);
  return url;
}
function pinnedPool(url, addresses) {
  const key = `${url.origin}|${addresses.map(item => item.address).sort().join(',')}`;
  const existing = pools.get(key);
  if (existing) { pools.delete(key); pools.set(key, existing); return existing; }
  const agent = new Agent({ connections: 2, pipelining: 1, headersTimeout: 15000, bodyTimeout: 15000, keepAliveTimeout: 10000, connect: {
    timeout: 8000,
    lookup: (_host, options, callback) => {
      const filtered = options.family ? addresses.filter(item => item.family === options.family) : addresses;
      if (!filtered.length) return callback(Object.assign(new Error('没有匹配的安全网络地址'), { code: 'ENOTFOUND' }));
      options.all ? callback(null, filtered) : callback(null, filtered[0].address, filtered[0].family);
    },
  } });
  pools.set(key, agent);
  while (pools.size > 24) { const first = pools.keys().next().value; const old = pools.get(first); pools.delete(first); void old.close().catch(() => {}); }
  return agent;
}
function closeNetwork() { for (const agent of pools.values()) void agent.destroy().catch(() => {}); pools.clear(); }

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

module.exports = { checkUrl, checkLxUrl, fetchAllowed, readLimited, closeNetwork };
