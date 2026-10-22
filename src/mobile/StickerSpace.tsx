import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion } from 'framer-motion';
import { Crosshair, Maximize2, Pause, Play } from 'lucide-react';
import TrackVersions from '../ui/TrackVersions';
import { containsTrack } from '../core/searchGroups';
import type { SourceDiagnosticsState } from '../core/types';
import { command } from './native';
const loadSourceDiagnostics = () => command<SourceDiagnosticsState>('sourceDiagnostics');
import { activeLyricIndex, parseLyrics } from '../core/lyrics';
import type { LyricLine } from '../core/types';
import type { Track } from '../core/types';
import { STICKER_GAP, expandedStickerLayout, focusedStickerRect, stickerSlotsForCount } from '../ui/stickerMosaic';
import { Art } from './Player';
import { isNativeMobile, readLyrics, type MobileSnapshot } from './native';
import { useSongGesture } from './useSongGesture';
import { projectStickerLayout, type StickerGeometry } from './stickerMotion';
import { StickerCameraGesture } from './stickerCamera';
import {useSpaceSettings,writeSpace,rules,type SpaceBookmark} from '../features/space/state';
import '../features/space/space.css';

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
export default memo(function StickerSpace({ songs:providedSongs, state, label, play, full, actions, focusRequest, seek, longPress, suspended = false }: {
  songs: Track[]; state: MobileSnapshot; label: string; play: (song: Track) => void;
  full: () => void; actions: (song: Track) => ReactNode;
  seek: (seconds: number) => void;
  focusRequest: number;
  longPress?: (song:Track)=>void;
  suspended?: boolean;
}) {
  const zoneDrag=useRef<{id:string;pointer:number}|undefined>(undefined);
  const settings=useSpaceSettings(),[zone,setZone]=useState(''),[zoneEditing,setZoneEditing]=useState(false),[restored,setRestored]=useState<Track[]>(),[restoreVersion,setRestoreVersion]=useState(0);
  const pendingRestore=useRef<SpaceBookmark|undefined>(undefined);
  const baseSongs=restored||providedSongs;
  const activeZone=settings.zones.find(value=>value.id===zone);
  const songs=useMemo(()=>activeZone?baseSongs.filter(song=>activeZone.trackIds.includes(song.id)):baseSongs,[baseSongs,activeZone]);
  useEffect(()=>{setRestored(undefined);setZone('');},[label]);
  const viewport = useRef<HTMLDivElement>(null), gesture = useRef(new StickerCameraGesture()), gestureOrigin=useRef({left:0,top:0});
  const dragged = useRef(false), x = useMotionValue(0), y = useMotionValue(0), scale=useMotionValue(1), systemReduced = useReducedMotion();
  const reduced=systemReduced||settings.motion==='reduced';
  const [camera, setCamera] = useState<{x:number;y:number;scale:number;toX?:number;toY?:number}>({ x: 0, y: 0, scale:1 });
  const cameraFlight = useRef(false), flightGeneration = useRef(0);
  const cameraTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cameraValue=()=>({x:x.get(),y:y.get(),scale:scale.get()});
  const updateCamera = () => { if (cameraFlight.current || cameraTimer.current !== undefined) return; cameraTimer.current = setTimeout(() => { cameraTimer.current = undefined; setCamera(cameraValue()); }, 50); };
  useMotionValueEvent(x, 'change', updateCamera); useMotionValueEvent(y, 'change', updateCamera);useMotionValueEvent(scale,'change',updateCamera);
  useEffect(() => () => clearTimeout(cameraTimer.current), []);
  const animations = useRef<ReturnType<typeof animate>[]>([]);
  const [size, setSize] = useState({ width: 390, height: 500 }), [selected, setSelected] = useState(() => Math.max(0,songs.findIndex(song=>song.id===state.playback.track?.id))), [moving, setMoving] = useState(false);
  const [chosenVariants, setChosenVariants] = useState<Record<string, string>>({});
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
  const stickerElements = useRef(new Map<string, HTMLElement>()), stickerAnimations = useRef(new Map<string, Animation>());
  const layoutGeometry = useRef(new Map<string, StickerGeometry>()), transitionGeometry = useRef(layoutGeometry.current);
  const geometry = useMemo(() => new Map(songs.map((song,index) => { const rect=rects[index];return [song.id,{left:rect.x*pitch,top:rect.y*pitch,width:rect.columns*pitch-STICKER_GAP,height:rect.rows*pitch-STICKER_GAP}]; })), [songs,rects,pitch]);
  const registerSticker = useCallback((id: string, element: HTMLElement | null) => {
    if(element)stickerElements.current.set(id,element);
    else{stickerElements.current.delete(id);stickerAnimations.current.get(id)?.cancel();stickerAnimations.current.delete(id);}
  },[]);
  useLayoutEffect(()=>{
    projectStickerLayout(stickerElements.current,layoutGeometry.current,geometry,stickerAnimations.current,!suspended&&!reduced,settings.motion==='light'?240:580);
    layoutGeometry.current=geometry;
  },[geometry,suspended,reduced,settings.motion]);
  const bounds = rects.length ? { left: Math.min(...rects.map(rect => rect.x)) * pitch, top: Math.min(...rects.map(rect => rect.y)) * pitch, right: Math.max(...rects.map(rect => rect.x + rect.columns)) * pitch, bottom: Math.max(...rects.map(rect => rect.y + rect.rows)) * pitch } : { left: 0, top: 0, right: 0, bottom: 0 };
  function stop() { flightGeneration.current++; animations.current.forEach(animation => animation.stop()); if(cameraFlight.current){cameraFlight.current=false;setCamera(cameraValue());} }
  function cancelGesture(){zoneDrag.current=undefined;const ids=gesture.current.ids();gesture.current.cancel();for(const id of ids)if(viewport.current?.hasPointerCapture(id))viewport.current.releasePointerCapture(id);setMoving(false);}
  useEffect(() => {
    if(suspended){stop();cancelGesture();clearTimeout(cameraTimer.current);cameraTimer.current=undefined;clearTimeout(captionTimer.current);}
    else {showCaption();hideCaptionLater();}
  }, [suspended]);
  function focus(index: number) {
    if (!songs.length) return; if(gesture.current.count)cancelGesture();transitionGeometry.current=layoutGeometry.current;setSelected(index); stop();
    const rect = focusedStickerRect(index, slots) || slots[index];
    const options = reduced ? { duration: 0 } : { duration: settings.motion==='light'?.28:.62, ease: [.22, 1, .36, 1] as [number, number, number, number] };
    // Focus is centered deliberately; empty space is filled by the personal background.
    const toX=size.width / 2 - (rect.x + rect.columns / 2) * pitch * scale.get(), toY=size.height / 2 - (rect.y + rect.rows / 2) * pitch * scale.get();
    // Mount the swept viewport once. Camera frames update the plane directly,
    // rather than rerendering every poster and measuring its layout every 50ms.
    clearTimeout(cameraTimer.current);cameraTimer.current=undefined;
    cameraFlight.current=true;const generation=flightGeneration.current;
    setCamera({...cameraValue(),toX,toY});
    animations.current = [animate(x,toX,options),animate(y,toY,options)];
    void Promise.all(animations.current).then(()=>{if(generation===flightGeneration.current){cameraFlight.current=false;setCamera(cameraValue());}});
  }
  useEffect(() => { const element = viewport.current; if (!element) return; const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; if(width>0&&height>0)setSize(previous=>previous.width===width&&previous.height===height?previous:{width,height}); }); observer.observe(element); return () => observer.disconnect(); }, []);
  useEffect(() => {
    if(suspended)return;
    const previous = previousLayout.current, ids = songs.map(song => song.id);
    const appended = previous.ids.length > 0 && previous.ids.length <= ids.length && previous.ids.every((id, index) => id === ids[index]);
    const current = songs.findIndex(song => song.id === player.track?.id);
    const restore=pendingRestore.current;
    if(restore){pendingRestore.current=undefined;stop();cancelGesture();setSelected(Math.max(0,songs.findIndex(song=>song.id===restore.selectedId)));x.set(restore.camera.x);y.set(restore.camera.y);scale.set(restore.camera.scale);setCamera(cameraValue());previousLayout.current={ids,focusRequest,width:size.width,height:size.height};return;}
    if (!appended) {
      focus(current >= 0 ? current : 0);
    } else if (previous.focusRequest !== focusRequest) {
      focus(current >= 0 ? current : selected);
    } else if (previous.width !== size.width || previous.height !== size.height) {
      cancelGesture();
      focus(selected);
    }
    // Progressive source replies and pagination extend the same wall. They must
    // not recenter the user's camera or change the selected poster.
    previousLayout.current = { ids, focusRequest, width: size.width, height: size.height };
  }, [signature, focusRequest, size.width, size.height, suspended,restoreVersion]);
  useEffect(() => () => stop(), []);
  useEffect(()=>{const request=(event:Event)=>{if(suspended)return;window.dispatchEvent(new CustomEvent('zenix-space-response',{detail:{token:(event as CustomEvent).detail.token,snapshot:{camera:cameraValue(),selectedId:songs[selected]?.id||'',tracks:songs.map(rules.reference)}}}));};const restore=(event:Event)=>{if(suspended)return;const bookmark=(event as CustomEvent<SpaceBookmark>).detail;const known=new Map(baseSongs.map(song=>[song.id,song]));setRestored(bookmark.tracks.filter(song=>song.source!=='local'||known.has(song.id)).map(song=>known.get(song.id)||song));setZone('');pendingRestore.current=bookmark;setRestoreVersion(v=>v+1);};window.addEventListener('zenix-space-request',request);window.addEventListener('zenix-space-restore',restore);return()=>{window.removeEventListener('zenix-space-request',request);window.removeEventListener('zenix-space-restore',restore);};},[songs,selected,baseSongs,suspended]);
  return <section className={`mobile-space ${moving ? 'is-panning' : ''} ${suspended ? 'is-suspended' : ''}`} aria-hidden={suspended} onPointerDownCapture={showCaption} onPointerUpCapture={hideCaptionLater} onPointerCancelCapture={hideCaptionLater}>
    <div className={`space-caption glass ${captionVisible ? "is-visible" : "is-hidden"}`} aria-hidden={!captionVisible}><span>{player.track ? `${player.playing ? "正在播放" : "已暂停"} · ${player.track.title}` : label}</span><small>{songs.length} 首 · 双指缩放</small><button tabIndex={captionVisible ? 0 : -1} aria-label="聚焦当前歌曲" onClick={() => { const index = songs.findIndex(song => song.id === player.track?.id); focus(index >= 0 ? index : selected); }}><Crosshair /></button></div>
    {(settings.zones.length>0||restored)&&<nav className="zenix-space-zones" aria-label="音乐空间分区"><button aria-pressed={!activeZone} onClick={()=>setZone('')}>全部贴纸</button>{settings.zones.map(item=><button key={item.id} data-space-zone={item.id} aria-pressed={zone===item.id} onClick={()=>setZone(item.id)}>{item.name}</button>)}<button aria-pressed={zoneEditing} onClick={()=>setZoneEditing(value=>!value)}>{zoneEditing?'完成整理':'拖动贴纸归类'}</button>{restored&&<button onClick={()=>{setRestored(undefined);setZone('');}}>返回原空间</button>}</nav>}
    {zoneEditing&&<p className="zenix-space-empty">将贴纸拖到上方分区按钮，松开即可归类。</p>}
    {!songs.length&&<p className="zenix-space-empty">分区内没有当前空间中的歌曲，可以从工作台加入聚焦歌曲。</p>}
    <div ref={viewport} className="space-viewport" onPointerDownCapture={event => {
      if(zoneEditing){const sticker=(event.target as Element).closest<HTMLElement>('[data-song-id]');if(sticker?.dataset.songId){zoneDrag.current={id:sticker.dataset.songId,pointer:event.pointerId};dragged.current=true;event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();}return;}
      if(suspended||event.button!==0||!gesture.current.count&&(event.target as Element).closest('.sticker-toolbar,input,.focused-lyrics'))return;
      if(!gesture.current.count){if(event.pointerType==='touch'&&!event.isPrimary)return;stop();dragged.current=false;gestureOrigin.current=event.currentTarget.getBoundingClientRect();}
      const point={x:event.clientX-gestureOrigin.current.left,y:event.clientY-gestureOrigin.current.top};
      if(!gesture.current.down(event.pointerId,point,cameraValue()))return;
      if(gesture.current.count===2){dragged.current=true;setMoving(true);for(const id of gesture.current.ids())event.currentTarget.setPointerCapture(id);event.preventDefault();event.stopPropagation();}
    }} onPointerMoveCapture={event=>{
      if(zoneDrag.current){event.preventDefault();return;}
      const value=gesture.current.move(event.pointerId,{x:event.clientX-gestureOrigin.current.left,y:event.clientY-gestureOrigin.current.top},bounds,size);if(!value)return;
      if(!dragged.current){dragged.current=true;setMoving(true);event.currentTarget.setPointerCapture(event.pointerId);}
      x.set(value.x);y.set(value.y);scale.set(value.scale);
      if(gesture.current.count===2){event.preventDefault();event.stopPropagation();}
    }} onPointerUpCapture={event=>{if(zoneDrag.current){const drag=zoneDrag.current;zoneDrag.current=undefined;const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-space-zone]'),id=target?.dataset.spaceZone;if(id){const next={...settings,zones:settings.zones.map(zone=>zone.id===id?{...zone,trackIds:[...new Set([...zone.trackIds,drag.id])]}:zone)};void command('features',{operation:'spaceFeatures',action:'save',value:next}).then(saved=>writeSpace(saved)).catch(error=>window.dispatchEvent(new CustomEvent('zenix-audio-notice',{detail:String(error)})));}if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);return;}gesture.current.up(event.pointerId,cameraValue());if(!gesture.current.count)setMoving(false);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancelCapture={cancelGesture} onLostPointerCapture={event=>{
      // Touch starts with implicit capture on the poster. Its bubbled loss when
      // the viewport takes over is a handoff, not cancellation of the camera.
      if(event.target===event.currentTarget&&gesture.current.has(event.pointerId)&&!event.currentTarget.hasPointerCapture(event.pointerId))cancelGesture();
    }} onClickCapture={event=>{if(dragged.current&&event.detail!==0){event.preventDefault();event.stopPropagation();}}}>
      <motion.div className="space-plane" style={{ x, y, scale,transformOrigin:'0 0' }}>{songs.map((song, index) => {
        const candidateChoice = song.searchAlternatives?.find(item => item.id === chosenVariants[song.id]) || song.searchAlternatives?.find(candidate=>state.sources.some(source=>source.id===candidate.providerId&&source.enabled&&source.manifest.capabilities.includes('resolvePlayback'))) || song;
        const choice = chosenVariants[song.id] ? {...candidateChoice, preferredPlaybackProviderId:candidateChoice.providerId} : candidateChoice;
        const rect = rects[index], current = containsTrack(song, player.track?.id), focused = index === selected;
        const choiceCurrent = choice.id === player.track?.id || current && !chosenVariants[song.id];
        // Layout still includes the complete finite playlist, while React,
        // motion subscriptions and decoded covers exist only near the viewport.
        const inView = (left:number,top:number,width:number,height:number) => left*camera.scale+Math.min(camera.x,camera.toX??camera.x)<size.width+240 && (left+width)*camera.scale+Math.max(camera.x,camera.toX??camera.x)>-240 && top*camera.scale+Math.min(camera.y,camera.toY??camera.y)<size.height+240 && (top+height)*camera.scale+Math.max(camera.y,camera.toY??camera.y)>-240;
        const from=camera.toX===undefined?undefined:transitionGeometry.current.get(song.id);
        const visible = focused || inView(rect.x*pitch,rect.y*pitch,rect.columns*pitch,rect.rows*pitch) || Boolean(from&&inView(from.left,from.top,from.width,from.height));
        if (!visible) return null;
        return <MosaicSticker key={song.id} id={song.id} register={registerSticker} className={`space-sticker ${focused ? 'is-focused is-expanded' : ''} ${current ? 'is-current' : ''}`} left={rect.x*pitch} top={rect.y*pitch} width={rect.columns*pitch-STICKER_GAP} height={rect.rows*pitch-STICKER_GAP}>
          <SongPoster song={song} index={index} current={current} defer={camera.toX!==undefined} gesturing={moving} focus={()=>focus(index)} longPress={longPress}/>
          {focused && current && <FocusedLyrics track={player.track || song} position={player.position} seek={seek} suspended={suspended} reduced={Boolean(reduced)} />}
          <AnimatePresence initial={false}>{focused && <motion.div className="sticker-toolbar" initial={{ opacity: 0, y: reduced ? 0 : 11 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : 4 }} transition={{ duration: reduced ? 0 : .3, delay: focused && !reduced ? .19 : 0 }}>
            {actions(choice)}
            <TrackVersions track={song} selected={choice} sources={state.sources} select={candidate=>setChosenVariants(previous=>({...previous,[song.id]:candidate.id}))} load={loadSourceDiagnostics}/>
            <button aria-label={`${choiceCurrent && (player.playWhenReady ?? player.playing) ? '暂停' : '播放'} ${song.title}`} onClick={()=>play(choiceCurrent ? player.track || choice : choice)}>{choiceCurrent && (player.playWhenReady ?? player.playing) ? <Pause/> : <Play/>}</button>
            {current && <button aria-label="打开完整播放器" onClick={full}><Maximize2/></button>}
          </motion.div>}</AnimatePresence>

        </MosaicSticker>;
      })}</motion.div>
    </div>
  </section>;
}, (previous,next) => Boolean(previous.suspended && next.suspended));

