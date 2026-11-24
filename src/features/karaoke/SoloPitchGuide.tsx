import {useMemo} from 'react';
import type {KaraokeLyricLine, PitchFrame} from './contracts';

const width = 620, height = 132, guide = 158, pixelsPerMs = .077;
const names = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const noteName = (midi: number) => `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;

export default function SoloPitchGuide({lyrics,elapsed,frames}:{lyrics:readonly KaraokeLyricLine[];elapsed:number;frames:readonly PitchFrame[]}) {
  const chart = useMemo(() => {
    const notes = lyrics.flatMap(line => line.notes);
    let low = 127, high = 0;
    for (const note of notes) {low = Math.min(low,note.midi);high = Math.max(high,note.midi);}
    return {notes,low:Math.max(0,low-3),high:Math.min(127,Math.max(low+6,high+3))};
  }, [lyrics]);
  if (!chart.notes.length) return <section className="solo-pitch-empty"><h4>音高轨</h4><p>导入带音高的曲谱后，会在这里显示进拍线和目标音符。</p></section>;
  const x = (time: number) => guide + (time-elapsed)*pixelsPerMs;
  const y = (midi: number) => 12 + (chart.high - midi) / Math.max(1,chart.high-chart.low) * (height-24);
  const visible = chart.notes.filter(note => x(note.endMs) >= 32 && x(note.startMs) <= width);
  const step = Math.max(2,Math.ceil((chart.high-chart.low)/5));
  const levels: number[] = [];
  for (let midi = chart.low; midi <= chart.high; midi+=step) levels.push(midi);
  return <figure className="solo-pitch-guide">
    <figcaption><strong>音高轨</strong><span><i/>目标音符 <i/>你的音高</span></figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="横向为时间，纵向为音高，音符通过竖线时开唱" preserveAspectRatio="none">
      {levels.map(midi => <g key={midi}><text x={4} y={y(midi)+4}>{noteName(midi)}</text><line x1={32} x2={width} y1={y(midi)} y2={y(midi)}/></g>)}
      {visible.map((note,index) => <rect key={`${note.startMs}:${note.midi}:${index}`} className={elapsed >= note.startMs && elapsed < note.endMs ? 'is-current' : undefined} x={Math.max(32,x(note.startMs))} y={y(note.midi)-4} width={Math.max(1,Math.min(width,x(note.endMs))-Math.max(32,x(note.startMs)))} height={8} rx={3}/>)}
      {frames.filter(frame => frame.midi !== null && frame.confidence >= .55 && frame.midi >= chart.low && frame.midi <= chart.high && x(frame.atMs) >= 32 && x(frame.atMs) <= width)
        .map(frame => <circle key={frame.atMs} cx={x(frame.atMs)} cy={y(frame.midi!)} r={2.8}/>)}
      <line className="solo-playhead" x1={guide} x2={guide} y1={0} y2={height}/>
    </svg>
    <small>音符经过竖线时开唱；位置越高，音越高。</small>
  </figure>;
}
