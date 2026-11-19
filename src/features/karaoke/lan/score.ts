import {KARAOKE_LIMITS, KARAOKE_GRADE_ORDER, karaokeGradeForScore, type KaraokeGrade, type KaraokeLineGradeFields, type KaraokeLineScore} from '../contracts';
import {isPublicKaraokeText} from '../song-summary';
import {karaokeLanUtf8Bytes} from './protocol';
import type { KaraokeLanResult } from './types';
import { lanFailure, lanOk } from './types';

export interface ScoreLineInput {
  readonly itemId?: unknown;
  readonly lineIndex?: unknown;
  readonly revision?: unknown;
  readonly lineScore?: unknown;
  readonly clientSentAtMs?: unknown;
}

export interface NormalizedScoreLine {
  readonly itemId: string;
  readonly lineIndex: number;
  readonly revision: number;
  readonly lineScore: KaraokeLineScore & Partial<KaraokeLineGradeFields>;
  readonly clientSentAtMs: number;
}

const MAX_SCORE_LINE_BYTES = 4096;

export function normalizeScoreLine(input: ScoreLineInput): KaraokeLanResult<NormalizedScoreLine> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['type', 'itemId', 'lineIndex', 'revision', 'lineScore', 'clientSentAtMs'].includes(key))) {
    return lanFailure('INVALID_INPUT', 'score.line 字段无效', false);
  }
  const itemId = isPublicKaraokeText(input.itemId, 300) ? input.itemId.trim() : '';
  if (!itemId || itemId.length > 256) {
    return lanFailure('INVALID_INPUT', 'score.line 歌曲项无效', false);
  }
  if (!Number.isSafeInteger(input.lineIndex) || (input.lineIndex as number) < 0
    || (input.lineIndex as number) >= KARAOKE_LIMITS.maxLyricLines) {
    return lanFailure('INVALID_INPUT', 'score.line 句索引无效', false);
  }
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0) {
    return lanFailure('INVALID_INPUT', 'score.line 修订号无效', false);
  }
  if (!Number.isSafeInteger(input.clientSentAtMs) || (input.clientSentAtMs as number) < 0) {
    return lanFailure('INVALID_INPUT', 'score.line 发送时间无效', false);
  }
  const lineScore = normalizeLineScore(input.lineScore);
  if (!lineScore.ok) return lineScore;
  if (lineScore.value.lineIndex !== input.lineIndex) {
    return lanFailure('INVALID_INPUT', 'score.line 两处句索引不一致', false);
  }
  return lanOk({
    itemId,
    lineIndex: input.lineIndex as number,
    revision: input.revision as number,
    lineScore: lineScore.value,
    clientSentAtMs: input.clientSentAtMs as number,
  });
}

const numericFields = ['startMs', 'endMs', 'lyrics', 'completeness', 'breath', 'total'] as const;
const allowedFields = new Set<string>([...numericFields, 'lineIndex', 'pitch', 'rhythm', 'feedback', 'grade', 'combo', 'confidence']);

export function normalizeLineScore(value: unknown): KaraokeLanResult<KaraokeLineScore & Partial<KaraokeLineGradeFields>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return lanFailure('INVALID_INPUT', 'score.line 分数载荷无效', false);
  }
  const line = value as Record<string, unknown>;
  if (Object.keys(line).some(key => !allowedFields.has(key))
    || !numericFields.every(key => typeof line[key] === 'number' && Number.isFinite(line[key]))
    || !Number.isSafeInteger(line.lineIndex) || Number(line.lineIndex) < 0
    || Number(line.startMs) < 0 || Number(line.endMs) <= Number(line.startMs)
    || Number(line.endMs) > 8 * 60 * 60 * 1000
    || ![line.pitch, line.rhythm].every(entry => entry === null || typeof entry === 'number' && Number.isFinite(entry))
    || (line.grade !== undefined && !KARAOKE_GRADE_ORDER.includes(line.grade as KaraokeGrade))
    || (line.combo !== undefined && (!Number.isSafeInteger(line.combo) || Number(line.combo) < 0))
    || (line.confidence !== undefined && (typeof line.confidence !== 'number' || !Number.isFinite(line.confidence)))) {
    return lanFailure('INVALID_INPUT', 'score.line 分数或时间字段无效', false);
  }
  const feedback = line.feedback;
  if (!Array.isArray(feedback) || feedback.length > 32 || feedback.some(text => !isPublicKaraokeText(text, 200))) {
    return lanFailure('INVALID_INPUT', 'score.line 点评列表无效', false);
  }
  if (karaokeLanUtf8Bytes(JSON.stringify(line)) > MAX_SCORE_LINE_BYTES) {
    return lanFailure('INVALID_INPUT', 'score.line 载荷过大', false);
  }
  const total = clampNumber(line.total, 0, 100);
  const lineScore: KaraokeLineScore & Partial<KaraokeLineGradeFields> = {
    lineIndex: line.lineIndex as number,
    startMs: clampNumber(line.startMs, 0, Number.MAX_SAFE_INTEGER),
    endMs: clampNumber(line.endMs, 0, Number.MAX_SAFE_INTEGER),
    pitch: line.pitch === null ? null : clampNumber(line.pitch, 0, 100),
    rhythm: line.rhythm === null ? null : clampNumber(line.rhythm, 0, 100),
    lyrics: clampNumber(line.lyrics, 0, 100),
    completeness: clampNumber(line.completeness, 0, 100),
    breath: clampNumber(line.breath, 0, 100),
    total,
    feedback: Object.freeze(feedback.slice()),
    ...(line.grade === undefined ? {} : {grade: karaokeGradeForScore(total)}),
    ...(line.combo === undefined ? {} : {combo: clampNumber(line.combo, 0, KARAOKE_LIMITS.maxLyricLines)}),
    ...(line.confidence === undefined ? {} : {confidence: clampNumber(line.confidence, 0, 1)}),
  };
  return lanOk(Object.freeze(lineScore));
}

function clampNumber(value: unknown, minimum: number, maximum: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(minimum, Math.min(maximum, numeric));
}
