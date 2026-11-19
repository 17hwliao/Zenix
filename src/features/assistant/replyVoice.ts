type Invoke = <T = unknown>(args: Record<string, unknown>) => Promise<T>;
type AudioReply = {voice: string; mimeType: string; audioBase64: string};

export async function speakReply(text: string, invoke: Invoke, signal: AbortSignal,
  options: {online: boolean; onFallback?: () => void}) {
  signal.throwIfAborted();
  if (options.online) {
    const requestId = crypto.randomUUID();
    const cancel = () => {void invoke({operation: 'assistant', action: 'speechSynthesisCancel', requestId}).catch(() => {});};
    signal.addEventListener('abort', cancel, {once: true});
    try {
      const value = await invoke<AudioReply>({operation: 'assistant', action: 'speechSynthesize', requestId, text});
      signal.throwIfAborted();
      if (value?.voice !== 'zh-CN-XiaoyiNeural' || value.mimeType !== 'audio/mpeg'
        || typeof value.audioBase64 !== 'string' || value.audioBase64.length > 2800000) throw Error('无效的在线语音');
      const bytes = Uint8Array.from(atob(value.audioBase64), char => char.charCodeAt(0));
      if (bytes.length < 100) throw Error('在线语音为空');
      const url = URL.createObjectURL(new Blob([bytes], {type: 'audio/mpeg'}));
      const audio = new Audio(url);
      try {
        await new Promise<void>((resolve, reject) => {
          let finished = false;
          const done = (error?: unknown) => {
            if (finished) return;
            finished = true;
            signal.removeEventListener('abort', stop);
            audio.onended = null;
            audio.onerror = null;
            error ? reject(error) : resolve();
          };
          const stop = () => {audio.pause();done(signal.reason || new DOMException('已停止朗读', 'AbortError'));};
          signal.addEventListener('abort', stop, {once: true});
          audio.onended = () => done();
          audio.onerror = () => done(Error('在线语音无法播放'));
          if (signal.aborted) stop();
          else void audio.play().catch(done);
        });
      } finally {audio.pause();audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);}
      return;
    } catch {
      signal.throwIfAborted();
      options.onFallback?.();
    } finally {signal.removeEventListener('abort', cancel);}
  }
  signal.throwIfAborted();
  if (typeof speechSynthesis === 'undefined') throw Error('系统语音不可用');
  await new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.04;
    const voice = speechSynthesis.getVoices().find(item => /^zh/i.test(item.lang));
    if (voice) utterance.voice = voice;
    let finished = false;
    const done = (error?: unknown) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener('abort', stop);
      utterance.onend = null;
      utterance.onerror = null;
      error ? reject(error) : resolve();
    };
    const stop = () => {speechSynthesis.cancel();done(signal.reason || new DOMException('已停止朗读', 'AbortError'));};
    signal.addEventListener('abort', stop, {once: true});
    utterance.onend = () => done();
    utterance.onerror = () => done(Error('语音回复未完成'));
    if (signal.aborted) stop();
    else speechSynthesis.speak(utterance);
  });
}
