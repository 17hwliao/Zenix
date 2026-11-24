import {parseLyrics} from '../../core/lyrics';
import type {
  KaraokeGeneratedBacking,
  KaraokeGenerationLyricLine,
  KaraokeGenerationProgress,
  KaraokeSeparationState,
  RawLyrics,
  Track,
} from '../../core/types';
import {comparableLength} from './solo-assets';

export type LocalGenerationStage =
  | 'preparing'
  | KaraokeGenerationProgress['stage'];

export type LocalGenerationState =
  | {status:'idle'}
  | {status:'running';stage:LocalGenerationStage}
  | {status:'ready';backing:Track;chartName:string;noteCount:number;lineCount:number;message:string}
  | {status:'partial';backing:Track;chartFailure:string}
  | {status:'unavailable';code:'dependency'|'model'|'lyrics'|'input'|'disk'|'busy';message:string}
  | {status:'cancelled'}
  | {status:'error';message:string};

export const localGenerationStages: readonly LocalGenerationStage[] = Object.freeze([
  'preparing',
  'separating',
  'publishing',
  'pitching',
  'aligning',
  'validating',
]);

export const localGenerationLabels: Readonly<Record<LocalGenerationStage,string>> = Object.freeze({
  preparing:'准备本机分析',
  separating:'分离伴奏',
  publishing:'发布伴奏',
  pitching:'提取音高',
  aligning:'生成曲谱',
  validating:'核对曲谱',
});

const lrcClock = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/;
const yrcClock = /^\s*\[\d{1,8},\d{1,8}\]/m;
const vttClock = /^\s*\S+\s*-->\s*\S+/m;
const ttmlClock = /<p\b[^>]*\bbegin\s*=/i;
const qrcClock = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/;

/**
 * parseLyrics deliberately fabricates a five-second grid for untimed text so
 * ordinary lyric display still works. Local generation must not turn that
 * display fallback into an invented chart timeline.
 */
export function hasTimedLyrics(raw:RawLyrics | null | undefined): boolean {
  if (!raw || typeof raw.text !== 'string' || !raw.text.trim()) return false;
  return lrcClock.test(raw.text)
    || yrcClock.test(raw.text)
    || vttClock.test(raw.text)
    || ttmlClock.test(raw.text)
    || qrcClock.test(raw.text);
}

function finiteDurationMs(durationSeconds:number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return Math.min(24 * 60 * 60 * 1000, Math.round(durationSeconds * 1000));
}

/**
 * Produces the immutable lyric snapshot sent to the trusted generation worker.
 * Explicit line ends bound the line, adjacent starts prevent overlaps, and all
 * values stay inside the current recording.
 */
export function timedLyricsFromRaw(
  raw:RawLyrics | null | undefined,
  durationSeconds:number,
): readonly KaraokeGenerationLyricLine[] {
  const durationMs = finiteDurationMs(durationSeconds);
  if (!hasTimedLyrics(raw)) return Object.freeze([]);
  const parsed = parseLyrics(raw!).filter(line=>Number.isFinite(line.time) && line.text.trim());
  const rows: KaraokeGenerationLyricLine[] = [];
  let previousEnd = 0;
  for (let index = 0; index < parsed.length && rows.length < 4000; index += 1) {
    const line = parsed[index];
    const rawStart = Math.round(line.time * 1000);
    const nextRawStart = parsed[index + 1];
    const nextStart = nextRawStart ? Math.round(nextRawStart.time * 1000) : durationMs;
    const upperBound = durationMs || Math.max(rawStart + 1,nextStart);
    let startMs = Math.max(previousEnd,Math.max(0,rawStart));
    if (startMs >= upperBound) continue;
    if (nextStart > startMs) startMs = Math.min(startMs,nextStart - 1);
    const explicitEnd = line.endTime !== undefined && Number.isFinite(line.endTime)
      ? Math.round(line.endTime * 1000)
      : undefined;
    let endMs = explicitEnd ?? (nextStart > startMs ? nextStart : upperBound);
    if (nextStart > startMs) endMs = Math.min(endMs,nextStart);
    endMs = Math.min(upperBound,Math.max(startMs + 1,endMs));
    if (endMs <= startMs) continue;
    rows.push(Object.freeze({startMs,endMs,text:line.text.trim()}));
    previousEnd = endMs;
  }
  return Object.freeze(rows);
}

export function generatedBackingTrack(source:Track, backing:KaraokeGeneratedBacking): Track | undefined {
  if (!backing || !/^[a-f0-9]{64}$/i.test(backing.key || '')
    || !Number.isFinite(backing.duration) || backing.duration <= 0
    || !comparableLength(source.duration,backing.duration)) return undefined;
  return {
    id:'karaoke-separated:'+backing.key,
    title:source.title+' · 本地生成',
    artist:source.artist,
    source:'local',
    path:'',
    audioUrl:'yzqxy://karaoke-backing/'+backing.key,
    duration:backing.duration,
  };
}

export function generatedBackingDigest(track?:Track): string {
  const prefix='karaoke-separated:';
  const key=track?.id.startsWith(prefix) ? track.id.slice(prefix.length) : '';
  return /^[a-f0-9]{64}$/i.test(key) ? key.toLowerCase() : '';
}

export function progressStage(stage:unknown): LocalGenerationStage | undefined {
  return typeof stage === 'string' && localGenerationStages.includes(stage as LocalGenerationStage)
    ? stage as LocalGenerationStage
    : undefined;
}

export function shouldShowLocalGeneration(
  mobile:boolean,
  canGenerate:boolean,
  hasPair:boolean,
  state:LocalGenerationState,
  chartReady:boolean,
): boolean {
  return !mobile && canGenerate && (!hasPair || !chartReady || state.status!=='idle');
}

export function localGenerationDependencyHint(
  state:KaraokeSeparationState | undefined,
): string | undefined {
  if (state?.status === 'unavailable' && state.message) {
    return `本机伴奏引擎暂不可用：${state.message}`;
  }
  if (state?.status === 'available' && state.chartAvailable === false) {
    return state.message || '可以生成本地伴奏，但曲谱模型暂不可用。';
  }
  return undefined;
}

export function unavailableGenerationMessage(
  code:'dependency'|'model'|'lyrics'|'input'|'disk'|'busy',
  message:string,
): string {
  const prefix:{[key in typeof code]:string} = {
    dependency:'本机生成依赖不可用',
    model:'本地模型不可用',
    lyrics:'逐句时间歌词不可用',
    input:'原曲输入不可用',
    disk:'本地生成空间不足',
    busy:'另一个本地任务正在进行',
  };
  return message.trim() ? `${prefix[code]}：${message.trim()}` : prefix[code];
}
