import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Home, Maximize2, Minimize2, Minus, Search, X } from 'lucide-react';
import ShaderBackdrop from './ShaderBackdrop';
import PersonalBackdrop, { type PersonalScene } from './PersonalBackdrop';
import LatticePlayer from './LatticePlayer';
import PlaybackBar from './PlaybackBar';
import SearchOverlay from './SearchOverlay';
import SettingsModal from './SettingsModal';
import PersonalHome from './PersonalHome';
import PersonalLibraryManager from './PersonalLibraryManager';
import QueuePanel from './QueuePanel';
import { playUiSound } from '../core/sounds';
import { trackCoverUrl } from '../core/trackCover';
import type { ZenixShellProps } from './types';
import './Zenix.css';

export default function ZenixShell(props: ZenixShellProps) {
  const {
    appearanceBackground = null, interactionLocked = false, appearanceBusy = false, onChooseBackground, onClearBackground,
    tracks, playlists = [], currentTrack = null, playing, position, duration, volume, muted = false,
    shuffle = false, repeat = 'off', queue = [], queueIndex = -1, recentTracks = [], lyrics = [], playerViewRequestKey, libraryBusy = false,
    onPlayTrack, onTogglePlay, onPrevious, onNext, onSeek, onVolumeChange,
    onToggleMute, onToggleShuffle, onCycleRepeat, onImportFolder, onAddFiles, onImportPlaylist, onOpenPlaylists, onRefreshLibrary,
    onMinimize, onMaximize, onClose, onReplayIntro,
    personal = { liked: [], favorites: [], history: [], playlists: [] }, onToggleSaved, onCreatePersonalPlaylist, onAddToPersonalPlaylist, onRemovePersonalTrack, onRemoveSaved, onRenamePersonalPlaylist, onDeletePersonalPlaylist, onRemoveFromQueue,
    desktopLyricsVisible = false, onToggleDesktopLyrics,
  } = props;
  const [view, setView] = useState<'home' | 'player'>('home');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'options' | 'sources'>('options');
  const [managerSection, setManagerSection] = useState<string | null>(null);
  const [enteringPlayer, setEnteringPlayer] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [titlebarRevealed, setTitlebarRevealed] = useState(false);
  const [homeSearchRevealed, setHomeSearchRevealed] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const previousViewRequestRef = useRef(playerViewRequestKey);
  const enterPlayer = () => { playUiSound('enter'); setEnteringPlayer(Boolean(appearanceBackground)); setView('player'); };
  useEffect(() => { shellRef.current?.scrollTo({ top: 0, left: 0 }); }, [view]);
  useEffect(() => {
    if (previousViewRequestRef.current !== playerViewRequestKey) {
      previousViewRequestRef.current = playerViewRequestKey;
      enterPlayer();
    }
  }, [playerViewRequestKey]);
  useEffect(() => {
    const bridge = window.yzqxy?.window;
    if (!bridge) return;
    void bridge.isMaximized().then(setMaximized);
    return bridge.onMaximizedChanged(setMaximized);
  }, []);
  useEffect(() => {
    if (view !== 'player' || !appearanceBackground) { setEnteringPlayer(false); return; }
    const timer = window.setTimeout(() => setEnteringPlayer(false), reduceMotion ? 0 : 550);
    return () => window.clearTimeout(timer);
  }, [view, appearanceBackground, reduceMotion]);

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
  }, [currentTrack, duration, interactionLocked, onSeek, onTogglePlay, position, queueOpen, searchOpen, settingsOpen, managerSection, view]);

  const openSearch = (text = query) => {
    playUiSound('enter');
    setQueueOpen(false);
    setManagerSection(null);
    setQuery(text);
    setSearchOpen(true);
  };
  const openQueue = () => { playUiSound('enter'); setSearchOpen(false); setSettingsOpen(false); setQueueOpen(true); };
  const togglePlayback = () => { playUiSound(playing ? 'cancel' : 'enter'); onTogglePlay(); };
  const previousTrack = () => { playUiSound('enter'); onPrevious(); };
  const nextTrack = () => { playUiSound('enter'); onNext(); };
  const toggleDesktopLyrics = () => { playUiSound(desktopLyricsVisible ? 'cancel' : 'enter'); onToggleDesktopLyrics?.(); };

  const showWindowControls = Boolean(onMinimize || onMaximize || onClose);
  const personalScene: PersonalScene = settingsOpen ? 'settings' : searchOpen ? 'search' : managerSection ? 'collection' : queueOpen ? 'queue' : 'home';
  const showPersonalBackground = (view === 'home' || enteringPlayer) && Boolean(appearanceBackground);

  return (
    <div ref={shellRef} className={`yz-shell yz-shell--${view}${reduceMotion ? ' yz-reduce-motion' : ''}${showPersonalBackground ? ' has-personal-background' : ''}`} onMouseMove={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const top = event.clientY - bounds.top;
      const right = bounds.right - event.clientX;
      setTitlebarRevealed(top >= 0 && top <= 33 && right >= 0 && right <= 178);
    }} onMouseLeave={() => setTitlebarRevealed(false)}>
      <ShaderBackdrop surface={view} playing={playing} reduceMotion={reduceMotion} />
      {showPersonalBackground && <PersonalBackdrop background={appearanceBackground} scene={personalScene} />}
      {trackCoverUrl(currentTrack) && view === 'player' && <div className="yz-cover-backdrop" style={{ backgroundImage: `url("${trackCoverUrl(currentTrack)?.replaceAll('"', '%22')}")` }} aria-hidden="true" />}
      <div className="yz-grain" aria-hidden="true" />
      <div className="yz-titlebar-drag" aria-hidden="true" />

      {view === 'home' && !searchOpen && (
        <div className={`yz-home-search-dock${homeSearchRevealed ? ' is-revealed' : ''}`} onMouseEnter={() => setHomeSearchRevealed(true)} onMouseLeave={() => setHomeSearchRevealed(false)}>
          <form role="search" onSubmit={event => { event.preventDefault(); openSearch(query); setHomeSearchRevealed(false); }}>
            <Search size={17} aria-hidden="true" />
            <input value={query} onChange={event => setQuery(event.target.value)} onFocus={() => setHomeSearchRevealed(true)} placeholder="搜索音乐" aria-label="搜索音乐" />
            <button type="submit" aria-label="打开搜索"><ArrowRight size={16} /></button>
          </form>
        </div>
      )}

      {showWindowControls && (
        <div className={`yz-window-controls${titlebarRevealed ? ' is-revealed' : ''}`} role="toolbar" aria-label="窗口控制">
          {onMinimize && <button title="最小化" aria-label="最小化" onClick={onMinimize}><Minus size={14} /></button>}
          {onMaximize && <button title={maximized ? '还原窗口' : '最大化'} aria-label={maximized ? '还原窗口' : '最大化'} onClick={onMaximize}>{maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>}
          {onClose && <button title="关闭" aria-label="关闭" onClick={onClose}><X size={15} /></button>}
        </div>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {view === 'home' ? (
          <motion.div key="home" className="yz-page yz-home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.32 }}>
            <PersonalHome personal={personal} tracks={tracks} currentTrack={currentTrack} appearanceBackground={appearanceBackground} appearanceBusy={appearanceBusy} onPlayTrack={onPlayTrack} onOpenPlayer={enterPlayer} onOpenManager={setManagerSection} onOpenSettings={() => setSettingsOpen(true)} onChooseBackground={onChooseBackground} onClearBackground={onClearBackground} onReplayIntro={onReplayIntro} onImportFolder={onImportFolder} onAddFiles={onAddFiles} onImportPlaylist={onImportPlaylist} onOpenLocalLibrary={onOpenPlaylists} />
            {currentTrack && <PlaybackBar track={currentTrack} personal={personal} onToggleSaved={onToggleSaved} onAddToPlaylist={onAddToPersonalPlaylist} onCreatePlaylist={onCreatePersonalPlaylist} playing={playing} position={position} duration={duration} volume={volume} muted={muted} shuffle={shuffle} repeat={repeat} surface="home" onTogglePlay={togglePlayback} onPrevious={previousTrack} onNext={nextTrack} onSeek={onSeek} onVolumeChange={onVolumeChange} onToggleMute={onToggleMute} onToggleShuffle={onToggleShuffle} onCycleRepeat={onCycleRepeat} onOpenPlayer={enterPlayer} onOpenQueue={openQueue} />}
          </motion.div>
        ) : (
          <motion.div key="player" className="yz-page yz-player" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.34 }}>
            {currentTrack ? (
              <LatticePlayer track={currentTrack} personal={personal} onToggleSaved={onToggleSaved} onAddToPlaylist={onAddToPersonalPlaylist} onCreatePlaylist={onCreatePersonalPlaylist} queue={queue} queueIndex={queueIndex} recentTracks={recentTracks} onPlayTrack={track => { playUiSound('enter'); onPlayTrack(track); }} lyrics={lyrics} playing={playing} position={position} duration={duration} volume={volume} muted={muted} shuffle={shuffle} repeat={repeat} onBack={() => { playUiSound('cancel'); setView('home'); }} onTogglePlay={togglePlayback} onPrevious={previousTrack} onNext={nextTrack} onSeek={onSeek} onVolumeChange={onVolumeChange} onToggleMute={onToggleMute} onToggleShuffle={onToggleShuffle} onCycleRepeat={onCycleRepeat} onOpenQueue={openQueue} onOpenSettings={() => setSettingsOpen(true)} onOpenSearch={() => openSearch()} searchAvailable={!queueOpen && !settingsOpen && !managerSection && !searchOpen} desktopLyricsVisible={desktopLyricsVisible} onToggleDesktopLyrics={onToggleDesktopLyrics ? toggleDesktopLyrics : undefined} />
            ) : <><button className="yz-player-back yz-player-back--empty" onClick={() => { playUiSound('cancel'); setView('home'); }} title="个人主页" aria-label="个人主页"><Home size={19} /></button><div className="yz-lattice-search-zone"><button onClick={() => openSearch()} title="搜索歌曲" aria-label="搜索歌曲"><Search size={17} /><span>搜索音乐</span><kbd>Ctrl K</kbd></button></div><div className="yz-empty-player-dots" aria-hidden="true" /></>}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {searchOpen && <motion.div key="search" className={`yz-search-layer yz-search-layer--${view}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : .18 }}><SearchOverlay query={query} onQueryChange={setQuery} localTracks={tracks} onPlayTrack={(track, queue) => { onPlayTrack(track, queue); enterPlayer(); }} onClose={() => setSearchOpen(false)} onOpenSources={() => { setSearchOpen(false); setSettingsInitialTab('sources'); setSettingsOpen(true); }} background={appearanceBackground} /></motion.div>}
        {queueOpen && <motion.div className="yz-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setQueueOpen(false)}><QueuePanel personal={personal} tracks={tracks} playlists={playlists} queue={queue} currentTrack={currentTrack} onPlayTrack={onPlayTrack} onRemove={index => onRemoveFromQueue?.(index)} onToggleSaved={(kind, track) => onToggleSaved?.(kind, track)} onAddToPlaylist={(id, track) => onAddToPersonalPlaylist?.(id, track)} onCreatePlaylist={(name, track) => onCreatePersonalPlaylist?.(name, track)} onOpenManager={() => { setQueueOpen(false); setManagerSection('playlists'); }} onClose={() => setQueueOpen(false)} /></motion.div>}
        {managerSection && <PersonalLibraryManager key={managerSection} initialSection={managerSection} personal={personal} tracks={tracks} onClose={() => setManagerSection(null)} onPlayTrack={(track, list) => { onPlayTrack(track, list); setManagerSection(null); enterPlayer(); }} onCreatePlaylist={name => onCreatePersonalPlaylist?.(name)} onRenamePlaylist={(id, name) => onRenamePersonalPlaylist?.(id, name)} onDeletePlaylist={id => onDeletePersonalPlaylist?.(id)} onRemoveSaved={(kind, id) => onRemoveSaved?.(kind, id)} onRemovePersonalTrack={(id, trackId) => onRemovePersonalTrack?.(id, trackId)} onAddToPlaylist={(id, track) => onAddToPersonalPlaylist?.(id, track)} />}
        {settingsOpen && <motion.div key="settings" className="yz-settings-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><SettingsModal initialTab={settingsInitialTab} reduceMotion={reduceMotion} libraryBusy={libraryBusy} appearanceBackground={appearanceBackground} appearanceBusy={appearanceBusy} desktopLyricsVisible={desktopLyricsVisible} onToggleDesktopLyrics={onToggleDesktopLyrics ? toggleDesktopLyrics : undefined} onChooseBackground={onChooseBackground} onClearBackground={onClearBackground} onReduceMotionChange={setReduceMotion} onImportFolder={onImportFolder} onRefreshLibrary={onRefreshLibrary} onClose={() => { setSettingsOpen(false); setSettingsInitialTab('options'); }} /></motion.div>}
      </AnimatePresence>
    </div>
  );
}


