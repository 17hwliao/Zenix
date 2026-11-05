import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {isAndroid, isNativeMobile, observeAssistantVoice} from '../../mobile/native';
import {speechChunks} from './speechText';
import {HoldRecording} from './recording';
import SkinCharacter from './SkinCharacter';
import {getAssistantRuntime} from './remote/runtime';
import ModelSettings from './remote/ModelSettings';
import SessionContent, {remoteCharacterPhase} from './remote/SessionContent';
import {resultSummaryLines} from './remote/presentation';
import './conversation.css';

type Invoke = <T = unknown>(args: Record<string, unknown>) => Promise<T>;
type RecordingSession = {
  token: string;
  held: boolean;
  source: 'pointer' | 'keyboard';
  recording?: InstanceType<typeof HoldRecording>;
  native: boolean;
};
type Phase = 'idle' | 'preparing' | 'listening' | 'thinking' | 'executing' | 'talking'
  | 'shy' | 'greeting' | 'cheer' | 'success' | 'failure';

/** Text, held speech and character entrances all submit to the same lifetime coordinator. */
export default function AssistantConversation({mobile = false, invoke: provided, execute}: {
  mobile?: boolean;
  invoke?: Invoke;
  execute?: (action: string, args: Record<string, unknown>) => Promise<unknown>;
}) {
  const runtime = useMemo(() => getAssistantRuntime(mobile, provided, execute), [mobile, provided, execute]);
  const {session, invoke} = runtime;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [voiceMessage, setVoiceMessage] = useState<string>();
  const [spoken, setSpoken] = useState(() => {
    try { return localStorage.getItem('zenix.assistant.spoken.v1') !== 'false'; }
    catch { return true; }
  });
  const active = useRef<RecordingSession | undefined>(undefined);
  const phaseRef = useRef<Phase>('idle');
  const revision = useRef(0);
  const alive = useRef(true);
  const pointerY = useRef(0);
  const reaction = useRef(0);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const speech = useRef<{stop?: () => void} | undefined>(undefined);
  const lastSpoken = useRef(snapshot.result);
  const native = mobile && isAndroid && isNativeMobile;

  const experience = useCallback((state: Phase, message?: string) => {
    if (!alive.current) return;
    phaseRef.current = state;
    setPhase(state);
    setVoiceMessage(message);
    window.dispatchEvent(new CustomEvent('zenix-assistant-state', {detail: {state, text: message}}));
    if (!mobile) void invoke({operation: 'assistant', action: 'feedback', state, text: message || ''}).catch(() => {});
  }, [invoke, mobile]);

  const silence = useCallback(() => {
    const previous = speech.current;
    speech.current = undefined;
    previous?.stop?.();
    if (native) void invoke({operation: 'assistant', action: 'speechSilence'}).catch(() => {});
    else if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  }, [native, invoke]);

  const answer = useCallback((message: string, emotion: Phase, token: number, messages: string[] = []) => {
    if (!alive.current || token !== revision.current) return;
    experience(emotion, message);
    if (!spoken) return;
    const output: {stop?: () => void} = {};
    speech.current?.stop?.();
    speech.current = output;
    const valid = () => alive.current && token === revision.current && speech.current === output;
    void (async () => {
      experience(emotion === 'shy' ? 'shy' : 'talking', message);
      try {
        for (const part of speechChunks([message, ...messages])) {
          if (!valid()) return;
          if (native) {
            const value = await invoke<{spoken: boolean}>({operation: 'assistant', action: 'speechSpeak', text: part});
            if (!valid()) return;
            if (!value.spoken) throw Error('系统语音不可用');
          } else {
            if (typeof speechSynthesis === 'undefined') throw Error('系统语音不可用');
            await new Promise<void>((resolve, reject) => {
              const utterance = new SpeechSynthesisUtterance(part);
              utterance.lang = 'zh-CN';
              utterance.rate = 1.04;
              const voice = speechSynthesis.getVoices().find(item => /^zh/i.test(item.lang));
              if (voice) utterance.voice = voice;
              output.stop = resolve;
              utterance.onend = () => {output.stop = undefined; resolve();};
              utterance.onerror = () => {output.stop = undefined; reject(Error('语音回复未完成'));};
              speechSynthesis.speak(utterance);
            });
          }
        }
        if (valid()) experience(emotion, message);
      } catch {
        if (valid()) experience(emotion, message + '（语音回复未完成，文字结果已保留）');
      } finally {
        if (speech.current === output) speech.current = undefined;
      }
    })();
  }, [spoken, native, invoke, experience]);

  useEffect(() => {
    if (active.current) return;
    const mood = remoteCharacterPhase(snapshot.status) as Phase;
    if (snapshot.result && snapshot.result !== lastSpoken.current) {
      lastSpoken.current = snapshot.result;
      answer(snapshot.message, mood, revision.current, snapshot.result.speech || resultSummaryLines(snapshot.result));
    } else if (!speech.current) experience(mood);
  }, [snapshot.status, snapshot.message, snapshot.result, answer, experience]);

  const stopRecording = useCallback(() => {
    const recording = active.current;
    active.current = undefined;
    recording?.recording?.cancel();
    if (recording) void invoke({operation: 'assistant', action: 'speechCancel', token: recording.token}).catch(() => {});
    session.setListening(false);
  }, [invoke, session]);

  const cancel = useCallback(() => {
    revision.current++;
    stopRecording();
    silence();
    session.cancel();
    experience('idle');
  }, [session, stopRecording, silence, experience]);

  const accept = useCallback(async (value: {transcript: string; confidence?: number}, token = ++revision.current) => {
    if (!alive.current || token !== revision.current) return;
    silence();
    setOpen(true);
    setText(value.transcript);
    setVoiceMessage(undefined);
    session.setListening(false);
    const confidence = value.confidence === undefined || value.confidence < 0 ? .5 : value.confidence;
    await session.submit(value.transcript, confidence);
  }, [session, silence]);

  const begin = useCallback(async (source: 'pointer' | 'keyboard') => {
    if (active.current || session.getSnapshot().busy) return;
    clearTimeout(reactionTimer.current);
    silence();
    const token = ++revision.current;
    const recording: RecordingSession = {token: crypto.randomUUID(), held: true, source, native};
    active.current = recording;
    setOpen(true);
    experience('preparing', '正在准备麦克风，请在提示“正在听”后说话…');
    try {
      if (native) {
        const permission = await invoke<{permitted: boolean}>({operation: 'assistant', action: 'speechPermission'});
        if (active.current !== recording || !recording.held) return;
        if (!permission.permitted) throw Error('未允许麦克风，请授权后再按住说话');
        void invoke<{transcript: string; confidence?: number}>({
          operation: 'assistant', action: 'speechBegin', token: recording.token,
        }).then(value => {
          if (active.current !== recording || token !== revision.current) return;
          active.current = undefined;
          void accept(value, token);
        }).catch(error => {
          if (active.current === recording && token === revision.current) {
            active.current = undefined;
            session.setListening(false);
            experience('failure', error instanceof Error ? error.message : '语音识别失败');
          }
        });
        return;
      }
      recording.recording = new HoldRecording();
      const ready = await recording.recording.start();
      if (active.current !== recording || !recording.held) {recording.recording.cancel(); return;}
      if (ready) {
        session.setListening(true);
        experience('listening', '正在听 · 松开发送，Escape 取消');
      }
    } catch (error) {
      if (active.current === recording) {
        active.current = undefined;
        recording.recording?.cancel();
        session.setListening(false);
        experience('failure', error instanceof Error ? error.message : '麦克风未能启动');
      }
    }
  }, [native, invoke, session, silence, experience, accept]);

  const release = useCallback(async () => {
    const recording = active.current;
    if (!recording?.held) return;
    recording.held = false;
    if (phaseRef.current === 'preparing') {
      revision.current++;
      stopRecording();
      experience('idle', '已取消录音。');
      return;
    }
    const token = revision.current;
    experience('thinking', '已松开，正在识别这句话…');
    try {
      if (recording.native) {
        await invoke({operation: 'assistant', action: 'speechStop', token: recording.token});
        return;
      }
      const wav = recording.recording!.finish();
      const value = await invoke<{transcript: string; confidence?: number}>({
        operation: 'assistant', action: 'speechRecognize', token: recording.token, wav,
      });
      if (active.current !== recording || token !== revision.current) return;
      active.current = undefined;
      await accept(value, token);
    } catch (error) {
      if (active.current === recording && token === revision.current) {
        active.current = undefined;
        session.setListening(false);
        experience('failure', error instanceof Error ? error.message : '语音识别失败');
      }
    }
  }, [invoke, session, stopRecording, experience, accept]);

  const handlers = useRef({begin, release, cancel, accept});
  handlers.current = {begin, release, cancel, accept};
  useEffect(() => {
    alive.current = true;
    runtime.attach();
    let removeVoice: (() => void) | undefined;
    if (native) void observeAssistantVoice(value => {
      const recording = active.current;
      if (!recording || recording.token !== value.token || !recording.held) return;
      if (value.phase === 'listening') {
        session.setListening(true);
        experience('listening', '正在听 · 松开发送，上滑取消');
      } else if (value.phase === 'captured') experience('thinking', '系统已收好这句话，松开发送；也可取消后重说。');
    }).then(handle => {
      if (!alive.current) void handle.remove();
      else removeVoice = () => {void handle.remove();};
    }).catch(() => {});
    const blur = () => {
      if (active.current) {revision.current++; stopRecording(); experience('idle');}
    };
    const hidden = () => {if (document.hidden) {blur(); silence();}};
    const down = (event: KeyboardEvent) => {
      const state = session.getSnapshot();
      if (event.key === 'Escape' && (active.current || state.busy || state.confirmation || speech.current)) {
        event.preventDefault(); event.stopImmediatePropagation(); handlers.current.cancel(); return;
      }
      if (mobile || event.code !== 'Space' || event.altKey || event.ctrlKey || event.metaKey
        || event.shiftKey || event.isComposing) return;
      if (event.target instanceof Element
        && event.target.closest('input,textarea,select,[contenteditable="true"],button,a,[role="button"],[role="slider"]')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) void handlers.current.begin('keyboard');
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || active.current?.source !== 'keyboard') return;
      event.preventDefault(); event.stopImmediatePropagation(); void handlers.current.release();
    };
    const request = () => setOpen(true);
    const input = (event: Event) => {
      if (active.current) return;
      void handlers.current.accept({transcript: String((event as CustomEvent).detail?.text || ''), confidence: 1});
    };
    const cancelRequest = () => handlers.current.cancel();
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('zenix-assistant-conversation', request);
    window.addEventListener('zenix-assistant-input', input);
    window.addEventListener('zenix-assistant-cancel', cancelRequest);
    const startStop = mobile ? undefined : window.yzqxy?.companion?.onVoiceStart?.(() => {blur(); silence();});
    const stop = mobile ? undefined : window.yzqxy?.companion?.onVoice?.(value => {
      if (!active.current) void handlers.current.accept(value);
    });
    return () => {
      alive.current = false;
      revision.current++;
      stopRecording();
      silence();
      clearTimeout(reactionTimer.current);
      removeVoice?.(); stop?.(); startStop?.();
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('zenix-assistant-conversation', request);
      window.removeEventListener('zenix-assistant-input', input);
      window.removeEventListener('zenix-assistant-cancel', cancelRequest);
      runtime.detach();
    };
  }, [runtime, session, mobile, native, invoke, experience, stopRecording, silence]);

  const closePanel = () => {
    if (active.current) {revision.current++; stopRecording();}
    setOpen(false);
  };
  const confirm = async (token: string) => {
    silence(); revision.current++; setVoiceMessage(undefined); await session.confirm(token);
  };
  const choose = async (ref: string) => {
    silence(); revision.current++; setVoiceMessage(undefined); await session.chooseCandidate(ref);
  };
  const shy = () => {
    if (active.current || snapshot.busy) return;
    silence();
    const token = ++revision.current;
    const mood = (['shy', 'greeting', 'cheer'] as const)[reaction.current++ % 3];
    answer(mood === 'shy' ? '突然被你碰到，有一点害羞……' : mood === 'greeting'
      ? '你好呀，星音在这里。' : '和你一起听歌很开心！', mood, token);
    clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => {
      if (token === revision.current) experience(remoteCharacterPhase(session.getSnapshot().status) as Phase);
    }, 3500);
  };
  const shown = voiceMessage ? {...snapshot, message: voiceMessage} : snapshot;
  const microphoneText = phase === 'listening' ? '松开发送' : phase === 'preparing' ? '准备中'
    : phase === 'thinking' && active.current ? '识别中' : snapshot.busy ? '处理中' : '按住说话';

  return <aside className={`assistant-conversation ${mobile ? 'is-mobile' : ''}`} aria-label="星音语音助手">
    {open && <section className="assistant-chat" aria-label="与星音交流">
      <header><strong>星音 · 音乐助手</strong><button aria-label="关闭语音助手" onClick={closePanel}>×</button></header>
      <div className="assistant-chat-character" data-state={phase} data-animated="true">
        <button aria-label="轻触星音：害羞回应" onClick={shy}><SkinCharacter state={phase} invoke={invoke}/></button>
        <span className="assistant-expression" aria-hidden="true">{phase === 'shy' ? '♡' : phase === 'listening' ? '•••' : phase === 'thinking' ? '⋯' : phase === 'success' ? '✦' : ''}</span>
      </div>
      <SessionContent snapshot={shown} onConfirm={confirm} onCancel={cancel} onChoose={choose}/>
      {snapshot.heard && <small>听到：“{snapshot.heard}”</small>}
      <form onSubmit={event => {
        event.preventDefault();
        if (!active.current && text.trim()) void accept({transcript: text, confidence: 1});
      }}>
        <label>你想说的话<input value={text} maxLength={4000} onChange={event => setText(event.target.value)} placeholder="例如：找一下王菲的红豆"/></label>
        <button disabled={!text.trim() || Boolean(active.current)}>发送</button>
      </form>
      {phase === 'talking' && <button onClick={() => {silence(); experience('idle', '已停止朗读，文字结果保留。');}}>停止朗读</button>}
      <label className="assistant-spoken"><input type="checkbox" checked={spoken} onChange={event => {
        setSpoken(event.target.checked);
        if (!event.target.checked) silence();
        try {localStorage.setItem('zenix.assistant.spoken.v1', String(event.target.checked));} catch {}
      }}/>语音回复</label>
      <details className="assistant-model-details"><summary>模型连接设置</summary>
        <ModelSettings mobile={mobile} transport={runtime.transport} onConfigurationChanged={()=>session.configurationChanged()}/>
      </details>
      <small>{mobile ? '按住悬浮麦克风说话，松开发送，上滑取消。' : '在应用空白处按住空格说话；输入框中的空格照常输入。'}</small>
      {(active.current || snapshot.busy) && <button onClick={cancel}>取消本次对话</button>}
    </section>}
    <div className="assistant-voice-dock">
      <button className="assistant-talk-toggle" aria-label="打开星音对话" onClick={() => open ? closePanel() : setOpen(true)}>星音</button>
      <button className="assistant-hold-voice" disabled={snapshot.busy} data-phase={phase}
        aria-label={mobile ? '按住与星音说话' : '按住说话，也可按住空格'} aria-pressed={phase === 'listening'}
        onContextMenu={event => event.preventDefault()}
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
          pointerY.current = event.clientY; void begin('pointer');
        }}
        onPointerMove={event => {if (active.current?.source === 'pointer' && pointerY.current - event.clientY > 72) cancel();}}
        onPointerUp={event => {
          if (active.current?.source === 'pointer') void release();
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={() => {if (active.current?.held && active.current.source === 'pointer') cancel();}}
        onKeyDown={event => {
          if (event.code === 'Space' || event.key === 'Enter') {
            event.preventDefault(); if (!event.repeat) void begin('keyboard');
          }
        }}
        onKeyUp={event => {if (event.code === 'Space' || event.key === 'Enter') {event.preventDefault(); void release();}}}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0014 0v-2M12 19v3M8 22h8"/></svg>
        <span>{microphoneText}</span>
      </button>
    </div>
  </aside>;
}
