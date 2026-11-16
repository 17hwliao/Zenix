import type { RawLyrics, Track } from '../../core/types';
import {
  KARAOKE_LIMITS,
  type AccompanimentDescriptor,
  type KaraokeLyricLine,
  type KaraokeTrackDescriptor,
  type PitchNote,
  type PitchTrack,
} from './contracts';
import { deepFreezeClone, frozenArray } from './immutable';
import { karaokeFailure, karaokeOk, type KaraokeResult } from './result';

const MAX_LYRIC_TEXT_LENGTH = 2000;
const MAX_PITCH_NOTES = 24_000;
const DEFAULT_LINE_DURATION_MS = 5000;
const MIN_LINE_DURATION_MS = 40;
const LRC_CLOCK = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const LRC_INLINE_CLOCK = /<([^>]+)>/g;

export type KaraokeTrackMetadata = Pick<
  Track,
  'id' | 'title' | 'artist' | 'duration' | 'source' | 'providerId' | 'remoteId' | 'playbackRecording'
>;

export type KaraokePitchSourceInput =
  | { readonly format: 'lrc' | 'enhanced-lrc'; readonly text: string }
  | { readonly format: 'ultrastar'; readonly text: string }
  | { readonly format: 'midi'; readonly data: Uint8Array | ArrayBuffer | readonly number[] | string };

export interface KaraokeSongResolveInput {
  readonly track: KaraokeTrackMetadata;
  readonly accompaniment: AccompanimentDescriptor;
  readonly rawLyrics?: RawLyrics | string | null;
  readonly pitchSource?: KaraokePitchSourceInput;
  readonly recordingId?: string;
  readonly durationMs?: number;
}

export interface KaraokeSongResolver {
  resolve(input: KaraokeSongResolveInput): Promise<KaraokeResult<KaraokeTrackDescriptor>>;
}

export interface ParsedKaraokePitch {
  readonly track: PitchTrack;
  readonly title?: string;
  readonly artist?: string;
}

class ParseFailure extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'INVALID_LYRIC' | 'INVALID_PITCH' | 'PARSE_FAILED' | 'UNSUPPORTED_FORMAT',
    message: string,
  ) {
    super(message);
  }
}

function nullableText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function fractionSeconds(fraction: string | undefined): number {
  return fraction ? Number(fraction) / (10 ** fraction.length) : 0;
}

function lrcClock(minutes: string, seconds: string, fraction?: string): number {
  return (Number(minutes) * 60 + Number(seconds) + fractionSeconds(fraction)) * 1000;
}

function clockToken(value: string): number | null {
  const trimmed = value.trim().split(',')[0] || '';
  const match = trimmed.match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?$/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return (hours * 3600 + minutes * 60 + seconds + fractionSeconds(match[4])) * 1000;
}

function metadataValue(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^\\[${key}:([^\\]]*)\\]`, 'im'));
  return nullableText(match?.[1]);
}

function ultraStarMetadataValue(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`^#${key}:([^\\r\\n]*)`, 'im'));
  return nullableText(match?.[1]);
}

interface DraftLine {
  startMs: number;
  endMs?: number;
  text: string;
  translation?: string;
  notes: PitchNote[];
}

function enhancedSegments(content: string): { text: string; notes: Array<Pick<PitchNote, 'startMs' | 'midi'>> } {
  const markers = [...content.matchAll(LRC_INLINE_CLOCK)];
  if (markers.length === 0) return { text: content.trim(), notes: [] };
  const notes: Array<Pick<PitchNote, 'startMs' | 'midi'>> = [];
  const words: string[] = [];
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const startAt = marker.index ?? 0;
    const startMs = clockToken(marker[1]);
    if (startMs === null) continue;
    const contentStart = startAt + marker[0].length;
    const contentEnd = markers[index + 1]?.index ?? content.length;
    let word = content.slice(contentStart, contentEnd);
    const pitch = word.match(/^\s*(?:\{\s*(?:midi:)?(-?\d+(?:\.\d+)?)\s*\}|\[\s*midi:(-?\d+(?:\.\d+)?)\s*\])/i);
    if (pitch) {
      notes.push({ startMs, midi: Number(pitch[1] ?? pitch[2]) });
      word = word.slice(pitch[0].length);
    }
    words.push(word);
  }
  const prefix = markers[0]?.index ? content.slice(0, markers[0].index) : '';
  return { text: `${prefix}${words.join('')}`.trim(), notes };
}

