import {useCallback, useEffect, useRef, useState} from 'react';
import type {RawLyrics, Track} from '../../core/types';
import {command} from '../../mobile/native';
import {KARAOKE_LIMITS, type KaraokeLineScore, type KaraokeTrackDescriptor, type KaraokeLyricLine, type PitchFrame} from './contracts';
import {scoreSoloLine, summarizeSolo, type SoloResult} from './solo-score';
import {practiceRecord, savePractice, type PracticeRecord} from './solo-history';
import {
  analyzePitchSamples,
  importKaraokePitchReference,
  releaseKaraokeCapture,
  resolveKaraokeTrack,
  type KaraokeCaptureResources,
  type KaraokeImportFile,
} from './adapter';
import {prepareSoloAudio, type SoloAudio} from './solo-audio';
import type {KaraokeUiError} from './ui';
import {setKaraokeVoiceLock} from './voice-lock';

export type KaraokeSessionStatus = 'idle' | 'requesting' | 'singing' | 'paused' | 'complete' | 'failed';
export type VocalMode = 'original' | 'instrumental';

interface Microphone extends KaraokeCaptureResources {
  stream: MediaStream;
  context: AudioContext;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
}

interface SoloRun {
  controller: AbortController;
  phase: 'requesting' | 'singing' | 'paused';
  changingPlayback: boolean;
  audio?: SoloAudio;
  audioController?: AbortController;
  mode: VocalMode;
  pausedSwitch?: {mode:VocalMode;position:number};
  checkedLines: number;
  lines: KaraokeLineScore[];
  scoreLines: readonly KaraokeLyricLine[];
  microphone?: Microphone;
  timer?: ReturnType<typeof setInterval>;
  frames: PitchFrame[];
}

