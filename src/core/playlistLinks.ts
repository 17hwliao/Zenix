import type { Track } from './types';

export type PlaylistPlatform = 'tx' | 'wy' | 'kw';
export const playlistPlatforms: Record<PlaylistPlatform, string> = { tx: 'QQ 音乐', wy: '网易云音乐', kw: '酷我音乐' };
export type PlaylistResponse = { url: string; status: number; text: string };
export type PlaylistRequest = (args: { url: string; method?: 'GET' | 'POST'; body?: string }) => Promise<PlaylistResponse>;
export type LinkedPlaylist = { platform: PlaylistPlatform; url: string; name: string; total: number | null; tracks: Track[]; duplicates: number; skipped: number; warnings: string[]; complete: boolean };
const hosts: Record<PlaylistPlatform, string[]> = {
  tx: ['y.qq.com', 'i.y.qq.com', 'i2.y.qq.com', 'c.y.qq.com', 'u.y.qq.com', 'c6.y.qq.com'],
  wy: ['music.163.com', 'y.music.163.com', '163cn.tv'],
  kw: ['www.kuwo.cn', 'kuwo.cn', 'h5app.kuwo.cn', 'nplserver.kuwo.cn'],
};
const MAX_TRACKS = 5000;
const clean = (value: unknown, limit = 300) => String(value ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim().slice(0, limit);
const numeric = (value: unknown): string => /^\d{1,20}$/.test(String(value)) ? String(value) : '';
const count = (value: unknown): number | null => value !== undefined && value !== null && value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export function detectPlaylist(input: string): { platform: PlaylistPlatform; url: string; id: string } {
  if (input.length > 8192) throw Error('分享文字过长，请只粘贴歌单链接');
  const raw = input.match(/https?:\/\/[^\s<>"“”]+/i)?.[0]?.replace(/[，。！？、）)\]】》]+$/g, '');
  if (!raw) throw Error('请粘贴 QQ 音乐、网易云或酷我的歌单分享链接');
  const url = new URL(raw.replace(/&amp;/g, '&'));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port && !['80', '443'].includes(url.port)) throw Error('歌单链接地址无效');
  // Legacy public share links are upgraded to HTTPS before any connection.
  url.protocol = 'https:'; url.port = '';
  const platform = (Object.keys(hosts) as PlaylistPlatform[]).find(key => hosts[key].includes(url.hostname));
  if (!platform) throw Error('暂不支持这个平台，请使用 QQ 音乐、网易云或酷我的公开歌单链接');
  let id = '';
  if (platform === 'tx') {
    id = numeric(url.pathname.match(/\/(?:playlist|playsquare)\/(\d+)/)?.[1]);
    if (/taoge|playlist|playsquare/.test(url.pathname)) id ||= numeric(url.searchParams.get('id') || url.searchParams.get('disstid') || url.searchParams.get('dissid'));
    if (/type=playlist/.test(url.hash)) id ||= numeric(new URLSearchParams(url.hash.slice(1)).get('id'));
  } else if (platform === 'wy') {
    const fragment = url.hash.replace(/^#/, '');
    if (/playlist/.test(url.pathname + fragment)) id = numeric(url.searchParams.get('id') || new URLSearchParams(fragment.split('?')[1] || '').get('id') || url.pathname.match(/\/playlist\/(\d+)/)?.[1]);
  } else {
    id = numeric(url.pathname.match(/\/playlist(?:_detail)?\/(\d+)/)?.[1]);
    if (/playlist|collection/.test(url.pathname)) id ||= numeric(url.searchParams.get('pid') || url.searchParams.get('id'));
  }
  return { platform, url: url.href, id };
}

function encodeInfo(info: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(info));
  if (bytes.length > 4096) throw Error('歌曲元数据过长');
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function song(platform: PlaylistPlatform, raw: any): Track | null {
  if (!raw || typeof raw !== 'object') return null;
  let name = '', singer = '', albumName = '', seconds = 0, songmid = '', albumId = '', extra = {};
  if (platform === 'tx') {
    songmid = clean(raw.mid || raw.songmid, 80); if (!/^[a-zA-Z0-9]+$/.test(songmid)) return null;
    name = clean(raw.title || raw.name || raw.songname); singer = clean(raw.singer?.map((s: any) => s.name).join('、'));
    albumName = clean(raw.album?.name || raw.albumname); albumId = clean(raw.album?.mid || raw.albummid, 80); seconds = Number(raw.interval) || 0;
    extra = { songId: raw.id || raw.songid, albumMid: albumId, strMediaMid: clean(raw.file?.media_mid || raw.strMediaMid || songmid, 80) };
  } else if (platform === 'wy') {
    songmid = numeric(raw.id); name = clean(raw.name); singer = clean((raw.ar || raw.artists)?.map((s: any) => s.name).join('、'));
    albumName = clean((raw.al || raw.album)?.name); albumId = numeric((raw.al || raw.album)?.id); seconds = Number(raw.dt ?? raw.duration ?? 0) / 1000;
  } else {
    songmid = numeric(String(raw.id || raw.MUSICRID || raw.musicrid || '').replace(/^MUSIC_/, ''));
    name = clean(raw.name || raw.SONGNAME || raw.NAME); singer = clean(raw.artist || raw.ARTIST); albumName = clean(raw.album || raw.ALBUM); albumId = numeric(raw.albumid || raw.ALBUMID); seconds = Number(raw.duration || raw.DURATION) || 0;
  }
  if (!songmid || !name) return null;
  const duration = Number.isFinite(seconds) ? Math.max(0, Math.min(86400, seconds)) : 0;
  const info = { source: platform, songmid, name, singer, albumName, albumId, ...extra, interval: `${Math.floor(duration / 60).toString().padStart(2, '0')}:${Math.floor(duration % 60).toString().padStart(2, '0')}`, types: [{ type: '128k' }, { type: '320k' }, { type: 'flac' }], _types: {}, typeUrl: {}, lrc: null, img: null, otherSource: null };
  return { id: `playlist:${platform}:${songmid}`, title: name, artist: singer, album: albumName, duration, source: 'custom', providerId: 'lx.playlist:catalog', remoteId: encodeInfo(info), path: '', audioUrl: '' };
}

export async function readLinkedPlaylist(input: string, transport: PlaylistRequest, signal?: AbortSignal, progress: (message: string) => void = () => {}): Promise<LinkedPlaylist> {
  let target = detectPlaylist(input);
  const started = Date.now(), warnings: string[] = [], entries: any[] = [];
  let name = '', total: number | null = null, interrupted = false;
  const request = async (url: string, method: 'GET' | 'POST' = 'GET', body?: string) => {
    signal?.throwIfAborted(); if (Date.now() - started > 120000) throw Error('歌单读取已达两分钟，请稍后重试');
    const response = await transport({ url, method, body }); signal?.throwIfAborted();
    if (response.status < 200 || response.status >= 300) throw Error(`平台返回 HTTP ${response.status}，请检查网络或稍后重试`);
    return response;
  };
  const json = async (url: string, method: 'GET' | 'POST' = 'GET', body?: string) => {
    const response = await request(url, method, body);
    try { return JSON.parse(response.text.replace(/^\uFEFF/, '')); } catch { throw Error('平台未返回歌单数据，可能需要登录或链接已失效'); }
  };
  if (!target.id) {
    progress('正在解析分享链接');
    const response = await request(target.url);
    const resolved = detectPlaylist(response.url);
    if (resolved.platform !== target.platform) throw Error('分享链接跳转到了另一个平台');
    target = resolved;
    // Official short-link pages sometimes use a literal JS/meta redirect. Never execute it.
    if (!target.id) {
      const html = response.text.replace(/\\\//g, '/');
      const candidates = Array.from(html.matchAll(/(?:location(?:\.href)?\s*=\s*|location\.replace\(\s*|location\.assign\(\s*)["'](https?:\/\/[^"']+)["']/g), match => match[1]);
      const meta = html.match(/<meta\b[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=(https?:\/\/[^"']+)/i)?.[1];
      if (meta) candidates.push(meta);
      for (const candidate of candidates.slice(0, 100)) {
        try { const found = detectPlaylist(candidate); if (found.platform === target.platform && found.id) { target = found; break; } } catch {}
      }
    }
    if (!target.id) throw Error('没有识别到歌单 ID，请从平台的歌单页面重新复制分享链接（歌曲、专辑和个人主页链接不适用）');
  }
  progress(`正在读取${playlistPlatforms[target.platform]}歌单`);
  if (target.platform === 'tx') {
    // Read public metadata only. The paged RPC is also used when the legacy endpoint is unavailable/incomplete.
    try {
      const data = await json(`https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=${target.id}&format=json&platform=yqq.json&needNewCode=0`);
      const list = data.code === 0 && data.cdlist?.[0];
      if (list && Array.isArray(list.songlist)) { name = clean(list.dissname, 100); total = count(list.total_song_num ?? list.songnum); entries.push(...list.songlist.slice(0, MAX_TRACKS)); }
    } catch (error) { signal?.throwIfAborted(); }
    if (!entries.length || total === null || entries.length < total) {
      const pages: any[] = [], signatures = new Set<string>(); let pageTotal: number | null = null;
      try {
        for (let offset = 0; offset < MAX_TRACKS; offset += 100) {
          progress(`正在读取 QQ 音乐歌单 · 已获取 ${offset} 首`);
          const payload = { comm: { ct: 24, cv: 0, format: 'json' }, req_1: { module: 'music.srfDissInfo.aiDissInfo', method: 'uniform_get_Dissinfo', param: { disstid: Number(target.id), userinfo: 1, tag: 1, orderlist: 1, song_begin: offset, song_num: 100, onlysonglist: 0, enc_host_uin: '' } } };
          const data = await json('https://u.y.qq.com/cgi-bin/musicu.fcg', 'POST', JSON.stringify(payload));
          const value = data.code === 0 && data.req_1?.code === 0 && data.req_1.data;
          if (!value || !Array.isArray(value.songlist)) throw Error('QQ 音乐未开放此歌单，请确认歌单及主页公开，稍后重试');
          if (!offset) { name = clean(value.dirinfo?.title || name, 100); pageTotal = count(value.total_song_num); }
          const page = value.songlist.slice(0, 100), signature = JSON.stringify(page.map((item: any) => item.mid || item.songmid || item.id));
          if (page.length && signatures.has(signature)) throw Error('平台重复返回同一页，未能读取完整歌单');
          signatures.add(signature); pages.push(...page);
          if (pageTotal !== null ? pages.length >= pageTotal : page.length < 100) break;
          if (!page.length) break;
        }
        entries.splice(0, entries.length, ...pages); total = pageTotal;
      } catch (error) {
        signal?.throwIfAborted();
        if (pages.length && pages.length > entries.length) { entries.splice(0, entries.length, ...pages); total = pageTotal; }
        if (!entries.length) throw error;
        interrupted = true; warnings.push(error instanceof Error ? error.message : '部分分页读取失败');
      }
    }
  } else if (target.platform === 'wy') {
    const data = await json(`https://music.163.com/api/v6/playlist/detail?id=${target.id}&n=1000&s=0`);
    const list = data.code === 200 && data.playlist;
    if (!list || !Array.isArray(list.tracks)) throw Error('网易云未开放此歌单，请确认歌单公开且链接有效');
    name = clean(list.name, 100); total = count(list.trackCount ?? list.trackIds?.length);
    const available = new Map<string, any>(list.tracks.map((item: any) => [String(item.id), item]));
    const ids: string[] = Array.isArray(list.trackIds) ? list.trackIds.map((item: any) => numeric(item.id)).filter(Boolean).slice(0, MAX_TRACKS) : list.tracks.map((item: any) => numeric(item.id)).filter(Boolean).slice(0, MAX_TRACKS);
    const missing = ids.filter(id => !available.has(id));
    for (let offset = 0; offset < missing.length; offset += 200) {
      progress(`正在补全网易云曲目信息 · ${offset}/${missing.length}`);
      try {
        const details = await json(`https://music.163.com/api/song/detail?ids=${encodeURIComponent(JSON.stringify(missing.slice(offset, offset + 200).map(Number)))}`);
        if (details.code !== 200 || !Array.isArray(details.songs)) throw Error('部分曲目信息无法读取');
        for (const item of details.songs) available.set(String(item.id), item);
      } catch (error) { signal?.throwIfAborted(); interrupted = true; warnings.push('部分曲目信息未能补全，可重试解析'); break; }
    }
    entries.push(...ids.map(id => available.get(id)));
    if (!Array.isArray(list.trackIds)) { interrupted = true; warnings.push('平台没有提供完整歌曲 ID 清单，无法确认完整性'); }
  } else {
    const signatures = new Set<string>();
    for (let page = 0; page < MAX_TRACKS / 100; page++) {
      try {
        const data = await json(`https://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${target.id}&pn=${page}&rn=100&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1`);
        if (data.result !== 'ok' || !Array.isArray(data.musiclist)) throw Error('酷我未开放此歌单，请确认歌单公开且链接有效');
        if (!page) { name = clean(data.title, 100); total = count(data.total); }
        const items = data.musiclist.slice(0, 100), signature = JSON.stringify(items.map((item: any) => item.id || item.MUSICRID || item.musicrid));
        if (items.length && signatures.has(signature)) throw Error('平台重复返回同一页');
        signatures.add(signature); entries.push(...items); progress(`正在读取酷我歌单 · 已获取 ${entries.length} 首`);
        if (total !== null ? entries.length >= total : items.length < 100) break;
        if (!items.length) break;
      } catch (error) { signal?.throwIfAborted(); if (!entries.length) throw error; interrupted = true; warnings.push('后续分页读取失败，请重试解析'); break; }
    }
  }
  const tracks: Track[] = [], seen = new Set<string>(); let duplicates = 0, skipped = 0, bytes = 0;
  for (const entry of entries.slice(0, MAX_TRACKS)) {
    let track: Track | null = null; try { track = song(target.platform, entry); } catch {}
    if (!track) { skipped++; continue; }
    if (seen.has(track.id)) { duplicates++; continue; }
    bytes += new TextEncoder().encode(JSON.stringify(track)).length + 1;
    if (bytes > 2 * 1024 * 1024 - 8192) { interrupted = true; warnings.push('曲目信息达到单次导入大小上限，只保留前面的曲目；可以在原平台拆分歌单后分次导入'); break; }
    seen.add(track.id); tracks.push(track);
  }
  if (total !== null && total > MAX_TRACKS) warnings.push('歌单超过 5000 首，本次只读取前 5000 首');
  const complete = !interrupted && total !== null && entries.length >= total && skipped === 0 && entries.length <= MAX_TRACKS;
  if (total === null) warnings.push('平台未提供总数，无法确认是否完整');
  else if (entries.length < total) warnings.push(`仅获取到 ${entries.length}/${total} 首，平台可能限制了公开内容`);
  if (skipped) warnings.push(`${skipped} 首歌曲缺少必要信息，未加入导入清单`);
  if (duplicates) warnings.push(`${duplicates} 首重复的同平台歌曲已合并`);
  if (!tracks.length) throw Error(total === 0 ? '这是一个空歌单，没有可导入的歌曲' : '未取得可导入的曲目信息，请检查歌单是否公开');
  return { platform: target.platform, url: target.url, name: name || `${playlistPlatforms[target.platform]}导入歌单`, total, tracks, duplicates, skipped, warnings, complete };
}