function closeNotes(draft: DraftLine[], durationMs: number): KaraokeLyricLine[] {
  const sorted = draft
    .filter((line) => Number.isFinite(line.startMs) && line.startMs >= 0 && line.text.trim())
    .sort((left, right) => left.startMs - right.startMs);

  return sorted.map((line, index) => {
    if (line.text.trim().length > MAX_LYRIC_TEXT_LENGTH) {
      throw new ParseFailure('INVALID_LYRIC', `第 ${index + 1} 行歌词超过长度限制`);
    }
    if (line.translation && line.translation.length > MAX_LYRIC_TEXT_LENGTH) {
      throw new ParseFailure('INVALID_LYRIC', `第 ${index + 1} 行翻译超过长度限制`);
    }
    const nextStart = sorted[index + 1]?.startMs;
    const fallbackEnd = Math.max(
      line.startMs + MIN_LINE_DURATION_MS,
      Math.min(durationMs, line.startMs + DEFAULT_LINE_DURATION_MS),
    );
    const explicitEnd = Number.isFinite(line.endMs) ? Number(line.endMs) : undefined;
    const naturalEnd = nextStart !== undefined && nextStart > line.startMs
      ? Math.min(durationMs, nextStart)
      : fallbackEnd;
    const endMs = Math.max(
      line.startMs + MIN_LINE_DURATION_MS,
      Math.min(durationMs, explicitEnd ?? naturalEnd),
    );
    const notes = line.notes
      .map((note, noteIndex, all) => {
        const nextNoteStart = all[noteIndex + 1]?.startMs;
        const noteEnd = Number.isFinite(note.endMs) && note.endMs > note.startMs
          ? note.endMs
          : Math.min(endMs, nextNoteStart && nextNoteStart > note.startMs ? nextNoteStart : endMs);
        return {
          startMs: Math.max(line.startMs, Math.min(endMs, note.startMs)),
          endMs: Math.max(line.startMs, Math.min(endMs, noteEnd)),
          midi: note.midi,
          ...(note.lyric ? { lyric: note.lyric } : {}),
        };
      })
      .filter((note) => note.endMs > note.startMs);
    return Object.freeze({
      index,
      startMs: line.startMs,
      endMs,
      text: line.text.trim(),
      ...(line.translation ? { translation: line.translation } : {}),
      notes: frozenArray(notes.map((note) => Object.freeze(note))),
    });
  });
}

export function parseLrcPitchTrack(
  text: string,
  durationMs: number,
  source: 'enhanced-lrc' = 'enhanced-lrc',
): ParsedKaraokePitch {
  if (typeof text !== 'string' || !text.trim()) throw new ParseFailure('INVALID_LYRIC', 'LRС 内容为空');
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new ParseFailure('INVALID_PITCH', '歌曲时长无效');
  const offsetMatch = text.match(/^\[offset:([+-]?\d+)\]/im);
  const offsetMs = offsetMatch ? Number(offsetMatch[1]) : 0;
  const draft: DraftLine[] = [];
  for (const row of text.split(/\r?\n/)) {
    LRC_CLOCK.lastIndex = 0;
    const stamps = [...row.matchAll(LRC_CLOCK)];
    if (stamps.length === 0) continue;
    const rawContent = row.replace(LRC_CLOCK, '');
    const segments = enhancedSegments(rawContent);
    if (!segments.text) continue;
    for (const stamp of stamps) {
      const startMs = Math.max(0, Math.min(durationMs, lrcClock(stamp[1], stamp[2], stamp[3]) + offsetMs));
      draft.push({
        startMs,
        text: segments.text,
        notes: segments.notes.map((note) => ({
          startMs: Math.max(0, Math.min(durationMs, note.startMs + offsetMs)),
          endMs: 0,
          midi: note.midi,
        })),
      });
    }
  }
  const lines = closeNotes(draft, durationMs);
  return Object.freeze({
    track: Object.freeze({ schema: 1, source, lines: frozenArray(lines) }),
    ...(metadataValue(text, 'ti') ? { title: metadataValue(text, 'ti') } : {}),
    ...(metadataValue(text, 'ar') ? { artist: metadataValue(text, 'ar') } : {}),
  });
}

