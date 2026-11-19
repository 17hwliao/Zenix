import {useCallback, useEffect, useRef, useState} from 'react';
import type {InstalledSource, RawLyrics, Track} from '../../core/types';
import {command, observeKaraokeAudio, type KaraokeAudioPosition} from '../../mobile/native';
import {
  karaokeGradeForScore, KARAOKE_LIMITS, type KaraokeClientEvent, type KaraokeRoomState,
  type KaraokeTrackDescriptor, type PitchFrame,
} from './contracts';
import {analyzePitchSamples, releaseKaraokeCapture, resolveKaraokeTrack} from './adapter';
import {findKaraokeTrack} from './round-track';
import {scoreKaraoke} from './score-engine';
import type {KaraokeGradeFeedback} from './ui/KaraokeBattle';
import type {KaraokePerformanceView, KaraokeUiError} from './ui/types';

type ScoreEvent = Extract<KaraokeClientEvent, {type: 'score.line'}>;
type MicStatus = 'idle' | 'requesting' | 'active' | 'unavailable';
type Microphone = {stream: MediaStream; context: AudioContext; analyser: AnalyserNode; source: MediaStreamAudioSourceNode};

function roomElapsed(room: KaraokeRoomState, clockOffsetMs: number): number {
  const {startedAtMs, pausedAtMs, pausedTotalMs} = room.battle;
  return startedAtMs === undefined ? 0 : Math.max(0, (pausedAtMs ?? Date.now() + clockOffsetMs) - startedAtMs - (pausedTotalMs ?? 0));
}

