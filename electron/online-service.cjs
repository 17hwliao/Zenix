const { URL } = require('node:url');

const PROVIDER = 'netease';
const REQUEST_TIMEOUT_MS = 15000;

function api() {
  return require('@neteasecloudmusicapienhanced/api/main');
}

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, Math.trunc(number)))
    : fallback;
}

function numericSongId(value) {
  const text = String(value ?? '').trim();
  if (!/^[1-9]\d{0,17}$/.test(text)) throw new Error('无效的在线歌曲 ID');
  return text;
}

function httpsUrl(value) {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function withDeadline(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}请求超时`)), REQUEST_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function request(operation, input, label) {
  let response;
  try {
    response = await withDeadline(operation(input), label);
  } catch (error) {
    throw new Error(`${label}失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const body = response?.body;
  if (!body || typeof body !== 'object' || Number(body.code) !== 200) {
    throw new Error(`${label}失败（${body?.code ?? response?.status ?? '无响应'}）`);
  }
  return body;
}

function normalizeSong(song, parallelPrivilege) {
  const id = Number(song?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const artists = Array.isArray(song.ar) ? song.ar : Array.isArray(song.artists) ? song.artists : [];
  const artist = artists.map((entry) => String(entry?.name ?? '').trim()).filter(Boolean).join(', ');
  const album = song.al ?? song.album ?? {};
  const privilege = song.privilege ?? parallelPrivilege;
  const durationMs = Number(song.dt ?? song.duration ?? 0);
  return {
    id: `${PROVIDER}:${id}`,
    path: '',
    source: 'online',
    providerId: PROVIDER,
    remoteId: String(id),
    title: String(song.name ?? '').trim() || '未知歌曲',
    artist: artist || '未知艺人',
    album: String(album.name ?? '').trim() || undefined,
    duration: Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : 0,
    audioUrl: '',
    coverUrl: httpsUrl(album.picUrl ?? album.coverUrl),
    availability: Number(privilege?.st) < 0 ? 'unavailable' : 'playable',
  };
}

function previewSeconds(info) {
  if (!info || typeof info !== 'object') return undefined;
  const start = Number(info.start);
  const end = Number(info.end);
  const length = end - start;
  return Number.isFinite(length) && length > 0 && length <= 600 ? length : undefined;
}

function lyricText(value) {
  return typeof value?.lyric === 'string' ? value.lyric : '';
}

function createOnlineService() {
  return {
    async search(query, offset = 0, limit = 30) {
      const keywords = String(query ?? '').trim().slice(0, 200);
      if (!keywords) return { tracks: [], total: 0, nextOffset: 0, hasMore: false };
      const start = boundedInteger(offset, 0, 0, 100000);
      const pageSize = boundedInteger(limit, 30, 1, 50);
      const body = await request(api().cloudsearch, { keywords, offset: start, limit: pageSize }, '搜索');
      const result = body.result ?? {};
      const songs = Array.isArray(result.songs) ? result.songs : [];
      const privileges = Array.isArray(result.privileges) ? result.privileges : [];
      const tracks = songs.map((song, index) => normalizeSong(song, privileges[index])).filter(Boolean);
      const reportedTotal = Number(result.songCount);
      const total = Number.isFinite(reportedTotal) && reportedTotal >= 0
        ? reportedTotal
        : start + songs.length + (songs.length === pageSize ? 1 : 0);
      const nextOffset = start + songs.length;
      return { tracks, total, nextOffset, hasMore: nextOffset < total && songs.length > 0 };
    },

    async resolve(remoteId) {
      const id = numericSongId(remoteId);
      let lastCode;
      for (const level of ['exhigh', 'standard']) {
        const body = await request(api().song_url_v1, { id, level, randomCNIP: true, https: true }, '获取试听地址');
        const source = Array.isArray(body.data) ? body.data[0] : undefined;
        const audioUrl = httpsUrl(source?.url);
        if (audioUrl) {
          return {
            audioUrl,
            previewSeconds: previewSeconds(source?.freeTrialInfo),
          };
        }
        lastCode = source?.code;
      }
      return { audioUrl: null, unavailableReason: lastCode ? `暂时无法播放（${lastCode}）` : '这首歌暂时无法播放' };
    },

    async lyrics(remoteId) {
      const id = numericSongId(remoteId);
      const body = await request(api().lyric_new, { id }, '获取歌词');
      return {
        text: lyricText(body.lrc),
        translationText: lyricText(body.tlyric),
        wordByWordText: lyricText(body.yrc),
        romanizationText: lyricText(body.romalrc) || lyricText(body.yromalrc),
      };
    },
  };
}

module.exports = { createOnlineService };
