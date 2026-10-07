import type { PersonalState, RoamingStatus, Track, InstalledSource } from './types';
import { player, type PlaybackLifecycle } from './player';
import { sourceDeadline } from './sourceDeadline';
import { createState, queries, rank, consume, identity, feedback, prune, type RoamingState, type RoamingReason } from './roamingEngine';

const emptyPersonal: PersonalState = { liked: [], favorites: [], history: [], playlists: [] };
const storageKey = 'zenix.roaming.v1';
function loadState(): RoamingState {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (!stored || stored.version !== 1 || !stored.seen || !stored.feedback || !stored.artistAffinity || !Array.isArray(stored.recentArtists)) return createState();
    return prune({ ...createState(), ...stored });
  }
  catch { return createState(); }
}

/** Small candidate pool and a persistent recording ledger; no recommendation service. */
class RoamingController {
  private learning = loadState();
  private personal: PersonalState = emptyPersonal;
  private status: RoamingStatus = { active: false, phase: 'idle', message: '', discovered: 0, tracks: [] };
  private listeners = new Set<(status: RoamingStatus) => void>();
  private pending: Track[] = [];
  private viewed: Track[] = [];
  private generation = 0;
  private abort?: AbortController;
  private advancing = false;
  private filling?: Promise<void>;
  private foregroundRequested = false;
  private failureQueued = false;
  private consecutiveFailures = 0;
  private searchFailures = 0;
  private successfulSearches = 0;
  private sources: InstalledSource[] = [];
  private cursors = new Map<string, string | null>();
  private completed = new Set<string>();
  private session?: { track: Track; seconds: number; clock: number; audible: boolean };
  private previousRepeat = player.snapshot.repeat;
  private unlisten?: () => void;
  private unlistenPlayer?: () => void;

