import type { MediaCommand, PlayerState, RepeatMode, SourceProgress, Track } from './types';

type Listener = (state: PlayerState) => void;
export type PlaybackLifecycle = { type: 'audible' | 'pause' | 'pause-request' | 'waiting' | 'failure' | 'manual' | 'selected' | 'tick' | 'skip' | 'ended'; track?: Track };

function readPreference<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : JSON.parse(stored) as T;
  } catch {
    return fallback;
  }
}

function savePreference(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Playback remains usable when storage is unavailable.
  }
}

class PlayerController {
  private audio: HTMLAudioElement;
  private state: PlayerState;
  private listeners = new Set<Listener>();
  private lifecycleListeners = new Set<(event: PlaybackLifecycle) => void>();
  private navigation?: (reason: 'next' | 'ended' | 'previous') => Promise<void>;
  private resumeHandler?: () => Promise<boolean>;
  private history: number[] = [];
  private shufflePool = new Set<number>();
  private unlistenMedia?: () => void;
  private unlistenMediaSeek?: () => void;
  private trackResolver?: (track: Track, failedAttempts: readonly string[], report: (progress: SourceProgress) => void, signal: AbortSignal) => Promise<Track>;
  private sourceAbort?: AbortController;
  private mediaWaitTimer?: ReturnType<typeof setTimeout>;
  private failedAttempts = new Set<string>();
  private selectionToken = 0;
  private playbackToken = 0;
  private playbackRequested = false;
  private resolvingSource?: { token: number; pending: Promise<boolean> };
  private pendingSeek?: { token: number; seconds: number };

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    const volume = readPreference<number>('yzqxy.volume', 0.75);
    const muted = readPreference<boolean>('yzqxy.muted', false);
    const shuffle = readPreference<boolean>('yzqxy.shuffle', false);
    const repeat = readPreference<RepeatMode>('yzqxy.repeat', 'all');
    this.audio.volume = typeof volume === 'number' && Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.75;
    this.audio.muted = muted === true;
    this.state = {
      playing: false,
      position: 0,
      duration: 0,
      volume: this.audio.volume,
      muted: muted === true,
      shuffle: shuffle === true,
      repeat: ['off', 'all', 'one'].includes(repeat) ? repeat : 'all',
      queue: [],
      queueIndex: -1,
    };

    this.audio.addEventListener('play', () => this.update({ playing: true, error: undefined }));
    this.audio.addEventListener('playing', () => {
      this.emitLifecycle('audible');
      clearTimeout(this.mediaWaitTimer);
      this.update({ sourceActivity: undefined });
    });
    this.audio.addEventListener('waiting', () => {
      this.emitLifecycle('waiting');
      if (this.state.track?.source === 'custom' && this.state.playing && !this.resolvingSource) {
        this.reportSource({ phase: 'buffering', message: '正在缓冲音频', detail: '连接仍在运行，请稍候' });
        this.armMediaWait(this.playbackToken);
      }
    });
    this.audio.addEventListener('pause', () => { this.emitLifecycle('pause'); this.update({ playing: false }); });
    this.audio.addEventListener('timeupdate', () => this.updateClock());
    this.audio.addEventListener('durationchange', () => this.updateClock());
    this.audio.addEventListener('loadedmetadata', () => {
      const pending = this.pendingSeek;
      if (pending && pending.token === this.selectionToken) {
        this.audio.currentTime = Math.min(pending.seconds, Number.isFinite(this.audio.duration) ? this.audio.duration : pending.seconds);
        this.pendingSeek = undefined;
      }
      this.updateClock();
    });
    this.audio.addEventListener('ended', () => void this.onEnded());
    this.audio.addEventListener('error', () => {
      if (this.state.track?.source === 'custom' && !this.playbackRequested) return;
      if (this.state.track?.source === 'custom' && !this.state.track.audioUrl) return;
      if (this.retryMediaSource()) return;
      const error = this.audio.error;
      const message = this.state.track?.source === 'custom'
        ? '音乐源返回的音频无法加载。请重试或更换音乐源。'
        : error ? `无法播放此音频（错误 ${error.code}）` : '无法播放此音频';
      this.failSource(message);
    });