interface UltraStarNote {
  beat: number;
  duration: number;
  midi: number;
  text: string;
}

export function parseUltraStarPitchTrack(text: string, durationMs: number): ParsedKaraokePitch {
  if (typeof text !== 'string' || !text.trim()) throw new ParseFailure('INVALID_LYRIC', 'UltraStar 内容为空');
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new ParseFailure('INVALID_PITCH', '歌曲时长无效');
  const bpmMatch = text.match(/^#BPM:([0-9.]+)/im);
  const bpm = bpmMatch ? Number(bpmMatch[1]) : 0;
  if (!Number.isFinite(bpm) || bpm <= 0) throw new ParseFailure('INVALID_PITCH', 'UltraStar 缺少有效 BPM');
  const gapMatch = text.match(/^#GAP:(-?\d+)/im);
  const gapMs = gapMatch ? Number(gapMatch[1]) : 0;
  const beatMs = 60_000 / bpm;
  const groups: UltraStarNote[][] = [];
  let current: UltraStarNote[] = [];
  for (const row of text.split(/\r?\n/)) {
    const trimmed = row.trim();
    if (!trimmed) continue;
    if (trimmed === '-' || trimmed === 'E') {
      if (current.length) groups.push(current);
      current = [];
      continue;
    }
    const note = trimmed.match(/^[:\*RF]\s+(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*(.*)$/i);
    if (!note) continue;
    const beat = Number(note[1]);
    const beatDuration = Number(note[2]);
    const midi = Number(note[3]);
    if (!Number.isFinite(beat) || !Number.isFinite(beatDuration) || beatDuration <= 0) {
      throw new ParseFailure('INVALID_PITCH', 'UltraStar 音符时长无效');
    }
    if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
      throw new ParseFailure('INVALID_PITCH', `UltraStar MIDI 音高越界：${note[3]}`);
    }
    current.push({
      beat,
      duration: beatDuration,
      midi,
      text: note[4].replace(/_/g, ' ').trim(),
    });
  }
  if (current.length) groups.push(current);
  if (groups.length === 0) throw new ParseFailure('INVALID_PITCH', 'UltraStar 中没有音高音符');

  const lines = groups.map((group, index) => {
    const notes = group.map((note) => Object.freeze({
      startMs: Math.max(0, Math.min(durationMs, gapMs + note.beat * beatMs)),
      endMs: Math.max(0, Math.min(durationMs, gapMs + (note.beat + note.duration) * beatMs)),
      midi: note.midi,
      ...(note.text ? { lyric: note.text } : {}),
    })).filter((note) => note.endMs > note.startMs);
    const startMs = notes[0]?.startMs ?? 0;
    const endMs = notes[notes.length - 1]?.endMs ?? Math.min(durationMs, startMs + MIN_LINE_DURATION_MS);
    return Object.freeze({
      index,
      startMs,
      endMs: Math.max(startMs + MIN_LINE_DURATION_MS, endMs),
      text: group.map((note) => note.text).filter(Boolean).join(' ').trim() || `UltraStar 音高句 ${index + 1}`,
      notes: frozenArray(notes),
    });
  }).filter((line) => line.startMs < durationMs && line.notes.length > 0);

  return Object.freeze({
    track: Object.freeze({ schema: 1, source: 'ultrastar', lines: frozenArray(lines) }),
    ...(ultraStarMetadataValue(text, 'TITLE') ? { title: ultraStarMetadataValue(text, 'TITLE') } : {}),
    ...(ultraStarMetadataValue(text, 'ARTIST') ? { artist: ultraStarMetadataValue(text, 'ARTIST') } : {}),
  });
}

type MidiEvent =
  | { readonly tick: number; readonly type: 'tempo'; readonly microseconds: number }
  | { readonly tick: number; readonly type: 'lyric'; readonly text: string }
  | { readonly tick: number; readonly type: 'on' | 'off'; readonly channel: number; readonly midi: number };

interface MidiNote {
  startTick: number;
  endTick: number;
  midi: number;
  lyric?: string;
}

function midiBytes(data: Uint8Array | ArrayBuffer | readonly number[] | string): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) {
    const values = Uint8Array.from(data);
    if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new ParseFailure('INVALID_PITCH', 'MIDI 字节数组包含非法值');
    }
    return values;
  }
  if (typeof data === 'string') {
    try {
      const raw = atob(data.replace(/\s+/g, ''));
      return Uint8Array.from(raw, (character) => character.charCodeAt(0));
    } catch {
      throw new ParseFailure('PARSE_FAILED', 'MIDI base64 数据无效');
    }
  }
  throw new ParseFailure('UNSUPPORTED_FORMAT', '不支持的 MIDI 输入');
}