export function useKaraokeRound({room, viewerMemberId, mobile, tracks, sources, readLyrics, submit, clockOffsetMs, closed}: {
  room?: KaraokeRoomState;
  viewerMemberId?: string;
  mobile: boolean;
  tracks: readonly Track[];
  sources: readonly InstalledSource[];
  readLyrics(track: Track): Promise<RawLyrics | null>;
  submit(event: ScoreEvent): void;
  clockOffsetMs: number;
  closed: boolean;
}) {
  const item = room?.queue.find(candidate => candidate.id === room.currentItemId);
  const itemId = !closed ? item?.id : undefined;
  const round = itemId && room?.battle.revision !== undefined ? `${room.roomId}:${room.battle.revision}` : undefined;
  const stage = room?.status;
  const member = room?.members.find(candidate => candidate.id === viewerMemberId);
  const singer = Boolean(viewerMemberId && item?.singerIds.includes(viewerMemberId) && member?.side !== 'none');
  const allowsMicrophone = Boolean(member && member.role !== 'listener' && member.side !== 'none' && !closed);
  const live = useRef({room, item, tracks, sources, readLyrics, submit, clockOffsetMs, singer});
  live.current = {room, item, tracks, sources, readLyrics, submit, clockOffsetMs, singer};
  const mic = useRef<Microphone | null>(null);
  const captureGeneration = useRef(0);
  const requestingMic = useRef(false);
  const [microphoneStatus, setMicrophoneStatus] = useState<MicStatus>('idle');
  const [roundError, setRoundError] = useState<KaraokeUiError | null>(null);
  const [prepared, setPrepared] = useState<{round: string; track: Track; descriptor?: KaraokeTrackDescriptor; audioUrl?: string}>();
  const [performance, setPerformance] = useState<KaraokePerformanceView>();
  const [grade, setGrade] = useState<KaraokeGradeFeedback | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const nativePosition = useRef<(KaraokeAudioPosition & {sampledAt: number}) | undefined>(undefined);
  const [foreground, setForeground] = useState(!document.hidden);

  const releaseMic = useCallback(() => {
    captureGeneration.current++;
    requestingMic.current = false;
    const current = mic.current;
    mic.current = null;
    if (current) releaseKaraokeCapture({...current, nodes: [current.source, current.analyser]});
    setMicrophoneStatus('idle');
  }, []);

  const enableMicrophone = useCallback(async () => {
    if (!allowsMicrophone || mic.current || requestingMic.current) return;
    const generation = ++captureGeneration.current;
    requestingMic.current = true;
    setMicrophoneStatus('requesting');
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      if (mobile) {
        const result = await command<{permitted: boolean}>('assistant', {action: 'speechPermission'});
        if (!result.permitted) throw Error('麦克风权限未开启');
      }
      if (captureGeneration.current !== generation) return;
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') throw Error('当前设备不支持实时麦克风分析');
      stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true}, video: false});
      if (captureGeneration.current !== generation) {
        releaseKaraokeCapture({stream});
        return;
      }
      context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      source.connect(analyser);
      await context.resume();
      if (captureGeneration.current !== generation) {
        releaseKaraokeCapture({stream, context, nodes: [source, analyser]});
        return;
      }
      mic.current = {stream, context, source, analyser};
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => {
        if (mic.current?.stream !== stream) return;
        releaseMic();
        setMicrophoneStatus('unavailable');
        setRoundError({message: '麦克风已断开，伴奏继续，这台设备暂停评分。', recoverable: true});
      }, {once: true});
      setMicrophoneStatus('active');
    } catch {
      releaseKaraokeCapture({stream, context});
      if (captureGeneration.current !== generation) return;
      setMicrophoneStatus('unavailable');
      setRoundError({message: '无法启用麦克风。你仍可听伴奏，本机分数标为未评估。', recoverable: true});
    } finally {
      if (captureGeneration.current === generation) requestingMic.current = false;
    }
  }, [allowsMicrophone, mobile, releaseMic]);

  useEffect(() => () => releaseMic(), [releaseMic]);
  useEffect(() => {
    if (!allowsMicrophone || stage === 'results' || stage === 'closed') releaseMic();
  }, [allowsMicrophone, stage, releaseMic]);
  useEffect(() => {
    if (!round) return;
    return releaseMic;
  }, [round, releaseMic]);
  useEffect(() => {
    const hidden = () => {
      setForeground(!document.hidden);
      if (document.hidden && mobile) releaseMic();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [mobile, releaseMic]);

  useEffect(() => {
    setGrade(null);
    setPrepared(undefined);
    setPerformance(undefined);
    if (!round) return;
    setRoundError(null);
    const controller = new AbortController();
    const {signal} = controller;
    const {item, tracks, sources, readLyrics} = live.current;
    if (!item) return;
    void (async () => {
      const track = await findKaraokeTrack(item, tracks, sources, mobile, signal);
      signal.throwIfAborted();
      if (!track) throw Error('本机未找到这首歌。可导入同一录音，或启用可以搜索这首歌的音乐源。');
      const lyricsPromise = readLyrics(track).catch(() => null);
      const descriptor = await resolveKaraokeTrack(track, await lyricsPromise);
      signal.throwIfAborted();
      // Lyrics can load even when audio resolution fails.
      setPrepared({round, track, descriptor: descriptor.ok ? descriptor.value : undefined});
      if (!mobile) {
        const resolved = track.source !== 'local' && !track.audioUrl
          ? await (await import('../../core/sourcePlayback')).resolveOriginalTrack(track, [], () => {}, signal)
          : track;
        signal.throwIfAborted();
        const uri = resolved.audioUrl || (/^(?:file:|blob:|yzqxy:)/u.test(resolved.path) ? resolved.path : '');
        if (!uri) throw Error('本机没有可播放的伴奏。');
        setPrepared({round, track, descriptor: descriptor.ok ? descriptor.value : undefined, audioUrl: uri});
      }
    })().catch(error => {
      if (!signal.aborted) setRoundError({message: error instanceof Error ? error.message : '无法准备本机歌曲', recoverable: true});
    });
    return () => controller.abort();
  }, [round, mobile]);

  const activeTrack = prepared?.round === round ? prepared?.track : undefined;
  const activeDescriptor = prepared?.round === round ? prepared?.descriptor : undefined;
  const audioUrl = prepared?.round === round ? prepared?.audioUrl : undefined;
  useEffect(() => {
    if (mobile || !round || !audioUrl) return;
    const player = new Audio(audioUrl);
    player.preload = 'auto';
    player.volume = .75;
    audio.current = player;
    const failed = () => setRoundError({message: '本机伴奏无法播放，房间状态仍会同步。', recoverable: true});
    player.addEventListener('error', failed);
    return () => {
      audio.current = null;
      releaseKaraokeCapture({audio: player, listeners: [() => player.removeEventListener('error', failed)]});
    };
  }, [mobile, round, audioUrl]);

  useEffect(() => {
    if (!round || !mobile) return;
    nativePosition.current = undefined;
    let alive = true;
    let busy = false;
    let remove: (() => void) | undefined;
    const poll = () => {
      if (busy || document.hidden) return;
      busy = true;
      void command<KaraokeAudioPosition>('karaokeAudio', {operation: 'status', round}).then(position => {
        if (!alive || (!position.playing && !position.buffering && !position.positionMs)) return;
        nativePosition.current = {...position, sampledAt: performanceClock()};
      }).catch(() => {}).finally(() => {busy = false;});
    };
    const timer = setInterval(poll, 240);
    void observeKaraokeAudio(event => {
      if (!alive || event.round !== round) return;
      if (event.state === 'stopped' && nativePosition.current?.positionMs && !event.positionMs) return;
      nativePosition.current = {positionMs: event.positionMs, playing: event.state === 'playing', buffering: false, sampledAt: performanceClock()};
      if (event.state === 'error') setRoundError({message: event.message || '本机伴奏已停止。', recoverable: true});
    }).then(handle => {
      if (alive) remove = () => {void handle.remove();};
      else void handle.remove();
    }).catch(() => {});
    return () => {
      alive = false;
      clearInterval(timer);
      remove?.();
      nativePosition.current = undefined;
      void command('karaokeAudio', {operation: 'stop', round}).catch(() => {});
    };
  }, [mobile, round]);
  useEffect(() => {
    if (!round || (mobile && !foreground) || (stage !== 'singing' && stage !== 'paused')) return;
    let alive = true;
    const positionMs = live.current.room ? roomElapsed(live.current.room, live.current.clockOffsetMs) : 0;
    if (mobile && activeTrack) {
      void command('karaokeAudio', {operation: stage === 'singing' ? 'play' : 'pause', round, track: activeTrack, positionMs})
        .catch(() => {if (alive) setRoundError({message: '本机伴奏无法播放，请检查音乐源。', recoverable: true});});
    } else if (audio.current) {
      const player = audio.current;
      if (stage === 'paused') player.pause();
      else {
        try {player.currentTime = positionMs / 1000;} catch {}
        void player.play().catch(() => {if (alive) setRoundError({message: '本机伴奏无法播放。', recoverable: true});});
      }
    }
    return () => {alive = false;};
  }, [stage, round, activeTrack, audioUrl, mobile, foreground]);

  useEffect(() => {
    if (!round) return;
    let cursor = 0, combo = 0, firstSampleMs: number | undefined;
    let samples: Float32Array<ArrayBuffer> | undefined;
    let microphone: Microphone | null;
    let frame: PitchFrame | undefined;
    let frames: PitchFrame[] = [];
    const lines = activeDescriptor?.pitchTrack?.lines ?? [];
    const durationMs = activeDescriptor?.durationMs ?? (live.current.item?.song?.durationMs ?? 0);
    const update = () => {
      const {room, clockOffsetMs, singer, submit} = live.current;
      if (!room || room.battle.revision === undefined || !room.currentItemId) return;
      const roomPosition = roomElapsed(room, clockOffsetMs);
      const native = nativePosition.current;
      const desktop = audio.current;
      const mediaPlaying = mobile
        ? native?.playing && performanceClock() - native.sampledAt < 600
        : desktop && !desktop.paused && !desktop.ended && desktop.readyState >= 3;
      const elapsedMs = mobile && native
        ? native.positionMs + (mediaPlaying ? Math.min(260, performanceClock() - native.sampledAt) : 0)
        : desktop && desktop.readyState >= 1 ? desktop.currentTime * 1000 : roomPosition;
      if (room.status === 'singing' && singer) {
        if (microphone !== mic.current) {
          microphone = mic.current;
          samples = microphone ? new Float32Array(microphone.analyser.fftSize) : undefined;
          firstSampleMs = undefined;
          frames = [];
          frame = undefined;
        }
        if (microphone && samples && mediaPlaying) {
          const at = elapsedMs;
          firstSampleMs ??= at;
          microphone.analyser.getFloatTimeDomainData(samples);
          frame = analyzePitchSamples(samples, microphone.context.sampleRate, at);
          if (frames.length < KARAOKE_LIMITS.maxPitchFrames) frames.push(frame);
        }
        while (cursor < lines.length && lines[cursor].endMs <= elapsedMs
          && (mediaPlaying || desktop?.ended || native && native.positionMs >= lines[cursor].endMs)) {
          const line = lines[cursor++];
          if (!microphone || firstSampleMs === undefined || firstSampleMs > line.startMs + 200) continue;
          const section = frames.filter(frame => frame.atMs >= line.startMs - 200 && frame.atMs <= line.endMs + 200);
          frames = frames.filter(frame => frame.atMs >= line.endMs - 200);
          if (!section.length) continue;
          const [score] = scoreKaraoke({pitchFrames: section, pitchTrack: {...activeDescriptor!.pitchTrack!, lines: [line]}}).lines;
          if (!score) continue;
          const grade = karaokeGradeForScore(score.total);
          combo = score.total >= 80 ? combo + 1 : 0;
          setGrade({grade, combo, itemId: room.currentItemId, lineIndex: line.index, side: room.members.find(row => row.id === viewerMemberId)?.side});
          submit({type: 'score.line', itemId: room.currentItemId, lineIndex: line.index,
            revision: room.battle.revision, clientSentAtMs: Date.now(),
            lineScore: {...score, feedback: [], grade, combo},
          });
        }
      }
      const line = lines[cursor]?.startMs <= elapsedMs && lines[cursor]?.endMs > elapsedMs
        ? lines[cursor] : lines.find(line => line.startMs <= elapsedMs && line.endMs > elapsedMs);
      const note = line?.notes.find(note => note.startMs <= elapsedMs && note.endMs > elapsedMs);
      const countdownMs = room.status === 'countdown'
        ? Math.max(0, (room.countdownEndsAtMs ?? 0) - Date.now() - clockOffsetMs) : undefined;
      setPerformance({
        status: room.status === 'countdown' || room.status === 'singing' || room.status === 'paused' ? room.status : 'idle',
        elapsedMs, durationMs, activeLineIndex: line?.index ?? -1, countdownMs,
        lineProgress: line ? Math.min(1, (elapsedMs - line.startMs) / Math.max(1, line.endMs - line.startMs)) : 0,
        pitch: {status: frame?.midi != null ? 'tracking' : microphone ? 'no-signal' : 'unsupported',
          targetMidi: note?.midi ?? null, detectedMidi: frame?.midi ?? null,
          confidence: frame?.confidence ?? 0, energy: frame?.energy ?? 0},
      });
    };
    update();
    const timer = setInterval(update, 50);
    return () => clearInterval(timer);
  }, [round, activeDescriptor, viewerMemberId, mobile]);

  return {performance, grade, roundError,
    microphoneStatus, enableMicrophone, allowsMicrophone, dismissError: () => setRoundError(null),
    lyrics: activeDescriptor?.pitchTrack?.lines ?? []};
}

function performanceClock() {
  return globalThis.performance.now();
}
