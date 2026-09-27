export type SoundKind = 'enter' | 'cancel' | 'slide';
export type SoundSettings = { enabled: boolean; volume: number; enter: number; cancel: number; slide: number };

const KEY = 'zenix.ui-sounds.v1';
const defaults: SoundSettings = { enabled: true, volume: .85, enter: 1, cancel: 1, slide: 1 };
const files = import.meta.glob('../../assets/sounds/*.wav', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const channels = new Map<string, HTMLAudioElement[]>();
let lastSlide = 0;

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
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event('zenix:sounds-changed'));
}

export function playUiSound(kind: SoundKind) {
  const settings = getSoundSettings();
  if (!settings.enabled || settings.volume <= 0) return;
  if (kind === 'slide' && performance.now() - lastSlide < 180) return;
  if (kind === 'slide') lastSlide = performance.now();
  const key = `${kind}-${settings[kind]}`;
  const url = files[`../../assets/sounds/${key}.wav`];
  if (!url) return;
  try {
    let pool = channels.get(key);
    if (!pool) {
      pool = Array.from({ length: 3 }, () => { const audio = new Audio(url); audio.preload = 'auto'; return audio; });
      channels.set(key, pool);
    }
    const audio = pool.find(channel => channel.paused || channel.ended) || pool[0];
    audio.pause();
    audio.currentTime = 0;
    audio.volume = settings.volume;
    void audio.play().catch(() => {});
  } catch { /* The music player remains usable when the output device is unavailable. */ }
}
