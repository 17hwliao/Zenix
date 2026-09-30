import { useCallback, useEffect, useRef, useState } from 'react';
import { ZenixShell } from './ui';
import ZenixIntro from './ui/ZenixIntro';
import AppearanceOnboarding from './ui/AppearanceOnboarding';
import { library, loadLyrics, parseLyrics, player } from './core';
import type { AppearanceState, LibrarySnapshot, LyricLine, PersonalState, PlayerState, Track } from './core';
import type { InstalledSource, SourceProgress } from './core/types';
import { sourceDeadline } from './core/sourceDeadline';
import { PlaylistManager } from './playlists';

function sameSong(original: Track, candidate: Track): boolean {
  const key = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const artist = key(original.artist);
  const otherArtist = key(candidate.artist);
  const sameArtist = artist === otherArtist || Math.min(artist.length, otherArtist.length) >= 2 && (artist.includes(otherArtist) || otherArtist.includes(artist));
  return key(original.title) === key(candidate.title)
    && sameArtist
    && (!original.duration || !candidate.duration || Math.abs(original.duration - candidate.duration) <= 8);
}

async function hasPlayableAudio(url: string, signal?: AbortSignal, onFailure?: (reason: unknown) => void): Promise<boolean> {
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-1023' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
    if (!response.ok || /(?:text\/html|application\/json)/i.test(response.headers.get('content-type') || '') || !response.body) return false;
    const reader = response.body.getReader();
    try {
      const { value } = await reader.read();
      if (!value || value.length < 4) return false;
      const head = String.fromCharCode(...value.slice(0, 4));
      return head.startsWith('ID3') || head === 'fLaC' || head === 'OggS' || head === 'RIFF'
        || head === 'ftyp' || String.fromCharCode(...value.slice(4, 8)) === 'ftyp'
        || (value[0] === 0xff && (value[1] & 0xe0) === 0xe0);
    } finally { void reader.cancel().catch(() => {}); }
  } catch (reason) { signal?.throwIfAborted(); onFailure?.(reason); return false; }
}

type QualityTier = 'lossless24' | 'lossless' | 'high' | 'standard';

function qualityOrder(preference: string): QualityTier[] {
  return preference === 'standard' ? ['standard'] : preference === 'high' ? ['high', 'standard'] : ['lossless24', 'lossless', 'high', 'standard'];
}

function availableQualities(source: InstalledSource, track: Track, preference: string): QualityTier[] {
  const desired = qualityOrder(preference);
  if (source.kind === 'lx') {
    let platform = '';
    try { platform = JSON.parse(atob((track.remoteId || '').replace(/-/g, '+').replace(/_/g, '/'))).source || ''; } catch {}
    const formats = source.manifest.lxPlatforms?.[platform]?.qualitys || [];
    return desired.filter(tier => tier === 'lossless24' ? formats.includes('flac24bit')
      : tier === 'lossless' ? formats.includes('flac') : tier === 'high' ? formats.includes('320k') : formats.includes('128k'));
  }
  const supported = source.manifest.qualities;
  return desired.filter(tier => tier !== 'lossless24' && (!supported.length || supported.includes(tier)));
}

