import { useCallback, useEffect, useRef, useState } from 'react';
import { ZenixShell } from './ui';
import ZenixIntro from './ui/ZenixIntro';
import AppearanceOnboarding from './ui/AppearanceOnboarding';
import { library, loadLyrics, parseLyrics, player } from './core';
import type { AppearanceState, LibrarySnapshot, LyricLine, PersonalState, PlayerState, Track } from './core';
import { PlaylistManager } from './playlists';

export default function App() {
  const [introVisible, setIntroVisible] = useState(true);
  const [appearance, setAppearance] = useState<AppearanceState>({ completed: true, background: null });
  const [appearanceLoaded, setAppearanceLoaded] = useState(false);
  const [appearanceBusy, setAppearanceBusy] = useState(false);
  const finishIntro = useCallback(() => setIntroVisible(false), []);
  const [collection, setCollection] = useState<LibrarySnapshot>(library.snapshot);
  const [playback, setPlayback] = useState<PlayerState>(player.snapshot);
  const [personal, setPersonal] = useState<PersonalState>({ liked: [], favorites: [], history: [], playlists: [] });
  const [desktopLyricsVisible, setDesktopLyricsVisible] = useState(false);
  const [recentTracks, setRecentTracks] = useState<Track[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('zenix.recentTracks') || localStorage.getItem('yzqxy.recentTracks') || '[]');
      if (!Array.isArray(saved)) return [];
      const seen = new Set<string>();
      return saved.filter((item): item is Track => {
        if (typeof item?.id !== 'string' || typeof item?.title !== 'string' || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }).slice(0, 50);
    } catch { return []; }
  });
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [playlistsOpen, setPlaylistsOpen] = useState(false);
  const [playerViewRequestKey, setPlayerViewRequestKey] = useState(0);
  const lastHistoryEvent = useRef('');

  useEffect(() => {
    const bridge = window.yzqxy?.personal;
    if (!bridge) return;
    let active = true;
    void bridge.load().then(state => { if (active) setPersonal(state); })
      .catch(error => { if (active) setNotice(error instanceof Error ? error.message : '个人曲库读取失败'); });
    const unsubscribe = bridge.onChanged(state => { if (active) setPersonal(state); });
    return () => { active = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!playback.playing || !playback.track) { lastHistoryEvent.current = ''; return; }
    if (lastHistoryEvent.current === playback.track.id) return;
    lastHistoryEvent.current = playback.track.id;
    const bridge = window.yzqxy?.personal;
    if (bridge) void bridge.record(playback.track).then(setPersonal).catch(() => {});
  }, [playback.playing, playback.track?.id]);

  useEffect(() => {
    const bridge = window.yzqxy?.desktopLyrics;
    if (!bridge) return;
    let active = true;
    const unsubscribe = bridge.onVisibleChanged(visible => {
      if (!active) return;
      setDesktopLyricsVisible(visible);
      localStorage.setItem('zenix.desktopLyrics.enabled', visible ? '1' : '0');
    });
    void bridge.isVisible().then(async visible => {
      if (!active) return;
      if (!visible && localStorage.getItem('zenix.desktopLyrics.enabled') === '1') visible = await bridge.toggle();
      if (active) setDesktopLyricsVisible(visible);
    }).catch(() => {});
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!desktopLyricsVisible) return;
    const bridge = window.yzqxy?.desktopLyrics;
    if (!bridge) return;
    const active = lyrics.reduce((index, line, i) => playback.position >= line.time ? i : index, -1);
    const previous = lyrics[active - 1];
    const current = lyrics[active];
    const following = lyrics[active + 1];
    void bridge.update({ previous: previous?.text || '', line: current?.text || (lyrics.length ? '即将开始' : playback.track?.title || ''), next: following?.text || (lyrics.length ? '' : playback.track ? '暂无同步歌词' : ''), title: playback.track?.title || '', trackId: playback.track?.id || '', track: playback.track ?? null, playing: playback.playing, position: playback.position, duration: playback.duration, lines: lyrics.map(line => ({ time: line.time, text: line.text })) });
  }, [desktopLyricsVisible, lyrics, playback.position, playback.duration, playback.playing, playback.track?.id, playback.track?.title]);

  const toggleDesktopLyrics = () => {
    const bridge = window.yzqxy?.desktopLyrics;
    if (!bridge) { setNotice('桌面歌词只在桌面版中可用'); return; }
    void bridge.toggle().then(visible => {
      setDesktopLyricsVisible(visible);
      localStorage.setItem('zenix.desktopLyrics.enabled', visible ? '1' : '0');
    }).catch(error => setNotice(error instanceof Error ? error.message : '桌面歌词无法打开'));
  };

  useEffect(() => {
    const bridge = window.yzqxy?.appearance;
    if (!bridge) { setAppearanceLoaded(true); return; }
    let active = true;
    void bridge.load().then(state => { if (active) setAppearance(state); })
      .catch(error => { if (active) setNotice(error instanceof Error ? error.message : '外观设置读取失败'); })
      .finally(() => { if (active) setAppearanceLoaded(true); });
    const unsubscribe = bridge.onChanged(state => { if (active) setAppearance(state); });
    return () => { active = false; unsubscribe(); };
  }, []);

  const chooseBackground = async () => {
    if (!window.yzqxy?.appearance || appearanceBusy) return;
    setAppearanceBusy(true);
    try { const state = await window.yzqxy.appearance.choose(); if (state) setAppearance(state); }
    catch (error) { setNotice(error instanceof Error ? error.message : '背景文件无法使用'); }
    finally { setAppearanceBusy(false); }
  };
  const completeAppearance = async () => {
    if (!window.yzqxy?.appearance || appearanceBusy) return;
    setAppearanceBusy(true);
    try { setAppearance(await window.yzqxy.appearance.complete()); }
    catch (error) { setNotice(error instanceof Error ? error.message : '外观设置保存失败'); }
    finally { setAppearanceBusy(false); }
  };
  const clearBackground = async () => {
    if (!window.yzqxy?.appearance || appearanceBusy) return;
    setAppearanceBusy(true);
    try { setAppearance(await window.yzqxy.appearance.clear()); }
    catch (error) { setNotice(error instanceof Error ? error.message : '背景移除失败'); }
    finally { setAppearanceBusy(false); }
  };

  useEffect(() => {
    player.setTrackResolver(async track => {
      if (track.source === 'online') throw new Error('旧在线来源已移除；请等待自定义源接入');
      if (track.source === 'custom') {
        if (!window.yzqxy?.sources) throw new Error('音乐源只在桌面版中可用');
        const resolved = await window.yzqxy.sources.resolve(track, localStorage.getItem('zenix.onlineQuality') || 'high');
        return { ...track, audioUrl: resolved.audioUrl, actualQuality: resolved.actualQuality, coverUrl: resolved.coverUrl || track.coverUrl };
      }
      return track;
    });
    const unsubscribeLibrary = library.subscribe(setCollection);
    const unsubscribePlayer = player.subscribe(setPlayback);
    const unsubscribeProgress = library.subscribeProgress(progress => setLibraryBusy(Boolean(progress)));
    let active = true;
    void library.init().then(snapshot => {
      if (active) player.restoreQueue(snapshot.tracks);
    }).catch(error => {
      if (active) setNotice(error instanceof Error ? error.message : '曲库读取失败');
    });
    return () => {
      player.setTrackResolver(undefined);
      active = false;
      unsubscribeLibrary();
      unsubscribePlayer();
      unsubscribeProgress();
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLyrics([]);
    if (playback.track) {
      const visited = playback.track;
      setRecentTracks(previous => [visited, ...previous.filter(item => item.id !== visited.id)].slice(0, 50));
      const request = playback.track.source === 'online' ? Promise.resolve([])
        : playback.track.source === 'custom'
          ? window.yzqxy?.sources.lyrics(playback.track).then(raw => raw ? parseLyrics(raw) : []) ?? Promise.resolve([])
          : loadLyrics(playback.track);
      void request.then(lines => {
        if (active) setLyrics(lines);
      }).catch(() => {
        if (active) setLyrics([]);
      });
    }
    return () => { active = false; };
  }, [playback.track?.id]);

  useEffect(() => {
    try {
      localStorage.setItem('zenix.recentTracks', JSON.stringify(recentTracks.map(item => item.source === 'online' || item.source === 'custom' ? { ...item, audioUrl: undefined } : item)));
    } catch { /* Browsing history is optional when storage is unavailable. */ }
  }, [recentTracks]);

  const importFolder = async () => {
    setLibraryBusy(true);
    try { await library.importFolder(); }
    catch (error) { setNotice(error instanceof Error ? error.message : '导入失败'); }
    finally { setLibraryBusy(false); }
  };

  const addFiles = async () => {
    setLibraryBusy(true);
    try { await library.addFiles(); }
    catch (error) { setNotice(error instanceof Error ? error.message : '导入文件失败'); }
    finally { setLibraryBusy(false); }
  };

  const importPlaylist = async () => {
    setLibraryBusy(true);
    try { await library.importPlaylist(); }
    catch (error) { setNotice(error instanceof Error ? error.message : '导入歌单失败'); }
    finally { setLibraryBusy(false); }
  };

  const refreshLibrary = async () => {
    setLibraryBusy(true);
    try { await library.rescan(); }
    catch (error) { setNotice(error instanceof Error ? error.message : '刷新失败'); }
    finally { setLibraryBusy(false); }
  };

  const playTrack = async (track: Track, queue?: Track[]) => {
    try {
      await player.playTrack(track, queue);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '无法播放这首歌');
    }
  };

  const personalAction = async (action: () => Promise<PersonalState>) => {
    try { setPersonal(await action()); }
    catch (error) { setNotice(error instanceof Error ? error.message : '保存失败'); }
  };
  const toggleSaved = (kind: 'liked' | 'favorites', track: Track) => {
    const bridge = window.yzqxy?.personal;
    if (bridge) void personalAction(() => bridge.toggle(kind, track));
  };
  const createPersonalPlaylist = (name: string, firstTrack?: Track) => {
    const bridge = window.yzqxy?.personal;
    if (bridge) void personalAction(async () => {
      const before = await bridge.load();
      const created = await bridge.createPlaylist(name);
      const playlist = created.playlists.find(item => !before.playlists.some(old => old.id === item.id));
      return firstTrack && playlist ? bridge.addToPlaylist(playlist.id, firstTrack) : created;
    });
  };
  const addToPersonalPlaylist = (id: string, track: Track) => {
    const bridge = window.yzqxy?.personal;
    if (bridge) void personalAction(() => bridge.addToPlaylist(id, track));
  };
  const removePersonalTrack = (id: string, trackId: string) => {
    const bridge = window.yzqxy?.personal;
    if (bridge) void personalAction(() => bridge.removeFromPlaylist(id, trackId));
  };
  const removeSaved = (kind: 'liked' | 'favorites' | 'history', id: string) => {
    const bridge = window.yzqxy?.personal;
    if (bridge) void personalAction(() => bridge.removeSaved(kind, id));
  };
  const renamePersonalPlaylist = (id: string, name: string) => {
    const bridge = window.yzqxy?.personal;
    if (bridge) void personalAction(() => bridge.renamePlaylist(id, name));
  };
  const deletePersonalPlaylist = (id: string) => {
    const bridge = window.yzqxy?.personal;
    if (bridge) void personalAction(() => bridge.deletePlaylist(id));
  };

  return <>
    <ZenixShell
      appearanceBackground={introVisible ? null : appearance.background}
      interactionLocked={introVisible || (appearanceLoaded && !appearance.completed)}
      appearanceBusy={appearanceBusy}
      onChooseBackground={chooseBackground}
      onClearBackground={clearBackground}
      tracks={collection.tracks}
      personal={personal}
      desktopLyricsVisible={desktopLyricsVisible}
      onToggleDesktopLyrics={toggleDesktopLyrics}
      onToggleSaved={(kind, track) => toggleSaved(kind, track as Track)}
      onCreatePersonalPlaylist={(name, track) => createPersonalPlaylist(name, track as Track | undefined)}
      onAddToPersonalPlaylist={(id, track) => addToPersonalPlaylist(id, track as Track)}
      onRemovePersonalTrack={removePersonalTrack}
      onRemoveSaved={removeSaved}
      onRenamePersonalPlaylist={renamePersonalPlaylist}
      onDeletePersonalPlaylist={deletePersonalPlaylist}
      onSetQueue={(tracks, index) => player.setQueue(tracks as Track[], index)}
      onRemoveFromQueue={index => player.removeFromQueue(index)}
      playlists={collection.playlists}
      playerViewRequestKey={playerViewRequestKey}
      currentTrack={playback.track}
      playing={playback.playing}
      position={playback.position}
      duration={playback.duration}
      volume={playback.volume}
      muted={playback.muted}
      shuffle={playback.shuffle}
      repeat={playback.repeat}
      queue={playback.queue}
      queueIndex={playback.queueIndex}
      recentTracks={recentTracks}
      lyrics={lyrics}
      libraryBusy={libraryBusy}
      onPlayTrack={(track, queue) => { void playTrack(track as Track, queue as Track[] | undefined); }}
      onTogglePlay={() => player.toggle()}
      onPrevious={() => { void player.previous(); }}
      onNext={() => { void player.next(); }}
      onSeek={seconds => player.seek(seconds)}
      onVolumeChange={volume => player.setVolume(volume)}
      onToggleMute={() => player.toggleMute()}
      onToggleShuffle={() => player.setShuffle(!player.snapshot.shuffle)}
      onCycleRepeat={() => player.cycleRepeat()}
      onImportFolder={importFolder}
      onAddFiles={addFiles}
      onImportPlaylist={importPlaylist}
      onOpenPlaylists={() => setPlaylistsOpen(true)}
      onRefreshLibrary={refreshLibrary}
      onMinimize={window.yzqxy ? () => { void window.yzqxy?.window.minimize(); } : undefined}
      onMaximize={window.yzqxy ? () => { void window.yzqxy?.window.toggleMaximize(); } : undefined}
      onClose={window.yzqxy ? () => { void window.yzqxy?.window.close(); } : undefined}
      onReplayIntro={() => setIntroVisible(true)}
    />
    {playlistsOpen && <PlaylistManager onClose={() => setPlaylistsOpen(false)} onPlayTrack={(track, queue) => {
      void playTrack(track, queue);
      setPlaylistsOpen(false);
      setPlayerViewRequestKey(value => value + 1);
    }} />}
    {(notice || playback.error) && <div className="yz-runtime-notice" role="alert" onClick={() => setNotice('')}>{notice || playback.error}</div>}
    {appearanceLoaded && !introVisible && !appearance.completed && <AppearanceOnboarding busy={appearanceBusy} onChoose={chooseBackground} onSkip={completeAppearance} />}
    {introVisible && <ZenixIntro background={appearance.background} onFinish={finishIntro} />}
  </>;
}
