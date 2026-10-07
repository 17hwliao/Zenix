const { createHash } = require('node:crypto');
const { inflateSync } = require('node:zlib');
const { AsyncLocalStorage } = require('node:async_hooks');
const { fetchAllowed, readLimited } = require('./runtime/source-network.cjs');
const context = new AsyncLocalStorage();
const fetch = (url, options = {}) => fetchAllowed(url, null, { ...options, signal: context.getStore() ? AbortSignal.any([context.getStore(), options.signal || AbortSignal.timeout(11000)]) : options.signal || AbortSignal.timeout(11000) });

const PLATFORMS = { kw: '酷我', kg: '酷狗', tx: 'QQ 音乐', wy: '网易云', mg: '咪咕' };
const MAX_INFO = 4096;

function compactInfo(info) {
  const data = JSON.stringify(info);
  if (Buffer.byteLength(data) > MAX_INFO) throw new Error('LX 歌曲信息过大');
  return Buffer.from(data).toString('base64url');
}

function readInfo(remoteId) {
  if (typeof remoteId !== 'string' || remoteId.length > 6000) throw new Error('LX 歌曲信息无效');
  const info = JSON.parse(Buffer.from(remoteId, 'base64url').toString('utf8'));
  if (!info || !PLATFORMS[info.source] || !info.songmid) throw new Error('LX 歌曲信息无效');
  return info;
}

function qualityTypes(values) {
  return Object.fromEntries(Object.entries(values).filter(([, hash]) => Boolean(hash)).map(([type, hash]) => [type, { hash }]));
}

function normalize(name, artist, album, duration, coverUrl, info) {
  const seconds = Math.max(0, Number(duration) || 0);
  info.interval = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
  info.img = /^https:\/\//i.test(coverUrl || '') ? coverUrl : null;
  info.lrc = null;
  info.typeUrl = {};
  info.otherSource = null;
  return {
    remoteId: compactInfo(info), title: String(name || '').trim(), artist: String(artist || '').trim(),
    album: String(album || '').trim(), duration: seconds,
    coverUrl: /^https:\/\//i.test(coverUrl || '') ? coverUrl : undefined,
  };
}

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(11000) });
  if (!response.ok) throw new Error(`LX 歌曲目录返回 HTTP ${response.status}`);
  const text = (await readLimited(response, 2 * 1024 * 1024)).toString('utf8');
  if (text.length > 2 * 1024 * 1024) throw new Error('LX 歌曲目录响应过大');
  return JSON.parse(text);
}

async function searchKw(keyword, page, size) {
  const query = new URLSearchParams({ client: 'kt', all: keyword, pn: String(page - 1), rn: String(size), uid: '794762570', ver: 'kwplayer_ar_9.2.2.1', vipver: '1', show_copyright_off: '1', newver: '1', ft: 'music', cluster: '0', strategy: '2012', encoding: 'utf8', rformat: 'json', vermerge: '1', mobi: '1', issubtitle: '1' });
  const data = await json(`https://search.kuwo.cn/r.s?${query}`);
  return {
    total: Number(data.TOTAL) || 0,
    items: (data.abslist || []).map(song => {
      const songmid = String(song.MUSICRID || '').replace(/^MUSIC_/, '');
      if (!songmid) return null;
      const info = { source: 'kw', songmid, name: song.SONGNAME || song.NAME, singer: song.ARTIST, albumName: song.ALBUM, albumId: song.ALBUMID, types: [{ type: '128k' }, { type: '320k' }, { type: 'flac' }], _types: {} };
      return normalize(info.name, info.singer, info.albumName, song.DURATION, '', info);
    }).filter(Boolean),
  };
}

