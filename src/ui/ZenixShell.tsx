import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Home, Maximize2, Minimize2, Minus, Search, X } from 'lucide-react';
import PersonalBackdrop, { type PersonalScene } from './PersonalBackdrop';
import LatticePlayer from './LatticePlayer';
import PlaybackBar from './PlaybackBar';
import SearchOverlay from './SearchOverlay';
import { useMusicSearch } from './useMusicSearch';
import SettingsModal from './SettingsModal';
import PersonalHome from './PersonalHome';
import PersonalLibraryManager from './PersonalLibraryManager';
import QueuePanel from './QueuePanel';
import SourceCallout from './SourceCallout';
import { playUiSound } from '../core/sounds';
import { useDocumentVisible } from '../core/useDocumentVisible';
import { trackCoverUrl } from '../core/trackCover';
import type { ZenixShellProps } from './types';
import './Zenix.css';

const ShaderBackdrop = lazy(() => import('./ShaderBackdrop'));

export default function ZenixShell(props: ZenixShellProps) {
  const {
    appearanceBackground = null, interactionLocked = false, appearanceBusy = false, onChooseBackground, onClearBackground,
    tracks, playlists = [], currentTrack = null, playbackError, sourceActivity, onCancelSourceRequest, playing, position, duration, volume, muted = false,
    shuffle = false, repeat = 'off', queue = [], queueIndex = -1, lyrics = [], playerViewRequestKey, libraryBusy = false,
    onPlayTrack, onTogglePlay, onPrevious, onNext, onSeek, onVolumeChange,
    onToggleMute, onToggleShuffle, onCycleRepeat, onImportFolder, onAddFiles, onImportPlaylist, onOpenPlaylists, onRefreshLibrary,
    onMinimize, onMaximize, onClose, onReplayIntro,
    personal = { liked: [], favorites: [], history: [], playlists: [] }, onToggleSaved, onCreatePersonalPlaylist, onAddToPersonalPlaylist, onRemovePersonalTrack, onRemoveSaved, onRenamePersonalPlaylist, onDeletePersonalPlaylist, onRemoveFromQueue, onSetQueue,
    desktopLyricsVisible = false, onToggleDesktopLyrics,
  } = props;
  const [view, setView] = useState<'home' | 'player'>('home');
  const [playerWallMode, setPlayerWallMode] = useState<'recent' | 'queue' | 'search'>('recent');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const musicSearch = useMusicSearch(query, searchOpen || (view === 'player' && playerWallMode === 'search'), tracks);
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'options' | 'sources'>('options');
  const [managerSection, setManagerSection] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [titlebarRevealed, setTitlebarRevealed] = useState(false);
  const [homeSearchRevealed, setHomeSearchRevealed] = useState(false);
  const documentVisible = useDocumentVisible();
  const previousViewRequestRef = useRef(playerViewRequestKey);
  const enterPlayer = (mode: 'recent' | 'queue' = 'recent') => {
    playUiSound('enter');
    setPlayerWallMode(mode);
    if (mode === 'recent' && !currentTrack && personal.history.length) onSetQueue?.(personal.history.map(entry => entry.track), 0);
    setView('player');
  };
  useEffect(() => {
    if (previousViewRequestRef.current !== playerViewRequestKey) {
      previousViewRequestRef.current = playerViewRequestKey;
      enterPlayer('queue');
    }
  }, [playerViewRequestKey]);
  useEffect(() => {
    const bridge = window.yzqxy?.window;
    if (!bridge) return;
    void bridge.isFullscreen?.().then(setFullscreen);
    return bridge.onFullscreenChanged?.(setFullscreen);
  }, []);

  // Keyboard commands mirror the visible player controls while leaving text inputs alone.
  useEffect(() => {
    if (interactionLocked) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (managerSection) setManagerSection(null);
        else if (settingsOpen) { setSettingsOpen(false); setSettingsInitialTab('options'); }
        else if (searchOpen) setSearchOpen(false);
        else if (queueOpen) setQueueOpen(false);
        else if (view === 'player') { playUiSound('cancel'); setView('home'); }
        else if (fullscreen) void window.yzqxy?.window.toggleFullscreen();
        else return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !settingsOpen && !managerSection && !queueOpen) {
          event.preventDefault();
          setSearchOpen(true);
        }
        return;
      }
      if (settingsOpen || managerSection || queueOpen || searchOpen) return;
      const target = event.target;
      if (target instanceof Element && target.closest('button, a, input, textarea, select, [role="button"], [role="slider"], [contenteditable="true"]')) return;
      if (event.code === 'Space' && currentTrack) {
        event.preventDefault();
        onTogglePlay();
      } else if (event.key === 'ArrowRight') {
        if (view === 'player' && currentTrack) { event.preventDefault(); onSeek(Math.min(position + 5, duration)); }
      } else if (event.key === 'ArrowLeft') {
        if (view === 'player' && currentTrack) { event.preventDefault(); onSeek(Math.max(position - 5, 0)); }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentTrack, duration, interactionLocked, onSeek, onTogglePlay, position, queueOpen, searchOpen, settingsOpen, managerSection, view, fullscreen]);

  const openSearch = (text = query) => {
    playUiSound('enter');
    setQueueOpen(false);
    setManagerSection(null);
    setQuery(text);
    setSearchOpen(true);
  };
  const showSearchResults = () => {
    if (!query.trim()) { openSearch(); return; }
    musicSearch.submit();
    playUiSound('enter');
    setPlayerWallMode('search');
    setView('player');
    setSearchOpen(false);
    setQueueOpen(false);
    setManagerSection(null);
    setHomeSearchRevealed(false);
  };
  const openQueue = () => { playUiSound('enter'); setSearchOpen(false); setSettingsOpen(false); setQueueOpen(true); };
  const togglePlayback = () => { playUiSound(playing ? 'cancel' : 'enter'); onTogglePlay(); };
  const previousTrack = () => { playUiSound('enter'); onPrevious(); };
  const nextTrack = () => { playUiSound('enter'); onNext(); };
  const toggleDesktopLyrics = () => { playUiSound(desktopLyricsVisible ? 'cancel' : 'enter'); onToggleDesktopLyrics?.(); };

  const showWindowControls = Boolean(onMinimize || onMaximize || onClose);
  const personalScene: PersonalScene = settingsOpen ? 'settings' : searchOpen ? 'search' : managerSection ? 'collection' : queueOpen ? 'queue' : view === 'player' ? 'player' : 'home';
  const showPersonalBackground = Boolean(appearanceBackground);
  const recentTracks = personal.history.map(entry => entry.track);
  const searchingWall = searchOpen || playerWallMode === 'search';
  const playerAnchor = currentTrack || (searchingWall ? musicSearch.visibleTracks[0] : playerWallMode === 'recent' ? recentTracks[0] : queue[0]);
  const displayTracks = searchingWall ? musicSearch.visibleTracks : playerWallMode === 'recent' ? recentTracks.length ? recentTracks : currentTrack ? [currentTrack] : [] : undefined;

  return (
    <div className={`yz-shell yz-shell--${view}${reduceMotion ? ' yz-reduce-motion' : ''}${showPersonalBackground ? ' has-personal-background' : ''}`} onPointerMove={event => {
      if (searchOpen || settingsOpen || managerSection || queueOpen || interactionLocked || event.buttons) return;
      const target = event.target as Element;
      const overSearch = Boolean(target.closest('.yz-home-search-dock,.yz-lattice-search-zone'));
      const overAction = Boolean(target.closest('button,a,input,select,textarea,[role="button"],.yz-window-controls-zone'));
      setHomeSearchRevealed(overSearch || (!overAction && event.clientY >= 32 && event.clientY <= 148));
    }} onPointerLeave={() => setHomeSearchRevealed(false)}>
      {documentVisible && !showPersonalBackground && view === 'home' && <Suspense fallback={null}><ShaderBackdrop surface={view} playing={playing} reduceMotion={reduceMotion} /></Suspense>}
      {showPersonalBackground && <PersonalBackdrop background={appearanceBackground} scene={personalScene} />}
      {trackCoverUrl(currentTrack) && view === 'player' && <div className="yz-cover-backdrop" style={{ backgroundImage: `url("${trackCoverUrl(currentTrack)?.replaceAll('"', '%22')}")` }} aria-hidden="true" />}
      <div className="yz-grain" aria-hidden="true" />
      <div className="yz-titlebar-drag" aria-hidden="true" />

      {view === 'home' && !searchOpen && (
        <div className={`yz-home-search-dock${homeSearchRevealed ? ' is-revealed' : ''}`} onMouseEnter={() => setHomeSearchRevealed(true)} >
          <form role="search" onSubmit={event => { event.preventDefault(); showSearchResults(); }}>
            <Search size={17} aria-hidden="true" />
            <input value={query} onChange={event => setQuery(event.target.value)} onFocus={() => setHomeSearchRevealed(true)} placeholder="搜索音乐" aria-label="搜索音乐" />
            <button type="submit" aria-label="搜索"><Search size={16} /></button>
          </form>
        </div>
      )}

      {showWindowControls && (
        <div className="yz-window-controls-zone" onMouseEnter={() => setTitlebarRevealed(true)} onMouseLeave={() => setTitlebarRevealed(false)}>
          <div className={`yz-window-controls${titlebarRevealed ? ' is-revealed' : ''}`} role="toolbar" aria-label="窗口控制">
          {onMinimize && <button title="最小化" aria-label="最小化" onClick={onMinimize}><Minus size={14} /></button>}
          {onMaximize && <button title={fullscreen ? '退出全屏（F11）' : '全屏（F11）'} aria-label={fullscreen ? '退出全屏' : '全屏'} onClick={onMaximize}>{fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>}
          {onClose && <button title="关闭" aria-label="关闭" onClick={onClose}><X size={15} /></button>}
          </div>
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {view === 'home' ? (
          <motion.div key="home" className="yz-page yz-home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.32 }}>
            <PersonalHome personal={personal} tracks={tracks} currentTrack={currentTrack} appearanceBackground={appearanceBackground} appearanceBusy={appearanceBusy} onPlayTrack={onPlayTrack} onOpenPlayer={() => enterPlayer('recent')} onOpenManager={setManagerSection} onOpenSettings={() => setSettingsOpen(true)} onChooseBackground={onChooseBackground} onClearBackground={onClearBackground} onReplayIntro={onReplayIntro} onImportFolder={onImportFolder} onAddFiles={onAddFiles} onImportPlaylist={onImportPlaylist} onOpenLocalLibrary={onOpenPlaylists} />
            {currentTrack && <PlaybackBar track={currentTrack} personal={personal} onToggleSaved={onToggleSaved} onAddToPlaylist={onAddToPersonalPlaylist} onCreatePlaylist={onCreatePersonalPlaylist} playing={playing} position={position} duration={duration} volume={volume} muted={muted} shuffle={shuffle} repeat={repeat} surface="home" onTogglePlay={togglePlayback} onPrevious={previousTrack} onNext={nextTrack} onSeek={onSeek} onVolumeChange={onVolumeChange} onToggleMute={onToggleMute} onToggleShuffle={onToggleShuffle} onCycleRepeat={onCycleRepeat} onOpenPlayer={() => enterPlayer('recent')} onOpenQueue={openQueue} />}
          </motion.div>
        ) : (
          <motion.div key="player" className="yz-page yz-player" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.34 }}>
            {playerAnchor ? (
              <LatticePlayer track={playerAnchor} hasPlayback={Boolean(currentTrack)} personal={personal} onToggleSaved={onToggleSaved} onAddToPlaylist={onAddToPersonalPlaylist} onCreatePlaylist={onCreatePersonalPlaylist} queue={queue} queueIndex={queueIndex} displayTracks={displayTracks} onPlayTrack={track => { playUiSound('enter'); onPlayTrack(track, searchingWall ? musicSearch.playableTracks : playerWallMode === 'recent' ? recentTracks : undefined); }} lyrics={lyrics} playing={playing} position={position} duration={duration} volume={volume} muted={muted} shuffle={shuffle} repeat={repeat} onBack={() => { playUiSound('cancel'); setView('home'); }} onTogglePlay={currentTrack ? togglePlayback : () => onPlayTrack(playerAnchor, searchingWall ? musicSearch.playableTracks : recentTracks)} onPrevious={previousTrack} onNext={nextTrack} onSeek={onSeek} onVolumeChange={onVolumeChange} onToggleMute={onToggleMute} onToggleShuffle={onToggleShuffle} onCycleRepeat={onCycleRepeat} onOpenQueue={openQueue} onOpenSettings={() => setSettingsOpen(true)} onOpenSearch={() => openSearch()} searchRevealed={homeSearchRevealed} searchAvailable={!queueOpen && !settingsOpen && !managerSection && !searchOpen} desktopLyricsVisible={desktopLyricsVisible} onToggleDesktopLyrics={onToggleDesktopLyrics ? toggleDesktopLyrics : undefined} />
            ) : <><button className="yz-player-back yz-player-back--empty" onClick={() => { playUiSound('cancel'); setView('home'); }} title="个人主页" aria-label="个人主页"><Home size={19} /></button><div className={`yz-lattice-search-zone${homeSearchRevealed ? ' is-revealed' : ''}`}><button onClick={() => openSearch()} title="搜索歌曲" aria-label="搜索歌曲"><Search size={17} /><span>搜索音乐</span><kbd>Ctrl K</kbd></button></div><div className="yz-empty-player-dots" aria-hidden="true" /></>}
            {searchingWall && !musicSearch.visibleTracks.length && !searchOpen && <div className="yz-search-wall-status" role="status"><strong>{musicSearch.loading ? `正在搜索“${musicSearch.keyword}”…` : `没有找到“${musicSearch.keyword}”`}</strong>{!musicSearch.loading && <button onClick={() => openSearch()}>修改搜索或音乐源</button>}</div>}
          </motion.div>
        )}
      </AnimatePresence>

      {sourceActivity && <SourceCallout activity={sourceActivity} title={currentTrack?.title} onRetry={onTogglePlay} onCancel={onCancelSourceRequest} onManage={() => { setSearchOpen(false); setQueueOpen(false); setSettingsInitialTab('sources'); setSettingsOpen(true); }} />}

      {playbackError && !sourceActivity && currentTrack && !searchOpen && !settingsOpen && !queueOpen && !managerSection && <div className="yz-playback-error" role="alert">
        <div><strong>播放失败</strong><span>{playbackError}</span></div>
        <div className="yz-playback-error-actions"><button onClick={onTogglePlay}>重试</button>{currentTrack.source === 'custom' && <button onClick={() => { setSettingsInitialTab('sources'); setSettingsOpen(true); }}>管理音乐源</button>}</div>
      </div>}

      <AnimatePresence>
        {searchOpen && <motion.div key="search" className={`yz-search-layer yz-search-layer--${view}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : .18 }}><SearchOverlay query={query} onQueryChange={setQuery} search={musicSearch} onPlayTrack={(track, queue) => { onPlayTrack(track, queue); enterPlayer('queue'); }} onShowResults={showSearchResults} onClose={() => setSearchOpen(false)} onOpenSources={() => { setSearchOpen(false); setSettingsInitialTab('sources'); setSettingsOpen(true); }} background={appearanceBackground} /></motion.div>}
        {queueOpen && <motion.div className="yz-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setQueueOpen(false)}><QueuePanel personal={personal} tracks={tracks} playlists={playlists} queue={queue} currentTrack={currentTrack} onPlayTrack={onPlayTrack} onSetQueue={onSetQueue} onRemove={index => onRemoveFromQueue?.(index)} onToggleSaved={(kind, track) => onToggleSaved?.(kind, track)} onAddToPlaylist={(id, track) => onAddToPersonalPlaylist?.(id, track)} onCreatePlaylist={(name, track) => onCreatePersonalPlaylist?.(name, track) ?? Promise.resolve(null)} onOpenManager={() => { setQueueOpen(false); setManagerSection('playlists'); }} onClose={() => setQueueOpen(false)} /></motion.div>}
        {managerSection && <PersonalLibraryManager key={managerSection} initialSection={managerSection} personal={personal} tracks={tracks} queue={queue} onClose={() => setManagerSection(null)} onPlayTrack={(track, list) => { onPlayTrack(track, list); setManagerSection(null); enterPlayer('queue'); }} onCreatePlaylist={name => onCreatePersonalPlaylist?.(name) ?? Promise.resolve(null)} onRenamePlaylist={(id, name) => onRenamePersonalPlaylist?.(id, name) ?? Promise.resolve(false)} onDeletePlaylist={id => onDeletePersonalPlaylist?.(id) ?? Promise.resolve(false)} onRemoveSaved={(kind, id) => onRemoveSaved?.(kind, id)} onRemovePersonalTrack={(id, trackId) => onRemovePersonalTrack?.(id, trackId)} onAddToPlaylist={(id, track) => onAddToPersonalPlaylist?.(id, track)} />}
        {settingsOpen && <motion.div key="settings" className="yz-settings-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><SettingsModal initialTab={settingsInitialTab} reduceMotion={reduceMotion} libraryBusy={libraryBusy} appearanceBackground={appearanceBackground} appearanceBusy={appearanceBusy} desktopLyricsVisible={desktopLyricsVisible} onToggleDesktopLyrics={onToggleDesktopLyrics ? toggleDesktopLyrics : undefined} onChooseBackground={onChooseBackground} onClearBackground={onClearBackground} onReduceMotionChange={setReduceMotion} onImportFolder={onImportFolder} onRefreshLibrary={onRefreshLibrary} onClose={() => { setSettingsOpen(false); setSettingsInitialTab('options'); }} /></motion.div>}
      </AnimatePresence>
    </div>
  );
}
