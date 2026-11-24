'use strict';

const MAX_LYRIC_LINES = 4000;
const MAX_LYRIC_CHARS = 512 * 1024;
const MAX_LINE_CHARS = 2000;
const MAX_METADATA_CHARS = 300;
const REQUEST_ID = /^[a-f0-9-]{36}$/i;

function invalid(message) {
  return Object.assign(Error(message), {code:'INPUT'});
}

function cleanText(value, max = MAX_LINE_CHARS) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeRequestId(value) {
  if (typeof value !== 'string' || !REQUEST_ID.test(value)) throw invalid('本地生成请求标识无效');
  return value.toLowerCase();
}

function normalizeOptions(value) {
  if (value === undefined) return Object.freeze({schemaVersion:1});
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1) {
    throw invalid('本地生成选项无效');
  }
  return Object.freeze({schemaVersion:1});
}

function normalizeTrackMetadata(track, durationMs) {
  if (!track || typeof track !== 'object') throw invalid('缺少本地生成歌曲信息');
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? Math.min(durationMs, 24 * 60 * 60 * 1000) : 0;
  if (!duration) throw invalid('原曲时长无效，无法生成本地曲谱');
  return Object.freeze({
    title: cleanText(track.title, MAX_METADATA_CHARS) || '未命名歌曲',
    artist: cleanText(track.artist, MAX_METADATA_CHARS) || '未知歌手',
    durationMs: Math.round(duration),
  });
}

function normalizeLyrics(value, durationMs) {
  if (!Array.isArray(value)) throw invalid('歌词快照格式无效');
  if (value.length > MAX_LYRIC_LINES) throw invalid('歌词行数超过本地生成限制');
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : Number.POSITIVE_INFINITY;
  let chars = 0;
  const lines = value.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid(`第 ${index + 1} 行歌词格式无效`);
    const startMs = Number(row.startMs);
    const endMs = Number(row.endMs);
    const text = cleanText(row.text);
    if (!text) throw invalid(`第 ${index + 1} 行歌词为空`);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs || startMs >= duration) {
      throw invalid(`第 ${index + 1} 行歌词时间无效`);
    }
    chars += text.length;
    if (chars > MAX_LYRIC_CHARS) throw invalid('歌词内容超过本地生成限制');
    return Object.freeze({
      startMs: Math.round(startMs),
      endMs: Math.round(Math.min(endMs, duration)),
      text,
    });
  }).sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  if (lines.some(line => line.endMs <= line.startMs)) throw invalid('歌词时间边界无效');
  return Object.freeze(lines);
}

function normalizeGenerationRequest(track, requestId, lyrics, options, durationMs) {
  return Object.freeze({
    requestId: normalizeRequestId(requestId),
    metadata: normalizeTrackMetadata(track, durationMs),
    lyrics: normalizeLyrics(lyrics, durationMs),
    options: normalizeOptions(options),
  });
}

module.exports = {
  MAX_LINE_CHARS,
  MAX_LYRIC_CHARS,
  MAX_LYRIC_LINES,
  normalizeGenerationRequest,
  normalizeLyrics,
  normalizeOptions,
  normalizeRequestId,
  normalizeTrackMetadata,
};
