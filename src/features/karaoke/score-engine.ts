import {
  KARAOKE_LIMITS,
  type KaraokeLineScore,
  type KaraokeScore,
  type KaraokeScoreWeights,
  type PitchFrame,
  type PitchNote,
  type PitchTrack,
} from './contracts';
import { frozenArray } from './immutable';
import { karaokeFailure, karaokeOk, type KaraokeResult } from './result';

export const DEFAULT_KARAOKE_SCORE_WEIGHTS: KaraokeScoreWeights = Object.freeze({
  pitch: 45,
  rhythm: 25,
  lyrics: 15,
  completeness: 10,
  breath: 5,
});

export interface RecognizedLyricLine {
  lineIndex: number;
  text: string;
  startMs?: number;
  endMs?: number;
}

export interface KaraokeScoreOptions {
  /** Subtract capture/playback latency from every frame timestamp before alignment. */
  latencyCompensationMs?: number;
  minConfidence?: number;
  minEnergy?: number;
  trustPitchTrack?: boolean;
  weights?: Partial<KaraokeScoreWeights>;
}

export interface KaraokeScoreInput {
  pitchFrames: readonly PitchFrame[];
  pitchTrack?: PitchTrack;
  recognizedLyrics?: readonly RecognizedLyricLine[];
  options?: KaraokeScoreOptions;
}

interface NormalizedOptions {
  latencyCompensationMs: number;
  minConfidence: number;
  minEnergy: number;
  trustPitchTrack: boolean;
  weights: KaraokeScoreWeights;
}

interface AnalyticLine {
  lineScore: KaraokeLineScore;
  combo: number;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rounded(value: number): number {
  return Math.round(clamp(value, 0, 100) * 100) / 100;
}

function normalizeOptions(options: KaraokeScoreOptions | undefined): NormalizedOptions {
  const custom = options?.weights;
  const weights: KaraokeScoreWeights = {
    pitch: Math.max(0, finite(custom?.pitch, DEFAULT_KARAOKE_SCORE_WEIGHTS.pitch)),
    rhythm: Math.max(0, finite(custom?.rhythm, DEFAULT_KARAOKE_SCORE_WEIGHTS.rhythm)),
    lyrics: Math.max(0, finite(custom?.lyrics, DEFAULT_KARAOKE_SCORE_WEIGHTS.lyrics)),
    completeness: Math.max(0, finite(custom?.completeness, DEFAULT_KARAOKE_SCORE_WEIGHTS.completeness)),
    breath: Math.max(0, finite(custom?.breath, DEFAULT_KARAOKE_SCORE_WEIGHTS.breath)),
  };
  return {
    latencyCompensationMs: Math.max(-5000, Math.min(5000, finite(options?.latencyCompensationMs, 0))),
    minConfidence: clamp(finite(options?.minConfidence, 0.55)),
    minEnergy: clamp(finite(options?.minEnergy, 0.015)),
    trustPitchTrack: options?.trustPitchTrack !== false,
    weights,
  };
}

function normalizeFrames(frames: readonly PitchFrame[] | undefined, latencyMs: number): PitchFrame[] {
  if (!Array.isArray(frames)) return [];
  const normalized: PitchFrame[] = [];
  for (let index = 0; index < frames.length && index < KARAOKE_LIMITS.maxPitchFrames; index += 1) {
    const frame = frames[index] as PitchFrame | null | undefined;
    if (!frame || typeof frame !== 'object' || !Number.isFinite(frame.atMs)) continue;
    const atMs = frame.atMs - latencyMs;
    if (!Number.isFinite(atMs)) continue;
    normalized.push({
      atMs,
      midi: Number.isInteger(frame.midi) && Number(frame.midi) >= 0 && Number(frame.midi) <= 127
        ? Number(frame.midi)
        : null,
      confidence: clamp(finite(frame.confidence, 0)),
      energy: clamp(finite(frame.energy, 0)),
    });
  }
  normalized.sort((left, right) => left.atMs - right.atMs);
  return normalized;
}

function isVoiced(frame: PitchFrame, options: NormalizedOptions): frame is PitchFrame & { midi: number } {
  return frame.midi !== null
    && Number.isFinite(frame.midi)
    && frame.confidence >= options.minConfidence
    && frame.energy >= options.minEnergy;
}

function validNotes(line: PitchTrack['lines'][number] | undefined): PitchNote[] {
  if (!line || !Array.isArray(line.notes)) return [];
  return line.notes
    .filter((note) => Number.isFinite(note.startMs)
      && Number.isFinite(note.endMs)
      && note.endMs > note.startMs
      && Number.isInteger(note.midi)
      && note.midi >= 0
      && note.midi <= 127)
    .slice()
    .sort((left, right) => left.startMs - right.startMs);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function octaveAdjustedDistance(left: number, right: number): { raw: number; adjusted: number; octave: boolean } {
  const raw = Math.abs(left - right);
  const adjusted = Math.min(raw, Math.abs(raw - 12), Math.abs(raw - 24), Math.abs(raw - 36));
  return { raw, adjusted, octave: raw >= 10.5 && raw <= 13.5 && adjusted <= 0.75 };
}

function dtwPitchScore(notes: readonly PitchNote[], frames: readonly (PitchFrame & { midi: number })[]): {
  score: number;
  signedSemitones: number;
} {
  if (notes.length === 0 || frames.length === 0) return { score: 0, signedSemitones: 0 };
  const stride = Math.max(1, Math.ceil(frames.length / 160));
  const observed = frames.filter((_, index) => index % stride === 0 || index === frames.length - 1);
  const rows = notes.length + 1;
  const columns = observed.length + 1;
  const costs = Array.from({ length: rows }, () => new Float64Array(columns).fill(Number.POSITIVE_INFINITY));
  const signed = notes.map((note) => observed.map((frame) => frame.midi - note.midi));
  costs[0][0] = 0;

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const distance = octaveAdjustedDistance(notes[row - 1].midi, observed[column - 1].midi);
      const local = Math.min(4, distance.adjusted) + (distance.octave ? 3 : 0);
      const previous = Math.min(costs[row - 1][column], costs[row][column - 1], costs[row - 1][column - 1]);
      costs[row][column] = local + previous;
    }
  }

