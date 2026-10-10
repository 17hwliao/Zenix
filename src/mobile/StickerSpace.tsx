import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion } from 'framer-motion';
import { Crosshair, Maximize2, Pause, Play } from 'lucide-react';
import { activeLyricIndex, parseLyrics } from '../core/lyrics';
import type { LyricLine } from '../core/types';
import type { Track } from '../core/types';
import { STICKER_GAP, expandedStickerLayout, focusedStickerRect, stickerSlotsForCount } from '../ui/stickerMosaic';
import { Art } from './Player';
import { isNativeMobile, readLyrics, type MobileSnapshot } from './native';
import { useSongGesture } from './useSongGesture';

/** Uses the desktop mosaic algorithm, finite posters and a touch camera. */
const layouts = new Map<string, ReturnType<typeof expandedStickerLayout>>();
function mobileLayout(count: number, selected: number, slots: ReturnType<typeof stickerSlotsForCount>) {
  const key = `${count}:${selected}`;
  let layout = layouts.get(key);
  if (!layout) {
    layout = expandedStickerLayout(selected, slots);
    if (layouts.size >= 32) layouts.delete(layouts.keys().next().value!);
    layouts.set(key, layout);
  }
  return layout;
}
export default memo(function StickerSpace({ songs, state, label, play, full, actions, focusRequest, seek, longPress, suspended = false }: {
  songs: Track[]; state: MobileSnapshot; label: string; play: (song: Track) => void;
  full: () => void; actions: (song: Track) => ReactNode;
  seek: (seconds: number) => void;
  focusRequest: number;
  longPress?: (song:Track)=>void;
  suspended?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null), gesture = useRef<{ id: number; x: number; y: number; cx: number; cy: number; moved: boolean } | null>(null);
  const dragged = useRef(false), x = useMotionValue(0), y = useMotionValue(0), reduced = useReducedMotion();
  const [camera, setCamera] = useState<{x:number;y:number;toX?:number;toY?:number}>({ x: 0, y: 0 });
  const cameraFlight = useRef(false), flightGeneration = useRef(0);
  const cameraTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const updateCamera = () => { if (cameraFlight.current || cameraTimer.current !== undefined) return; cameraTimer.current = setTimeout(() => { cameraTimer.current = undefined; setCamera({ x: x.get(), y: y.get() }); }, 50); };
  useMotionValueEvent(x, 'change', updateCamera); useMotionValueEvent(y, 'change', updateCamera);
  useEffect(() => () => clearTimeout(cameraTimer.current), []);
  const animations = useRef<ReturnType<typeof animate>[]>([]);
  const [size, setSize] = useState({ width: 390, height: 500 }), [selected, setSelected] = useState(() => Math.max(0,songs.findIndex(song=>song.id===state.playback.track?.id))), [moving, setMoving] = useState(false);
  const signature = songs.map(song => song.id).join('|'), player = state.playback;
  const previousLayout = useRef({ ids: [] as string[], focusRequest: -1, width: 0, height: 0 });
  const [captionVisible, setCaptionVisible] = useState(true);
  const captionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function showCaption() { clearTimeout(captionTimer.current); setCaptionVisible(true); }
  function hideCaptionLater() { clearTimeout(captionTimer.current); captionTimer.current = setTimeout(() => setCaptionVisible(false), 3000); }
  useEffect(() => { showCaption(); hideCaptionLater(); return () => clearTimeout(captionTimer.current); }, [player.track?.id, label]);
  const slots = useMemo(() => stickerSlotsForCount(songs.length), [songs.length]);
  // A focused poster expands inside the mosaic, as on PC. This is independent
  // of playback and of the explicit button that opens the full-screen player.
  const expanded = useMemo(() => mobileLayout(songs.length,Math.min(selected, songs.length - 1),slots), [selected, slots, songs.length]);
  const pitch = Math.max(39, Math.min(85, (size.width - 32) / 6));
  const rects = useMemo(() => slots.map((slot, index) => expanded.get(index) || slot), [slots, expanded]);
  const bounds = rects.length ? { left: Math.min(...rects.map(rect => rect.x)) * pitch, top: Math.min(...rects.map(rect => rect.y)) * pitch, right: Math.max(...rects.map(rect => rect.x + rect.columns)) * pitch, bottom: Math.max(...rects.map(rect => rect.y + rect.rows)) * pitch } : { left: 0, top: 0, right: 0, bottom: 0 };
  function limit(value: number, start: number, end: number, extent: number) {
    if (end - start < extent - 32) return (extent - (end - start)) / 2 - start;
    return Math.max(extent - end - 24, Math.min(24 - start, value));
  }
  function stop() { flightGeneration.current++; animations.current.forEach(animation => animation.stop()); if(cameraFlight.current){cameraFlight.current=false;setCamera({x:x.get(),y:y.get()});} }
  useEffect(() => {
    if(suspended){stop();clearTimeout(cameraTimer.current);cameraTimer.current=undefined;clearTimeout(captionTimer.current);}
    else {showCaption();hideCaptionLater();}
  }, [suspended]);
  function focus(index: number) {
    if (!songs.length) return; setSelected(index); stop();
    const rect = focusedStickerRect(index, slots) || slots[index];
    const options = reduced ? { duration: 0 } : { duration: .62, ease: [.22, 1, .36, 1] as [number, number, number, number] };
    // Focus is centered deliberately; empty space is filled by the personal background.
    const toX=size.width / 2 - (rect.x + rect.columns / 2) * pitch, toY=size.height / 2 - (rect.y + rect.rows / 2) * pitch;
    // Mount the swept viewport once. Camera frames update the plane directly,
    // rather than rerendering every poster and measuring its layout every 50ms.
    clearTimeout(cameraTimer.current);cameraTimer.current=undefined;
    cameraFlight.current=true;const generation=flightGeneration.current;
    setCamera({x:x.get(),y:y.get(),toX,toY});
    animations.current = [animate(x,toX,options),animate(y,toY,options)];
    void Promise.all(animations.current).then(()=>{if(generation===flightGeneration.current){cameraFlight.current=false;setCamera({x:x.get(),y:y.get()});}});
  }
  useEffect(() => { const element = viewport.current; if (!element) return; const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; if(width>0&&height>0)setSize(previous=>previous.width===width&&previous.height===height?previous:{width,height}); }); observer.observe(element); return () => observer.disconnect(); }, []);
  useEffect(() => {
    if(suspended)return;
    const previous = previousLayout.current, ids = songs.map(song => song.id);
    const appended = previous.ids.length > 0 && previous.ids.length <= ids.length && previous.ids.every((id, index) => id === ids[index]);
    const current = songs.findIndex(song => song.id === player.track?.id);
    if (!appended) {
      focus(current >= 0 ? current : 0);
    } else if (previous.focusRequest !== focusRequest) {
      focus(current >= 0 ? current : selected);
    } else if (previous.width !== size.width || previous.height !== size.height) {
      focus(selected);
    }
    // Progressive source replies and pagination extend the same wall. They must
    // not recenter the user's camera or change the selected poster.
    previousLayout.current = { ids, focusRequest, width: size.width, height: size.height };
  }, [signature, focusRequest, size.width, size.height, suspended]);
  useEffect(() => () => stop(), []);
  return <section className={`mobile-space ${moving ? 'is-panning' : ''} ${suspended ? 'is-suspended' : ''}`} aria-hidden={suspended} onPointerDownCapture={showCaption} onPointerUpCapture={hideCaptionLater} onPointerCancelCapture={hideCaptionLater}>
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
        const visible = focused || (rect.x * pitch + Math.min(camera.x,camera.toX??camera.x) < size.width + 240 && (rect.x + rect.columns) * pitch + Math.max(camera.x,camera.toX??camera.x) > -240 && rect.y * pitch + Math.min(camera.y,camera.toY??camera.y) < size.height + 240 && (rect.y + rect.rows) * pitch + Math.max(camera.y,camera.toY??camera.y) > -240);
        if (!visible) return null;
        return <MosaicSticker key={song.id} id={song.id} className={`space-sticker ${focused ? 'is-focused is-expanded' : ''} ${current ? 'is-current' : ''}`} reduced={Boolean(reduced)} left={rect.x*pitch} top={rect.y*pitch} width={rect.columns*pitch-STICKER_GAP} height={rect.rows*pitch-STICKER_GAP}>
          <SongPoster song={song} index={index} current={current} focus={()=>focus(index)} longPress={longPress}/>
          {focused && current && <FocusedLyrics track={song} position={player.position} seek={seek} />}
          <AnimatePresence initial={false}>{focused && <motion.div className="sticker-toolbar" initial={{ opacity: 0, y: reduced ? 0 : 11 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : 4 }} transition={{ duration: reduced ? 0 : .3, delay: focused && !reduced ? .19 : 0 }}>
            {actions(song)}
            <button aria-label={`${current && (player.playWhenReady ?? player.playing) ? '暂停' : '播放'} ${song.title}`} onClick={()=>play(song)}>{current && (player.playWhenReady ?? player.playing) ? <Pause/> : <Play/>}</button>
            {current && <button aria-label="打开完整播放器" onClick={full}><Maximize2/></button>}
          </motion.div>}</AnimatePresence>

        </MosaicSticker>;
      })}</motion.div>
    </div>
  </section>;
}, (previous,next) => Boolean(previous.suspended && next.suspended));

