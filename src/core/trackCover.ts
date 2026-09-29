import type { Track } from './types';

export function trackCoverUrl(track: Pick<Track, 'coverUrl' | 'source' | 'providerId' | 'remoteId'> | null | undefined): string | undefined {
  if (!track) return undefined;
  if (track.coverUrl) return track.coverUrl;
  if (track.source === 'custom' && track.providerId?.startsWith('lx.') && track.remoteId) {
    return `yzqxy://source-cover/${encodeURIComponent(track.providerId)}/${encodeURIComponent(track.remoteId)}`;
  }
  return undefined;
}
