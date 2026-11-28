export type SoundKind = 'enter' | 'cancel' | 'slide';
export type SoundSettings = { enabled: boolean; volume: number; enter: number; cancel: number; slide: number };

const KEY = 'zenix.ui-sounds.v1';
/** Local and same-origin window changes have the same settings contract. */
export function subscribeSoundSettings(update: () => void) {
  const storage = (event: StorageEvent) => {if (event.key === KEY || event.key === null) update();};
  window.addEventListener('zenix:sounds-changed', update);
  window.addEventListener('storage', storage);
  return () => {window.removeEventListener('zenix:sounds-changed', update);window.removeEventListener('storage', storage);};
}
const defaults: SoundSettings = { enabled: true, volume: .85, enter: 1, cancel: 1, slide: 1 };
const files = import.meta.glob('../../assets/sounds/*.wav', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const channels = new Map<SoundKind, { key: string; pool: HTMLAudioElement[] }>();
let lastSlide = 0;
type SoundGesture = {played: boolean};
let soundGesture: SoundGesture | undefined;
let useWebAudio = false;
let effectContext: AudioContext | undefined;
let effectRevision = 0;
const decodedEffects = new Map<string, Promise<AudioBuffer>>();
const effectVoices = new Set<AudioBufferSourceNode>();

function stopMediaEffects() {
  for (const slot of channels.values()) slot.pool.forEach(audio => { audio.pause(); audio.removeAttribute('src'); audio.load(); });
  channels.clear();
}

function stopEffects() {
  effectRevision++;
  effectVoices.forEach(source => {try {source.stop();} catch { /* Already ended. */ }});
  effectVoices.clear();
}

function resumeEffectContext() {
  const context = effectContext ??= new AudioContext({latencyHint: 'interactive'});
  void context.resume().catch(() => {});
  return context;
}

// Mobile UI feedback must not create an HTML media player or own its MediaSession.
// Decode the same local samples into short Web Audio voices instead.
function playWebAudioEffect(url: string, intensity: number) {
  try {
    const context = resumeEffectContext();
    const revision = effectRevision;
    let decoded = decodedEffects.get(url);
    if (!decoded) {
      decoded = fetch(url).then(response => {if (!response.ok) throw Error('UI sound unavailable');return response.arrayBuffer();}).then(bytes => context.decodeAudioData(bytes));
      decodedEffects.set(url, decoded);
      void decoded.catch(() => { if (decodedEffects.get(url) === decoded) decodedEffects.delete(url); });
    }
    void decoded.then(buffer => {
      const settings = getSoundSettings();
      if (revision !== effectRevision || context !== effectContext || context.state !== 'running' || !settings.enabled || settings.volume <= 0) return;
      if (effectVoices.size >= 3) { const oldest = effectVoices.values().next().value; oldest?.stop(); if (oldest) effectVoices.delete(oldest); }
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer; gain.gain.value = settings.volume * intensity;
      source.connect(gain); gain.connect(context.destination); effectVoices.add(source);
      source.onended = () => { effectVoices.delete(source);source.disconnect();gain.disconnect(); };
      source.start();
    }).catch(() => {});
  } catch { /* Feedback cannot interrupt native music when an audio device is unavailable. */ }
}

const variantNumber = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(1, Math.min(5, Math.round(Number(value)))) : 1;
const level = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : defaults.volume;

export function getSoundSettings(): SoundSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<SoundSettings>;
    return {
      enabled: saved.enabled !== false,
      volume: level(saved.volume),
      enter: variantNumber(saved.enter),
      cancel: variantNumber(saved.cancel),
      slide: variantNumber(saved.slide),
    };
  } catch { return defaults; }
}

export function setSoundSettings(next: SoundSettings) {
  if (!next.enabled || next.volume <= 0) { stopEffects(); stopMediaEffects(); }
  localStorage.setItem(KEY, JSON.stringify(next));
  if (useWebAudio && next.enabled && next.volume > 0) {try {resumeEffectContext();} catch { /* No feedback device. */ }}
  window.dispatchEvent(new Event('zenix:sounds-changed'));
}

