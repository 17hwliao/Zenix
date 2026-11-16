import { useCallback, useEffect, useRef, useState } from 'react';
import type { RawLyrics, Track } from '../../core/types';
import type {
  KaraokeScore,
  KaraokeTrackDescriptor,
  PitchFrame,
} from './contracts';
import { scoreKaraoke } from './score-engine';
import {
  analyzePitchSamples,
  importKaraokePitchReference,
  releaseKaraokeCapture,
  resolveKaraokeTrack,
  type KaraokeCaptureResources,
  type KaraokeImportFile,
} from './adapter';
import type { KaraokeUiError } from './ui';

export type KaraokeSessionStatus = 'loading' | 'idle' | 'requesting' | 'singing' | 'paused' | 'complete' | 'failed';

interface KaraokeResourceState extends KaraokeCaptureResources {
  audio?: HTMLAudioElement | null;
  analyser?: AnalyserNode | null;
  microphoneListeners?: readonly (() => void)[];
}

class AccompanimentStartError extends Error {}

interface UseKaraokeSessionOptions {
  track?: Track;
  readLyrics(track: Track): Promise<RawLyrics | null>;
}

function microphoneError(error: unknown): KaraokeUiError {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return {code: 'MIC_PERMISSION_DENIED', message: '麦克风权限被拒绝。请在系统或浏览器设置中允许麦克风后重试。', recoverable: true};
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return {code: 'MIC_NOT_FOUND', message: '没有找到可用的麦克风。请连接麦克风后重试。', recoverable: true};
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return {code: 'MIC_BUSY', message: '麦克风当前无法读取，可能被其他应用占用。', recoverable: true};
    }
  }
  return {
    code: 'MIC_FAILED',
    message: error instanceof Error ? error.message : '无法启动麦克风',
    recoverable: true,
  };
}

function releaseMicrophoneCapture(resources: KaraokeResourceState): void {
  for (const remove of resources.microphoneListeners ?? []) {
    try { remove(); } catch {}
  }
  resources.microphoneListeners = [];
  for (const node of resources.nodes ?? []) {
    try { node?.disconnect(); } catch {}
  }
  for (const mediaTrack of resources.stream?.getTracks() ?? []) {
    try { mediaTrack.stop(); } catch {}
  }
  if (resources.context) {
    try {
      const closing = resources.context.close();
      if (closing && typeof closing.catch === 'function') void closing.catch(() => {});
    } catch {}
  }
  resources.stream = null;
  resources.nodes = [];
  resources.context = null;
  resources.analyser = null;
}