  const pathScores: number[] = [];
  const pathSigned: number[] = [];
  let row = notes.length;
  let column = observed.length;
  let steps = 0;
  while (row > 0 && column > 0 && steps < rows + columns) {
    const distance = octaveAdjustedDistance(notes[row - 1].midi, observed[column - 1].midi);
    if (!distance.octave) {
      pathScores.push(distance.adjusted);
      pathSigned.push(signed[row - 1][column - 1]);
    }
    const diagonal = costs[row - 1][column - 1];
    const up = costs[row - 1][column];
    const left = costs[row][column - 1];
    if (diagonal <= up && diagonal <= left) {
      row -= 1;
      column -= 1;
    } else if (up < left) {
      row -= 1;
    } else {
      column -= 1;
    }
    steps += 1;
  }
  const meanDistance = pathScores.length
    ? pathScores.reduce((total, value) => total + value, 0) / pathScores.length
    : 12;
  return {
    score: clamp(Math.exp(-0.55 * meanDistance * meanDistance) * 100, 0, 100),
    signedSemitones: median(pathSigned),
  };
}

function normalizeLyricText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function editSimilarity(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  if (!a.length && !b.length) return 1;
  if (!a.length || !b.length) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);
  for (let row = 1; row <= a.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    for (let column = 0; column <= b.length; column += 1) previous[column] = current[column];
  }
  return clamp(1 - previous[b.length] / Math.max(a.length, b.length));
}

function matchingLyrics(
  recognized: readonly RecognizedLyricLine[] | undefined,
  lineIndex: number,
  startMs: number,
  endMs: number,
): string | undefined {
  if (!Array.isArray(recognized) || recognized.length === 0) return undefined;
  const exact = recognized.find((line) => line.lineIndex === lineIndex);
  const selected = exact ?? recognized
    .filter((line) => typeof line.text === 'string')
    .map((line) => {
      const middle = Number.isFinite(line.startMs) && Number.isFinite(line.endMs)
        ? (Number(line.startMs) + Number(line.endMs)) / 2
        : Number.POSITIVE_INFINITY;
      return { line, distance: Math.abs(middle - (startMs + endMs) / 2) };
    })
    .sort((left, right) => left.distance - right.distance)[0]?.line;
  return typeof selected?.text === 'string' ? selected.text : undefined;
}

