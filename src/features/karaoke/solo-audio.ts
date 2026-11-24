import {sourceDeadline} from '../../core/sourceDeadline';
import type {SourceProgress, Track} from '../../core/types';
import {command, observeKaraokeAudio, type KaraokeAudioPosition} from '../../mobile/native';
import {karaokeAccompaniment, releaseKaraokeCapture} from './adapter';

export interface SoloAudio {
  play(): Promise<void>;
  pause(): Promise<void>;
  position(): {ms: number; playing: boolean};
  dispose(): void;
}

interface SoloAudioEvents {
  ended(positionMs: number): void;
  stopped(): void;
  failed(message: string): void;
  progress?(progress: SourceProgress): void;
  playing?(): void;
}

export async function prepareSoloAudio(track: Track, mobile: boolean, signal: AbortSignal, events: SoloAudioEvents, startAtMs = 0, exactRecording = false): Promise<SoloAudio> {
  if (mobile && !(track.source === 'local' && track.audioUrl.startsWith('blob:'))) {
    const round = `solo:${crypto.randomUUID()}`;
    let position = {ms: startAtMs, playing: false, sampledAt: performance.now()};
    let started = false;
    let pending = false;
    const listener = await observeKaraokeAudio(event => {
      if (signal.aborted || event.round !== round) return;
      position = {ms: event.positionMs, playing: event.state === 'playing', sampledAt: performance.now()};
      if (event.state === 'ended') events.ended(position.ms);
      if (event.state === 'stopped') events.stopped();
      if (event.state === 'error') events.failed(event.message || '无法播放练唱音频。');
    });
    if (signal.aborted) {
      void listener.remove().catch(() => {});
      signal.throwIfAborted();
    }
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = () => {
      if (pending || signal.aborted) return;
      pending = true;
      void command<KaraokeAudioPosition>('karaokeAudio', {operation: 'status', round})
        .then(state => {
          if (!signal.aborted && timer !== undefined) {
            position = {ms: state.positionMs, playing: state.playing, sampledAt: performance.now()};
          }
        })
        .catch(() => {})
        .finally(() => {pending = false;});
    };
    const stopPolling = () => {
      clearInterval(timer);
      timer = undefined;
    };
    return {
      async play() {
        signal.throwIfAborted();
        await command('karaokeAudio', {operation: 'play', round, track, syncElapsed: false, exactRecording, ...(!started && startAtMs > 0 ? {positionMs: startAtMs} : {})});
        signal.throwIfAborted();
        started = true;
        timer = setInterval(poll, 200);
        poll();
      },
      async pause() {
        stopPolling();
        await command('karaokeAudio', {operation: 'pause', round});
      },
      position: () => {
        const age = performance.now() - position.sampledAt;
        return {ms: position.ms + (position.playing ? Math.min(age, 200) : 0), playing: position.playing && age < 500};
      },
      dispose() {
        stopPolling();
        void listener.remove().catch(() => {});
        void command('karaokeAudio', {operation: 'stop', round}).catch(() => {});
      },
    };
  }

  let audio: HTMLAudioElement | undefined;
  let checkpoint = startAtMs / 1000;
  let wantsPlayback = false;
  let pendingPlayback: Promise<void> | undefined;
  let playExisting: (() => Promise<void>) | undefined;
  let clearCandidate: (() => void) | undefined;
  const attemptedUrls = new Set<string>();
  const dispose = () => {
    signal.removeEventListener('abort', dispose);
    clearCandidate?.();
  };
  signal.throwIfAborted();
  signal.addEventListener('abort', dispose, {once: true});

  function playNext(): Promise<void> {
    if (pendingPlayback) return pendingPlayback;
    wantsPlayback = true;
    const task = (async () => {
      signal.throwIfAborted();
      try {
        if (audio && playExisting) {
          try { await playExisting(); events.playing?.(); return; }
          catch (cause) {
            signal.throwIfAborted();
            if (cause instanceof DOMException && cause.name === 'NotAllowedError') throw cause;
            checkpoint = Math.max(checkpoint, audio?.currentTime ?? 0);
            clearCandidate?.();
            if (track.source === 'local') throw Error('无法继续播放本地练唱音频，请检查文件是否可用。');
            events.progress?.({phase:'retrying',message:'音频连接已中断，正在从上次位置恢复'});
          }
        }
        const {uri} = karaokeAccompaniment(track);
        if (track.source === 'local' || (!track.remoteId && !uri.startsWith('unavailable:'))) {
          if (await tryPlayback(track)) {events.playing?.(); return;}
          if (track.source === 'local') throw Error('无法播放本地练唱音频，请检查文件是否可用。');
        }
        const {resolveOriginalTrack} = await import('../../core/sourcePlayback');
        // Respect the result the user selected, then try alternatives for the same recording.
        const selected = {...track, preferredPlaybackProviderId: track.providerId || track.preferredPlaybackProviderId};
        await resolveOriginalTrack(selected, [], progress => events.progress?.(progress), signal, tryPlayback, exactRecording);
        events.playing?.();
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'NotAllowedError') throw Error('系统阻止了练唱音频播放，请再次点击播放。');
        throw cause;
      }
    })();
    pendingPlayback = task;
    const clear = () => {if (pendingPlayback === task) pendingPlayback = undefined;};
    void task.then(clear,clear);
    return task;
  }

  async function tryPlayback(candidate: Track): Promise<boolean> {
    signal.throwIfAborted();
    const {uri} = karaokeAccompaniment(candidate);
    if (uri.startsWith('unavailable:') || attemptedUrls.has(uri)) return false;
    attemptedUrls.add(uri);
    const player = new Audio();
    player.volume = 0.8;
    const token = /^yzqxy:\/\/stream\/([\da-f-]{36})$/i.exec(uri)?.[1];
    let streamStatus: number | undefined;
    let rejectPlayback: ((error: Error) => void) | undefined;
    const record = (played: boolean, reason?: string) => {
      if (candidate.diagnosticAttemptId && candidate.playbackProviderId !== 'cache') {
        void window.yzqxy?.sources.outcome?.(candidate.diagnosticAttemptId, played, reason).catch(() => {});
      }
    };
    const ended = () => events.ended(player.currentTime * 1000);
    const failPlayer = (mediaError: Error, reason: string) => {
      if (rejectPlayback) {rejectPlayback(mediaError); return;}
      if (audio !== player || !wantsPlayback || pendingPlayback || signal.aborted) return;
      record(false, reason);
      if (track.source === 'local') {events.failed('本地练唱音频播放中断。'); return;}
      checkpoint = Math.max(checkpoint, player.currentTime);
      clear();
      events.progress?.({phase:'retrying',message:'音频连接已中断，正在从上次位置恢复'});
      void playNext().catch(cause => {if (!signal.aborted) events.failed(cause instanceof Error ? cause.message : '无法恢复练唱音频。');});
    };
    const failed = () => failPlayer(Error('练唱音频不可播放'), '练唱音频在播放中断开');
    const stalled = () => {
      if (streamStatus !== undefined && player.readyState < 3) {
        const reason = `练唱音频请求返回 HTTP ${streamStatus}`;
        failPlayer(Error(reason), reason);
      }
    };
    const clearStreamFailure = () => {streamStatus = undefined;};
    const savePosition = () => {if (!player.seeking) checkpoint = Math.max(checkpoint, player.currentTime);};
    const unsubscribe = token ? window.yzqxy?.sources.onStreamFailure?.(failure => {
      if (failure.token !== token) return;
      streamStatus = failure.status;
      stalled();
    }) : undefined;
    const clear = () => {
      if (clearCandidate !== clear) return;
      clearCandidate = undefined;
      audio = undefined;
      playExisting = undefined;
      unsubscribe?.();
      player.removeEventListener('ended', ended);
      player.removeEventListener('error', failed);
      player.removeEventListener('waiting', stalled);
      player.removeEventListener('stalled', stalled);
      player.removeEventListener('canplay', clearStreamFailure);
      player.removeEventListener('timeupdate', savePosition);
      releaseKaraokeCapture({audio: player});
    };
    clearCandidate = clear;
    player.addEventListener('ended', ended);
    player.addEventListener('error', failed);
    player.addEventListener('waiting', stalled);
    player.addEventListener('stalled', stalled);
    player.addEventListener('canplay', clearStreamFailure);
    const start = async (first: boolean) => {
      let onMetadata: (() => void) | undefined;
      let onClock: (() => void) | undefined;
      try {
        await sourceDeadline(async () => {
          const failure = new Promise<never>((_, reject) => {rejectPlayback = reject;});
          const play = async () => {
            if (first) {
              if (checkpoint > 0) {
                const ready = new Promise<void>(resolve => {
                  onMetadata = resolve;
                  player.addEventListener('loadedmetadata',onMetadata,{once:true});
                });
                player.preload = 'auto';
                player.src = uri;
                await Promise.race([ready,failure]);
                signal.throwIfAborted();
                if (Number.isFinite(player.duration) && checkpoint >= player.duration) throw Error('备用录音短于当前演唱进度');
                player.currentTime = checkpoint;
              } else player.src = uri;
            }
            if (player.error) throw Error('练唱音频不可播放');
            stalled();
            // A resolved play() can precede a failed range request. On resume,
            // wait for the media clock to advance from the preserved position.
            if (checkpoint > 0 || !first) {
              const before = player.currentTime;
              const advances = new Promise<void>(resolve => {
                onClock = () => {if (!player.seeking && player.currentTime > before && player.readyState >= 3) resolve();};
                player.addEventListener('timeupdate',onClock);
              });
              await Promise.all([player.play(), advances]);
            } else await player.play();
          };
          await Promise.race([failure,play()]);
        }, signal, 0);
      } finally {
        rejectPlayback = undefined;
        if (onMetadata) player.removeEventListener('loadedmetadata',onMetadata);
        if (onClock) player.removeEventListener('timeupdate',onClock);
      }
    };
    try {
      await start(true);
      signal.throwIfAborted();
      audio = player;
      player.addEventListener('timeupdate', savePosition);
      playExisting = () => start(false).catch(cause => {
        if (!signal.aborted && !(cause instanceof DOMException && cause.name === 'NotAllowedError')) record(false, streamStatus ? `练唱音频请求返回 HTTP ${streamStatus}` : '练唱音频恢复失败');
        throw cause;
      });
      record(true);
      return true;
    } catch (cause) {
      const mediaCode = player.error?.code;
      clear();
      signal.throwIfAborted();
      if (cause instanceof DOMException && cause.name === 'NotAllowedError') throw cause;
      record(false, streamStatus ? `练唱音频请求返回 HTTP ${streamStatus}` : `练唱音频加载失败${mediaCode ? `（媒体错误 ${mediaCode}）` : ''}`);
      return false;
    }
  }

  return {
    play: playNext,
    async pause() {wantsPlayback = false; checkpoint = Math.max(checkpoint, audio?.currentTime ?? 0); audio?.pause();},
    position: () => ({ms: (audio?.currentTime ?? checkpoint) * 1000, playing: !!audio && !audio.paused && !audio.ended && !audio.seeking && audio.readyState >= 3}),
    dispose,
  };
}