async function openMicrophone(mobile: boolean, signal: AbortSignal): Promise<Microphone> {
  if (mobile) {
    const permission = await command<{permitted: boolean}>('assistant', {action: 'speechPermission'});
    if (!permission.permitted) throw new DOMException('麦克风权限未开启', 'NotAllowedError');
  }
  signal.throwIfAborted();
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
    throw Error('当前环境不支持麦克风实时音高分析');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true},
    video: false,
  });
  const capture: KaraokeCaptureResources = {stream};
  const cancel = () => {
    releaseKaraokeCapture(capture);
    Object.assign(capture, {stream: null, context: null, nodes: []});
  };
  signal.addEventListener('abort', cancel, {once: true});
  try {
    signal.throwIfAborted();
    const context = new AudioContext();
    capture.context = context;
    const source = context.createMediaStreamSource(stream);
    capture.nodes = [source];
    const analyser = context.createAnalyser();
    capture.nodes = [source, analyser];
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.2;
    source.connect(analyser);
    await context.resume();
    signal.throwIfAborted();
    return {...capture, stream, context, analyser, samples: new Float32Array(analyser.fftSize)};
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

export function useKaraokeSession({track, accompaniment, readLyrics, mobile, otherAudioPlaying = false}: {
  track?: Track;
  accompaniment?: Track;
  readLyrics(track: Track): Promise<RawLyrics | null>;
  mobile: boolean;
  otherAudioPlaying?: boolean;
}) {
  const [sessionTrack] = useState(() => track ? {...track} : undefined);
  const [descriptor, setDescriptor] = useState<KaraokeTrackDescriptor | null>(null);
  const descriptorRef = useRef<KaraokeTrackDescriptor | null>(null);
  const importedReference = useRef(false);
  const originalDescriptor = useRef<KaraokeTrackDescriptor | null>(null);
  const [status, setStatus] = useState<KaraokeSessionStatus>('idle');
  const [error, setError] = useState<KaraokeUiError | null>(null);
  const [result, setResult] = useState<SoloResult | null>(null);
  const [latestLine, setLatestLine] = useState<KaraokeLineScore | null>(null);
  const [vocalMode, setVocalMode] = useState<VocalMode | null>(null);
  const [switching, setSwitching] = useState(false);
  const [saveState,setSaveState] = useState<'idle'|'saving'|'saved'|'failed'>('idle');
  const savedRecord = useRef<PracticeRecord | null>(null);
  const pendingSave = useRef(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [latestFrame, setLatestFrame] = useState<PitchFrame | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [microphoneGranted, setMicrophoneGranted] = useState(false);
  const [microphonePending, setMicrophonePending] = useState(false);
  const [audioProgress, setAudioProgress] = useState('');
  const active = useRef<SoloRun | null>(null);
  const mounted = useRef(false);
  const readLyricsRef = useRef(readLyrics);
  readLyricsRef.current = readLyrics;
  const otherAudio = useRef(otherAudioPlaying);
  otherAudio.current = otherAudioPlaying;

  useEffect(() => {
    if (!sessionTrack) return;
    let alive = true;
    void (async () => {
      const lyrics = await readLyricsRef.current(sessionTrack).catch(() => null);
      const resolved = await resolveKaraokeTrack(sessionTrack, lyrics);
      if (!alive) return;
      originalDescriptor.current = resolved.ok ? resolved.value : null;
      if (importedReference.current) return;
      if (resolved.ok) {
        descriptorRef.current = resolved.value;
        setDescriptor(resolved.value);
        const pitch = resolved.value.pitchTrack;
        setSourceLabel(pitch?.lines.some(line => line.notes.length > 0)
          ? `歌曲自带 ${pitch.source} 音高参考`
          : '未检测到音高参考');
      } else {
        setSourceLabel('当前歌曲缺少可用于评分的资料');
      }
    })();
    return () => {alive = false;};
  }, [sessionTrack]);

  const release = useCallback((run: SoloRun) => {
    if (active.current !== run) return;
    active.current = null;
    run.controller.abort();
    run.audioController?.abort();
    clearInterval(run.timer);
    run.audio?.dispose();
    if (run.microphone) releaseKaraokeCapture(run.microphone);
    setKaraokeVoiceLock(false, mobile);
    if (mounted.current) {
      setMicrophoneGranted(false);
      setMicrophonePending(false);
      setAudioProgress('');
      setSwitching(false);
    }
  }, [mobile]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (active.current) release(active.current);
    };
  }, [release]);

  const scoreThrough = useCallback((run: SoloRun, elapsed: number) => {
    const lines = run.scoreLines;
    while (run.checkedLines < lines.length && lines[run.checkedLines].endMs <= elapsed) {
      const score = scoreSoloLine(lines[run.checkedLines++],run.frames);
      if (score) {run.lines.push(score); setLatestLine(score);}
    }
  }, []);

  const persist = useCallback(() => {
    const record = savedRecord.current;
    if (!record || pendingSave.current) return;
    pendingSave.current = true;
    setSaveState('saving');
    const settle = (value: 'saved'|'failed') => {
      if (savedRecord.current !== record) return;
      pendingSave.current = false;
      if (mounted.current) setSaveState(value);
    };
    void savePractice(record).then(() => settle('saved'),() => settle('failed'));
  }, []);

  const finishRun = useCallback((run: SoloRun, positionMs: number) => {
    if (active.current !== run) return;
    release(run);
    if (run.phase === 'requesting') {
      setStatus('idle');
      return;
    }
    setElapsedMs(positionMs);
    scoreThrough(run,positionMs + 50);
    const summary = summarizeSolo(run.scoreLines,run.lines);
    setResult(summary);
    if (summary && sessionTrack) {
      savedRecord.current = practiceRecord(sessionTrack,summary);
      pendingSave.current = false;
      persist();
    }
    setStatus('complete');
  }, [persist,release,scoreThrough,sessionTrack]);

  const fail = useCallback((run: SoloRun, message: string) => {
    if (active.current !== run) return;
    release(run);
    setError({code: 'ACCOMPANIMENT_FAILED', message, recoverable: true});
    setStatus('failed');
  }, [release]);

  const startTimer = useCallback((run: SoloRun) => {
    run.timer = setInterval(() => {
      const position = run.audio?.position();
      if (!position || active.current !== run || run.changingPlayback) return;
      setElapsedMs(position.ms);
      const microphone = run.microphone;
      if (!position.playing) return;
      if (microphone && run.mode === 'instrumental' && run.scoreLines.length && !otherAudio.current) {
        microphone.analyser.getFloatTimeDomainData(microphone.samples);
        const frame = analyzePitchSamples(microphone.samples, microphone.context.sampleRate, position.ms);
        if (run.frames.length < KARAOKE_LIMITS.maxPitchFrames && frame.atMs > (run.frames.at(-1)?.atMs ?? -1)) run.frames.push(frame);
        setLatestFrame(frame);
      }
      scoreThrough(run,position.ms - 150);
    }, 50);
  }, [scoreThrough]);

  const prepareAudio = useCallback(async (run: SoloRun, selected: Track, positionMs: number, mode:VocalMode) => {
    run.audioController?.abort();
    run.audio?.dispose();
    run.audio = undefined;
    const controller = new AbortController();
    run.audioController = controller;
    const current = () => active.current === run && !controller.signal.aborted;
    const audio = await prepareSoloAudio(selected,mobile,controller.signal,{
      ended: ms => {if (current()) finishRun(run,ms);},
      stopped: () => {if (current() && !run.changingPlayback) fail(run,'练唱音频已停止，可以重新开始。');},
      failed: message => {if (current() && !run.changingPlayback) fail(run,message);},
      progress: progress => {if (current()) setAudioProgress(progress.message);},
      playing: () => {if (current()) setAudioProgress('');},
    },positionMs,mode === 'instrumental');
    if (!current()) {audio.dispose();controller.signal.throwIfAborted(); throw Error('已取消');}
    run.audio = audio;
    return audio;
  }, [fail,finishRun,mobile]);

  const start = useCallback(async (scoreAllowed = false) => {
    if (!sessionTrack || active.current) return;
    const mode = accompaniment ? vocalMode ?? 'instrumental' : 'original';
    const selected = mode === 'instrumental' ? accompaniment : sessionTrack;
    if (!selected) return;
    const scoreLines = scoreAllowed && accompaniment && importedReference.current ? descriptorRef.current?.pitchTrack?.lines ?? [] : [];
    const run: SoloRun = {controller:new AbortController(),phase:'requesting',changingPlayback:false,frames:[],mode,checkedLines:0,lines:[],scoreLines};
    active.current = run;
    const {signal} = run.controller;
    setElapsedMs(0);
    setLatestFrame(null);
    setResult(null);
    setLatestLine(null);
    savedRecord.current = null;
    pendingSave.current = false;
    setSaveState('idle');
    setError(null);
    setAudioProgress('正在加载练唱音频');
    setStatus('requesting');
    try {
      const audio = await prepareAudio(run,selected,0,mode);
      if (signal.aborted) return;
      setKaraokeVoiceLock(true, mobile);
      setMicrophonePending(true);
      const connectMicrophone = async () => {
        try {
          const microphone = await openMicrophone(mobile, signal);
          if (signal.aborted) {
            releaseKaraokeCapture(microphone);
            return;
          }
          run.microphone = microphone;
          const onEnded = () => {
            if (active.current !== run || run.microphone !== microphone) return;
            run.microphone = undefined;
            releaseKaraokeCapture(microphone);
            setLatestFrame(null);
            setMicrophoneGranted(false);
            setError({code: 'MIC_ENDED', message: '麦克风已断开，仍可跟唱，本轮不计分。', recoverable: true});
          };
          microphone.listeners = microphone.stream.getAudioTracks().map(input => {
            input.addEventListener('ended', onEnded);
            return () => input.removeEventListener('ended', onEnded);
          });
          setMicrophoneGranted(true);
        } catch (cause) {
          if (signal.aborted) return;
          const reason = cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? '请在系统设置中允许麦克风权限。'
            : '请检查麦克风是否已接入或正被占用。';
          setError({code: 'MIC_UNAVAILABLE', message: `麦克风未开启，仍可跟唱，本轮不计分。${reason}`, recoverable: true});
        } finally {
          if (active.current === run) setMicrophonePending(false);
        }
      };
      if (mobile) await connectMicrophone();
      else void connectMicrophone();
      if (signal.aborted) return;
      await audio.play();
      if (signal.aborted) return;
      run.phase = 'singing';
      setStatus('singing');
      startTimer(run);
    } catch (cause) {
      fail(run, cause instanceof Error ? cause.message : '无法启动练唱音频。');
    }
  }, [accompaniment,fail,mobile,prepareAudio,sessionTrack,startTimer,vocalMode]);

  const changeVocalMode = useCallback(async (mode: VocalMode) => {
    const target = mode === 'instrumental' ? accompaniment : sessionTrack;
    if (!target || !sessionTrack) return;
    const run = active.current;
    if (!run) {setVocalMode(mode);return;}
    if (!run.audio || run.phase === 'requesting' || run.changingPlayback || run.mode === mode) return;
    const wasPlaying = run.phase === 'singing';
    const oldMode = run.mode;
    const position = run.audio.position().ms;
    run.changingPlayback = true;
    setSwitching(true);
    setAudioProgress('正在切换音轨，从当前进度继续');
    try {
      const audio = await prepareAudio(run,target,position,mode);
      if (wasPlaying) await audio.play();
      if (active.current !== run) return;
      if (!wasPlaying) {
        if (run.pausedSwitch?.mode === mode) run.pausedSwitch = undefined;
        else run.pausedSwitch ??= {mode:oldMode,position};
      }
      run.mode = mode;
      setLatestFrame(null);
      setVocalMode(mode);
    } catch {
      if (active.current !== run) return;
      try {
        const previous = oldMode === 'instrumental' ? accompaniment : sessionTrack;
        if (!previous) throw Error('原音轨不可用');
        const audio = await prepareAudio(run,previous,position,oldMode);
        if (wasPlaying) await audio.play();
        if (active.current === run) setError({code:'VOCAL_SWITCH_FAILED',message:'切换失败，已恢复刚才的音轨。',recoverable:false});
      } catch (cause) {fail(run,cause instanceof Error ? cause.message : '无法恢复之前的音轨。');}
    } finally {
      run.changingPlayback = false;
      if (active.current === run) {setSwitching(false);setAudioProgress('');}
    }
  }, [accompaniment,fail,prepareAudio,sessionTrack]);

  const changePlayback = useCallback(async (next: 'singing' | 'paused') => {
    const run = active.current;
    if (!run?.audio || run.phase === 'requesting' || run.phase === next || run.changingPlayback) return;
    run.changingPlayback = true;
    try {
      if (next === 'paused') await run.audio.pause();
      else {
        if (!mobile) setAudioProgress('正在从暂停处继续播放');
        try {await run.audio.play();}
        catch (cause) {
          const previous = run.pausedSwitch;
          const previousTrack = previous?.mode === 'instrumental' ? accompaniment : sessionTrack;
          if (!previous || !previousTrack || active.current !== run) throw cause;
          const fallback = await prepareAudio(run,previousTrack,previous.position,previous.mode);
          await fallback.play();
          if (active.current !== run) return;
          run.mode = previous.mode;
          setVocalMode(previous.mode);
          setError({code:'VOCAL_SWITCH_FAILED',message:'选定的音轨无法继续，已恢复刚才的音轨。',recoverable:false});
        }
        run.pausedSwitch = undefined;
      }
      if (active.current !== run) return;
      run.phase = next;
      setStatus(next);
      if (next === 'paused') {
        clearInterval(run.timer);
        setElapsedMs(run.audio.position().ms);
      } else {
        startTimer(run);
      }
    } catch (cause) {
      fail(run, cause instanceof Error ? cause.message : '无法控制练唱音频。');
    } finally {
      run.changingPlayback = false;
    }
  }, [accompaniment,fail,mobile,prepareAudio,sessionTrack,startTimer]);

  useEffect(() => {
    if (!mobile) return;
    const onVisibility = () => {
      const run = active.current;
      if (document.hidden && run && run.phase !== 'requesting') {
        finishRun(run, run.audio?.position().ms ?? 0);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [finishRun, mobile]);

  const applyPitchReference = useCallback((descriptor: KaraokeTrackDescriptor,label:string) => {
    if (!mounted.current || active.current) return false;
    importedReference.current = true;
    descriptorRef.current = descriptor;
    setDescriptor(descriptor);
    setSourceLabel(label);
    setResult(null);
    setElapsedMs(0);
    setLatestFrame(null);
    setError(null);
    setStatus('idle');
    return true;
  },[]);

  const clearPitchReference = useCallback(() => {
    if (active.current || !importedReference.current) return;
    importedReference.current = false;
    descriptorRef.current = originalDescriptor.current;
    setDescriptor(originalDescriptor.current);
    setSourceLabel('请选择与当前伴奏对齐的曲谱');
  },[]);

  const importPitchReference = async (file: KaraokeImportFile, signal?: AbortSignal) => {
    if (!sessionTrack || active.current || signal?.aborted) return false;
    const resolved = await importKaraokePitchReference(file, sessionTrack);
    if (!mounted.current || active.current || signal?.aborted) return false;
    if (!resolved.ok) {
      setError({code: resolved.error.code, message: resolved.error.message, recoverable: false});
      return false;
    }
    return applyPitchReference(resolved.value,`已载入 ${file.name}`);
  };

  return {
    descriptor,
    sessionTrack,
    status,
    error,
    result,
    elapsedMs,
    latestFrame,
    pitchTrail: status === 'singing' && active.current?.mode === 'instrumental' ? active.current.frames.slice(-120) : [],
    latestLine,
    sourceLabel,
    microphoneGranted,
    microphonePending,
    audioProgress,
    vocalMode:vocalMode ?? (accompaniment ? 'instrumental' : 'original'),
    changeVocalMode,
    resetVocalMode: () => setVocalMode(null),
    switching,
    saveState,
    retrySave:persist,
    dismissError: () => setError(null),
    start,
    pause: () => changePlayback('paused'),
    resume: () => changePlayback('singing'),
    finish: () => {
      const run = active.current;
      if (run) finishRun(run, run.audio?.position().ms ?? 0);
    },
    importPitchReference,
    applyPitchReference,
    clearPitchReference,
  };
}
