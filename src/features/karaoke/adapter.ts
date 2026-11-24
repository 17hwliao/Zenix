import { parseLyrics } from '../../core/lyrics';
import type { RawLyrics, Track } from '../../core/types';
import type {
  AccompanimentDescriptor,
  KaraokeLyricLine,
  KaraokeTrackDescriptor,
  PitchFrame,
  PitchTrack,
} from './contracts';
import {
  createKaraokeSongResolver,
  type KaraokePitchSourceInput,
  type KaraokeSongResolver,
} from './song-resolver';
import { karaokeFailure, karaokeOk, type KaraokeResult } from './result';

export interface KaraokeImportFile {
  readonly name: string;
  readonly type?: string;
  readonly data: ArrayBuffer | Uint8Array | string;
}

export interface KaraokeCaptureResources {
  timer?: ReturnType<typeof setInterval> | null;
  listeners?: readonly (() => void)[];
  nodes?: readonly ({ disconnect(): void } | null | undefined)[];
  stream?: { getTracks(): readonly { stop(): void }[] } | null;
  context?: { close(): void | Promise<void> } | null;
  audio?: {
    pause?(): void;
    removeAttribute?(name: string): void;
    load?(): void;
  } | null;
}

function audioAddress(track: Track): string {
  const audioUrl = typeof track.audioUrl === 'string' ? track.audioUrl.trim() : '';
  if (audioUrl) return audioUrl;
  const path = typeof track.path === 'string' ? track.path.trim() : '';
  return /^(?:blob:|file:|yzqxy:)/.test(path) ? path : '';
}

export function karaokeAccompaniment(track: Track): AccompanimentDescriptor {
  const uri = audioAddress(track);
  return {
    kind: track.source === 'local' ? 'local-file' : 'source-official',
    label: '当前录音（独立播放）',
    uri: uri || `unavailable:${encodeURIComponent(track.id)}`,
    rehearsalOnly: false,
  };
}

function manualPitchTrack(raw: RawLyrics | string | null | undefined, durationMs: number): PitchTrack | undefined {
  const parsed = raw ? parseLyrics(raw) : [];
  if (!parsed.length || !Number.isFinite(durationMs) || durationMs <= 0) return undefined;
  const lines = parsed
    .filter((line) => Number.isFinite(line.time) && line.text.trim())
    .slice(0, 4000)
    .map((line, index, source): KaraokeLyricLine => {
      const startMs = Math.max(0, Math.min(durationMs, line.time * 1000));
      const nextStart = source[index + 1]?.time;
      const fallbackEnd = Math.min(durationMs, startMs + 5000);
      const naturalEnd = nextStart === undefined ? fallbackEnd : Math.min(durationMs, nextStart * 1000);
      const explicitEnd = line.endTime === undefined ? naturalEnd : Math.min(durationMs, line.endTime * 1000);
      return Object.freeze({
        index,
        startMs,
        endMs: Math.max(startMs + 1, explicitEnd),
        text: line.text.trim(),
        ...(line.translation ? { translation: line.translation } : {}),
        notes: Object.freeze([]),
      });
    });
  return lines.length
    ? Object.freeze({ schema: 1, source: 'manual', lines: Object.freeze(lines) })
    : undefined;
}

export async function resolveKaraokeTrack(
  track: Track,
  rawLyrics: RawLyrics | string | null | undefined,
  resolver: KaraokeSongResolver = createKaraokeSongResolver(),
): Promise<KaraokeResult<KaraokeTrackDescriptor>> {
  const resolved = await resolver.resolve({
    track,
    accompaniment: karaokeAccompaniment(track),
    rawLyrics,
  });
  if (!resolved.ok || resolved.value.pitchTrack?.lines.length) return resolved;
  const fallback = manualPitchTrack(rawLyrics, resolved.value.durationMs);
  return karaokeOk(Object.freeze({
    ...resolved.value,
    ...(fallback ? { pitchTrack: fallback } : {}),
  }));
}

export function karaokeImportFormat(fileName: string, text = ''): KaraokePitchSourceInput['format'] {
  const extension = fileName.toLowerCase().split('.').pop() || '';
  if (extension === 'mid' || extension === 'midi') return 'midi';
  if (extension === 'ultrastar' || extension === 'ulstar') return 'ultrastar';
  if (/^#\s*bpm\s*:/im.test(text)) return 'ultrastar';
  if (/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>\s*(?:\{\s*(?:midi:)?\d+(?:\.\d+)?\s*\}|\[\s*midi:\s*\d+(?:\.\d+)?\s*\])/i.test(text)) {
    return 'enhanced-lrc';
  }
  return 'enhanced-lrc';
}

async function readSource(file: KaraokeImportFile): Promise<KaraokePitchSourceInput> {
  const binary = typeof file.data === 'string' ? new TextEncoder().encode(file.data) : file.data;
  const format = karaokeImportFormat(file.name);
  if (format === 'midi') return {format: 'midi', data: binary};
  const text = typeof binary === 'string'
    ? binary
    : new TextDecoder('utf-8', {fatal: false}).decode(binary);
  return karaokeImportFormat(file.name, text) === 'ultrastar'
    ? {format: 'ultrastar', text}
    : {format: 'enhanced-lrc', text};
}

export async function importKaraokePitchReference(
  file: KaraokeImportFile,
  track: Track,
  resolver: KaraokeSongResolver = createKaraokeSongResolver(),
): Promise<KaraokeResult<KaraokeTrackDescriptor>> {
  try {
    const pitchSource = await readSource(file);
    const resolved = await resolver.resolve({
      track,
      accompaniment: karaokeAccompaniment(track),
      pitchSource,
    });
    if (!resolved.ok) return resolved;
    const titleKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
    if (titleKey(resolved.value.title) !== titleKey(track.title) || titleKey(resolved.value.artist) !== titleKey(track.artist)) {
      return karaokeFailure('INVALID_PITCH','曲谱标注的歌曲或歌手与当前录音不一致。');
    }
    const trusted = resolved.value.pitchTrack?.lines.some((line) => line.notes.length > 0);
    if (!trusted) return karaokeFailure('INVALID_PITCH', '文件里没有可用的可信音高音符');
    return resolved;
  } catch {
    return karaokeFailure('PARSE_FAILED', '无法读取这个音高参考文件');
  }
}

export function activeKaraokeLineIndex(lines: readonly KaraokeLyricLine[], elapsedMs: number): number {
  if (!lines.length) return -1;
  const time = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  let current = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].startMs > time) break;
    current = index;
  }
  return current;
}

