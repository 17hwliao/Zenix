import type { KaraokeSongSummary } from './contracts';

const privateText = /(?:https?:\/\/|file:|blob:|data:|content:|bearer\s+|[?&](?:token|password)=|[a-z]:[\\/]|\\\\)/iu;

export function isPublicKaraokeText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength
    && !privateText.test(value) && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function karaokeSongSummary(value: unknown): KaraokeSongSummary | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const {title, artist, durationMs} = value as Partial<KaraokeSongSummary>;
  if (!isPublicKaraokeText(title, 128) || !title.trim() || !isPublicKaraokeText(artist, 128)
    || typeof durationMs !== 'number' || !Number.isSafeInteger(durationMs)
    || durationMs < 0 || durationMs > 8 * 60 * 60 * 1000) return;
  return Object.freeze({title: title.trim(), artist: artist.trim(), durationMs});
}