async function searchKg(keyword, page, size) {
  const query = new URLSearchParams({ platform: 'AndroidFilter', iscorrection: '1', keyword, hifiquality: '0', pagesize: String(size), PrivilegeFilter: '0', page: String(page) });
  const data = await json(`https://songsearch.kugou.com/song_search_v2?${query}`);
  if (data.error_code !== 0) throw new Error(data.error_msg || '酷狗歌曲目录搜索失败');
  return {
    total: Number(data.data?.total) || 0,
    items: (data.data?.lists || []).map(song => {
      const hashes = { '128k': song.FileHash, '320k': song.HQFileHash, flac: song.SQFileHash, flac24bit: song.ResFileHash };
      const info = { source: 'kg', songmid: song.Audioid, albumAudioId: song.MixSongID, hash: song.FileHash, name: song.OriSongName || song.SongName, singer: (song.Singers || []).map(item => item.name).join('、') || song.SingerName, albumName: song.AlbumName, albumId: song.AlbumID, types: Object.entries(hashes).filter(([, hash]) => hash).map(([type, hash]) => ({ type, hash })), _types: qualityTypes(hashes) };
      return info.songmid ? normalize(info.name, info.singer, info.albumName, song.Duration, '', info) : null;
    }).filter(Boolean),
  };
}

async function searchWy(keyword, page, size) {
  const query = new URLSearchParams({ s: keyword, type: '1', offset: String((page - 1) * size), limit: String(size) });
  const data = await json(`https://music.163.com/api/search/get/web?${query}`);
  return {
    total: Number(data.result?.songCount) || 0,
    items: (data.result?.songs || []).map(song => {
      const info = { source: 'wy', songmid: song.id, name: song.name, singer: (song.artists || []).map(item => item.name).join('、'), albumName: song.album?.name, albumId: song.album?.id, types: [{ type: '128k' }, { type: '320k' }, { type: 'flac' }], _types: {} };
      return info.songmid ? normalize(info.name, info.singer, info.albumName, (song.duration || 0) / 1000, song.album?.picUrl, info) : null;
    }).filter(Boolean),
  };
}