function dataText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
  } catch {
    return Array.from(bytes, (value) => String.fromCharCode(value)).join('').trim();
  }
}

function parseMidiEvents(bytes: Uint8Array): { events: MidiEvent[]; division: number } {
  const signature = 'MThd';
  if (bytes.length < 14 || String.fromCharCode(...bytes.slice(0, 4)) !== signature) {
    throw new ParseFailure('PARSE_FAILED', '不是标准 MIDI 文件');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(4);
  if (headerLength < 6 || 8 + headerLength > bytes.length) throw new ParseFailure('PARSE_FAILED', 'MIDI 头长度无效');
  const format = view.getUint16(8);
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  if (format > 2 || (division & 0x8000) !== 0 || division === 0) {
    throw new ParseFailure('UNSUPPORTED_FORMAT', '仅支持 PPQ MIDI，不支持 SMPTE division');
  }

  const events: MidiEvent[] = [];
  let cursor = 8 + headerLength;
  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    if (cursor + 8 > bytes.length || String.fromCharCode(...bytes.slice(cursor, cursor + 4)) !== 'MTrk') {
      throw new ParseFailure('PARSE_FAILED', `MIDI 轨道 ${trackIndex + 1} 头无效`);
    }
    const length = view.getUint32(cursor + 4);
    cursor += 8;
    const end = cursor + length;
    if (end > bytes.length) throw new ParseFailure('PARSE_FAILED', `MIDI 轨道 ${trackIndex + 1} 越界`);
    let tick = 0;
    let runningStatus: number | undefined;
    const readVariable = (): number => {
      let value = 0;
      for (let count = 0; count < 4; count += 1) {
        if (cursor >= end) throw new ParseFailure('PARSE_FAILED', 'MIDI 可变长度整数越界');
        const byte = bytes[cursor++];
        value = (value << 7) | (byte & 0x7f);
        if ((byte & 0x80) === 0) return value;
      }
      throw new ParseFailure('PARSE_FAILED', 'MIDI 可变长度整数过长');
    };
    const readByte = (): number => {
      if (cursor >= end) throw new ParseFailure('PARSE_FAILED', 'MIDI 事件数据越界');
      return bytes[cursor++];
    };

    while (cursor < end) {
      tick += readVariable();
      let status = bytes[cursor];
      if (status >= 0x80) {
        cursor += 1;
        if (status < 0xf0) runningStatus = status;
      } else {
        if (runningStatus === undefined) throw new ParseFailure('PARSE_FAILED', 'MIDI running status 无效');
        status = runningStatus;
      }
      if (status === 0xff) {
        const type = readByte();
        const size = readVariable();
        if (cursor + size > end) throw new ParseFailure('PARSE_FAILED', 'MIDI meta 事件越界');
        const payload = bytes.slice(cursor, cursor + size);
        cursor += size;
        runningStatus = undefined;
        if (type === 0x51 && size === 3) {
          const microseconds = (payload[0] << 16) | (payload[1] << 8) | payload[2];
          if (microseconds > 0) events.push({ tick, type: 'tempo', microseconds });
        } else if (type === 0x05) {
          const text = dataText(payload);
          if (text) events.push({ tick, type: 'lyric', text });
        }
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const size = readVariable();
        if (cursor + size > end) throw new ParseFailure('PARSE_FAILED', 'MIDI SysEx 事件越界');
        cursor += size;
        runningStatus = undefined;
        continue;
      }
      const command = status & 0xf0;
      const channel = status & 0x0f;
      const first = readByte();
      const second = command === 0xc0 || command === 0xd0 ? 0 : readByte();
      if (command === 0x90 || command === 0x80) {
        events.push({ tick, type: command === 0x90 && second > 0 ? 'on' : 'off', channel, midi: first });
      }
    }
    cursor = end;
  }
  return { events, division };
}

