import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { Captions, Home, ListMusic, Maximize2, Pause, Play, Repeat1, Repeat2, Search, Settings2, Shuffle, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { playUiSound } from '../core/sounds';
import CoverArt from './CoverArt';
import { formatTime } from './library';
import { CENTER_STICKER_SLOT, STICKER_GAP, STICKER_SLOTS, WALL_COLUMNS, WALL_ROWS, expandedStickerLayout } from './stickerMosaic';
import type { LyricLineView, RepeatMode, TrackView } from './types';

type LatticePlayerProps = {
  track: TrackView;
  queue: TrackView[];
  queueIndex: number;
  recentTracks: TrackView[];
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
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  searchAvailable?: boolean;
  desktopLyricsVisible?: boolean;
  onToggleDesktopLyrics?: () => void;
};

const wrap = (value: number, length: number) => ((value % length) + length) % length;

export default function LatticePlayer({
  track, queue, queueIndex, recentTracks, onPlayTrack, lyrics, playing, position, duration, volume, muted, shuffle, repeat,
  onBack, onTogglePlay, onPrevious, onNext, onSeek, onVolumeChange,
  onToggleMute, onToggleShuffle, onCycleRepeat, onOpenQueue, onOpenSettings, onOpenSearch, searchAvailable = true, desktopLyricsVisible = false, onToggleDesktopLyrics,
}: LatticePlayerProps) {
  const wallRef = useRef<HTMLDivElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const lyricRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dragRef = useRef<{ id: number; x: number; y: number; cameraX: number; cameraY: number; dragged: boolean } | null>(null);
  const didDragRef = useRef(false);
  const offsetRef = useRef<number | null>(null);
  const queueSignatureRef = useRef<string | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [camera, setCamera] = useState({ x: 0, y: 0 });
  const [selectedSlot, setSelectedSlot] = useState(CENTER_STICKER_SLOT);
  const [dragging, setDragging] = useState(false);
  const [panning, setPanning] = useState(false);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const seekDraftRef = useRef<number | null>(null);
  const seekDraggingRef = useRef(false);
  const [, setFocusRevision] = useState(0);

  // The playback queue determines the posters. Songs played from earlier queues remain available.
  const wallTracks = useMemo(() => {
    const entries = queue.length ? queue : [track];
    const ids = new Set(entries.map(item => item.id));
    const earlier = [...recentTracks].reverse().filter(item => !ids.has(item.id));
    return [...earlier, ...entries];
  }, [queue, recentTracks, track]);
  const activeIndex = wallTracks.findIndex(item => item.id === track.id);
  const queueSignature = queue.map(item => item.id).join('|');
  if (queueSignatureRef.current !== queueSignature) {
    queueSignatureRef.current = queueSignature;
    offsetRef.current = Math.max(0, queueIndex >= 0 ? wallTracks.length - queue.length + queueIndex : activeIndex) - CENTER_STICKER_SLOT;
  }
  const offset = offsetRef.current ?? 0;
  const slotIndex = (slot: number) => wrap(offset + slot, wallTracks.length);
  const focusedTrack = wallTracks[slotIndex(selectedSlot)] ?? track;
  const focusedIsCurrent = focusedTrack.id === track.id;
  const cellPitch = Math.max(72, Math.min(112, viewport.width / 14.5, viewport.height / 8.8));
  const wallWidth = WALL_COLUMNS * cellPitch - STICKER_GAP;
  const wallHeight = WALL_ROWS * cellPitch - STICKER_GAP;
  const total = duration || track.duration || 0;
  const shownPosition = seekDraft ?? position;
  const activeLyric = lyrics.reduce((found, line, index) => position >= line.time ? index : found, -1);
  const expandedRects = useMemo(() => expandedStickerLayout(selectedSlot), [selectedSlot]);

  const clampCamera = useCallback((x: number, y: number) => ({
    x: Math.max(Math.min(0, viewport.width - wallWidth), Math.min(0, x)),
    y: Math.max(Math.min(0, viewport.height - wallHeight), Math.min(0, y)),
  }), [viewport.width, viewport.height, wallWidth, wallHeight]);

  const focusSlot = useCallback((slot: number) => {
    const focus = expandedStickerLayout(slot).get(slot);
    if (!focus) return;
    setSelectedSlot(slot);
    setPanning(false);
    setCamera(clampCamera(viewport.width / 2 - (focus.x + focus.columns / 2) * cellPitch + STICKER_GAP / 2, viewport.height / 2 - (focus.y + focus.rows / 2) * cellPitch + STICKER_GAP / 2));
  }, [cellPitch, clampCamera, viewport.height, viewport.width]);

  const focusCurrent = () => {
    const index = wallTracks.findIndex(item => item.id === track.id);
    if (index < 0) return;
    offsetRef.current = index - CENTER_STICKER_SLOT;
    setFocusRevision(value => value + 1);
    focusSlot(CENTER_STICKER_SLOT);
    playUiSound('enter');
  };

  useEffect(() => {
    const node = wallRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { focusSlot(selectedSlot); }, [focusSlot]);
  useEffect(() => { focusSlot(CENTER_STICKER_SLOT); }, [queueSignature]);

  // Following playback does not interrupt a poster selected for browsing.
  useEffect(() => {
    const candidates = STICKER_SLOTS.map((_, slot) => slot).filter(slot => wallTracks[slotIndex(slot)]?.id === track.id);
    if (!candidates.length) return;
    const nearest = candidates.reduce((best, slot) => Math.abs(slot - selectedSlot) < Math.abs(best - selectedSlot) ? slot : best);
    focusSlot(nearest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  useEffect(() => {
    const container = lyricsContainerRef.current;
    const line = lyricRefs.current[activeLyric];
    if (!container || !line || !focusedIsCurrent) return;
    const lineTop = line.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: Math.max(0, lineTop - 22), behavior: 'smooth' });
  }, [activeLyric, focusedIsCurrent, track.id]);

  useEffect(() => {
    const node = wallRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
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
  }, [clampCamera]);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || (event.target as Element).closest('.yz-sticker.is-expanded button, .yz-sticker.is-expanded input')) return;
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
  const playFocused = () => focusedIsCurrent ? onTogglePlay() : onPlayTrack(focusedTrack);
  const commitMiniSeek = () => {
    const seconds = seekDraftRef.current;
    seekDraggingRef.current = false;
    seekDraftRef.current = null;
    setSeekDraft(null);
    if (seconds !== null) onSeek(seconds);
  };

  return <div className="yz-lattice">
    <div className="yz-sticker-viewport" ref={wallRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onClickCapture={clickCapture}>
      <div className={`yz-sticker-world${dragging || panning ? ' is-panning' : ''}`} style={{ width: wallWidth, height: wallHeight, transform: `translate3d(${camera.x}px,${camera.y}px,0)` }}>
        {STICKER_SLOTS.map((tile, slot) => {
          const itemIndex = slotIndex(slot);
          const item = wallTracks[itemIndex];
          const rect = expandedRects.get(slot) ?? tile;
          const expanded = slot === selectedSlot;
          const current = item.id === track.id;
          return <div key={slot} className={`yz-sticker${expanded ? ' is-expanded' : ''}${current ? ' is-current' : ''}${rect.columns * rect.rows <= 6 ? ' is-compact' : ''}`} style={{ left: rect.x * cellPitch, top: rect.y * cellPitch, width: rect.columns * cellPitch - STICKER_GAP, height: rect.rows * cellPitch - STICKER_GAP }} onClick={() => { if (!expanded) { playUiSound('enter'); focusSlot(slot); } }} onKeyDown={event => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            if (!expanded) focusSlot(slot);
            else if (event.key === 'Enter') playFocused();
          }} role={expanded ? 'group' : 'button'} tabIndex={expanded ? -1 : 0} title={expanded ? undefined : `展开 ${item.title} · ${item.artist}`} aria-label={`${item.title} · ${item.artist}`}>
            <CoverArt title={item.title} coverUrl={item.coverUrl} />
            <span className="yz-sticker-shade" />
            {expanded ? <>
              <div className="yz-sticker-focus-shade" />
              <div className="yz-sticker-focus-meta"><small>{focusedIsCurrent ? '正在播放 · ' : itemIndex < activeIndex ? '此前播放 · ' : ''}{String(itemIndex + 1).padStart(2, '0')}</small><h1>{item.title}</h1><p>{item.artist || '未知艺术家'}</p></div>
              {focusedIsCurrent && <div className="yz-lattice-lyrics" ref={lyricsContainerRef}>
                {lyrics.length ? lyrics.map((line, index) => <button key={`${line.time}-${index}`} ref={element => { lyricRefs.current[index] = element; }} className={`yz-lattice-lyric ${index === activeLyric ? 'is-current' : ''} ${index < activeLyric ? 'is-past' : ''}`} onClick={() => onSeek(line.time)} title={`跳转到 ${formatTime(line.time)}`}>{line.text}<small>{line.translation}</small></button>) : <div className="yz-lattice-no-lyrics">暂无歌词</div>}
              </div>}
              <div className="yz-sticker-focus-controls">
                <button onClick={playFocused} title={focusedIsCurrent && playing ? '暂停' : `播放 ${item.title}`} aria-label={focusedIsCurrent && playing ? '暂停' : `播放 ${item.title}`}>{focusedIsCurrent && playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
                {focusedIsCurrent && <><button onClick={onOpenQueue} title="播放队列" aria-label="播放队列"><Maximize2 size={15} /></button><input type="range" min={0} max={Math.max(total, 1)} step={0.1} value={Math.min(position, Math.max(total, 1))} onChange={event => onSeek(Number(event.target.value))} aria-label="播放进度" style={{ '--range-fill': `${total ? Math.min(100, position / total * 100) : 0}%` } as CSSProperties} /></>}
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
    {searchAvailable && <div className="yz-lattice-search-zone"><button onClick={onOpenSearch} title="搜索歌曲" aria-label="搜索歌曲"><Search size={17} /><span>搜索音乐</span><kbd>Ctrl K</kbd></button></div>}
    <div className="yz-lattice-mini">
      <button className="yz-lattice-mini-focus" onClick={focusCurrent} title="定位到正在播放的贴纸"><CoverArt title={track.title} coverUrl={track.coverUrl} /><span className="yz-lattice-mini-text"><strong>{track.title}</strong><em>{track.artist || '未知艺术家'}</em></span></button>
      <button className={`yz-lattice-mini-lyrics${desktopLyricsVisible ? ' is-active' : ''}`} onClick={onToggleDesktopLyrics} disabled={!onToggleDesktopLyrics} title={desktopLyricsVisible ? '关闭桌面歌词' : '打开桌面歌词'} aria-label={desktopLyricsVisible ? '关闭桌面歌词' : '打开桌面歌词'} aria-pressed={desktopLyricsVisible}><Captions size={18} /></button>
      <input className="yz-lattice-mini-progress" type="range" min={0} max={Math.max(total, 1)} step={0.1} value={Math.min(shownPosition, Math.max(total, 1))} disabled={total <= 0} onPointerDown={() => { seekDraggingRef.current = true; seekDraftRef.current = position; setSeekDraft(position); }} onChange={event => { const seconds = Number(event.target.value); if (seekDraggingRef.current) { seekDraftRef.current = seconds; setSeekDraft(seconds); } else onSeek(seconds); }} onPointerUp={commitMiniSeek} onPointerCancel={() => { seekDraggingRef.current = false; seekDraftRef.current = null; setSeekDraft(null); }} aria-label="拖动歌曲进度" style={{ '--range-fill': `${total ? Math.min(100, shownPosition / total * 100) : 0}%` } as CSSProperties} /><small className="yz-lattice-mini-time">{formatTime(shownPosition)} / {formatTime(total)}</small>
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