export function useKaraokeSession({track, readLyrics}: UseKaraokeSessionOptions) {
  const [sessionTrack] = useState<Track | undefined>(() => track ? {...track} : undefined);
  const [descriptor, setDescriptor] = useState<KaraokeTrackDescriptor | null>(null);
  const descriptorRef = useRef<KaraokeTrackDescriptor | null>(null);
  const [status, setStatus] = useState<KaraokeSessionStatus>('loading');
  const [error, setError] = useState<KaraokeUiError | null>(null);
  const [result, setResult] = useState<KaraokeScore | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [latestFrame, setLatestFrame] = useState<PitchFrame | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [microphoneGranted, setMicrophoneGranted] = useState(false);
  const framesRef = useRef<PitchFrame[]>([]);
  const resourcesRef = useRef<KaraokeResourceState | null>(null);
  const timerPointerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const finishingRef = useRef(false);
  const audioElapsedRef = useRef(0);
  const activeStartedAtRef = useRef(0);
  const finishRef = useRef<() => void>(() => {});
  const readLyricsRef = useRef(readLyrics);
  readLyricsRef.current = readLyrics;

  const updateDescriptor = useCallback((value: KaraokeTrackDescriptor | null) => {
    descriptorRef.current = value;
    setDescriptor(value);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerPointerRef.current !== null) {
      clearInterval(timerPointerRef.current);
      timerPointerRef.current = null;
    }
    if (resourcesRef.current) resourcesRef.current.timer = null;
  }, []);

  const releaseResources = useCallback(() => {
    clearTimer();
    const resources = resourcesRef.current;
    resourcesRef.current = null;
    if (resources) {
      releaseKaraokeCapture({
        ...resources,
        listeners: [
          ...(resources.listeners ?? []),
          ...(resources.microphoneListeners ?? []),
        ],
      });
    }
    if (mountedRef.current) setMicrophoneGranted(false);
  }, [clearTimer]);

  useEffect(() => {
    let alive = true;
    void(async() => {
      if (!sessionTrack) {
        setStatus('idle');
        return;
      }
      try {
        const rawLyrics = await readLyricsRef.current(sessionTrack);
        const resolved = await resolveKaraokeTrack(sessionTrack, rawLyrics);
        if (!alive) return;
        if (!resolved.ok) {
          setError({code: resolved.error.code, message: resolved.error.message, recoverable: false});
          setStatus('failed');
          return;
        }
        updateDescriptor(resolved.value);
        setSourceLabel(resolved.value.pitchTrack?.lines.some((line) => line.notes.length > 0)
          ? `歌曲自带 ${resolved.value.pitchTrack.source} 音高参考`
          : '未检测到可信音高轨');
        setStatus('idle');
      } catch (cause) {
        if (!alive) return;
        setError({
          code: 'LYRICS_READ_FAILED',
          message: cause instanceof Error ? cause.message : '无法读取当前歌曲歌词',
          recoverable: true,
        });
        setStatus('failed');
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionTrack, updateDescriptor]);

  const finish = useCallback(() => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    clearTimer();
    const current = descriptorRef.current;
    const score = scoreKaraoke({
      pitchFrames: framesRef.current.slice(),
      ...(current?.pitchTrack ? {pitchTrack: current.pitchTrack} : {}),
      recognizedLyrics: [],
    });
    releaseResources();
    if (!mountedRef.current) return;
    setResult(score);
    setStatus('complete');
    finishingRef.current = false;
  }, [clearTimer, releaseResources]);
  finishRef.current = finish;

  const startTimer = useCallback(() => {
    clearTimer();
    const resources = resourcesRef.current;
    const analyser = resources?.analyser;
    const context = resources?.context as AudioContext | null | undefined;
    if (!resources) return;
    const samples = analyser ? new Float32Array(analyser.fftSize) : null;
    activeStartedAtRef.current = performance.now();
    const timer = setInterval(() => {
      const liveResources = resourcesRef.current;
      if (!liveResources) return;
      const audio = liveResources.audio;
      const elapsed = audio
        ? Math.max(0, audio.currentTime * 1000)
        : audioElapsedRef.current + Math.max(0, performance.now() - activeStartedAtRef.current);
      const liveAnalyser = liveResources.analyser;
      if (liveAnalyser && samples && context) {
        liveAnalyser.getFloatTimeDomainData(samples);
        const frame = analyzePitchSamples(samples, context.sampleRate, elapsed);
        framesRef.current.push(frame);
        if (mountedRef.current) setLatestFrame(frame);
      }
      if (mountedRef.current) {
        setElapsedMs(elapsed);
      }
      const duration = descriptorRef.current?.durationMs ?? 0;
      if (duration > 0 && elapsed >= duration) finishRef.current();
    }, 50);
    timerPointerRef.current = timer;
    resources.timer = timer;
  }, [clearTimer]);

  const start = useCallback(async () => {
    const current = descriptorRef.current;
    if (!current?.pitchTrack?.lines.length) {
      setError({code: 'LYRICS_REQUIRED', message: '当前歌曲没有可显示的逐句歌词，请先导入带音高的参考文件。', recoverable: false});
      setStatus('failed');
      return;
    }
    releaseResources();
    finishingRef.current = false;
    framesRef.current = [];
    audioElapsedRef.current = 0;
    setElapsedMs(0);
    setLatestFrame(null);
    setResult(null);
    setError(null);
    setStatus('requesting');

    const resources: KaraokeResourceState = {};
    resourcesRef.current = resources;
    try {
      const uri = current.accompaniment.uri;
      let hasAccompaniment = false;
      if (!uri.startsWith('unavailable:')) {
        hasAccompaniment = true;
        const audio = new Audio(uri);
        resources.audio = audio;
        audio.preload = 'auto';
        audio.volume = 0.8;
        const ended = () => finishRef.current();
        const mediaError = () => {
          if (!mountedRef.current) return;
          setError({code: 'ACCOMPANIMENT_FAILED', message: '独立伴奏无法播放。普通播放器未被修改，请检查音频连接后重试。', recoverable: true});
          releaseResources();
          setStatus('failed');
        };
        audio.addEventListener('ended', ended);
        audio.addEventListener('error', mediaError);
        resources.listeners = [
          ...(resources.listeners ?? []),
          () => audio.removeEventListener('ended', ended),
          () => audio.removeEventListener('error', mediaError),
        ];
        try {
          await audio.play();
        } catch {
          throw new AccompanimentStartError('独立伴奏无法播放。麦克风已释放，普通播放器未被修改。');
        }
      }

      let microphoneFailure: KaraokeUiError | null = null;
      try {
        if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
          throw new Error('当前环境不支持麦克风实时音高分析');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        resources.stream = stream;
        if (!mountedRef.current || resourcesRef.current !== resources) {
          releaseResources();
          return;
        }
        const context = new AudioContext();
        resources.context = context;
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0.2;
        source.connect(analyser);
        resources.nodes = [source, analyser];
        resources.analyser = analyser;
        await context.resume();
        if (!mountedRef.current || resourcesRef.current !== resources) {
          releaseResources();
          return;
        }
        for (const mediaTrack of stream.getTracks()) {
          const unreadable = () => {
            if (!mountedRef.current) return;
            releaseMicrophoneCapture(resources);
            setMicrophoneGranted(false);
            setError({code: 'MIC_ENDED', message: '麦克风已断开；独立伴奏仍会继续，这一轮不再评分。', recoverable: true});
          };
          mediaTrack.addEventListener('ended', unreadable);
          resources.microphoneListeners = [
            ...(resources.microphoneListeners ?? []),
            () => mediaTrack.removeEventListener('ended', unreadable),
          ];
        }
      } catch (cause) {
        microphoneFailure = microphoneError(cause);
        releaseMicrophoneCapture(resources);
      }

      if (!hasAccompaniment && microphoneFailure) {
        releaseResources();
        if (!mountedRef.current) return;
        setError(microphoneFailure);
        setStatus('failed');
        return;
      }
      if (!mountedRef.current || resourcesRef.current !== resources) {
        releaseResources();
        return;
      }
      setMicrophoneGranted(!microphoneFailure);
      setError(microphoneFailure);
      setStatus('singing');
      startTimer();
    } catch (cause) {
      if (resourcesRef.current === resources) releaseResources();
      if (!mountedRef.current) return;
      setError(cause instanceof AccompanimentStartError
        ? {code: 'ACCOMPANIMENT_FAILED', message: cause.message, recoverable: true}
        : microphoneError(cause));
      setStatus('failed');
    }
  }, [releaseResources, startTimer]);

  const pause = useCallback(() => {
    if (status !== 'singing') return;
    clearTimer();
    const audio = resourcesRef.current?.audio;
    if (audio) {
      audio.pause();
      audioElapsedRef.current = audio.currentTime * 1000;
    } else {
      audioElapsedRef.current += Math.max(0, performance.now() - activeStartedAtRef.current);
    }
    setElapsedMs(audioElapsedRef.current);
    setStatus('paused');
  }, [clearTimer, status]);

  const resume = useCallback(async() => {
    if (status !== 'paused') return;
    setError(null);
    try {
      const audio = resourcesRef.current?.audio;
      if (audio) await audio.play();
      activeStartedAtRef.current = performance.now();
      setStatus('singing');
      startTimer();
    } catch (cause) {
      setError({
        code: 'RESUME_FAILED',
        message: cause instanceof Error ? cause.message : '无法继续独立伴奏',
        recoverable: true,
      });
    }
  }, [startTimer, status]);

  const importPitchReference = useCallback(async(file: KaraokeImportFile) => {
    if (!sessionTrack) {
      setError({code: 'TRACK_REQUIRED', message: '请先选择一首歌曲', recoverable: false});
      return false;
    }
    const resolved = await importKaraokePitchReference(file, sessionTrack);
    if (!resolved.ok) {
      setError({code: resolved.error.code, message: resolved.error.message, recoverable: false});
      return false;
    }
    updateDescriptor(resolved.value);
    setSourceLabel(`已载入 ${file.name}`);
    setResult(null);
    setElapsedMs(0);
    setLatestFrame(null);
    setError(null);
    setStatus('idle');
    return true;
  }, [sessionTrack, updateDescriptor]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseResources();
    };
  }, [releaseResources]);

  return {
    descriptor,
    sessionTrack,
    status,
    error,
    result,
    elapsedMs,
    latestFrame,
    sourceLabel,
    microphoneGranted,
    dismissError: () => setError(null),
    start,
    pause,
    resume,
    finish,
    importPitchReference,
  };
}
