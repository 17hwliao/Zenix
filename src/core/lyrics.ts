import type { LyricLine, RawLyrics, Track } from './types';

const LRC_CLOCK = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

function lrcTime(minutes: string, seconds: string, fraction?: string): number {
  const fractionSeconds = fraction ? Number(fraction) / 10 ** fraction.length : 0;
  return Number(minutes) * 60 + Number(seconds) + fractionSeconds;
}

function clockTime(text: string): number | null {
  const value = text.trim();
  const match = value.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (match) {
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const fraction = match[4] ? Number(match[4]) / 10 ** match[4].length : 0;
    return hours * 3600 + minutes * 60 + seconds + fraction;
  }
  const unit = value.match(/^([\d.]+)(ms|s|m|h)$/);
  if (unit) {
    const multiplier = { ms: 0.001, s: 1, m: 60, h: 3600 }[unit[2] as 'ms' | 's' | 'm' | 'h'];
    return Number(unit[1]) * multiplier;
  }
  return null;
}

function stripInlineTiming(value: string): string {
  return value
    .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '')
    .replace(/\(\d+,\d+(?:,\d+)?\)/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function parseLrc(text: string): LyricLine[] {
  const offsetMatch = text.match(/^\[offset:([+-]?\d+)\]/im);
  const offset = offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  const parsed: LyricLine[] = [];
  for (const row of text.split(/\r?\n/)) {
    LRC_CLOCK.lastIndex = 0;
    const stamps = [...row.matchAll(LRC_CLOCK)];
    if (stamps.length === 0) continue;
    const content = stripInlineTiming(row.replace(LRC_CLOCK, ''));
    if (!content) continue;
    for (const stamp of stamps) {
      parsed.push({ time: Math.max(0, lrcTime(stamp[1], stamp[2], stamp[3]) + offset), text: content });
    }
  }
  return normalizeLines(parsed);
}

function parseVtt(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const blocks = text.replace(/^\uFEFF/, '').split(/\r?\n\s*\r?\n/);
  for (const block of blocks) {
    const rows = block.trim().split(/\r?\n/);
    const timingIndex = rows.findIndex((row) => row.includes('-->'));
    if (timingIndex < 0) continue;
    const [startText, endText] = rows[timingIndex].split('-->').map((item) => item.trim().split(/\s+/)[0]);
    const time = clockTime(startText);
    if (time === null) continue;
    const endTime = clockTime(endText);
    const content = rows.slice(timingIndex + 1).map(stripInlineTiming).filter(Boolean).join(' ');
    if (content) lines.push({ time, text: content, ...(endTime !== null ? { endTime } : {}) });
  }
  return normalizeLines(lines);
}

function parseTtml(text: string): LyricLine[] {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.querySelector('parsererror')) return [];
  const lines: LyricLine[] = [];
  for (const element of Array.from(document.getElementsByTagName('*'))) {
    if (element.localName !== 'p') continue;
    const time = clockTime(element.getAttribute('begin') || '');
    if (time === null) continue;
    const endTime = clockTime(element.getAttribute('end') || '');
    const content = element.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (content) lines.push({ time, text: content, ...(endTime !== null ? { endTime } : {}) });
  }
  return normalizeLines(lines);
}

function parseYrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const row of text.split(/\r?\n/)) {
    const match = row.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!match) continue;
    const content = stripInlineTiming(match[3]);
    if (content) lines.push({ time: Number(match[1]) / 1000, endTime: (Number(match[1]) + Number(match[2])) / 1000, text: content });
  }
  return normalizeLines(lines);
}

function parseQrc(text: string): LyricLine[] {
  const match = text.match(/LyricContent\s*=\s*(["'])([\s\S]*?)\1/i);
  const content = match ? match[2]
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&') : text;
  const lrc = parseLrc(content);
  return lrc.length ? lrc : parseYrc(content);
}

function normalizeLines(lines: LyricLine[]): LyricLine[] {
  const sorted = lines.filter((line) => Number.isFinite(line.time) && line.text.trim())
    .sort((left, right) => left.time - right.time);
  const merged: LyricLine[] = [];
  for (const line of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && Math.abs(previous.time - line.time) < 0.04) {
      if (previous.text !== line.text && !previous.translation) previous.translation = line.text;
      if (line.endTime && !previous.endTime) previous.endTime = line.endTime;
    } else {
      merged.push({ ...line });
    }
  }
  return merged;
}

function mergeTranslation(lines: LyricLine[], translation: LyricLine[]): LyricLine[] {
  for (const translated of translation) {
    const match = lines.find((line) => Math.abs(line.time - translated.time) <= 0.5);
    if (match && match.text !== translated.text) match.translation = translated.text;
  }
  return lines;
}

export function parseLyrics(raw: RawLyrics | string, format?: string): LyricLine[] {
  const text = typeof raw === 'string' ? raw : raw.text;
  const extension = (format ?? (typeof raw === 'string' ? '' : raw.format)).toLowerCase();
  let lines: LyricLine[];
  if (extension === 'ttml' || /<tt(?:\s|>)/i.test(text)) lines = parseTtml(text);
  else if (extension === 'vtt' || /^WEBVTT/m.test(text)) lines = parseVtt(text);
  else if (extension === 'yrc' || extension === 'krc') lines = parseYrc(text);
  else if (extension === 'qrc') lines = parseQrc(text);
  else lines = parseLrc(text);

  if (lines.length === 0 && text.trim()) {
    const untimed = text.split(/\r?\n/).map((row) => row.trim()).filter((row) => row && !/^\[[a-z]+:/i.test(row));
    lines = untimed.map((row, index) => ({ time: index === 0 ? 0 : index * 5, text: row }));
  }
  if (typeof raw !== 'string' && raw.translationText) {
    lines = mergeTranslation(lines, parseLyrics(raw.translationText, raw.format));
  }
  return lines;
}

export async function loadLyrics(track: Track): Promise<LyricLine[]> {
  const bridge = window.yzqxy;
  if (!bridge) return [];
  const raw = await bridge.library.readLyrics(track.id);
  return raw ? parseLyrics(raw) : [];
}

export function activeLyricIndex(lines: LyricLine[], seconds: number, offsetSeconds = 0): number {
  const time = seconds - offsetSeconds;
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].time <= time) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}
