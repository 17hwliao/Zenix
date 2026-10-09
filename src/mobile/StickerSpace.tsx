import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion } from 'framer-motion';
import { Crosshair, Maximize2, Minimize2, MoreHorizontal, Pause, Play } from 'lucide-react';
import { activeLyricIndex, parseLyrics } from '../core/lyrics';
import type { LyricLine } from '../core/types';
import type { Track } from '../core/types';
import { STICKER_GAP, expandedStickerLayout, stickerSlotsForCount } from '../ui/stickerMosaic';
import { Art } from './Player';
import { isNativeMobile, readLyrics, type MobileSnapshot } from './native';
import { useSongGesture } from './useSongGesture';

/** Uses the desktop mosaic algorithm, finite posters and a touch camera. */
export default function StickerSpace({ songs, state, label, play, full, actions, focusRequest, seek, longPress }: {
  songs: Track[]; state: MobileSnapshot; label: string; play: (song: Track) => void;
  full: () => void; actions: (song: Track) => ReactNode;
  seek: (seconds: number) => void;
  focusRequest: number;
  longPress?: (song:Track)=>void;
}) {
  const viewport = useRef<HTMLDivElement>(null), gesture = useRef<{ id: number; x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const dragged = useRef(false), x = useMotionValue(0), y = useMotionValue(0), reduced = useReducedMotion();
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const cameraTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const updateCamera = () => { if (cameraTimer.current !== undefined) return; cameraTimer.current = setTimeout(() => { cameraTimer.current = undefined; setCamera({ x: x.get(), y: y.get() }); }, 50); };
  useMotionValueEvent(x, 'change', updateCamera); useMotionValueEvent(y, 'change', updateCamera);
  useEffect(() => () => clearTimeout(cameraTimer.current), []);
  const animations = useRef<ReturnType<typeof animate>[]>([]);
  const [size, setSize] = useState({ width: 390, height: 500 }), [selected, setSelected] = useState(0), [moving, setMoving] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const signature = songs.map(song => song.id).join('|'), player = state.playback;
  const previousLayout = useRef({ ids: [] as string[], focusRequest: -1, width: 0, height: 0 });
  const [captionVisible, setCaptionVisible] = useState(true);
  const captionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function showCaption() { clearTimeout(captionTimer.current); setCaptionVisible(true); }
  function hideCaptionLater() { clearTimeout(captionTimer.current); captionTimer.current = setTimeout(() => setCaptionVisible(false), 3000); }
  useEffect(() => { showCaption(); hideCaptionLater(); return () => clearTimeout(captionTimer.current); }, [player.track?.id, label]);
  const slots = useMemo(() => stickerSlotsForCount(songs.length), [songs.length]);
  const expanded = useMemo(() => expandedIndex === null ? new Map() : expandedStickerLayout(Math.min(expandedIndex, songs.length - 1), slots), [expandedIndex, slots, songs.length]);
  const pitch = Math.max(39, Math.min(85, (size.width - 32) / 6));
  const rects = useMemo(() => slots.map((slot, index) => expanded.get(index) || slot), [slots, expanded]);
  const bounds = rects.length ? { left: Math.min(...rects.map(rect => rect.x)) * pitch, top: Math.min(...rects.map(rect => rect.y)) * pitch, right: Math.max(...rects.map(rect => rect.x + rect.columns)) * pitch, bottom: Math.max(...rects.map(rect => rect.y + rect.rows)) * pitch } : { left: 0, top: 0, right: 0, bottom: 0 };
  function limit(value: number, start: number, end: number, extent: number) {
    if (end - start < extent - 32) return (extent - (end - start)) / 2 - start;
    return Math.max(extent - end - 24, Math.min(24 - start, value));
  }
  function stop() { animations.current.forEach(animation => animation.stop()); }
  function focus(index: number, enlarged: number | null = expandedIndex) {
    if (!songs.length) return; setSelected(index); stop();
    const layout = enlarged === null ? new Map() : expandedStickerLayout(enlarged, slots), rect = layout.get(index) || slots[index];
    const options = reduced ? { duration: 0 } : { type: 'spring' as const, stiffness: 170, damping: 27, mass: .9 };
    // Focus is centered deliberately; empty space is filled by the personal background.
    animations.current = [animate(x, size.width / 2 - (rect.x + rect.columns / 2) * pitch, options), animate(y, size.height / 2 - (rect.y + rect.rows / 2) * pitch, options)];
  }
  useEffect(() => { const element = viewport.current; if (!element) return; const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; setSize({ width, height }); }); observer.observe(element); return () => observer.disconnect(); }, []);
  useEffect(() => {
    const previous = previousLayout.current, ids = songs.map(song => song.id);
    const appended = previous.ids.length > 0 && previous.ids.length <= ids.length && previous.ids.every((id, index) => id === ids[index]);
    const current = songs.findIndex(song => song.id === player.track?.id);
    if (!appended) {
      setExpandedIndex(null); focus(current >= 0 ? current : 0, null);
    } else if (previous.focusRequest !== focusRequest) {
      focus(current >= 0 ? current : selected);
    } else if (previous.width !== size.width || previous.height !== size.height) {
      focus(selected);
    }
    // Progressive source replies and pagination extend the same wall. They must
    // not recenter the user's camera or undo an explicitly enlarged sticker.
    previousLayout.current = { ids, focusRequest, width: size.width, height: size.height };
  }, [signature, focusRequest, size.width, size.height]);
  useEffect(() => () => stop(), []);
  return <section className={`mobile-space ${moving ? 'is-panning' : ''}`} onPointerDownCapture={showCaption} onPointerUpCapture={hideCaptionLater} onPointerCancelCapture={hideCaptionLater}>
    <div className={`space-caption glass ${captionVisible ? "is-visible" : "is-hidden"}`} aria-hidden={!captionVisible}><span>{player.track ? `${player.playing ? "正在播放" : "已暂停"} · ${player.track.title}` : label}</span><small>{songs.length} 首</small><button tabIndex={captionVisible ? 0 : -1} aria-label="聚焦当前歌曲" onClick={() => { const index = songs.findIndex(song => song.id === player.track?.id); focus(index >= 0 ? index : selected); }}><Crosshair /></button></div>
    <div ref={viewport} className="space-viewport" onPointerDown={event => {
      if (event.button !== 0 || (event.target as Element).closest('.sticker-toolbar, input, .focused-lyrics')) return;
      stop(); dragged.current = false; gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, cx: x.get(), cy: y.get(), moved: false };
    }} onPointerMove={event => {
      const drag = gesture.current; if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 8) { drag.moved = true; dragged.current = true; setMoving(true); event.currentTarget.setPointerCapture(event.pointerId); }
      if (drag.moved) { x.set(limit(drag.cx + dx, bounds.left, bounds.right, size.width)); y.set(limit(drag.cy + dy, bounds.top, bounds.bottom, size.height)); }
    }} onPointerUp={event => { gesture.current = null; setMoving(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { gesture.current = null; setMoving(false); }} onClickCapture={event => { if (dragged.current) { event.preventDefault(); event.stopPropagation(); dragged.current = false; } }}>
      <motion.div className="space-plane" style={{ x, y }}>{songs.map((song, index) => {
        const rect = rects[index], current = song.id === player.track?.id, focused = index === selected;
        // Layout still includes the complete finite playlist, while React,
        // motion subscriptions and decoded covers exist only near the viewport.
        const visible = focused || (rect.x * pitch + camera.x < size.width + 240 && (rect.x + rect.columns) * pitch + camera.x > -240 && rect.y * pitch + camera.y < size.height + 240 && (rect.y + rect.rows) * pitch + camera.y > -240);
        if (!visible) return null;
        return <motion.article key={song.id} className={`space-sticker ${focused ? 'is-focused' : ''} ${current ? 'is-current' : ''} ${index === expandedIndex ? 'is-expanded' : ''}`} data-song-id={song.id} data-compact={rect.rows * pitch - STICKER_GAP < 150 || undefined} initial={false} animate={{ left: rect.x * pitch, top: rect.y * pitch, width: rect.columns * pitch - STICKER_GAP, height: rect.rows * pitch - STICKER_GAP }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 190, damping: 29 }}>
          <SongPoster song={song} index={index} current={current} focus={()=>focus(index)} longPress={longPress}/>
          {focused && current && index === expandedIndex && <FocusedLyrics track={song} position={player.position} seek={seek} />}
          <AnimatePresence initial={false}>{focused && <motion.div className="sticker-toolbar" initial={{ opacity: 0, y: reduced ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : 4 }} transition={{ duration: reduced ? 0 : .18 }}>
            {index === expandedIndex ? actions(song) : <button aria-label={`更多 ${song.title}`} onClick={()=>longPress?.(song)}><MoreHorizontal/></button>}
            <button aria-label={index === expandedIndex ? `缩小贴纸 ${song.title}` : `放大贴纸 ${song.title}`} aria-pressed={index === expandedIndex} onClick={()=>{const next=index===expandedIndex?null:index;setExpandedIndex(next);focus(index,next);}}>{index === expandedIndex ? <Minimize2/> : <Maximize2/>}</button>
            <button aria-label={`${current && (player.playWhenReady ?? player.playing) ? '暂停' : '播放'} ${song.title}`} onClick={()=>play(song)}>{current && (player.playWhenReady ?? player.playing) ? <Pause/> : <Play/>}</button>
            {current && index === expandedIndex && <button aria-label="打开完整播放器" onClick={full}><Maximize2/></button>}
          </motion.div>}</AnimatePresence>

        </motion.article>;
      })}</motion.div>
    </div>
  </section>;
}

