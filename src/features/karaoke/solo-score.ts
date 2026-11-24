import {karaokeGradeForScore, type KaraokeGrade, type KaraokeLineScore, type KaraokeLyricLine, type PitchFrame} from './contracts';
import {scoreKaraoke} from './score-engine';

export const soloGrades: Record<KaraokeGrade, string> = {
  perfect: '精准', excellent: '优秀', veryGood: '稳定', good: '良好', nice: '有进步', pass: '基本跟上', retry: '继续练习',
};

export interface SoloResult {
  total: number;
  full: boolean;
  totalLines: number;
  lines: readonly KaraokeLineScore[];
  pitch: number;
  rhythm: number;
  coverage: number;
  grade: KaraokeGrade;
  sections?: readonly {label: string; total: number; scored: number; lines: number}[];
}

function firstAt(frames: readonly PitchFrame[], at: number): number {
  let first = 0, last = frames.length;
  while (first < last) {
    const mid = (first + last) >>> 1;
    if (frames[mid].atMs < at) first = mid + 1;
    else last = mid;
  }
  return first;
}

/** Only timed frames from the quiet accompaniment are captured by the solo controller. */
export function scoreSoloLine(line: KaraokeLyricLine, frames: readonly PitchFrame[]): KaraokeLineScore | null {
  if (!line.notes.length) return null;
  const start = line.notes[0].startMs;
  const end = line.notes.reduce((last,note) => Math.max(last,note.endMs),start);
  const window = frames.slice(firstAt(frames, start - 180), firstAt(frames, end + 180));
  // A denied or late microphone is unassessed. With a microphone present,
  // a real captured rest throughout a note is a scored miss.
  const captured = window.filter(frame => frame.atMs >= start - 50 && frame.atMs <= end + 50);
  const cells = new Set(captured.map(frame => Math.floor(Math.max(0, frame.atMs - start) / 100)));
  if (cells.size < Math.max(1, Math.floor((end - start) / 100 * .6))) return null;
  // Adjacent sentences never help (or hurt) this sentence's pitch score.
  const ownFrames = window.filter(frame => frame.atMs >= line.startMs && frame.atMs < line.endMs);
  const row = scoreKaraoke({pitchFrames:ownFrames, pitchTrack:{schema:1,source:'manual',lines:[line]},
    options:{weights:{pitch:60,rhythm:25,completeness:15,lyrics:0,breath:0}}}).lines[0];
  if (!row) return null;
  const feedback = row.feedback.filter(item => !/歌词识别|声音偏小/.test(item));
  return {...row,rhythm:row.rhythm ?? 0,feedback:feedback.length ? feedback : [row.total >= 85 ? '这一句跟得很稳' : '留意进入时机和尾音']};
}

export function summarizeSolo(lines: readonly KaraokeLyricLine[], scores: readonly KaraokeLineScore[]): SoloResult | null {
  if (!scores.length || !lines.length) return null;
  const mean = (read: (row: KaraokeLineScore) => number) => Math.round(scores.reduce((sum,row) => sum + read(row), 0) / scores.length);
  const total = mean(row => row.total);
  const byLine = new Map(scores.map(row => [row.lineIndex,row.total]));
  const labels = lines.length >= 3 ? ['前段','中段','后段'] : ['全段'];
  const sections = labels.flatMap((label,index) => {
    const part = lines.slice(Math.floor(index*lines.length/labels.length), Math.floor((index+1)*lines.length/labels.length));
    const rated = part.flatMap(line => byLine.has(line.index) ? [byLine.get(line.index)!] : []);
    return rated.length ? [{label,total:Math.round(rated.reduce((sum,value) => sum+value,0)/rated.length),scored:rated.length,lines:part.length}] : [];
  });
  return {total,full:scores.length === lines.length,totalLines:lines.length,lines:scores,
    pitch:mean(row => row.pitch ?? 0),rhythm:mean(row => row.rhythm ?? 0),coverage:mean(row => row.completeness),grade:karaokeGradeForScore(total),sections};
}