export function playUiSound(kind: SoundKind, intensity = 1) {
  if (soundGesture?.played) return;
  if (soundGesture) soundGesture.played = true;
  const settings = getSoundSettings();
  if (!settings.enabled || settings.volume <= 0) return;
  if (kind === 'slide' && performance.now() - lastSlide < 180) return;
  if (kind === 'slide') lastSlide = performance.now();
  const key = `${kind}-${settings[kind]}`;
  const url = files[`../../assets/sounds/${key}.wav`];
  if (!url) return;
  if (useWebAudio) { playWebAudioEffect(url, Math.max(0, Math.min(1, intensity))); return; }
  try {
    let slot = channels.get(kind);
    if (!slot || slot.key !== key) {
      slot?.pool.forEach(audio => { audio.pause(); audio.removeAttribute('src'); audio.load(); });
      slot = { key, pool: Array.from({ length: 2 }, () => { const audio = new Audio(url); audio.preload = 'auto'; return audio; }) };
      channels.set(kind, slot);
    }
    const pool = slot.pool;
    const audio = pool.find(channel => channel.paused || channel.ended) || pool[0];
    audio.pause();
    audio.currentTime = 0;
    audio.volume = settings.volume * Math.max(0, Math.min(1, intensity));
    void audio.play().catch(() => {});
  } catch { /* The music player remains usable when the output device is unavailable. */ }
}

/** One quiet sound per activation. Existing semantic sounds take precedence.
 * Capture sees portal controls too; the timer waits for React's handlers even
 * when they stop propagation. Hover, typing and cancelled gestures are silent. */
export function installUiSoundFeedback(target: Document = document, mobile = false) {
  const previousOutput = useWebAudio;
  useWebAudio = mobile;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const ignored = '[data-ui-sound="off"],.zenix-karaoke-modes,.assistant-hold-voice';
  const schedule = (event: Event, control: Element, kind: SoundKind) => {
    if (control.closest(ignored) || control.matches(':disabled,[aria-disabled="true"]') || control.closest('[inert]')) return;
    // Unlock mobile output while still inside the activation callback; decoding
    // and the deduplicated playback can finish after the component handler.
    if (useWebAudio) {const settings=getSoundSettings();if(settings.enabled&&settings.volume>0){try {resumeEffectContext();} catch { /* Feedback is optional. */ }}}
    const gesture: SoundGesture = {played: false};
    soundGesture = gesture;
    const timer = setTimeout(() => {
      timers.delete(timer);
      // Explicit cancel/enter/preview sounds already acknowledged this action.
      const newerGesture = soundGesture === gesture ? undefined : soundGesture;
      if (!gesture.played && !event.defaultPrevented) { soundGesture = gesture; playUiSound(kind, .35); }
      soundGesture = newerGesture;
    }, 0);
    timers.add(timer);
  };
  const click = (event: Event) => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest('button,a[href],summary,[role="button"],input[type="button"],input[type="submit"],input[type="reset"],input[type="checkbox"],input[type="radio"]');
    if (!control) return;
    const override = control.getAttribute('data-ui-sound');
    const label = control.getAttribute('aria-label') || control.textContent || '';
    schedule(event, control, override === 'cancel' || /^(关闭|取消|返回|收起)/.test(label.trim()) ? 'cancel' : 'enter');
  };
  const change = (event: Event) => {
    if (event.target instanceof HTMLSelectElement) schedule(event, event.target, 'enter');
  };
  target.addEventListener('click', click, true);
  target.addEventListener('change', change, true);
  const stopSettings = subscribeSoundSettings(() => {
    const settings = getSoundSettings();
    if (!settings.enabled || settings.volume <= 0) {stopEffects();stopMediaEffects();}
  });
  return () => {
    stopSettings();
    target.removeEventListener('click', click, true);
    target.removeEventListener('change', change, true);
    timers.forEach(clearTimeout); timers.clear(); soundGesture = undefined;
    useWebAudio = previousOutput;
    stopEffects(); stopMediaEffects(); decodedEffects.clear();
    const previousContext = effectContext; effectContext = undefined;
    if (previousContext) void previousContext.close().catch(() => {});
  };
}