    if (typeof window !== 'undefined') {
      this.unlistenMedia = window.yzqxy?.onMediaCommand((command) => this.handleMediaCommand(command));
      this.unlistenMediaSeek = window.yzqxy?.onMediaSeek(({ trackId, seconds }) => {
        if (trackId === this.state.track?.id) this.seek(seconds);
      });
    }
    this.setupMediaSession();
  }

  get snapshot(): PlayerState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  subscribeLifecycle(listener: (event: PlaybackLifecycle) => void): () => void {
    this.lifecycleListeners.add(listener);
    return () => { this.lifecycleListeners.delete(listener); };
  }

  setNavigationHandler(handler?: (reason: 'next' | 'ended' | 'previous') => Promise<void>): void { this.navigation = handler; }
  setResumeHandler(handler?: () => Promise<boolean>): void { this.resumeHandler = handler; }

  private emitLifecycle(type: PlaybackLifecycle['type']): void {
    this.lifecycleListeners.forEach(listener => listener({ type, track: this.state.track }));
  }

  retainCurrentTrack(): void {
    const track = this.state.track;
    this.update({ queue: track ? [track] : [], queueIndex: track ? 0 : -1 });
    this.history = [];
    this.shufflePool.clear();
    this.persistQueue();
  }

  syncRoamingQueue(upcoming: Track[]): void {
    const track = this.state.track;
    this.update({ queue: track ? [track, ...upcoming.filter(item => item.id !== track.id)] : upcoming, queueIndex: track ? 0 : -1 });
    this.persistQueue();
  }

  setTrackResolver<T extends Track>(resolver: ((track: T, failedAttempts: readonly string[], report: (progress: SourceProgress) => void, signal: AbortSignal) => Promise<T>) | undefined): void {
    this.trackResolver = resolver ? (track, failedAttempts, report, signal) => resolver(track as T, failedAttempts, report, signal) : undefined;
  }

  private reportSource(progress: SourceProgress): void {
    this.update({ sourceActivity: { ...progress, startedAt: this.state.sourceActivity?.startedAt ?? Date.now() } });
  }

  private invalidateSelection(keepSourceActivity = false): void {
    this.selectionToken += 1;
    this.sourceAbort?.abort();
    this.sourceAbort = undefined;
    clearTimeout(this.mediaWaitTimer);
    if (!keepSourceActivity) {
      this.playbackRequested = false;
      this.update({ sourceActivity: undefined });
    }
  }

  private failSource(message: string): void {
    this.playbackRequested = false;
    clearTimeout(this.mediaWaitTimer);
    if (this.state.track?.source === 'custom') this.reportSource({ phase: 'failed', message: /超时|timeout/i.test(message) ? '连接超时，暂时无法播放' : '暂时没有可播放的资源', detail: /没有启用/.test(message) ? '请先添加或启用音乐源，再重新播放' : '可用连接已尝试完毕，请重试或更换音乐源' });
    this.update({ playing: false, error: message });
    this.emitLifecycle('failure');
  }

  private armMediaWait(request: number): void {
    clearTimeout(this.mediaWaitTimer);
    this.mediaWaitTimer = setTimeout(() => {
      if (request !== this.playbackToken || !this.state.sourceActivity) return;
      if (this.retryMediaSource('刚才的音频加载超时，正在自动尝试备用方案')) return;
      this.playbackToken += 1;
      this.audio.pause();
      this.failSource('音频加载超时，请重试或更换音乐源。');
    }, 20000);
  }

  private update(patch: Partial<PlayerState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
    this.updateMediaPosition();
  }

  private updateClock(): void {
    this.emitLifecycle('tick');
    if (this.pendingSeek?.token === this.selectionToken && this.audio.readyState >= HTMLMediaElement.HAVE_METADATA && Math.abs(this.audio.currentTime - this.pendingSeek.seconds) < 0.15) this.pendingSeek = undefined;
    const pending = this.pendingSeek?.token === this.selectionToken ? this.pendingSeek : undefined;
    const position = pending?.seconds ?? (Number.isFinite(this.audio.currentTime) ? this.audio.currentTime : 0);
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : this.state.track?.duration ?? 0;
    if (Math.abs(position - this.state.position) > 0.1 || duration !== this.state.duration) {
      this.update({ position, duration });
    }
  }

  private persistQueue(): void {
    savePreference('yzqxy.queue', {
      ids: this.state.queue.map((track) => track.id),
      index: this.state.queueIndex,
      online: this.state.queue
        .filter((track) => track.source === 'online' || track.source === 'custom')
        .map((track) => ({ ...track, audioUrl: '', playbackProviderId: undefined, playbackQuality: undefined })),
    });
  }

  restoreQueue(tracks: Track[]): void {
    const saved = readPreference<{ ids: string[]; index: number; online?: Track[] } | null>('yzqxy.queue', null);
    if (!saved || !Array.isArray(saved.ids)) return;
    const byId = new Map(tracks.map((track) => [track.id, track]));
    for (const online of Array.isArray(saved.online) ? saved.online : []) {
      if ((online?.source === 'online' || online?.source === 'custom') && typeof online.id === 'string'
        && typeof online.title === 'string' && typeof online.artist === 'string') {
        byId.set(online.id, { ...online, audioUrl: '', playbackProviderId: undefined, playbackQuality: undefined });
      }
    }
    const queue = saved.ids.map((id) => byId.get(id)).filter((track): track is Track => Boolean(track));
    if (queue.length === 0) return;
    const queueIndex = Math.max(0, Math.min(queue.length - 1, Number.isInteger(saved.index) ? saved.index : 0));
    const track = queue[queueIndex];
    this.playbackToken += 1;
    this.invalidateSelection();
    this.failedAttempts.clear();
    this.pendingSeek = undefined;
    this.setAudioSource(track.audioUrl);
    this.update({ queue, queueIndex, track, position: 0, duration: track.duration, playing: false, error: undefined });
    this.updateMediaMetadata();
  }

  setQueue(queue: Track[], startIndex = 0): void {
    const entries = queue.map(track => track.source === 'custom' ? { ...track, audioUrl: '', playbackProviderId: undefined, playbackQuality: undefined } : track);
    this.history = [];
    this.shufflePool.clear();
    this.playbackToken += 1;
    this.invalidateSelection();
    this.failedAttempts.clear();
    this.pendingSeek = undefined;
    if (entries.length === 0) {
      this.audio.pause();
      this.setAudioSource('');
      this.update({ queue: [], queueIndex: -1, track: undefined, position: 0, duration: 0, error: undefined });
    } else {
      const queueIndex = Math.max(0, Math.min(entries.length - 1, startIndex));
      const track = entries[queueIndex];
      this.audio.pause();
      this.setAudioSource(track.audioUrl);
      this.update({ queue: entries, queueIndex, track, position: 0, duration: track.duration, playing: false, error: undefined });
      this.updateMediaMetadata();
    }
    this.persistQueue();
  }

  async playTrack(track: Track, queue?: Track[], origin: 'manual' | 'roaming' = 'manual'): Promise<void> {
    if (track.availability === 'unavailable' && track.source === 'local') throw new Error('这是对方的本地歌曲。请先导入同名、同歌手的音频，再重新导入歌单进行匹配。');
    if (origin === 'manual') this.emitLifecycle('manual');
    if (queue) {
      const index = queue.findIndex((item) => item.id === track.id);
      const nextQueue = index >= 0
        ? queue.map((item, itemIndex) => itemIndex === index && track.audioUrl ? track : item)
        : [track, ...queue];
      this.setQueue(nextQueue, index >= 0 ? index : 0);
    } else {
      const index = this.state.queue.findIndex((item) => item.id === track.id);
      if (index < 0) {
        const nextQueue = [...this.state.queue, track];
        this.setQueue(nextQueue, nextQueue.length - 1);
      } else if (index !== this.state.queueIndex || this.state.track?.id !== track.id) {
        this.select(index);
      }
    }
    this.emitLifecycle('selected');
    await this.play(false, origin === 'roaming');
  }

  private select(index: number): void {
    const selected = this.state.queue[index];
    const track = selected?.source === 'custom' ? { ...selected, audioUrl: '', playbackProviderId: undefined, playbackQuality: undefined } : selected;
    if (!track) return;
    this.playbackToken += 1;
    this.audio.pause();
    this.invalidateSelection();
    this.failedAttempts.clear();
    this.setAudioSource(track.audioUrl);
    this.update({ track, queueIndex: index, position: 0, duration: track.duration, playing: false, error: undefined });
    this.persistQueue();
    this.updateMediaMetadata();
  }

  async play(isRetry = false, bypassResume = false): Promise<void> {
    if (!isRetry && !bypassResume && this.resumeHandler && await this.resumeHandler()) return;
    if (!this.state.track) return;
    if(this.state.track.source==='local'&&this.state.track.availability==='unavailable'){this.update({playing:false,error:'这是对方的本地歌曲，请先导入同名、同歌手的音频，再重新导入歌单进行匹配。'});return;}
    if (!isRetry && this.state.error && this.state.track.source === 'custom') {
      this.failedAttempts.clear();
      this.invalidateSelection();
      const track = { ...this.state.track, audioUrl: '', playbackProviderId: undefined, playbackQuality: undefined };
      this.setAudioSource('');
      this.update({ track });
    }
    const request = ++this.playbackToken;
    this.playbackRequested = true;
    this.update({ error: undefined });
    if (this.state.track.source === 'custom') this.reportSource({ phase: isRetry ? 'switching' : 'connecting', message: isRetry ? '正在尝试备用连接' : '正在准备播放', detail: isRetry ? this.state.sourceActivity?.detail : '优先读取缓存，再连接可用资源' });
    try {
      if (!(await this.ensureAudioSource())) return;
      if (request !== this.playbackToken) return;
      if (this.state.track?.source === 'custom') {
        this.reportSource({ phase: 'buffering', message: '资源已就绪，正在加载音频' });
        this.armMediaWait(request);
      }
      await this.audio.play();
      if (request === this.playbackToken) {
        clearTimeout(this.mediaWaitTimer);
        this.update({ sourceActivity: undefined });
      }
    } catch (error) {
      if (request !== this.playbackToken) return;
      if (this.retryMediaSource()) return;
      const message = this.state.track?.source === 'custom' && error instanceof DOMException && error.name === 'NotSupportedError'
        ? '音乐源返回的音频无法加载。请重试或更换音乐源。'
        : error instanceof Error ? error.message : '无法开始播放';
      this.failSource(message);
    }
  }

  private retryMediaSource(detail = '刚才的音频未能加载，正在自动尝试备用方案'): boolean {
    const track = this.state.track;
    const provider = track?.playbackProviderId;
    const attempt = track?.playbackQuality ? `${provider}:${track.playbackQuality}` : provider;
    if (track?.source !== 'custom' || !attempt || this.failedAttempts.has(attempt)) return false;
    this.failedAttempts.add(attempt);
    this.playbackToken += 1;
    this.invalidateSelection(true);
    this.reportSource({ phase: 'switching', message: '正在尝试备用连接', detail });
    const position = this.state.position;
    this.pendingSeek = position > 0 ? { token: this.selectionToken, seconds: position } : undefined;
    this.setAudioSource('');
    this.update({ track: { ...track, audioUrl: '', playbackProviderId: undefined, playbackQuality: undefined }, playing: false, error: undefined });
    void this.play(true);
    return true;
  }

  private setAudioSource(audioUrl: string): void {
    if (audioUrl) this.audio.src = audioUrl;
    else this.audio.removeAttribute('src');
    this.audio.load();
  }

  private ensureAudioSource(): Promise<boolean> {
    const selected = this.state.track;
    if (!selected) return Promise.resolve(false);
    if (selected.audioUrl) return Promise.resolve(true);
    if (!this.trackResolver) {
      this.failSource('无法取得这首歌的播放地址');
      return Promise.resolve(false);
    }
    const token = this.selectionToken;
    if (this.resolvingSource?.token === token) return this.resolvingSource.pending;
    const index = this.state.queueIndex;
    const controller = new AbortController();
    this.sourceAbort = controller;
    const pending = (async () => {
      const resolved = await this.trackResolver!(selected, [...this.failedAttempts], progress => {
        if (token === this.selectionToken && this.state.track?.id === selected.id && !controller.signal.aborted) this.reportSource(progress);
      }, controller.signal);
      if (token !== this.selectionToken || this.state.track?.id !== selected.id) return false;
      if (!resolved.audioUrl) {
        this.failSource('这首歌暂时无法播放');
        return false;
      }
      const queue = [...this.state.queue];
      if (index >= 0 && queue[index]?.id === selected.id) queue[index] = resolved;
      this.setAudioSource(resolved.audioUrl);
      this.update({ track: resolved, queue, duration: resolved.duration || selected.duration, error: undefined });
      this.persistQueue();
      this.updateMediaMetadata();
      return true;
    })();
    this.resolvingSource = { token, pending };
    void pending.then(
      () => { if (this.resolvingSource?.pending === pending) { this.resolvingSource = undefined; this.sourceAbort = undefined; } },
      () => { if (this.resolvingSource?.pending === pending) { this.resolvingSource = undefined; this.sourceAbort = undefined; } },
    );
    return pending;
  }

  pause(internal = false): void {
    if (!internal) this.emitLifecycle('pause-request');
    this.playbackToken += 1;
    this.invalidateSelection();
    this.audio.pause();
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else void this.play();
  }

  private refillShufflePool(): void {
    this.shufflePool.clear();
    this.state.queue.forEach((_track, index) => {
      if (index !== this.state.queueIndex) this.shufflePool.add(index);
    });
  }

  async next(fromEnded = false): Promise<void> {
    if (this.navigation) { await this.navigation(fromEnded ? 'ended' : 'next'); return; }
    this.emitLifecycle(fromEnded ? 'ended' : 'skip');
    if (this.state.queue.length === 0) return;
    if (fromEnded && this.state.repeat === 'one') {
      this.seek(0);
      await this.play();
      return;
    }

    let nextIndex = -1;
    if (this.state.shuffle && this.state.queue.length > 1) {
      if (this.shufflePool.size === 0) {
        if (fromEnded && this.state.repeat === 'off') {
          this.update({ playing: false });
          return;
        }
        this.refillShufflePool();
      }
      const choices = [...this.shufflePool];
      nextIndex = choices[Math.floor(Math.random() * choices.length)];
      this.shufflePool.delete(nextIndex);
      this.history.push(this.state.queueIndex);
      if (this.history.length > 300) this.history.shift();
    } else {
      nextIndex = this.state.queueIndex + 1;
      if (nextIndex >= this.state.queue.length) {
        if (this.state.repeat === 'off' && fromEnded) {
          this.update({ playing: false });
          return;
        }
        nextIndex = 0;
      }
    }
    this.select(nextIndex);
    await this.play();
  }

  async previous(): Promise<void> {
    if (this.navigation) { await this.navigation('previous'); return; }
    if (this.state.queue.length === 0) return;
    if (this.state.position > 3) {
      this.seek(0);
      return;
    }
    let index: number;
    if (this.state.shuffle && this.history.length > 0) {
      this.shufflePool.add(this.state.queueIndex);
      index = this.history.pop()!;
    } else {
      index = this.state.queueIndex <= 0 ? this.state.queue.length - 1 : this.state.queueIndex - 1;
    }
    this.select(index);
    await this.play();
  }

  private async onEnded(): Promise<void> {
    await this.next(true);
  }

  seek(seconds: number): void {
    if (!this.state.track || !Number.isFinite(seconds)) return;
    const maximum = Number.isFinite(this.audio.duration) ? this.audio.duration : this.state.duration;
    const target = Math.max(0, Math.min(seconds, maximum || seconds));
    if (!this.audio.currentSrc && !this.state.track.audioUrl) {
      const token = this.selectionToken;
      this.pendingSeek = { token, seconds: target };
      this.update({ position: target });
      void this.ensureAudioSource().then(ok => {
        if (!ok && this.pendingSeek?.token === token) { this.pendingSeek = undefined; this.updateClock(); }
      }).catch(() => {
        if (this.pendingSeek?.token === token) { this.pendingSeek = undefined; this.updateClock(); }
      });
      return;
    }
    this.pendingSeek = { token: this.selectionToken, seconds: target };
    try { this.audio.currentTime = target; } catch { /* Apply after metadata arrives. */ }
    this.updateClock();
  }

  setVolume(value: number): void {
    const volume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    this.audio.volume = volume;
    this.update({ volume });
    savePreference('yzqxy.volume', volume);
  }

  setMuted(muted: boolean): void {
    this.audio.muted = muted;
    this.update({ muted });
    savePreference('yzqxy.muted', muted);
  }

  toggleMute(): void {
    this.setMuted(!this.state.muted);
  }

  setShuffle(shuffle: boolean): void {
    this.history = [];
    this.shufflePool.clear();
    this.update({ shuffle });
    savePreference('yzqxy.shuffle', shuffle);
  }

  setRepeat(repeat: RepeatMode): void {
    this.update({ repeat });
    savePreference('yzqxy.repeat', repeat);
  }

  cycleRepeat(): void {
    const next: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };
    this.setRepeat(next[this.state.repeat]);
  }

  enqueue(track: Track): void {
    this.update({ queue: [...this.state.queue, track] });
    this.shufflePool.clear();
    this.persistQueue();
  }

  playNext(track: Track): void {
    const queue = [...this.state.queue];
    const index = Math.max(0, this.state.queueIndex + 1);
    queue.splice(index, 0, track);
    this.update({ queue });
    this.shufflePool.clear();
    this.persistQueue();
    if (!this.state.track) void this.playTrack(track);
  }

  removeFromQueue(index: number): void {
    if (index < 0 || index >= this.state.queue.length) return;
    const queue = [...this.state.queue];
    queue.splice(index, 1);
    if (index === this.state.queueIndex) {
      if (queue.length === 0) this.setQueue([]);
      else {
        this.setQueue(queue, Math.min(index, queue.length - 1));
        void this.play();
      }
      return;
    }
    const queueIndex = index < this.state.queueIndex ? this.state.queueIndex - 1 : this.state.queueIndex;
    this.update({ queue, queueIndex });
    this.shufflePool.clear();
    this.history = [];
    this.persistQueue();
  }

  clearQueue(): void {
    this.setQueue([]);
  }

  private setupMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    session.setActionHandler('play', () => void this.play());
    session.setActionHandler('pause', () => this.pause());
    session.setActionHandler('previoustrack', () => void this.previous());
    session.setActionHandler('nexttrack', () => void this.next());
    session.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') this.seek(details.seekTime);
    });
    session.setActionHandler('seekbackward', (details) => this.seek(this.state.position - (details.seekOffset ?? 10)));
    session.setActionHandler('seekforward', (details) => this.seek(this.state.position + (details.seekOffset ?? 10)));
  }

  private updateMediaMetadata(): void {
    if (!('mediaSession' in navigator) || !this.state.track) return;
    const track = this.state.track;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album ?? '',
      artwork: track.coverUrl ? [{ src: track.coverUrl }] : [],
    });
  }

  private updateMediaPosition(): void {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = this.state.playing ? 'playing' : 'paused';
    if (this.state.duration > 0 && Number.isFinite(this.state.duration)) {
      try {
        navigator.mediaSession.setPositionState({
          duration: this.state.duration,
          position: Math.min(this.state.position, this.state.duration),
          playbackRate: 1,
        });
      } catch {
        // Some media backends reject position updates before metadata is ready.
      }
    }
  }

  private handleMediaCommand(command: MediaCommand): void {
    switch (command) {
      case 'play-pause': this.toggle(); break;
      case 'play': void this.play(); break;
      case 'pause': this.pause(); break;
      case 'next': void this.next(); break;
      case 'previous': void this.previous(); break;
    }
  }

  dispose(): void {
    this.playbackToken += 1;
    this.invalidateSelection();
    this.unlistenMedia?.();
    this.unlistenMediaSeek?.();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.listeners.clear();
    this.lifecycleListeners.clear();
  }
}

export const player = new PlayerController();
