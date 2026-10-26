import {useSpaceSettings,commitSpace,rules,type SpaceBookmark} from '../features/space/state';
import '../features/space/space.css';
import {useSpacePresentation} from '../features/space/presentation';
import PresentationControls from '../features/space/PresentationControls';
import OrbitSongSpace from '../features/space/OrbitSongSpace';
import SimpleSongList from '../features/space/SimpleSongList';
import type {Track} from '../core/types';
import {BrowseLinks} from './CatalogBrowser';
import LyricControls from './LyricControls';
import {useLyricDisplay} from '../core/listening';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import TrackVersions from './TrackVersions';
import type { InstalledSource } from '../core/types';
import { containsTrack } from '../core/searchGroups';
const loadSourceDiagnostics = () => window.yzqxy!.sources.diagnostics();
import { Captions, Home, ListMusic, Maximize2, Minimize2, Pause, Play, Repeat1, Repeat2, Search, Settings2, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { playUiSound } from '../core/sounds';
import { trackCoverUrl } from '../core/trackCover';
import CoverArt from './CoverArt';
import TrackQuickActions from './TrackQuickActions';
import { usePlayerBarGesture } from './usePlayerBarGesture';
import { formatTime } from './library';
import type { PersonalState } from '../core/types';
import { STICKER_GAP, expandedStickerLayout, stickerSlotsForCount, type StickerRect } from './stickerMosaic';
import type { LyricLineView, RepeatMode, TrackView } from './types';

type LatticePlayerProps = {
  assistantView?: {pure?:boolean;zone?:string;revision:number};
  sources?: InstalledSource[];
  track: TrackView;
  hasPlayback?: boolean;
  personal: PersonalState;
  onToggleSaved?: (kind: 'liked' | 'favorites', track: TrackView) => void;
  onAddToPlaylist?: (id: string, track: TrackView) => void;
  onCreatePlaylist?: (name: string, track: TrackView) => void;
  queue: TrackView[];
  queueIndex: number;
  displayTracks?: TrackView[];
  onPlayTrack: (track: TrackView) => void;
  lyrics: LyricLineView[];
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  onBack: () => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute?: () => void;
  onToggleShuffle?: () => void;
  onCycleRepeat?: () => void;
  onOpenQueue: () => void;
  expandRequest?: number;
  onExpandPlayer: () => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  searchAvailable?: boolean;
  searchRevealed?: boolean;
  desktopLyricsVisible?: boolean;
  onToggleDesktopLyrics?: () => void;
};

export default function LatticePlayer({ assistantView,
  track, sources = [], hasPlayback = true, personal, onToggleSaved, onAddToPlaylist, onCreatePlaylist, queue, queueIndex, displayTracks, onPlayTrack, lyrics, playing, position, duration, volume, muted, shuffle, repeat,
  onBack, onTogglePlay, onPrevious, onNext, onSeek, onVolumeChange,
  onToggleMute, onToggleShuffle, onCycleRepeat, onOpenQueue, onExpandPlayer, expandRequest = 0, onOpenSettings, onOpenSearch, searchAvailable = true, searchRevealed = false, desktopLyricsVisible = false, onToggleDesktopLyrics,
}: LatticePlayerProps) {
  const pendingRestore=useRef<SpaceBookmark|undefined>(undefined);
  const settings=useSpaceSettings(),[zone,setZone]=useState(''),[zoneEditing,setZoneEditing]=useState(false),[restored,setRestored]=useState<TrackView[]>(),[zoom,setZoom]=useState(1);
  const [pureLyrics,setPureLyrics]=useState(false);
  const presentation=useSpacePresentation();
  const wallRef = useRef<HTMLDivElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const lyricRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dragRef = useRef<{ id: number; x: number; y: number; cameraX: number; cameraY: number; dragged: boolean } | null>(null);
  const didDragRef = useRef(false);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lyricResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lyricPreviewRef = useRef<number | null>(null);
  const [lyricPreview, setLyricPreview] = useState<number | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [panning, setPanning] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const showStickers=presentation.mode==='sticker'||immersive;
  useEffect(()=>{if(!assistantView)return;setPureLyrics(Boolean(assistantView.pure));setImmersive(Boolean(assistantView.pure));setZone(assistantView.zone||'');if(assistantView.pure){setSelectedSlot(Math.max(0,queue.findIndex(song=>song.id===track?.id)));setPanning(false);}},[assistantView]);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const seekDraftRef = useRef<number | null>(null);
  const seekDraggingRef = useRef(false);
  // Each poster belongs to the visible search result or the current playback queue exactly once.
  const baseTracks=restored??displayTracks??(queue.length?queue:[track]);
  const activeZone=settings.zones.find(value=>value.id===zone);
  const wallTracks=useMemo(()=>activeZone?baseTracks.filter(song=>activeZone.trackIds.includes(song.id)):baseTracks,[baseTracks,activeZone]);
  const wallTracksRef = useRef(wallTracks);
  // Display adapters retain original records for every business operation.
  const presentationTracks=useMemo(()=>wallTracks.map(song=>({...song,audioUrl:song.audioUrl||'',searchAlternatives:undefined})),[wallTracks]);
  wallTracksRef.current = wallTracks;
  const focusedTrackIdRef = useRef<string | null>(null);
  const displayedIdsRef = useRef<string[]>([]);
  const slots = useMemo(() => stickerSlotsForCount(wallTracks.length), [wallTracks.length]);
  const activeIndex = hasPlayback ? wallTracks.findIndex(item => containsTrack(item, track.id)) : -1;
  const queueSignature = queue.map(item => item.id).join('|');
  const displaySignature = displayTracks?.map(item => item.id).join('|') ?? '';
  const focusedTrack = wallTracks[selectedSlot] ?? track;
  const [chosenVariants, setChosenVariants] = useState<Record<string, string>>({});
  const candidateChoice = focusedTrack.searchAlternatives?.find(item => item.id === chosenVariants[focusedTrack.id]) || focusedTrack.searchAlternatives?.find(candidate=>sources.some(source=>source.id===candidate.providerId&&source.enabled&&source.manifest.capabilities.includes('resolvePlayback'))) || focusedTrack;
  const focusedChoice = chosenVariants[focusedTrack.id] ? {...candidateChoice, preferredPlaybackProviderId:candidateChoice.providerId} : candidateChoice;
  const focusedChoiceIsCurrent = hasPlayback && (focusedChoice.id === track.id || containsTrack(focusedTrack,track.id) && !chosenVariants[focusedTrack.id]);
  const focusedIsCurrent = hasPlayback && containsTrack(focusedTrack, track.id);
  const cellPitch = Math.max(72, Math.min(112, viewport.width / 14.5, viewport.height / 8.8));
  const total = duration || track.duration || 0;
  const shownPosition = seekDraft ?? position;
  const [lyricDisplay,changeLyricDisplay]=useLyricDisplay(track);
  const activeLyric = lyrics.reduce((found, line, index) => position >= line.time + lyricDisplay.offset ? index : found, -1);
  const expandedRects = useMemo(() => expandedStickerLayout(selectedSlot, slots), [selectedSlot, slots]);
  const layoutBounds = useCallback((layout: Map<number, StickerRect>) => {
    const rects = slots.map((slot, index) => layout.get(index) ?? slot);
    if (!rects.length) return { left: 0, top: 0, right: 0, bottom: 0 };
    return {
      left: Math.min(...rects.map(rect => rect.x)), top: Math.min(...rects.map(rect => rect.y)),
      right: Math.max(...rects.map(rect => rect.x + rect.columns)), bottom: Math.max(...rects.map(rect => rect.y + rect.rows)),
    };
  }, [slots]);
  const bounds = layoutBounds(expandedRects);
  useEffect(()=>{const request=(event:Event)=>{if(presentation.mode!=='sticker'&&(event as CustomEvent).detail.purpose!=='selection'){window.dispatchEvent(new CustomEvent('zenix-space-response',{detail:{token:(event as CustomEvent).detail.token,error:'请切换到贴纸拼贴后保存空间位置；环绕角度暂不属于空间书签。'}}));return;}window.dispatchEvent(new CustomEvent('zenix-space-response',{detail:{token:(event as CustomEvent).detail.token,snapshot:{camera:presentation.mode==='sticker'?{...camera,scale:zoom}:{x:0,y:0,scale:1},selectedId:wallTracks[selectedSlot]?.id||'',tracks:wallTracks.map(rules.reference)}}}));};const restore=(event:Event)=>{presentation.change({mode:'sticker'});const bookmark=(event as CustomEvent<SpaceBookmark>).detail;const known=new Map(baseTracks.map(song=>[song.id,song]));const tracks=bookmark.tracks.filter(song=>song.source!=='local'||known.has(song.id)).map(song=>known.get(song.id)||song);pendingRestore.current=bookmark;setRestored(tracks);setZone('');setSelectedSlot(Math.max(0,tracks.findIndex(song=>song.id===bookmark.selectedId)));setZoom(bookmark.camera.scale);setCamera({x:bookmark.camera.x,y:bookmark.camera.y});setPanning(true);};window.addEventListener('zenix-space-request',request);window.addEventListener('zenix-space-restore',restore);return()=>{window.removeEventListener('zenix-space-request',request);window.removeEventListener('zenix-space-restore',restore);};},[camera,zoom,wallTracks,selectedSlot,baseTracks,presentation.mode,presentation.change]);
  const wallWidth = bounds.right * cellPitch;
  const wallHeight = bounds.bottom * cellPitch;
  const clampCamera = useCallback((x: number, y: number, target = bounds) => ({
    x: Math.max(viewport.width / 2 - target.right * cellPitch * zoom, Math.min(viewport.width / 2 - target.left * cellPitch * zoom, x)),
    y: Math.max(viewport.height / 2 - target.bottom * cellPitch * zoom, Math.min(viewport.height / 2 - target.top * cellPitch * zoom, y)),
  }), [bounds.left, bounds.top, bounds.right, bounds.bottom, cellPitch, viewport.width, viewport.height,zoom]);

  const focusSlot = useCallback((slot: number, remember = true) => {
    const layout = expandedStickerLayout(slot, slots);
    const focus = layout.get(slot);
    if (!focus) return;
    if (remember) focusedTrackIdRef.current = wallTracksRef.current[slot]?.id ?? null;
    setSelectedSlot(slot);
    setPanning(false);
    setCamera(clampCamera(viewport.width / 2 - (focus.x + focus.columns / 2) * cellPitch * zoom + STICKER_GAP / 2, viewport.height / 2 - (focus.y + focus.rows / 2) * cellPitch * zoom + STICKER_GAP / 2, layoutBounds(layout)));
  }, [cellPitch, clampCamera, layoutBounds, slots, viewport.height, viewport.width,zoom]);

  const focusCurrent = () => {
    const index = wallTracks.findIndex(item => item.id === track.id);
    if (index < 0) return;
    focusSlot(index);
    playUiSound('enter');
  };

  const openBar = usePlayerBarGesture(focusCurrent, onExpandPlayer);
  const lastExpand = useRef(0);
  useEffect(() => {
    if (!expandRequest || lastExpand.current === expandRequest || !hasPlayback) return;
    const index = wallTracks.findIndex(item => item.id === track.id);
    if (index < 0) return;
    lastExpand.current = expandRequest; focusSlot(index); setImmersive(true); setPanning(false);
  }, [expandRequest, hasPlayback, track.id, wallTracks, focusSlot]);

  useEffect(() => {
    const node = wallRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {if(entry.contentRect.width>0&&entry.contentRect.height>0)setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });});
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // Recenter on an actual viewport change, not on every appended source reply.
  useEffect(() => { focusSlot(selectedSlot, false); }, [cellPitch, viewport.width, viewport.height,zoom]);
  useEffect(() => { if (displayTracks === undefined) focusSlot(Math.max(0, queueIndex >= 0 ? queueIndex : activeIndex)); }, [queueSignature, displayTracks === undefined]);
  useEffect(() => {
    if (displayTracks === undefined) { displayedIdsRef.current = []; return; }
    const ids = wallTracks.map(item => item.id), previousIds = displayedIdsRef.current;
    displayedIdsRef.current = ids;
    const appended = previousIds.length > 0 && previousIds.length <= ids.length && previousIds.every((id, index) => id === ids[index]);
    if (!slots.length || appended) return;
    const previous = wallTracks.findIndex(item => item.id === focusedTrackIdRef.current);
    focusSlot(previous >= 0 ? previous : 0);
  }, [displayTracks === undefined, displaySignature, slots.length]);
  useEffect(() => {
    if (hasPlayback && displayTracks !== undefined && activeIndex >= 0) focusSlot(activeIndex);
  }, [track.id, hasPlayback]);

  // Following playback does not interrupt a poster selected for browsing.
  useEffect(() => {
    if (displayTracks !== undefined || activeIndex < 0) return;
    focusSlot(activeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  useEffect(()=>{const restore=pendingRestore.current;if(!restore)return;pendingRestore.current=undefined;setSelectedSlot(Math.max(0,wallTracks.findIndex(v=>v.id===restore.selectedId)));setCamera({x:restore.camera.x,y:restore.camera.y});setZoom(restore.camera.scale);},[restored]);

  useEffect(() => {
    const container = lyricsContainerRef.current;
    const line = lyricRefs.current[lyricPreview ?? activeLyric];
    if (!container || !line || !focusedIsCurrent) return;
    const lineTop = line.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: Math.max(0, lineTop - (pureLyrics&&immersive?container.clientHeight/2-line.clientHeight/2:22)), behavior: 'smooth' });
  }, [activeLyric, lyricPreview, focusedIsCurrent, track.id, immersive, pureLyrics, viewport.height]);

  useEffect(() => {
    if (!immersive) return;
    const restoreSticker = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"],.zenix-queue')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setImmersive(false);
      playUiSound('cancel');
    };
    window.addEventListener('keydown', restoreSticker, true);
    return () => window.removeEventListener('keydown', restoreSticker, true);
  }, [immersive]);

  useEffect(() => {
    const container = lyricsContainerRef.current;
    if (!container || !lyrics.length || !focusedIsCurrent) return;
    const browse = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey || !event.deltaY) return;
      event.preventDefault();
      event.stopPropagation();
      const step = Math.max(1, Math.min(3, Math.round(Math.abs(event.deltaY) / 100)));
      const index = Math.max(0, Math.min(lyrics.length - 1, (lyricPreviewRef.current ?? Math.max(0, activeLyric)) + Math.sign(event.deltaY) * step));
      lyricPreviewRef.current = index;
      setLyricPreview(index);
      if (lyricResetTimer.current) clearTimeout(lyricResetTimer.current);
      lyricResetTimer.current = setTimeout(() => { lyricPreviewRef.current = null; setLyricPreview(null); }, 3000);
    };
    container.addEventListener('wheel', browse, { passive: false });
    return () => container.removeEventListener('wheel', browse);
  }, [activeLyric, focusedIsCurrent, lyrics.length]);

  useEffect(() => {
    lyricPreviewRef.current = null;
    setLyricPreview(null);
    if (lyricResetTimer.current) clearTimeout(lyricResetTimer.current);
    return () => { if (lyricResetTimer.current) clearTimeout(lyricResetTimer.current); };
  }, [track.id]);

  useEffect(() => {
    const node = wallRef.current;
    if (!node || !showStickers) return;
    const onWheel = (event: WheelEvent) => {
      if (immersive) return;if(event.ctrlKey||event.metaKey){event.preventDefault();setZoom(previous=>Math.max(.4,Math.min(2.5,previous*Math.exp(-event.deltaY*.002))));return;}
      event.preventDefault();
      playUiSound('slide');
      const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
      setPanning(true);
      setCamera(previous => clampCamera(previous.x - dx, previous.y - dy));
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => setPanning(false), 140);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => { node.removeEventListener('wheel', onWheel); if (wheelTimer.current) clearTimeout(wheelTimer.current); };
  }, [clampCamera, immersive, showStickers]);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!showStickers || zoneEditing || immersive || event.button !== 0 || !event.isPrimary || (event.target as Element).closest('.yz-sticker.is-expanded button, .yz-sticker.is-expanded input')) return;
    didDragRef.current = false;
    dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y, dragged: false };
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.dragged && Math.hypot(dx, dy) > 7) {
      drag.dragged = true;
      didDragRef.current = true;
      setDragging(true);
      playUiSound('slide');
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (drag.dragged) setCamera(clampCamera(drag.cameraX + dx, drag.cameraY + dy));
  };
  const pointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.id !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const clickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!didDragRef.current) return;
    didDragRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };
  const playFocused = () => focusedChoiceIsCurrent ? onTogglePlay() : onPlayTrack(focusedChoice);
  const commitMiniSeek = () => {
    const seconds = seekDraftRef.current;
    seekDraggingRef.current = false;
    seekDraftRef.current = null;
    setSeekDraft(null);
    if (seconds !== null) onSeek(seconds);
  };

  const originalsById=useMemo(()=>new Map(wallTracks.map(song=>[song.id,song])),[wallTracks]);
  const originalSong=(song:Track)=>originalsById.get(song.id);
  const displayPlay=(song:Track)=>{
    const original=originalSong(song);
    if(!original)return;
    const candidate=original.searchAlternatives?.find(item=>item.id===chosenVariants[original.id])
      ||original.searchAlternatives?.find(item=>sources.some(source=>source.id===item.providerId&&source.enabled&&source.manifest.capabilities.includes('resolvePlayback')))
      ||original;
    const choice=chosenVariants[original.id]?{...candidate,preferredPlaybackProviderId:candidate.providerId}:candidate;
    const current=hasPlayback&&(choice.id===track.id||containsTrack(original,track.id)&&!chosenVariants[original.id]);
    if(current)onTogglePlay();else onPlayTrack(choice);
  };
  const presentationProps={
    tracks:presentationTracks,selectedId:wallTracks[selectedSlot]?.id,
    currentId:hasPlayback?wallTracks[activeIndex]?.id:undefined,playing,cardScale:presentation.cardScale,
    onFocus:(song:Track)=>{const index=wallTracks.findIndex(item=>item.id===song.id);if(index>=0)focusSlot(index);},
    onPlay:displayPlay,
    onExpand:()=>{if(!focusedIsCurrent)return;focusSlot(activeIndex);setImmersive(true);setPanning(false);},
    renderCover:(song:Track)=><CoverArt title={song.title} coverUrl={trackCoverUrl(originalSong(song)||song)}/>,
    renderActions:(song:Track)=>{
      const original=originalSong(song);
      return original?<>
        <TrackQuickActions track={original} personal={personal} onToggleSaved={onToggleSaved} onAddToPlaylist={onAddToPlaylist} onCreatePlaylist={onCreatePlaylist} compact/>
        {original.id===focusedTrack.id&&<TrackVersions track={original} selected={focusedChoice} sources={sources} load={loadSourceDiagnostics} select={candidate=>setChosenVariants(previous=>({...previous,[original.id]:candidate.id}))}/>}
      </>:null;
    },
  };

  return <div className={`yz-lattice zenix-motion-${settings.motion}${immersive ? ' is-immersive' : ''}${immersive&&pureLyrics?' is-pure-lyrics':''}`}>
    {!immersive&&<div className="yz-space-presentation-shell"><div className="yz-space-presentation-toolbar"><PresentationControls value={presentation} onChange={patch=>{dragRef.current=null;setDragging(false);setZoneEditing(false);presentation.change(patch);}} error={presentation.error} onDismissError={presentation.dismissError}/>
    {(settings.zones.length>0||restored)&&<nav className="zenix-space-zones" aria-label="音乐空间分区"><button aria-pressed={!activeZone} onClick={()=>setZone('')}>全部歌曲</button>{settings.zones.map(item=><button key={item.id} data-space-zone={item.id} onDragOver={event=>{if(zoneEditing)event.preventDefault();}} onDrop={event=>{event.preventDefault();const id=event.dataTransfer.getData('application/x-zenix-track');if(!baseTracks.some(song=>song.id===id))return;try{commitSpace({...settings,zones:settings.zones.map(zone=>zone.id===item.id?{...zone,trackIds:[...new Set([...zone.trackIds,id])]}:zone)});}catch(error){window.dispatchEvent(new CustomEvent('zenix-audio-notice',{detail:error instanceof Error?error.message:String(error)}));}}} aria-pressed={zone===item.id} onClick={()=>{setZone(item.id);setSelectedSlot(0);}}>{item.name}</button>)}{presentation.mode==='sticker'&&<button aria-pressed={zoneEditing} onClick={()=>setZoneEditing(value=>!value)}>{zoneEditing?'完成分区整理':'拖动贴纸归类'}</button>}{restored&&<button onClick={()=>{setRestored(undefined);setZone('');setZoom(1);}}>返回原空间</button>}</nav>}
    </div>{presentation.mode!=='sticker'&&<div className="yz-space-presentation-stage">{presentation.mode==='orbit'?<OrbitSongSpace {...presentationProps}/>:<SimpleSongList {...presentationProps}/>}</div>}</div>}
    {!wallTracks.length&&showStickers&&<p className="zenix-space-empty">分区内没有当前空间中的歌曲。</p>}
    <div className="yz-sticker-viewport" aria-hidden={!showStickers} style={{visibility:showStickers?undefined:'hidden',pointerEvents:showStickers?undefined:'none'}} ref={wallRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onClickCapture={clickCapture}>
      <div className={`yz-sticker-world${dragging || panning ? ' is-panning' : ''}`} style={{ width: immersive ? viewport.width : wallWidth, height: immersive ? viewport.height : wallHeight, transform: immersive ? 'translate3d(0,0,0)' : `translate3d(${camera.x}px,${camera.y}px,0) scale(${zoom})`,transformOrigin:'0 0' }}>
        {showStickers&&slots.map((tile, slot) => {
          const itemIndex = slot;
          const item = wallTracks[itemIndex];
          const rect = expandedRects.get(slot) ?? tile;
          const expanded = slot === selectedSlot;
          const current = hasPlayback && containsTrack(item, track.id);
          // Keep only the camera's visible posters and a small overscan mounted.
          const overscan = cellPitch * (dragging || panning ? 1.5 : 1);
          if (!expanded && (immersive || rect.x * cellPitch * zoom + camera.x > viewport.width + overscan || rect.y * cellPitch * zoom + camera.y > viewport.height + overscan || (rect.x + rect.columns) * cellPitch * zoom + camera.x < -overscan || (rect.y + rect.rows) * cellPitch * zoom + camera.y < -overscan)) return null;
          return <div key={slot} draggable={zoneEditing} onDragStart={event=>{if(!zoneEditing){event.preventDefault();return;}event.dataTransfer.setData('application/x-zenix-track',item.id);event.dataTransfer.effectAllowed='copy';}} className={`yz-sticker${expanded ? ' is-expanded' : ''}${current ? ' is-current' : ''}${rect.columns * rect.rows <= 6 ? ' is-compact' : ''}`} style={{ left: immersive && expanded ? 0 : rect.x * cellPitch, top: immersive && expanded ? 0 : rect.y * cellPitch, width: immersive && expanded ? viewport.width : rect.columns * cellPitch - STICKER_GAP, height: immersive && expanded ? viewport.height : rect.rows * cellPitch - STICKER_GAP, visibility: immersive && !expanded ? 'hidden' : undefined }} onClick={() => { if (!expanded) { playUiSound('enter'); focusSlot(slot); } }} onKeyDown={event => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            if (!expanded) focusSlot(slot);
            else if (event.key === 'Enter') playFocused();
          }} role={expanded ? 'group' : 'button'} tabIndex={expanded ? -1 : 0} title={expanded ? undefined : `展开 ${item.title} · ${item.artist}`} aria-label={`${item.title} · ${item.artist}`}>
            <CoverArt title={item.title} coverUrl={trackCoverUrl(item)} />
            <span className="yz-sticker-shade" />
            {expanded ? <>
              <div className="yz-sticker-focus-shade" />
              <div className="yz-sticker-focus-meta"><small>{focusedIsCurrent ? '正在播放 · ' : itemIndex < activeIndex ? '此前播放 · ' : ''}{String(itemIndex + 1).padStart(2, '0')}</small><h1>{item.title}</h1><BrowseLinks track={item}/></div>
              {focusedIsCurrent && <div className={`yz-lattice-lyrics${lyricDisplay.focus?' listening-lyric-focus':''}`} data-custom-size={lyricDisplay.customSize} data-custom-height={lyricDisplay.customLineHeight} data-custom-weight={lyricDisplay.customWeight} style={{fontSize:lyricDisplay.customSize?lyricDisplay.fontSize:undefined,lineHeight:lyricDisplay.customLineHeight?lyricDisplay.lineHeight:undefined,fontWeight:lyricDisplay.customWeight?lyricDisplay.weight:undefined}} ref={lyricsContainerRef}>
                {lyrics.length ? lyrics.map((line, index) => <button key={`${line.time}-${index}`} ref={element => { lyricRefs.current[index] = element; }} className={`yz-lattice-lyric ${index === (lyricPreview ?? activeLyric) ? 'is-current' : ''} ${index < (lyricPreview ?? activeLyric) ? 'is-past' : ''}`} onClick={() => { onSeek(Math.max(0,line.time+lyricDisplay.offset)); lyricPreviewRef.current = null; setLyricPreview(null); if (lyricResetTimer.current) clearTimeout(lyricResetTimer.current); }} title={`跳转到 ${formatTime(line.time)}`}>{line.text}{lyricDisplay.translation&&<small>{line.translation}</small>}</button>) : <div className="yz-lattice-no-lyrics">暂无歌词</div>}
              </div>}
              {focusedIsCurrent&&<button className="yz-pure-lyrics-toggle" aria-label={pureLyrics&&immersive?"退出歌词纯净模式":"歌词纯净模式"} aria-pressed={pureLyrics&&immersive} onClick={()=>{if(pureLyrics&&immersive)setPureLyrics(false);else{setPureLyrics(true);setImmersive(true);setPanning(false);}}}><Captions size={17}/>{pureLyrics&&immersive?"还原歌曲界面":"歌词纯净模式"}</button>}{focusedIsCurrent&&immersive&&<LyricControls value={lyricDisplay} change={changeLyricDisplay}/>}<div className="yz-sticker-focus-controls">
                <TrackVersions track={item} selected={focusedChoice} sources={sources} load={loadSourceDiagnostics} select={candidate=>setChosenVariants(previous=>({...previous,[item.id]:candidate.id}))}/>
                <button onClick={playFocused} title={focusedChoiceIsCurrent && playing ? '暂停' : `播放 ${item.title}`} aria-label={focusedChoiceIsCurrent && playing ? '暂停' : `播放 ${item.title}`}>{focusedChoiceIsCurrent && playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
                {focusedIsCurrent && <><button onClick={() => { setImmersive(value => !value); setPanning(false); playUiSound(immersive ? 'cancel' : 'enter'); }} title={immersive ? '还原歌曲贴纸' : '放大歌曲至窗口'} aria-label={immersive ? '还原歌曲贴纸' : '放大歌曲至窗口'} aria-pressed={immersive}>{immersive ? <Minimize2 size={17} /> : <Maximize2 size={15} />}</button><input type="range" min={0} max={Math.max(total, 1)} step={0.1} value={Math.min(position, Math.max(total, 1))} onChange={event => onSeek(Number(event.target.value))} aria-label="播放进度" style={{ '--range-fill': `${total ? Math.min(100, position / total * 100) : 0}%` } as CSSProperties} /></>}
              </div>
            </> : <>
              <span className="yz-sticker-badge">{current ? '正在播放 · ' : itemIndex < activeIndex ? '此前播放 · ' : ''}{String(itemIndex + 1).padStart(2, '0')}</span>
              <span className="yz-sticker-caption"><strong>{item.title}</strong><small>{item.artist || '未知艺术家'}</small></span>
            </>}
          </div>;
        })}
      </div>
    </div>
    <button className="yz-lattice-back" onClick={onBack} aria-label="个人主页" title="个人主页"><Home size={19} /></button>
    {searchAvailable && <div className={`yz-lattice-search-zone${searchRevealed ? ' is-revealed' : ''}`}><button onClick={onOpenSearch} title="搜索歌曲" aria-label="搜索歌曲"><Search size={17} /><span>搜索音乐</span><kbd>Ctrl K</kbd></button></div>}
    <div className="yz-lattice-mini" onClick={event => { if (!(event.target as Element).closest('button,input,select,a,[role="button"]')) openBar(); }}>
      <button className="yz-lattice-mini-focus" onClick={openBar} title="单击定位，双击放大当前歌曲"><CoverArt title={track.title} coverUrl={trackCoverUrl(track)} /><span className="yz-lattice-mini-text"><strong>{track.title}</strong><em>{track.artist || '未知艺术家'}</em></span></button>
      <button className={`yz-lattice-mini-lyrics${desktopLyricsVisible ? ' is-active' : ''}`} onClick={onToggleDesktopLyrics} disabled={!onToggleDesktopLyrics} title={desktopLyricsVisible ? '关闭桌面歌词' : '打开桌面歌词'} aria-label={desktopLyricsVisible ? '关闭桌面歌词' : '打开桌面歌词'} aria-pressed={desktopLyricsVisible}><Captions size={18} /></button>
      <TrackQuickActions track={track} personal={personal} onToggleSaved={onToggleSaved} onAddToPlaylist={onAddToPlaylist} onCreatePlaylist={onCreatePlaylist} compact />
      <input className="yz-lattice-mini-progress" type="range" min={0} max={Math.max(total, 1)} step={0.1} value={Math.min(shownPosition, Math.max(total, 1))} disabled={!hasPlayback || total <= 0} onPointerDown={() => { seekDraggingRef.current = true; seekDraftRef.current = position; setSeekDraft(position); }} onChange={event => { const seconds = Number(event.target.value); if (seekDraggingRef.current) { seekDraftRef.current = seconds; setSeekDraft(seconds); } else onSeek(seconds); }} onPointerUp={commitMiniSeek} onPointerCancel={() => { seekDraggingRef.current = false; seekDraftRef.current = null; setSeekDraft(null); }} aria-label="拖动歌曲进度" style={{ '--range-fill': `${total ? Math.min(100, shownPosition / total * 100) : 0}%` } as CSSProperties} /><small className="yz-lattice-mini-time">{formatTime(shownPosition)} / {formatTime(total)}</small>
      <div className="yz-lattice-mini-controls">
        <button onClick={onPrevious} title="上一首" aria-label="上一首"><SkipBack size={16} fill="currentColor" /></button>
        <button onClick={onTogglePlay} title={playing ? '暂停' : '播放'} aria-label={playing ? '暂停' : '播放'}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <button onClick={onNext} title="下一首" aria-label="下一首"><SkipForward size={16} fill="currentColor" /></button>
        <button onClick={onToggleShuffle} disabled={!onToggleShuffle} className={shuffle ? 'is-active' : ''} title="随机播放" aria-label="随机播放"><Shuffle size={16} /></button>
        <button onClick={onCycleRepeat} disabled={!onCycleRepeat} className={repeat !== 'off' ? 'is-active' : ''} title="循环模式" aria-label="循环模式">{repeat === 'one' ? <Repeat1 size={16} /> : <Repeat2 size={16} />}</button>
        <button onClick={onOpenQueue} title="播放队列" aria-label="播放队列"><ListMusic size={17} /></button>
        <button onClick={() => onToggleMute ? onToggleMute() : onVolumeChange(muted || volume === 0 ? .7 : 0)} title="静音" aria-label="切换静音">{muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
        <input type="range" min={0} max={1} step={.01} value={muted ? 0 : volume} onChange={event => onVolumeChange(Number(event.target.value))} aria-label="音量" style={{ '--range-fill': `${(muted ? 0 : volume) * 100}%` } as CSSProperties} />
      </div>
    </div>
    <button className="yz-lattice-settings" onClick={onOpenSettings} title="选项" aria-label="选项"><Settings2 size={20} /></button>
  </div>;
}