export function targetKaraokeMidi(
  line: KaraokeLyricLine | null | undefined,
  elapsedMs: number,
): number | null {
  if (!line) return null;
  const note = line.notes.find((value) => elapsedMs >= value.startMs && elapsedMs < value.endMs)
    ?? line.notes.find((value) => elapsedMs < value.startMs)
    ?? null;
  return note?.midi ?? null;
}

export function analyzePitchSamples(
  samples: Float32Array,
  sampleRate: number,
  atMs: number,
): PitchFrame {
  const safeAt = Number.isFinite(atMs) ? Math.max(0, atMs) : 0;
  if (!(samples instanceof Float32Array) || samples.length < 128
    || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return {atMs: safeAt, midi: null, confidence: 0, energy: 0};
  }

  let mean = 0;
  for (const sample of samples) mean += Number.isFinite(sample) ? sample : 0;
  mean /= samples.length;
  let squareSum = 0;
  for (const sample of samples) {
    const centered = (Number.isFinite(sample) ? sample : 0) - mean;
    squareSum += centered * centered;
  }
  const energy = Math.min(1, Math.sqrt(squareSum / samples.length));
  if (energy < 0.012) return {atMs: safeAt, midi: null, confidence: 0, energy};

  const minLag = Math.max(2, Math.floor(sampleRate / 1100));
  const maxLag = Math.min(samples.length - 2, Math.ceil(sampleRate / 65));
  const correlations: number[] = [];
  let maximum = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let cross = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    const count = samples.length - lag;
    for (let index = 0; index < count; index += 1) {
      const left = samples[index] - mean;
      const right = samples[index + lag] - mean;
      cross += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    const correlation = leftEnergy > 0 && rightEnergy > 0
      ? cross / Math.sqrt(leftEnergy * rightEnergy)
      : 0;
    correlations.push(correlation);
    if (correlation > maximum) maximum = correlation;
  }
  if (maximum < 0.58) return {atMs: safeAt, midi: null, confidence: Math.max(0, maximum), energy};

  let bestOffset = 0;
  const threshold = Math.max(0.58, maximum * 0.9);
  for (let index = 1; index < correlations.length - 1; index += 1) {
    if (correlations[index] >= threshold
      && correlations[index] >= correlations[index - 1]
      && correlations[index] >= correlations[index + 1]) {
      bestOffset = index;
      break;
    }
  }
  const rawLag = minLag + bestOffset;
  const previous = correlations[Math.max(0, bestOffset - 1)] ?? 0;
  const current = correlations[bestOffset] ?? 0;
  const next = correlations[Math.min(correlations.length - 1, bestOffset + 1)] ?? 0;
  const curvature = previous - 2 * current + next;
  const adjustment = Math.abs(curvature) > 1e-8
    ? Math.max(-0.5, Math.min(0.5, 0.5 * (previous - next) / curvature))
    : 0;
  const frequency = sampleRate / (rawLag + adjustment);
  if (!Number.isFinite(frequency) || frequency < 65 || frequency > 1100) {
    return {atMs: safeAt, midi: null, confidence: Math.max(0, current), energy};
  }
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
  return {
    atMs: safeAt,
    midi: midi >= 0 && midi <= 127 ? midi : null,
    confidence: Math.max(0, Math.min(1, current)),
    energy,
  };
}

export function releaseKaraokeCapture(resources: KaraokeCaptureResources): void {
  if (resources.timer !== undefined && resources.timer !== null) clearInterval(resources.timer);
  for (const remove of resources.listeners ?? []) {
    try { remove(); } catch {}
  }
  for (const node of resources.nodes ?? []) {
    try { node?.disconnect(); } catch {}
  }
  for (const track of resources.stream?.getTracks() ?? []) {
    try { track.stop(); } catch {}
  }
  if (resources.audio) {
    try { resources.audio.pause?.(); } catch {}
    try { resources.audio.removeAttribute?.('src'); } catch {}
    try { resources.audio.load?.(); } catch {}
  }
  if (resources.context) {
    try {
      const closing = resources.context.close();
      if (closing && typeof closing.catch === 'function') void closing.catch(() => {});
    } catch {}
  }
}