async function searchTx(keyword, page, size) {
  const request = { comm: { ct: '19', cv: '1851' }, req: { module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicDesktop', param: { query: keyword, page_num: page, num_per_page: size, search_type: 0 } } };
  const data = await json(`https://u.y.qq.com/cgi-bin/musicu.fcg?data=${encodeURIComponent(JSON.stringify(request))}`);
  const body = data.req?.data?.body?.song;
  if (!body) throw new Error('QQ 音乐歌曲目录搜索失败');
  return {
    total: Number(data.req?.data?.meta?.sum || data.req?.data?.meta?.estimate_sum) || 0,
    items: (body.list || []).map(song => {
      const mid = song.file?.media_mid;
      const albumMid = song.album?.mid || '';
      const info = { source: 'tx', songmid: song.mid, songId: song.id, strMediaMid: mid, albumMid, albumId: albumMid, name: song.title, singer: (song.singer || []).map(item => item.name).join('、'), albumName: song.album?.name, types: [{ type: '128k' }, { type: '320k' }, { type: 'flac' }], _types: {} };
      return mid && info.songmid ? normalize(info.name, info.singer, info.albumName, song.interval, albumMid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg` : '', info) : null;
    }).filter(Boolean),
  };
}

async function searchMg(keyword, page, size) {
  const time = Date.now().toString();
  // Upstream protocol compatibility constants, not Zenix user credentials.
  // Changes require checking the catalogue protocol; keep them isolated here.
  const deviceId = '963B7AA0D21511ED807EE5846EC87D20';
  const sign = createHash('md5').update(`${keyword}6cdc72a439cef99a3418d2a78aa28c73yyapp2d16148780a1dcc7408e06336b98cfd50${deviceId}${time}`).digest('hex');
  const query = new URLSearchParams({ isCorrect: '0', isCopyright: '1', searchSwitch: JSON.stringify({ song: 1, album: 0, singer: 0, tagSong: 1, mvSong: 0, bestShow: 1, songlist: 0, lyricSong: 0 }), pageSize: String(size), text: keyword, pageNo: String(page), sort: '0', sid: 'USS' });
  const data = await json(`https://jadeite.migu.cn/music_search/v3/search/searchAll?${query}`, { headers: { uiVersion: 'A_music_3.6.1', deviceId, timestamp: time, sign, channel: '0146921', 'User-Agent': 'Mozilla/5.0 (Linux; Android 11.0.0) AppleWebKit/534.30 Mobile Safari/534.30' } });
  if (data.code !== '000000') throw new Error(data.info || '咪咕歌曲目录搜索失败');
  return {
    total: Number(data.songResultData?.totalCount) || 0,
    items: (data.songResultData?.resultList || []).flat().slice(0, size).map(song => {
      const info = { source: 'mg', songmid: song.songId, copyrightId: song.copyrightId, name: song.name, singer: (song.singerList || []).map(item => item.name).join('、'), albumName: song.album, albumId: song.albumId, lrcUrl: song.lrcUrl, types: (song.audioFormats || []).map(item => ({ type: ({ PQ: '128k', HQ: '320k', SQ: 'flac', ZQ24: 'flac24bit' })[item.formatType] })).filter(item => item.type), _types: {} };
      const image = song.img3 || song.img2 || song.img1;
      return info.songmid && info.copyrightId ? normalize(info.name, info.singer, info.albumName, song.duration, image?.startsWith('https:') ? image : '', info) : null;
    }).filter(Boolean),
  };
}

const SEARCH = { kw: searchKw, kg: searchKg, tx: searchTx, wy: searchWy, mg: searchMg };

async function search(platform, keyword, page, size, signal) {
  if (signal) return context.run(signal, () => search(platform, keyword, page, size));
  if (!SEARCH[platform]) throw new Error(`Zenix 尚无 ${platform} 的 LX 歌曲目录适配`);
  const result = await SEARCH[platform](keyword, page, size);
  return { items: result.items, nextCursor: result.items.length && page * size < result.total ? String(page + 1) : null };
}

async function artwork(info) {
  if (typeof info.img === 'string' && /^https?:\/\//i.test(info.img)) return info.img;
  if (info.source === 'kw') {
    const query = new URLSearchParams({ corp: 'kuwo', type: 'rid_pic', pictype: '500', size: '500', rid: String(info.songmid) });
    const response = await fetch(`https://artistpicserver.kuwo.cn/pic.web?${query}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const url = (await readLimited(response, 65536)).toString('utf8').trim();
    return url.length < 1500 && /^https?:\/\//i.test(url) ? url : null;
  }
  if (info.source === 'kg') {
    const body = {
      appid: 1001, area_code: '1', behavior: 'play', clientver: '9020', need_hash_offset: 1, relate: 1,
      resource: [{ album_audio_id: info.songmid, album_id: info.albumId, hash: info.hash, id: 0, name: `${info.singer || ''} - ${info.name || ''}.mp3`, type: 'audio' }],
      token: '', userid: 2626431536, vip: 1,
    };
    const data = await json('https://media.store.kugou.com/v1/get_res_privilege', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'KG-RC': '1', 'KG-THash': 'expand_search_manager.cpp:852736169:451', 'User-Agent': 'KuGou2012-9020-ExpandSearchManager' },
      body: JSON.stringify(body),
    });
    const image = data.data?.[0]?.info?.image;
    const size = data.data?.[0]?.info?.imgsize?.[0] || 480;
    return typeof image === 'string' ? image.replace('{size}', String(size)).replace(/^http:\/\//i, 'https://') : null;
  }
  if (info.source === 'wy') {
    const data = await json(`https://music.163.com/api/song/detail?ids=${encodeURIComponent(JSON.stringify([info.songmid]))}`);
    return data.songs?.[0]?.album?.picUrl || data.songs?.[0]?.al?.picUrl || null;
  }
  if (info.source === 'tx' && info.albumMid) return `https://y.gtimg.cn/music/photo_new/T002R500x500M000${encodeURIComponent(info.albumMid)}.jpg`;
  return null;
}

function lyricResult(text, translationText = '') {
  if (typeof text !== 'string' || !text.trim()) return null;
  return { text: text.slice(0, 200000), translationText: typeof translationText === 'string' ? translationText.slice(0, 100000) : '', format: 'lrc', source: 'lx' };
}

async function lyrics(info) {
  if (info.source === 'kw') {
    const query = new URLSearchParams({ f: 'web', type: 'lyric', lrcx: '1', rid: String(info.songmid), encode: 'utf8' });
    const response = await fetch(`https://mlyric.kuwo.cn/mobi.s?${query}`, { signal: AbortSignal.timeout(11000) });
    if (!response.ok || Number(response.headers.get('content-length')) > 1024 * 1024) return null;
    const encoded = await readLimited(response, 1024 * 1024);
    if (encoded.length > 1024 * 1024 || !encoded.subarray(0, 10).toString('utf8').toLowerCase().startsWith('tp=content')) return null;
    const start = encoded.indexOf('\r\n\r\n');
    if (start < 0) return null;
    const inflated = inflateSync(encoded.subarray(start + 4), { maxOutputLength: 1024 * 1024 });
    const decoded = Buffer.from(inflated.toString('utf8'), 'base64');
    const key = Buffer.from('yeelion');
    for (let index = 0; index < decoded.length; index += 1) decoded[index] ^= key[index % key.length];
    return lyricResult(decoded.toString('utf8').replace(/<[-\d,]+>/g, ''));
  }
  if (info.source === 'wy') {
    const query = new URLSearchParams({ os: 'pc', id: String(info.songmid), lv: '-1', kv: '-1', tv: '-1' });
    const data = await json(`https://music.163.com/api/song/lyric?${query}`);
    return lyricResult(data.lrc?.lyric, data.tlyric?.lyric);
  }
  if (info.source === 'kg') {
    if (!info.hash) return null;
    const length = String(info.interval || '00:00').split(':').reduce((seconds, part) => seconds * 60 + (Number(part) || 0), 0);
    const search = new URLSearchParams({ ver: '1', man: 'yes', client: 'pc', keyword: String(info.name || ''), hash: String(info.hash), timelength: String(length), lrctxt: '1' });
    const found = await json(`https://lyrics.kugou.com/search?${search}`);
    const candidate = found.candidates?.[0];
    if (!candidate?.id || !candidate.accesskey) return null;
    const download = new URLSearchParams({ ver: '1', client: 'pc', id: String(candidate.id), accesskey: String(candidate.accesskey), fmt: 'lrc', charset: 'utf8' });
    const data = await json(`https://lyrics.kugou.com/download?${download}`);
    return data.fmt === 'lrc' && typeof data.content === 'string' ? lyricResult(Buffer.from(data.content, 'base64').toString('utf8')) : null;
  }
  if (info.source === 'tx') {
    const query = new URLSearchParams({ songmid: String(info.songmid), g_tk: '5381', loginUin: '0', hostUin: '0', format: 'json', inCharset: 'utf8', outCharset: 'utf-8', platform: 'yqq' });
    const data = await json(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${query}`, { headers: { Referer: 'https://y.qq.com/portal/player.html' } });
    const decode = value => typeof value === 'string' ? Buffer.from(value, 'base64').toString('utf8').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&') : '';
    return data.code === 0 ? lyricResult(decode(data.lyric), decode(data.trans)) : null;
  }
  if (info.source === 'mg' && info.lrcUrl) {
    const url = new URL(info.lrcUrl);
    if (url.protocol !== 'https:' || !(url.hostname === 'migu.cn' || url.hostname.endsWith('.migu.cn'))) return null;
    const response = await fetch(url, { signal: AbortSignal.timeout(11000), headers: { Referer: 'https://app.c.nf.migu.cn/' } });
    if (!response.ok || Number(response.headers.get('content-length')) > 200000) return null;
    const data = await readLimited(response, 1024 * 1024);
    return data.length <= 200000 ? lyricResult(data.toString('utf8').replace(/^@migu music@\s*/i, '')) : null;
  }
  return null;
}

module.exports = { PLATFORMS, readInfo, search, artwork, lyrics };
