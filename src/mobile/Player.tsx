import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { motion } from 'framer-motion';
import { Captions, ChevronDown, Disc3, ListMusic, LoaderCircle, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { activeLyricIndex, parseLyrics } from '../core/lyrics';
import type { LyricLine, Track } from '../core/types';
import { isNativeMobile, supportsOverlay, readLyrics, type MobileSnapshot } from './native';

export const fileUrl = (url?: string) => url && (url.startsWith('/') || url.startsWith('content:')) ? Capacitor.convertFileSrc(url) : url;
const clock = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`;
export const Art = memo(function Art({ track }: { track?: Track }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [track?.coverUrl]);
  return track?.coverUrl && !failed ? <img className="mobile-art" src={fileUrl(track.coverUrl)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} draggable={false} /> : <div className="mobile-art art-fallback"><Disc3 /><span>{track?.title?.slice(0, 1) || 'Z'}</span></div>;
}, (previous, next) => previous.track?.coverUrl === next.track?.coverUrl && previous.track?.title === next.track?.title);
export function Seek({ position, duration, onSeek, compact = false }: { position: number; duration: number; onSeek: (seconds: number) => void; compact?: boolean }) {
  const [drag, setDrag] = useState<number | null>(null); const value = drag ?? position;
  return <div className={`mobile-seek ${compact ? 'compact' : ''}`}><span>{clock(value)}</span><input aria-label="歌曲进度" type="range" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(value, Math.max(1, duration))} style={{ '--progress': `${Math.min(100, value / Math.max(1, duration) * 100)}%` } as CSSProperties} onChange={event => setDrag(Number(event.target.value))} onPointerUp={event => { onSeek(Number(event.currentTarget.value)); setDrag(null); }} onPointerCancel={() => setDrag(null)} onKeyUp={event => { if (event.key.startsWith('Arrow')) { onSeek(Number(event.currentTarget.value)); setDrag(null); } }} /><span>{clock(duration)}</span></div>;
}
export function FullPlayer({ state, act, actions, close, queue }: { state: MobileSnapshot; act: (action: string, payload?: Record<string, unknown>) => Promise<unknown>; actions: ReactNode; close: () => void; queue: () => void }) {
  const player = state.playback, track = player.track;
  const [lines, setLines] = useState<LyricLine[]>([]), [loading, setLoading] = useState(false);
  useEffect(() => { let cancelled = false; setLines([]); if (!track || !isNativeMobile) return; setLoading(true); void readLyrics(track).then(raw => { if (!cancelled) setLines(raw ? parseLyrics(raw) : []); }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [track?.id]);
  if (!track) return null;
  return <motion.section className="mobile-full-player" initial={{ y: '100%' }} animate={{ y: 0 }} transition={{ type: 'spring', damping: 30, stiffness: 240 }}><div className="full-player-art"><Art track={track} /></div><header><button aria-label="收起" onClick={close}><ChevronDown /></button><span>ZENIX · NOW PLAYING</span><button aria-label="播放列表" onClick={queue}><ListMusic /></button></header><div className="full-song"><Art track={track} /><h1>{track.title}</h1><p>{track.artist}</p></div><Lyrics lines={lines} position={player.position} loading={loading} size={state.profile?.lyricSize || 26} color={state.profile?.lyricColor || '#c5e9ff'} onSeek={seconds => void act('seek', { seconds })} /><div className="full-controls">{supportsOverlay && <button className="floating-lyric-toggle glass" aria-pressed={state.overlay?.enabled || false} onClick={async () => { if (!state.overlay?.enabled) await act('notifications'); await act('overlayEnable', { enabled: !state.overlay?.enabled }); }}><Captions />{state.overlay?.enabled ? '关闭悬浮歌词' : '悬浮歌词'}</button>}{actions}<Seek position={player.position} duration={player.duration} onSeek={seconds => void act('seek', { seconds })} /><div className="transport"><button className={player.shuffle ? 'selected' : ''} aria-label="随机播放" onClick={() => void act('mode', { shuffle: !player.shuffle })}><Shuffle /></button><button aria-label="上一首" onClick={() => void act('previous')}><SkipBack fill="currentColor" /></button><button className="primary-play" aria-label={player.playing ? '暂停' : '播放'} onClick={() => void act('toggle')}>{player.playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><button aria-label="下一首" onClick={() => void act('next')}><SkipForward fill="currentColor" /></button><button className={player.repeat !== 'off' ? 'selected' : ''} aria-label="循环模式" onClick={() => void act('mode', { repeat: player.repeat === 'all' ? 'one' : player.repeat === 'one' ? 'off' : 'all' })}><Repeat />{player.repeat === 'one' && <small>1</small>}</button></div><button className="queue-open" onClick={queue}><ListMusic />当前队列 · {player.queue.length} 首</button></div></motion.section>;
}
function Lyrics({ lines, position, loading, onSeek, size, color }: { lines: LyricLine[]; position: number; loading: boolean; onSeek: (seconds: number) => void; size: number; color: string }) {
  const ref = useRef<HTMLDivElement>(null), manual = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = activeLyricIndex(lines, position), activeRef = useRef(active); activeRef.current = active;
  const follow = useCallback(() => { const area = ref.current, row = area?.querySelector<HTMLButtonElement>(`[data-line="${activeRef.current}"]`); if (area && row) area.scrollTo({ top: row.offsetTop - area.clientHeight / 2 + row.clientHeight / 2, behavior: 'smooth' }); }, []);
  useEffect(() => { if (Date.now() >= manual.current) follow(); }, [active, lines, follow]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const preview = () => { manual.current = Date.now() + 3000; clearTimeout(timer.current); timer.current = setTimeout(() => { manual.current = 0; follow(); }, 3000); };
  return <div ref={ref} className="mobile-lyrics" style={{ '--lyric-size': `${size}px`, '--lyric-color': color } as CSSProperties} onTouchStart={preview} onTouchMove={preview} onWheel={preview}>{!lines.length ? <div className="lyrics-empty">{loading ? <><LoaderCircle className="spin" />正在获取歌词</> : '暂未找到歌词'}</div> : lines.map((line, index) => <button data-line={index} className={index === active ? 'active-line' : ''} key={`${line.time}-${index}`} onClick={() => { onSeek(line.time); manual.current = 0; clearTimeout(timer.current); }}><span>{line.text}</span>{line.translation && <small>{line.translation}</small>}</button>)}</div>;
}