async function resolveCustomTrack(track: Track, failedAttempts: readonly string[], report: (progress: SourceProgress) => void, signal: AbortSignal): Promise<Track> {
  const bridge = window.yzqxy?.sources;
  if (!bridge) throw new Error('音乐源只在桌面版中可用');
  const preference = localStorage.getItem('zenix.onlineQuality') || 'auto';
  const failures: string[] = [];
  let lastIssue = '';
  const notify = (phase: SourceProgress['phase'], message: string, detail = lastIssue || undefined) => {
    signal.throwIfAborted();
    report({ phase, message, detail });
  };
  const failed = (reason: unknown) => {
    signal.throwIfAborted();
    lastIssue = /timeout|timed out|超时/i.test(reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason))
      ? '刚才的连接超时，正在自动尝试备用方案'
      : '刚才的资源未能播放，正在自动尝试备用方案';
    notify('retrying', '本次尝试未成功，正在继续');
  };
  if (!failedAttempts.length) {
    notify('cache', '正在查找本地缓存', '有缓存时直接播放，无需重新连接');
    const checkedLocal = new Set<string>();
    for (const tier of qualityOrder(preference)) {
      const local = await sourceDeadline(() => bridge.cached(track, tier), signal, 4000).catch(() => { signal.throwIfAborted(); return null; });
      if (local && !checkedLocal.has(local.audioUrl)) {
        checkedLocal.add(local.audioUrl);
        notify('checking', '正在检查缓存音频');
        if (await hasPlayableAudio(local.audioUrl, signal)) return { ...track, ...local, coverUrl: track.coverUrl || local.coverUrl };
      }
    }
  }
  notify('connecting', '正在连接可用资源');
  const sources = (await sourceDeadline(() => bridge.list(), signal, 5000)).filter(source => source.enabled && source.manifest.capabilities.includes('resolvePlayback'));
  if (!sources.length) throw new Error('没有启用可播放的音乐源；请在音乐源设置中启用至少一个源。');
  let lxPlatform = '';
  try { lxPlatform = JSON.parse(atob((track.remoteId || '').replace(/-/g, '+').replace(/_/g, '/'))).source || ''; } catch {}
  const attempted: string[] = [];
  for (const source of sources) {
    notify(attempted.length ? 'switching' : 'connecting', attempted.length ? '正在换用备用连接' : '正在连接播放服务');
    attempted.push(source.manifest.name);
    const direct = source.id === track.providerId
      ? track
      : source.kind === 'lx' && lxPlatform && source.manifest.lxPlatforms?.[lxPlatform]
        ? { ...track, id: `source:${encodeURIComponent(source.id)}:${encodeURIComponent(track.remoteId || '')}`, providerId: source.id, audioUrl: '' }
        : null;
    const seen = new Set<string>();
    const tryCandidate = async (candidate: Track): Promise<Track | null> => {
      if (!candidate.remoteId || seen.has(candidate.remoteId)) return null;
      seen.add(candidate.remoteId);
      for (const tier of availableQualities(source, candidate, preference)) {
        if (failedAttempts.includes(`${source.id}:${tier}`)) continue;
        try {
          const qualityName = { lossless24: '高解析无损', lossless: '无损', high: '高品质', standard: '标准' }[tier];
          notify('resolving', `正在获取${qualityName}音频`);
          const resolved = await sourceDeadline(() => bridge.resolve(candidate, tier, track.id, true), signal);
          notify('checking', '正在确认音频能否播放');
          let audioIssue: unknown;
          if (resolved.audioUrl && await hasPlayableAudio(resolved.audioUrl, signal, reason => { audioIssue = reason; })) {
            return { ...track, ...resolved, coverUrl: track.coverUrl || resolved.coverUrl, playbackProviderId: source.id, playbackQuality: tier };
          }
          failures.push(`${source.manifest.name}的${tier}音质无法播放`);
          failed(audioIssue || '音频不可播放');
        } catch (reason) {
          failed(reason);
          failures.push(`${source.manifest.name}的${tier}音质：${reason instanceof Error ? reason.message : String(reason)}`);
        }
      }
      return null;
    };
    if (direct) {
      const playable = await tryCandidate(direct);
      if (playable) return playable;
    }
    if (!source.manifest.capabilities.includes('search')) continue;
    try {
      notify('switching', '正在寻找同一首歌的备用资源');
      const page = await sourceDeadline(() => bridge.search(source.id, track.title, null, 50), signal, 15000);
      const matches = page.items.filter(candidate => sameSong(track, candidate))
        .sort((left, right) => Math.abs(left.duration - track.duration) - Math.abs(right.duration - track.duration));
      for (const candidate of matches.slice(0, 2)) {
        const playable = await tryCandidate(candidate);
        if (playable) return playable;
      }
      if (!matches.length && !direct) failures.push(`${source.manifest.name}没有匹配的歌曲`);
    } catch (reason) {
      failed(reason);
      failures.push(`${source.manifest.name}搜索失败：${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }
  const last = failures.at(-1)?.replace(/^Error invoking remote method '[^']+': Error:\s*/, '') || '没有匹配资源';
  throw new Error(`已按顺序尝试 ${attempted.join(' → ') || '全部可用音乐源'}，仍未找到可播放音频。${last}`);
}

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
    player.setTrackResolver(async (track, failedAttempts, report, signal) => {
      if (track.source === 'online') throw new Error('旧在线来源已移除；请等待自定义源接入');
      if (track.source === 'custom') return resolveCustomTrack(track, failedAttempts, report, signal);
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
  const createPersonalPlaylist = async (name: string, firstTrack?: Track): Promise<string | null> => {
    const bridge = window.yzqxy?.personal;
    if (!bridge) return null;
    try {
      const before = await bridge.load();
      const created = await bridge.createPlaylist(name, firstTrack);
      const playlist = created.playlists.find(item => !before.playlists.some(old => old.id === item.id));
      setPersonal(created);
      return playlist?.id || null;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '创建歌单失败');
      return null;
    }
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
  const renamePersonalPlaylist = async (id: string, name: string): Promise<boolean> => {
    const bridge = window.yzqxy?.personal;
    if (!bridge) return false;
    try { setPersonal(await bridge.renamePlaylist(id, name)); return true; }
    catch (error) { setNotice(error instanceof Error ? error.message : '重命名失败'); return false; }
  };
  const deletePersonalPlaylist = async (id: string): Promise<boolean> => {
    const bridge = window.yzqxy?.personal;
    if (!bridge) return false;
    try { setPersonal(await bridge.deletePlaylist(id)); return true; }
    catch (error) { setNotice(error instanceof Error ? error.message : '删除歌单失败'); return false; }
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
      playbackError={playback.error}
      sourceActivity={playback.sourceActivity}
      onCancelSourceRequest={() => player.pause()}
      playing={playback.playing}
      position={playback.position}
      duration={playback.duration}
      volume={playback.volume}
      muted={playback.muted}
      shuffle={playback.shuffle}
      repeat={playback.repeat}
      queue={playback.queue}
      queueIndex={playback.queueIndex}
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
    {notice && <div className="yz-runtime-notice" role="alert" onClick={() => setNotice('')}>{notice}</div>}
    {appearanceLoaded && !introVisible && !appearance.completed && <AppearanceOnboarding busy={appearanceBusy} onChoose={chooseBackground} onSkip={completeAppearance} />}
    {introVisible && <ZenixIntro background={appearance.background} onFinish={finishIntro} />}
  </>;
}