function expectedMidi(notes: readonly PitchNote[], atMs: number): number | null {
  for (const note of notes) {
    if (atMs >= note.startMs && atMs <= note.endMs) return note.midi;
    if (note.startMs > atMs) break;
  }
  return null;
}

function expectedCells(
  rangesValue: ReadonlyArray<{ startMs: number; endMs: number }>,
  startMs: number,
  endMs: number,
): Set<number> {
  const cells = new Set<number>();
  const intervalMs = 80;
  const ranges: ReadonlyArray<{ startMs: number; endMs: number }> = rangesValue.length
    ? rangesValue
    : [{ startMs, endMs }];
  for (const range of ranges) {
    const first = Math.floor((range.startMs - startMs) / intervalMs);
    const last = Math.ceil((range.endMs - startMs) / intervalMs);
    for (let cell = Math.max(0, first); cell < last; cell += 1) cells.add(cell);
  }
  return cells;
}

function durationWeight(score: KaraokeLineScore): number {
  return Math.max(0.001, score.endMs - score.startMs);
}

function weightedTotal(
  parts: { pitch: number | null; rhythm: number | null; lyrics: number; completeness: number; breath: number },
  weights: KaraokeScoreWeights,
): number {
  const values: Array<[number, number]> = [];
  if (parts.pitch !== null && weights.pitch > 0) values.push([parts.pitch, weights.pitch]);
  if (parts.rhythm !== null && weights.rhythm > 0) values.push([parts.rhythm, weights.rhythm]);
  if (weights.lyrics > 0) values.push([parts.lyrics, weights.lyrics]);
  if (weights.completeness > 0) values.push([parts.completeness, weights.completeness]);
  if (weights.breath > 0) values.push([parts.breath, weights.breath]);
  const weightSum = values.reduce((total, item) => total + item[1], 0);
  if (weightSum <= 0) return 0;
  return values.reduce((total, item) => total + item[0] * item[1], 0) / weightSum;
}

function feedbackForLine(input: {
  activeCount: number;
  onsetDeltaMs: number | null;
  signedPitch: number;
  octaveMismatch: boolean;
  tailPitch: number | null;
  tailDeltaMs: number | null;
  lyricScore: number;
  lyricsProvided: boolean;
  meanEnergy: number;
  total: number;
}): readonly string[] {
  const feedback: string[] = [];
  if (input.activeCount === 0) {
    feedback.push('未检测到有效人声，环境声和静音不计分');
  }
  if (input.octaveMismatch) {
    feedback.push('存在约一个八度的音高偏差');
  } else if (input.signedPitch >= 0.5) {
    feedback.push('整体音高偏高');
  } else if (input.signedPitch <= -0.5) {
    feedback.push('整体音高偏低');
  }
  if (input.onsetDeltaMs !== null && Math.abs(input.onsetDeltaMs) > 120) {
    const seconds = (Math.abs(input.onsetDeltaMs) / 1000).toFixed(2);
    feedback.push(input.onsetDeltaMs < 0 ? `进入提前约${seconds}秒` : `进入延后约${seconds}秒`);
  }
  if (input.tailPitch !== null && input.tailPitch <= -0.5) {
    feedback.push('尾音偏低');
  } else if (input.tailPitch !== null && input.tailPitch >= 0.5) {
    feedback.push('尾音偏高');
  }
  if (input.tailDeltaMs !== null && input.tailDeltaMs < -200) {
    feedback.push('尾音结束偏早');
  }
  if (!input.lyricsProvided) {
    feedback.push('未提供歌词识别结果');
  } else if (input.lyricScore < 55) {
    feedback.push('歌词匹配度偏低');
  }
  if (input.activeCount > 0 && input.meanEnergy < 0.04) {
    feedback.push('声音偏小，气息支撑不足');
  }
  if (feedback.length === 0 && input.total >= 85) feedback.push('该句完成度良好');
  return frozenArray(feedback);
}