function MosaicSticker({id,className,left,top,width,height,register,children}:{id:string;className:string;left:number;top:number;width:number;height:number;register:(id:string,element:HTMLElement|null)=>void;children:ReactNode}){
  const ref=useCallback((element:HTMLElement|null)=>register(id,element),[id,register]);
  return <article ref={ref} className={className} data-song-id={id} data-compact={height<150||undefined} style={{left,top,width,height,transformOrigin:'0 0'}}>{children}</article>;
}

function SongPoster({song,index,current,focus,longPress,defer,gesturing}:{song:Track;index:number;current:boolean;focus:()=>void;longPress?:(song:Track)=>void;defer:boolean;gesturing:boolean}){
  const gesture=useSongGesture(longPress?()=>longPress(song):undefined,undefined,gesturing);
  return <button className="space-poster" {...gesture.handlers} onClick={focus} aria-label={`聚焦查看 ${song.title}`}><Art track={song} defer={defer}/><span className="sticker-index">{current?'正在播放 · ':''}{String(index+1).padStart(2,'0')}</span><span className="space-song"><strong>{song.title}</strong><small>{song.artist}</small></span></button>;
}

function FocusedLyrics({ track, position, seek, suspended, reduced }: { track: Track; position: number; seek: (seconds: number) => void; suspended: boolean; reduced: boolean }) {
  const [lines, setLines] = useState<LyricLine[]>([]), [preview, setPreview] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), touch = useRef<number | null>(null);
  const active = activeLyricIndex(lines, position), center = preview ?? Math.max(0, active);
  useEffect(()=>setLines([]),[track.id]);
  useEffect(() => {
    if(suspended)return;
    let cancelled=false;setPreview(null);clearTimeout(timer.current);
    // Source WebView creation, bridge reads and LRC parsing must wait until the
    // camera and poster transition finish, and be canceled if the panel opens.
    const load=setTimeout(()=>{if(isNativeMobile)void readLyrics(track).then(raw=>{if(!cancelled)setLines(raw?parseLyrics(raw):[]);}).catch(()=>{});},reduced?0:640);
    return()=>{cancelled=true;clearTimeout(load);clearTimeout(timer.current);};
  },[track.id,suspended,reduced]);
  function browse(direction: number) { setPreview(value => Math.max(0, Math.min(lines.length - 1, (value ?? Math.max(0, active)) + direction))); clearTimeout(timer.current); timer.current = setTimeout(() => setPreview(null), 3000); }
  if (!lines.length) return null;
  return <div className="focused-lyrics" onWheel={event => { event.stopPropagation(); browse(event.deltaY > 0 ? 1 : -1); }} onPointerDown={event => { touch.current = event.clientY; event.currentTarget.setPointerCapture(event.pointerId); clearTimeout(timer.current); }} onPointerMove={event => { if (touch.current === null) return; const delta = event.clientY - touch.current; if (Math.abs(delta) >= 28) { touch.current = event.clientY; browse(delta < 0 ? 1 : -1); } }} onPointerUp={event => { touch.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); clearTimeout(timer.current); timer.current = setTimeout(() => setPreview(null), 3000); }} onPointerCancel={() => { touch.current = null; timer.current = setTimeout(() => setPreview(null), 3000); }}>
    {[center - 1, center, center + 1].map((index, row) => <motion.div key={`${row}-${index}`} className={row === 1 ? 'center-line' : ''} initial={{ opacity: .2, y: 7 }} animate={{ opacity: row === 1 ? 1 : .4, y: 0 }} transition={{ duration: .22 }}><span>{lines[index]?.text || ''}</span></motion.div>)}
    {preview !== null && lines[center] && <button aria-label="跳到预览歌词" onClick={() => { seek(lines[center].time); clearTimeout(timer.current); setPreview(null); }}><Play fill="currentColor" size={15} /></button>}
  </div>;
}