export function parseMidiPitchTrack(
  data: Uint8Array | ArrayBuffer | readonly number[] | string,
  durationMs: number,
): ParsedKaraokePitch {
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new ParseFailure('INVALID_PITCH', '歌曲时长无效');
  const bytes = midiBytes(data);
  const { events, division } = parseMidiEvents(bytes);
  const tempo = events
    .filter((event): event is Extract<MidiEvent, { type: 'tempo' }> => event.type === 'tempo')
    .sort((left, right) => left.tick - right.tick);
  const lyrics = events
    .filter((event): event is Extract<MidiEvent, { type: 'lyric' }> => event.type === 'lyric')
    .sort((left, right) => left.tick - right.tick);
  const tickToMs = (tick: number): number => {
    let currentTick = 0;
    let microsecondsPerBeat = 500_000;
    let elapsedMs = 0;
    for (const event of tempo) {
      if (event.tick > tick) break;
      elapsedMs += ((event.tick - currentTick) / division) * (microsecondsPerBeat / 1000);
      currentTick = event.tick;
      microsecondsPerBeat = event.microseconds;
    }
    elapsedMs += ((tick - currentTick) / division) * (microsecondsPerBeat / 1000);
    return elapsedMs;
  };

  const open = new Map<string, number[]>();
  const notes: MidiNote[] = [];
  for (const event of events) {
    if (event.type !== 'on' && event.type !== 'off') continue;
    if (event.channel === 9) continue;
    const key = `${event.channel}:${event.midi}`;
    if (event.type === 'on') {
      const stack = open.get(key) ?? [];
      stack.push(event.tick);
      open.set(key, stack);
    } else {
      const startTick = open.get(key)?.shift();
      if (startTick !== undefined && event.tick > startTick) {
        notes.push({ startTick, endTick: event.tick, midi: event.midi });
      }
    }
  }
  for (const [key, starts] of open) {
    const midi = Number(key.split(':')[1]);
    for (const startTick of starts) notes.push({ startTick, endTick: startTick + division / 4, midi });
  }
  notes.sort((left, right) => left.startTick - right.startTick || left.midi - right.midi);
  if (notes.length === 0) throw new ParseFailure('INVALID_PITCH', 'MIDI 中没有可评价音符');

  let lyricIndex = 0;
  for (const note of notes) {
    while (lyricIndex + 1 < lyrics.length
      && Math.abs(lyrics[lyricIndex + 1].tick - note.startTick) <= Math.abs(lyrics[lyricIndex].tick - note.startTick)) {
      lyricIndex += 1;
    }
    const lyric = lyrics[lyricIndex];
    if (lyric && Math.abs(lyric.tick - note.startTick) <= division / 2) {
      note.lyric = lyric.text.replace(/[_~]/g, ' ').trim() || undefined;
    }
  }

  const groups: MidiNote[][] = [];
  let current: MidiNote[] = [];
  let previousEndTick = -1;
  for (const note of notes) {
    if (current.length && note.startTick - previousEndTick > division * 2) {
      groups.push(current);
      current = [];
    }
    current.push(note);
    previousEndTick = Math.max(previousEndTick, note.endTick);
  }
  if (current.length) groups.push(current);

  const lines = groups.map((group, index) => {
    const groupNotes = group.map((note) => Object.freeze({
      startMs: Math.max(0, Math.min(durationMs, tickToMs(note.startTick))),
      endMs: Math.max(0, Math.min(durationMs, tickToMs(note.endTick))),
      midi: note.midi,
      ...(note.lyric ? { lyric: note.lyric } : {}),
    })).filter((note) => note.endMs > note.startMs);
    const startMs = groupNotes[0]?.startMs ?? 0;
    const endMs = groupNotes[groupNotes.length - 1]?.endMs ?? startMs + MIN_LINE_DURATION_MS;
    return Object.freeze({
      index,
      startMs,
      endMs: Math.max(startMs + MIN_LINE_DURATION_MS, endMs),
      text: group.map((note) => note.lyric).filter(Boolean).join(' ').trim() || `MIDI 音高句 ${index + 1}`,
      notes: frozenArray(groupNotes),
    });
  }).filter((line) => line.notes.length > 0);

  return Object.freeze({
    track: Object.freeze({ schema: 1, source: 'midi', lines: frozenArray(lines) }),
  });
}