function analyzeLine(
  line: PitchTrack['lines'][number],
  trustedNotes: readonly PitchNote[],
  frames: readonly PitchFrame[],
  recognized: readonly RecognizedLyricLine[] | undefined,
  options: NormalizedOptions,
  pitchTrusted: boolean,
): AnalyticLine {
  const lineStart = finite(line?.startMs, 0);
  const lineEnd = Math.max(lineStart + 1, finite(line?.endMs, lineStart + 1));
  const windowFrames = frames.filter((frame) => frame.atMs >= lineStart - 250 && frame.atMs <= lineEnd + 250);
  const active = windowFrames.filter((frame): frame is PitchFrame & { midi: number } => isVoiced(frame, options));
  const lyricsText = matchingLyrics(recognized, finite(line?.index, 0), lineStart, lineEnd);
  const lyricScore = lyricsText === undefined
    ? 0
    : editSimilarity(normalizeLyricText(typeof line?.text === 'string' ? line.text : ''), normalizeLyricText(lyricsText)) * 100;

  const expected: ReadonlyArray<{ startMs: number; endMs: number }> = trustedNotes.length
    ? trustedNotes
    : Object.freeze([{ startMs: lineStart, endMs: lineEnd }]);
  const activeCells = new Set<number>();
  for (const frame of active) {
    if (frame.atMs >= lineStart && frame.atMs <= lineEnd) {
      activeCells.add(Math.max(0, Math.floor((frame.atMs - lineStart) / 80)));
    }
  }
  const wantedCells = expectedCells(expected, lineStart, lineEnd);
  let matchedCells = 0;
  for (const cell of wantedCells) if (activeCells.has(cell)) matchedCells += 1;
  const completeness = wantedCells.size ? clamp(matchedCells / wantedCells.size) * 100 : 0;

  const meanEnergy = active.length ? active.reduce((total, frame) => total + frame.energy, 0) / active.length : 0;
  const meanConfidence = active.length ? active.reduce((total, frame) => total + frame.confidence, 0) / active.length : 0;
  const voicedRatio = windowFrames.length ? active.length / windowFrames.length : 0;
  const breath = active.length
    ? clamp(clamp((meanEnergy - 0.015) / 0.14) * 0.65 + clamp(meanConfidence) * 0.25 + clamp(voicedRatio) * 0.1) * 100
    : 0;

  let pitch: number | null = null;
  let rhythm: number | null = null;
  let signedPitch = 0;
  let octaveMismatch = false;
  let onsetDeltaMs: number | null = null;
  let tailPitch: number | null = null;
  let tailDeltaMs: number | null = null;
  let combo = 0;

  if (pitchTrusted && trustedNotes.length) {
    const alignment = dtwPitchScore(trustedNotes, active);
    pitch = alignment.score;
    signedPitch = alignment.signedSemitones;
    octaveMismatch = active.some((frame) => {
      const target = expectedMidi(trustedNotes, frame.atMs);
      return target !== null && octaveAdjustedDistance(target, frame.midi).octave;
    });

    const expectedStart = trustedNotes[0].startMs;
    if (active.length) {
      const firstInLine = active.find((frame) => frame.atMs >= lineStart - 500 && frame.atMs <= lineEnd + 500);
      if (firstInLine) onsetDeltaMs = firstInLine.atMs - expectedStart;
    }
    const expectedEnd = trustedNotes[trustedNotes.length - 1].endMs;
    const lastInLine = [...active].reverse().find((frame) => frame.atMs <= lineEnd + 250);
    if (lastInLine) tailDeltaMs = lastInLine.atMs - expectedEnd;
    const tailStart = Math.max(lineStart, expectedEnd - 300);
    const tailDiffs = active
      .filter((frame) => frame.atMs >= tailStart && frame.atMs <= lineEnd + 250)
      .map((frame) => {
        const target = expectedMidi(trustedNotes, frame.atMs);
        return target === null ? null : frame.midi - target;
      })
      .filter((value): value is number => value !== null && Number.isFinite(value));
    if (tailDiffs.length) tailPitch = median(tailDiffs);

    let currentCombo = 0;
    let previousAt = Number.NEGATIVE_INFINITY;
    for (const frame of active) {
      const target = expectedMidi(trustedNotes, frame.atMs);
      const distance = target === null ? null : octaveAdjustedDistance(target, frame.midi);
      if (distance && !distance.octave && distance.adjusted <= 1 && frame.atMs - previousAt <= 180) {
        currentCombo += 1;
        combo = Math.max(combo, currentCombo);
      } else {
        currentCombo = 0;
      }
      previousAt = frame.atMs;
    }
  } else if (active.length) {
    const expectedStart = lyricsText !== undefined ? lineStart : lineStart;
    const first = active.find((frame) => frame.atMs >= lineStart - 500) ?? active[0];
    onsetDeltaMs = first.atMs - expectedStart;
  }

  if (rhythm === null && active.length) {
    const timingError = Math.max(0, Math.abs(onsetDeltaMs ?? 0) - 120);
    rhythm = clamp(1 - timingError / 600) * 100;
  }

  const total = rounded(weightedTotal({
    pitch,
    rhythm,
    lyrics: lyricScore,
    completeness,
    breath,
  }, options.weights));
  const feedback = feedbackForLine({
    activeCount: active.length,
    onsetDeltaMs,
    signedPitch,
    octaveMismatch,
    tailPitch,
    tailDeltaMs,
    lyricScore,
    lyricsProvided: lyricsText !== undefined,
    meanEnergy,
    total,
  });
  return {
    lineScore: Object.freeze({
      lineIndex: finite(line?.index, 0),
      startMs: lineStart,
      endMs: lineEnd,
      pitch: pitch === null ? null : rounded(pitch),
      rhythm: rhythm === null ? null : rounded(rhythm),
      lyrics: rounded(lyricScore),
      completeness: rounded(completeness),
      breath: rounded(breath),
      total,
      feedback,
    }),
    combo,
  };
}