function SongPoster({song,index,current,focus,longPress}:{song:Track;index:number;current:boolean;focus:()=>void;longPress?:(song:Track)=>void}){
  const gesture=useSongGesture(longPress?()=>longPress(song):undefined);
  return <button className="space-poster" {...gesture.handlers} onClick={focus} aria-label={`聚焦查看 ${song.title}`}><Art track={song}/><span className="sticker-index">{current?'正在播放 · ':''}{String(index+1).padStart(2,'0')}</span><span className="space-song"><strong>{song.title}</strong><small>{song.artist}</small></span></button>;
}

function FocusedLyrics({ track, position, seek }: { track: Track; position: number; seek: (seconds: number) => void }) {
  const [lines, setLines] = useState<LyricLine[]>([]), [preview, setPreview] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), touch = useRef<number | null>(null);
  const active = activeLyricIndex(lines, position), center = preview ?? Math.max(0, active);
  useEffect(() => { let cancelled = false; setLines([]); setPreview(null); clearTimeout(timer.current); if (isNativeMobile) void readLyrics(track).then(raw => { if (!cancelled) setLines(raw ? parseLyrics(raw) : []); }).catch(() => {}); return () => { cancelled = true; clearTimeout(timer.current); }; }, [track.id]);
  function browse(direction: number) { setPreview(value => Math.max(0, Math.min(lines.length - 1, (value ?? Math.max(0, active)) + direction))); clearTimeout(timer.current); timer.current = setTimeout(() => setPreview(null), 3000); }
  if (!lines.length) return null;
  return <div className="focused-lyrics" onWheel={event => { event.stopPropagation(); browse(event.deltaY > 0 ? 1 : -1); }} onPointerDown={event => { touch.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); clearTimeout(timer.current); }} onPointerMove={event => { if (touch.current === null) return; const delta = event.clientY - touch.current; if (Math.abs(delta) >= 28) { touch.current = event.clientY; browse(delta < 0 ? 1 : -1); } }} onPointerUp={event => { touch.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); clearTimeout(timer.current); timer.current = setTimeout(() => setPreview(null), 3000); }} onPointerCancel={() => { touch.current = null; timer.current = setTimeout(() => setPreview(null), 3000); }}>
    {[center - 1, center, center + 1].map((index, row) => <motion.div key={`${row}-${index}`} className={row === 1 ? 'center-line' : ''} initial={{ opacity: .2, y: 7 }} animate={{ opacity: row === 1 ? 1 : .4, y: 0 }} transition={{ duration: .22 }}><span>{lines[index]?.text || ''}</span></motion.div>)}
    {preview !== null && lines[center] && <button aria-label="跳到预览歌词" onClick={() => { seek(lines[center].time); clearTimeout(timer.current); setPreview(null); }}><Play fill="currentColor" size={15} /></button>}
  </div>;
}