  get snapshot(): RoamingStatus { return this.status; }
  subscribe(listener: (status: RoamingStatus) => void): () => void {
    this.listeners.add(listener); listener(this.status);
    return () => { this.listeners.delete(listener); };
  }
  connect(): () => void {
    this.unlisten?.(); this.unlistenPlayer?.();
    this.unlisten = player.subscribeLifecycle(event => this.lifecycle(event));
    this.unlistenPlayer = player.subscribe(state => {
      if (!this.status.active || this.advancing || state.sourceActivity || this.status.phase === 'failed' || this.status.phase === 'exhausted') return;
      const phase = state.playing ? 'playing' : 'paused';
      if (this.status.phase !== phase) this.update({ phase, message: state.playing ? '正在漫游，继续发现新音乐' : '漫游已暂停，播放后继续' });
    });
    return () => {
      this.unlisten?.(); this.unlistenPlayer?.();
      this.unlisten = undefined; this.unlistenPlayer = undefined;
      this.stop();
    };
  }
  setPersonal(personal: PersonalState): void { this.personal = personal; }
  noteSaved(track: Track, kind: 'liked' | 'favorites' | 'playlist'): void {
    feedback(this.learning, track, kind); this.persist();
  }
  private update(patch: Partial<RoamingStatus>): void {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach(listener => listener(this.status));
  }
  private persist(): boolean {
    try { localStorage.setItem(storageKey, JSON.stringify(this.learning)); return true; }
    catch { return false; }
  }
  private elapsed(): void {
    const session = this.session;
    if (!session) return;
    const now = performance.now();
    if (session.audible) session.seconds += Math.max(0, (now - session.clock) / 1000);
    session.clock = now;
  }
  private finish(reason: RoamingReason): void {
    if (!this.session) return;
    this.elapsed();
    // Cancelling a still-loading selection is not a taste signal.
    const observedReason = reason === 'skip' && this.session.seconds === 0 ? 'failed' : reason;
    consume(this.learning, this.session.track, observedReason, this.session.seconds, this.session.track.duration || player.snapshot.duration);
    this.session = undefined; this.persist();
  }
  private lifecycle(event: PlaybackLifecycle): void {
    if (event.type === 'pause-request' && this.status.active && this.advancing) {
      this.generation += 1; this.abort?.abort(); this.abort = new AbortController();
      this.advancing = false; this.filling = undefined; this.failureQueued = false;
      this.update({ phase: 'paused', message: '漫游已暂停，点击继续漫游恢复' });
      return;
    }
    if (event.type === 'manual') { this.finish('skip'); if (this.status.active) this.stop(true); return; }
    if (event.type === 'skip' || event.type === 'ended') { this.finish(event.type === 'ended' ? 'played' : 'skip'); return; }
    if (event.type === 'failure') {
      this.finish('failed');
      if (!this.status.active) return;
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= 4) {
        this.abort?.abort();
        this.update({ phase: 'failed', message: '连续多首歌曲无法播放，漫游已暂停。请检查网络或音乐源后重试。' });
      } else {
        this.update({ phase: 'searching', message: '这首暂不可用，正在探索下一首' });
        if (this.advancing) this.failureQueued = true;
        else void this.advance('failure');
      }
      return;
    }
    if (event.type === 'audible' && event.track) {
      if (this.session?.track.id !== event.track.id) {
        this.finish('played');
        this.session = { track: event.track, seconds: 0, clock: performance.now(), audible: false };
      }
      this.elapsed(); this.session!.audible = true;
      if (this.status.active) {
        this.consecutiveFailures = 0;
        this.update({ phase: 'playing', message: '正在漫游，继续发现新音乐' });
        if (this.pending.length < 5) void this.fill().catch(() => {});
      }
      return;
    }
    this.elapsed();
    if ((event.type === 'waiting' || event.type === 'pause') && this.session) this.session.audible = false;
  }
  async start(): Promise<void> {
    if (!window.yzqxy?.sources) throw new Error('音乐漫游需要在安装版中使用已配置的音乐源');
    if (!this.personal.history.length && !this.personal.liked.length && !this.personal.favorites.length) {
      throw new Error('先搜索并听一首歌曲，再开始音乐漫游');
    }
    if (this.status.active && this.status.phase === 'playing') return;
    if (this.status.active && this.status.phase === 'paused' && player.snapshot.track && this.viewed.some(track => track.id === player.snapshot.track?.id) && !player.snapshot.error) {
      await player.play(); return;
    }
    this.finish('played');
    this.generation += 1;
    this.abort?.abort(); this.abort = new AbortController();
    this.advancing = false; this.filling = undefined; this.failureQueued = false;
    this.consecutiveFailures = 0;
    this.cursors.clear(); this.completed.clear();
    this.searchFailures = 0; this.successfulSearches = 0;
    if (!this.status.active) { this.previousRepeat = player.snapshot.repeat; this.pending = []; this.viewed = []; }
    this.update({ active: true, phase: 'searching', message: '正在根据你的收听习惯寻找新歌曲', tracks: [] });
    player.setNavigationHandler(async reason => {
      if (reason === 'previous') { player.seek(0); return; }
      await this.advance(reason);
    });
    player.setResumeHandler(async () => {
      if (!this.status.active || this.advancing) return false;
      if (this.status.phase === 'failed' || this.status.phase === 'exhausted'
        || this.status.phase === 'paused' && !this.viewed.some(track => track.id === player.snapshot.track?.id)) {
        await this.start(); return true;
      }
      return false;
    });
    const generation = this.generation;
    try {
      const sources = await sourceDeadline(() => window.yzqxy!.sources.list(), this.abort.signal, 6000);
      if (generation !== this.generation) return;
      this.sources = sources.filter(source => source.enabled && source.manifest.capabilities.includes('search'));
      if (!this.sources.length) throw new Error('请先添加并启用支持搜索的音乐源');
      await this.advance('start');
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({ phase: 'failed', message: error instanceof Error ? error.message : '暂时无法开始漫游，请检查音乐源' });
    }
  }
  stop(manual = false): void {
    this.generation += 1; this.abort?.abort(); this.abort = undefined;
    this.filling = undefined; this.advancing = false; this.failureQueued = false;
    player.setNavigationHandler(undefined);
    player.setResumeHandler(undefined);
    if (this.status.active) {
      player.retainCurrentTrack();
      player.setRepeat(manual ? this.previousRepeat : 'off');
    }
    this.pending = []; this.viewed = [];
    this.update({ active: false, phase: 'idle', message: '' });
    this.persist();
  }
  private wall(): void {
    const current = player.snapshot.track;
    const tracks = [...this.viewed, ...this.pending];
    if (current && !tracks.some(track => track.id === current.id)) tracks.unshift(current);
    this.update({ tracks: tracks.slice(-45) });
    player.syncRoamingQueue(this.pending);
  }
  async playCandidate(track: Track): Promise<void> {
    if (!this.status.active) { await player.playTrack(track); return; }
    if (track.id === player.snapshot.track?.id) { player.toggle(); return; }
    // Explicitly revisiting a visible poster is allowed; automatic delivery remains unique.
    const allowed = this.pending.find(item => item.id === track.id) || this.viewed.find(item => item.id === track.id);
    if (!allowed || this.advancing) return;
    this.finish('skip');
    this.pending = this.pending.filter(item => identity(item) !== identity(allowed));
    await this.advance('selection', allowed);
  }
  private async advance(reason: 'start' | 'next' | 'ended' | 'failure' | 'selection', chosen?: Track): Promise<void> {
    if (!this.status.active || this.advancing || this.status.phase === 'failed' && reason === 'failure') return;
    this.advancing = true;
    const generation = this.generation;
    if (reason === 'next' || reason === 'ended') this.finish(reason === 'ended' ? 'played' : 'skip');
    this.pending = rank(this.learning, this.personal, this.pending).slice(0, 30);
    player.pause(true);
    this.update({ phase: 'searching', message: reason === 'failure' ? '这首暂不可用，正在探索下一首' : '正在寻找下一首新歌曲' });
    try {
      if (!chosen && !this.pending.length) await this.fill(true);
      if (generation !== this.generation) return;
      const next = chosen || this.pending.shift();
      if (!next) {
        this.update({ phase: this.successfulSearches ? 'exhausted' : 'failed', message: this.successfulSearches ? '当前能找到的新歌曲已探索完毕。听听其他歌曲后，可以继续漫游。' : '暂时无法检索新歌曲，请检查网络和音乐源后重试。' });
        return;
      }
      consume(this.learning, next, 'played', 0, next.duration);
      if (!this.persist()) {
        this.update({ phase: 'failed', message: '无法保存漫游去重记录，已暂停推荐。请检查本地存储空间。' });
        return;
      }
      this.viewed = [...this.viewed.filter(item => identity(item) !== identity(next)), next].slice(-10);
      this.session = { track: next, seconds: 0, clock: performance.now(), audible: false };
      this.update({ discovered: this.status.discovered + 1 });
      await player.playTrack(next, [next, ...this.pending], 'roaming');
      if (generation !== this.generation) return;
      this.wall();
      if (!player.snapshot.error) this.update({ phase: player.snapshot.playing ? 'playing' : 'paused', message: player.snapshot.playing ? '正在漫游，继续发现新音乐' : '漫游已暂停，播放后继续' });
    } catch (error) {
      if (generation === this.generation) this.update({ phase: 'failed', message: error instanceof Error ? error.message : '漫游暂时无法继续，请重试' });
    } finally {
      if (generation === this.generation) {
        this.advancing = false;
        if (this.failureQueued && this.status.phase !== 'failed') { this.failureQueued = false; void this.advance('failure'); }
      }
    }
  }
  private fill(foreground = false): Promise<void> {
    if (foreground) this.foregroundRequested = true;
    if (this.filling) return this.filling;
    const generation = this.generation;
    const signal = this.abort?.signal;
    if (!signal || signal.aborted || !this.status.active) return Promise.resolve();
    const task = (async () => {
      const plans = queries(this.learning, this.personal);
      this.persist();
      const candidates = [...this.pending];
      const searchedPlans = new Set<string>();
      let attempts = 0;
      for (const plan of plans) {
        for (const source of this.sources) {
          if (generation !== this.generation || signal.aborted || attempts >= 16) return;
          const key = `${source.id}:${plan.key}`;
          if (this.completed.has(key)) continue;
          attempts += 1;
          try {
            const page = await sourceDeadline(() => window.yzqxy!.sources.search(source.id, plan.keyword, this.cursors.get(key), 30), signal, 12000);
            if (generation !== this.generation) return;
            this.successfulSearches += 1;
            searchedPlans.add(plan.key);
            this.cursors.set(key, page.nextCursor);
            if (!page.nextCursor) this.completed.add(key);
            candidates.push(...page.items.filter(track => track.source === 'custom'));
            this.pending = rank(this.learning, this.personal, candidates).slice(0, this.foregroundRequested ? 5 : 30);
            candidates.splice(0, candidates.length, ...this.pending);
            this.wall();
            if (this.pending.length && this.foregroundRequested) { this.foregroundRequested = false; return; }
            if (this.pending.length >= 20 && searchedPlans.size >= Math.min(3, plans.length)) return;
            if (this.pending.length) break;
          } catch {
            if (signal.aborted || generation !== this.generation) return;
            this.searchFailures += 1;
            if (this.searchFailures >= 6 && !this.successfulSearches) return;
          }
        }
      }
    })();
    this.filling = task;
    void task.finally(() => { if (this.filling === task) { this.filling = undefined; this.foregroundRequested = false; } }).catch(() => {});
    return task;
  }
}

export const roaming = new RoamingController();
