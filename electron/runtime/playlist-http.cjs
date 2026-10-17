const { fetchPublicOnce, readLimited } = require('./source-network.cjs');
const HOSTS = ['y.qq.com','i.y.qq.com','i2.y.qq.com','c.y.qq.com','u.y.qq.com','c6.y.qq.com','music.163.com','y.music.163.com','163cn.tv','www.kuwo.cn','kuwo.cn','h5app.kuwo.cn','nplserver.kuwo.cn'];
function address(raw) {
  if (typeof raw !== 'string' || raw.length > 8192) throw Error('歌单地址无效');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !HOSTS.includes(url.hostname)) throw Error('只能读取支持平台的 HTTPS 公开歌单');
  return url;
}
async function playlistRequest(args) {
  let url = address(args.url), method = args.method || 'GET', body = args.body;
  if (!['GET','POST'].includes(method) || method === 'POST' && (url.hostname !== 'u.y.qq.com' || url.pathname !== '/cgi-bin/musicu.fcg') || body != null && (typeof body !== 'string' || Buffer.byteLength(body) > 32768)) throw Error('歌单请求无效');
  const signal = AbortSignal.timeout(25000);
  for (let hop = 0; hop <= 5; hop++) {
    if (method === 'POST' && (url.hostname !== 'u.y.qq.com' || url.pathname !== '/cgi-bin/musicu.fcg')) throw Error('歌单请求跳转到了不支持的接口');
    const referer = url.hostname.endsWith('qq.com') ? 'https://y.qq.com/' : url.hostname.includes('163') || url.hostname === '163cn.tv' ? 'https://music.163.com/' : 'https://www.kuwo.cn/';
    const response = await fetchPublicOnce(url.href, HOSTS, { method, body: method === 'POST' ? body : undefined, signal, headers: { Referer: referer, 'User-Agent': 'Mozilla/5.0 Zenix', ...(method === 'POST' ? {'Content-Type':'application/json'} : {}) } });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel().catch(()=>{});
      if (!location || hop === 5) throw Error('歌单链接重定向无效或次数过多');
      url = address(new URL(location,url).href);
      if ([301,302,303].includes(response.status)) { method = 'GET'; body = undefined; }
      continue;
    }
    return { url: url.href, status: response.status, text: (await readLimited(response, 4*1024*1024)).toString('utf8') };
  }
}
module.exports = { playlistRequest, address };
