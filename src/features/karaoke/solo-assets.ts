import type {Track} from '../../core/types';

const instrumental = /纯伴奏|纯音乐|无人声|无主唱|伴奏|\binstrumental\b|\bkaraoke\b/giu;
const titleKey = (value: string) => value.normalize('NFKC').replace(instrumental,'').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();

export function comparableLength(original: number, accompaniment: number): boolean {
  return original <= 0 || accompaniment <= 0 || Math.abs(original - accompaniment) <= Math.max(3,original * .035);
}

export function isInstrumentalVersion(original: Track, candidate: Track): boolean {
  const title = candidate.title.normalize('NFKC');
  return candidate.id !== original.id && (/纯伴奏|纯音乐|无人声|无主唱|伴奏|\binstrumental\b|\bkaraoke\b/iu.test(title))
    && titleKey(original.title) === titleKey(title) && comparableLength(original.duration,candidate.duration);
}

export function inspectAccompaniment(url: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve,reject) => {
    if (signal.aborted) {reject(signal.reason);return;}
    const audio = new Audio();
    const cleanup = () => {
      signal.removeEventListener('abort',abort);
      audio.removeEventListener('loadedmetadata',ready);
      audio.removeEventListener('error',failed);
      audio.removeAttribute('src');
      audio.load();
    };
    const ready = () => {
      const value = audio.duration;
      cleanup();
      if (Number.isFinite(value) && value > 0) resolve(value);
      else reject(Error('无法读取伴奏时长'));
    };
    const failed = () => {cleanup(); reject(Error('无法读取这个音频，请尝试 MP3、WAV 或 FLAC。'));};
    const abort = () => {cleanup();reject(signal.reason);};
    signal.addEventListener('abort',abort,{once:true});
    audio.addEventListener('loadedmetadata',ready);
    audio.addEventListener('error',failed);
    audio.preload = 'metadata';
    audio.src = url;
  });
}
