// Built-in update origins use Chromium's system proxy / DNS routing. Untrusted
// music-source requests retain their separate SSRF policy in source-network.
const HOSTS = new Set(['raw.githubusercontent.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
function updateUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('更新地址格式无效'); }
  if (url.protocol !== 'https:' || url.port && url.port !== '443' || url.username || url.password || url.hash || !HOSTS.has(url.hostname)) throw new Error('更新地址必须使用允许的 GitHub HTTPS 服务器');
  return url;
}
async function fetchUpdate(raw, { signal } = {}, transport = (url, options) => require('electron').net.fetch(url, options)) {
  let url = updateUrl(raw);
  for (let hop = 0; hop <= 5; hop++) {
    signal?.throwIfAborted();
    const response = await transport(url.href, { method: 'GET', redirect: 'manual', signal, credentials: 'omit', cache: 'no-store', bypassCustomProtocolHandlers: true, headers: { 'User-Agent': 'Zenix Windows Updates', 'Accept-Encoding': 'identity' } });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (hop === 5 || !location) throw new Error('更新下载重定向无效或次数过多');
    url = updateUrl(new URL(location, url).href);
  }
  throw new Error('更新下载重定向次数过多');
}
module.exports = { updateUrl, fetchUpdate };
