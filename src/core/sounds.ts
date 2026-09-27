export type SoundKind = 'enter' | 'cancel' | 'slide';
export type SoundSettings = { enabled: boolean; enter: number; cancel: number; slide: number };
const KEY = 'zenix.ui-sounds.v1';
const defaults: SoundSettings = { enabled: true, enter: 1, cancel: 1, slide: 1 };
let context: AudioContext | null = null;
let lastSlide = 0;
export function getSoundSettings(): SoundSettings {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return defaults; }
}
export function setSoundSettings(next: SoundSettings) { localStorage.setItem(KEY, JSON.stringify(next)); window.dispatchEvent(new Event('zenix:sounds-changed')); }
export function playUiSound(kind: SoundKind) {
  const settings = getSoundSettings();
  if (!settings.enabled) return;
  if (kind === 'slide' && performance.now() - lastSlide < 210) return;
  if (kind === 'slide') lastSlide = performance.now();
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    const variant = Math.max(1, Math.min(5, settings[kind]));
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === 'slide' ? 'sine' : variant % 2 ? 'triangle' : 'sine';
    const base = kind === 'enter' ? 560 + variant * 55 : kind === 'cancel' ? 460 + variant * 35 : 220 + variant * 30;
    oscillator.frequency.setValueAtTime(base * (kind === 'cancel' ? 1.5 : .78), now);
    oscillator.frequency.exponentialRampToValueAtTime(base * (kind === 'cancel' ? .65 : 1.25), now + (kind === 'slide' ? .17 : .085));
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === 'slide' ? .022 : .037, now + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, now + (kind === 'slide' ? .19 : .13) + variant * .008);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + .23);
  } catch { /* Audio is optional if output is unavailable. */ }
}