function validatePitchTrack(pitchTrack: PitchTrack, durationMs: number): KaraokeResult<PitchTrack> {
  if (!pitchTrack || pitchTrack.schema !== 1 || !Array.isArray(pitchTrack.lines)) {
    return karaokeFailure('INVALID_PITCH', '音高轨结构无效');
  }
  if (!['midi', 'ultrastar', 'enhanced-lrc', 'manual'].includes(pitchTrack.source)) {
    return karaokeFailure('INVALID_PITCH', '音高轨来源无效');
  }
  if (pitchTrack.lines.length > KARAOKE_LIMITS.maxLyricLines) {
    return karaokeFailure('LIMIT_EXCEEDED', '歌词行数超过限制');
  }
  let noteCount = 0;
  let previousStart = -Infinity;
  const lines: KaraokeLyricLine[] = [];
  for (let index = 0; index < pitchTrack.lines.length; index += 1) {
    const line = pitchTrack.lines[index];
    if (!Number.isFinite(line.startMs) || !Number.isFinite(line.endMs)
      || line.startMs < 0 || line.endMs <= line.startMs || line.startMs < previousStart) {
      return karaokeFailure('INVALID_LYRIC', `第 ${index + 1} 行时间顺序或边界无效`);
    }
    if (line.endMs > durationMs + 1) {
      return karaokeFailure('INVALID_LYRIC', `第 ${index + 1} 行超出歌曲时长`);
    }
    if (typeof line.text !== 'string' || !line.text.trim() || line.text.length > MAX_LYRIC_TEXT_LENGTH) {
      return karaokeFailure('INVALID_LYRIC', `第 ${index + 1} 行歌词长度无效`);
    }
    if (!Array.isArray(line.notes)) return karaokeFailure('INVALID_PITCH', `第 ${index + 1} 行音符列表无效`);
    let noteStart = -Infinity;
    const notes: PitchNote[] = [];
    for (const note of line.notes) {
      noteCount += 1;
      if (noteCount > MAX_PITCH_NOTES) return karaokeFailure('LIMIT_EXCEEDED', '音高音符数量超过限制');
      if (!Number.isFinite(note.startMs) || !Number.isFinite(note.endMs)
        || note.startMs < line.startMs - 1 || note.endMs > line.endMs + 1
        || note.endMs <= note.startMs || note.startMs < noteStart) {
        return karaokeFailure('INVALID_PITCH', `第 ${index + 1} 行音符时间顺序或边界无效`);
      }
      if (!Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127) {
        return karaokeFailure('INVALID_PITCH', `第 ${index + 1} 行 MIDI 音高越界`);
      }
      if (note.lyric !== undefined && (typeof note.lyric !== 'string' || note.lyric.length > MAX_LYRIC_TEXT_LENGTH)) {
        return karaokeFailure('INVALID_PITCH', `第 ${index + 1} 行音符歌词无效`);
      }
      noteStart = note.startMs;
      notes.push(Object.freeze({ ...note }));
    }
    previousStart = line.startMs;
    lines.push(Object.freeze({
      index,
      startMs: line.startMs,
      endMs: line.endMs,
      text: line.text.trim(),
      ...(line.translation ? { translation: line.translation } : {}),
      notes: frozenArray(notes),
    }));
  }
  return karaokeOk(Object.freeze({ schema: 1, source: pitchTrack.source, lines: frozenArray(lines) }));
}

function rawLyricsText(raw: RawLyrics | string | null | undefined): string | undefined {
  if (typeof raw === 'string') return raw;
  return raw && typeof raw.text === 'string' ? raw.text : undefined;
}

function recordingIdentity(track: KaraokeTrackMetadata, override?: string): string {
  if (override?.trim()) return override.trim();
  if (track.playbackRecording) {
    const playback = track.playbackRecording;
    return [playback.source, playback.providerId, playback.remoteId, playback.id]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(':') || playback.id;
  }
  return [track.source, track.providerId, track.remoteId, track.id]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(':') || track.id;
}