export function scoreKaraoke(input: KaraokeScoreInput): KaraokeScore {
  const options = normalizeOptions(input?.options);
  const frames = normalizeFrames(input?.pitchFrames, options.latencyCompensationMs);
  const track = input?.pitchTrack;
  const trackLines = track?.schema === 1 && Array.isArray(track.lines)
    ? track.lines.slice(0, KARAOKE_LIMITS.maxLyricLines)
    : [];
  const pitchTrusted = options.trustPitchTrack
    && !!track
    && ['midi', 'ultrastar', 'enhanced-lrc', 'manual'].includes(track.source);
  const pitchEvaluated = pitchTrusted && trackLines.some((line) => validNotes(line).length > 0);
  const analyses = trackLines.map((line) => analyzeLine(
    line,
    pitchEvaluated ? validNotes(line) : [],
    frames,
    input?.recognizedLyrics,
    options,
    pitchEvaluated,
  ));
  const lineScores = analyses.map((analysis) => analysis.lineScore);
  const totalWeight = lineScores.reduce((total, line) => total + durationWeight(line), 0);
  const total = totalWeight
    ? rounded(lineScores.reduce((sum, line) => sum + line.total * durationWeight(line), 0) / totalWeight)
    : 0;
  const mean = lineScores.length
    ? lineScores.reduce((sum, line) => sum + line.total, 0) / lineScores.length
    : 0;
  const variance = lineScores.length
    ? lineScores.reduce((sum, line) => sum + (line.total - mean) ** 2, 0) / lineScores.length
    : 0;
  const best = lineScores.reduce<KaraokeLineScore | null>(
    (current, line) => current === null || line.total > current.total ? line : current,
    null,
  );
  return Object.freeze({
    schema: 1,
    total,
    stability: lineScores.length ? rounded(100 - Math.sqrt(variance)) : 0,
    longestCombo: analyses.reduce((maximum, line) => Math.max(maximum, line.combo), 0),
    bestLine: best?.lineIndex ?? null,
    lines: frozenArray(lineScores),
    pitchEvaluated,
  });
}

export function safeScoreKaraoke(input: KaraokeScoreInput): KaraokeResult<KaraokeScore> {
  try {
    return karaokeOk(scoreKaraoke(input));
  } catch {
    return karaokeFailure('INVALID_INPUT', '评分输入异常，已返回结构化失败');
  }
}

export class KaraokeScoreEngine {
  score(input: KaraokeScoreInput): KaraokeScore {
    return scoreKaraoke(input);
  }

  scoreSafe(input: KaraokeScoreInput): KaraokeResult<KaraokeScore> {
    return safeScoreKaraoke(input);
  }
}
