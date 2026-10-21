import type { Track } from './types';

export function coverRequestUrl(url: string, retry = 0): string {
  if (!url.startsWith('yzqxy://source-cover/')) return url;
  const request = new URL(url);
  // Bypass negative responses cached by older clients without changing song IDs.
  request.searchParams.set('artwork', '2');
  if (retry) request.searchParams.set('retry', String(retry));
  return request.href;
}

export function trackCoverUrl(track: Pick<Track, 'coverUrl' | 'source' | 'providerId' | 'remoteId'> | null | undefined): string | undefined {
  if (!track) return undefined;
  if (track.coverUrl) return coverRequestUrl(track.coverUrl);
  if (track.source === 'custom' && track.providerId?.startsWith('lx.') && track.remoteId) {
    return coverRequestUrl(`yzqxy://source-cover/${encodeURIComponent(track.providerId)}/${encodeURIComponent(track.remoteId)}`);
  }
  return undefined;
}