function validateAccompaniment(value: AccompanimentDescriptor): KaraokeResult<AccompanimentDescriptor> {
  if (!value || !['local-file', 'source-official', 'separated', 'channel-cancel'].includes(value.kind)) {
    return karaokeFailure('INVALID_INPUT', '伴奏类型无效');
  }
  if (typeof value.uri !== 'string' || !value.uri.trim()) return karaokeFailure('INVALID_INPUT', '伴奏 URI 不能为空');
  if (value.kind === 'channel-cancel' && value.rehearsalOnly !== true) {
    return karaokeFailure('INVALID_INPUT', '声道抵消必须明确标记为 rehearsalOnly');
  }
  return karaokeOk(Object.freeze({
    kind: value.kind,
    label: value.label?.trim() || value.kind,
    uri: value.uri.trim(),
    ...(value.cacheKey ? { cacheKey: value.cacheKey } : {}),
    ...(value.fingerprint ? { fingerprint: value.fingerprint } : {}),
    ...(value.modelVersion ? { modelVersion: value.modelVersion } : {}),
    rehearsalOnly: value.kind === 'channel-cancel',
  }));
}

function parsePitchSource(input: KaraokePitchSourceInput, durationMs: number): ParsedKaraokePitch {
  if (input.format === 'lrc' || input.format === 'enhanced-lrc') {
    return parseLrcPitchTrack(input.text, durationMs);
  }
  if (input.format === 'ultrastar') return parseUltraStarPitchTrack(input.text, durationMs);
  if (input.format === 'midi') return parseMidiPitchTrack(input.data, durationMs);
  throw new ParseFailure('UNSUPPORTED_FORMAT', '不支持的音高轨格式');
}

export class DefaultKaraokeSongResolver implements KaraokeSongResolver {
  async resolve(input: KaraokeSongResolveInput): Promise<KaraokeResult<KaraokeTrackDescriptor>> {
    try {
      const track = input.track;
      if (!track || typeof track.id !== 'string' || !track.id.trim()) {
        return karaokeFailure('INVALID_TRACK', '歌曲缺少稳定 ID');
      }
      if (typeof track.title !== 'string' || !track.title.trim()) {
        return karaokeFailure('INVALID_TRACK', '歌曲缺少标题');
      }
      if (typeof track.artist !== 'string' || !track.artist.trim()) {
        return karaokeFailure('INVALID_TRACK', '歌曲缺少歌手');
      }
      const durationMs = input.durationMs
        ?? (Number.isFinite(track.duration) ? Math.round(track.duration * 1000) : 0);
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        return karaokeFailure('INVALID_TRACK', '歌曲时长无效');
      }
      const accompaniment = validateAccompaniment(input.accompaniment);
      if (!accompaniment.ok) return accompaniment;

      let parsedPitch: ParsedKaraokePitch | undefined;
      if (input.pitchSource) {
        parsedPitch = parsePitchSource(input.pitchSource, durationMs);
      } else {
        const text = rawLyricsText(input.rawLyrics);
        if (text) parsedPitch = parseLrcPitchTrack(text, durationMs);
      }

      let pitchTrack: PitchTrack | undefined;
      if (parsedPitch) {
        const validated = validatePitchTrack(parsedPitch.track, durationMs);
        if (!validated.ok) return validated;
        pitchTrack = validated.value;
      }

      const descriptor = deepFreezeClone<KaraokeTrackDescriptor>({
        schema: 1,
        recordingId: recordingIdentity(track, input.recordingId),
        title: parsedPitch?.title || track.title.trim(),
        artist: parsedPitch?.artist || track.artist.trim(),
        durationMs,
        accompaniment: accompaniment.value,
        ...(pitchTrack ? { pitchTrack } : {}),
      });
      return karaokeOk(descriptor);
    } catch (error) {
      if (error instanceof ParseFailure) return karaokeFailure(error.code, error.message);
      return karaokeFailure('PARSE_FAILED', 'K 歌歌曲解析失败');
    }
  }
}

export function createKaraokeSongResolver(): KaraokeSongResolver {
  return new DefaultKaraokeSongResolver();
}