function MosaicSticker({id,className,left,top,width,height,reduced,children}:{id:string;className:string;left:number;top:number;width:number;height:number;reduced:boolean;children:ReactNode}){
  const ref=useRef<HTMLElement>(null), previous=useRef<{left:number;top:number;width:number;height:number}|undefined>(undefined), animation=useRef<Animation|undefined>(undefined);
  useLayoutEffect(()=>{
    const element=ref.current, before=previous.current;
    previous.current={left,top,width,height};
    if(!element||!before)return;
    // Continue from the visible intermediate transform if focus changes quickly.
    // One measurement per layout change; the browser composites the following frames.
    const matrix=animation.current?new DOMMatrixReadOnly(getComputedStyle(element).transform):new DOMMatrixReadOnly();
    animation.current?.cancel();animation.current=undefined;
    if(reduced)return;
    const dx=before.left+matrix.m41-left,dy=before.top+matrix.m42-top,sx=before.width*matrix.m11/width,sy=before.height*matrix.m22/height;
    if(Math.abs(dx)<.01&&Math.abs(dy)<.01&&Math.abs(sx-1)<.001&&Math.abs(sy-1)<.001)return;
    animation.current=element.animate([{transform:`translate(${dx}px,${dy}px) scale(${sx},${sy})`},{transform:'none'}],{duration:580,easing:'cubic-bezier(.22,1,.36,1)'});
  },[left,top,width,height,reduced]);
  useEffect(()=>()=>animation.current?.cancel(),[]);
  return <article ref={ref} className={className} data-song-id={id} data-compact={height<150||undefined} style={{left,top,width,height,transformOrigin:'0 0'}}>{children}</article>;
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
