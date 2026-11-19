import type {Track, InstalledSource} from '../../core/types';
import {matchesImportedMetadata} from '../../core/playlistLinks';
import {command} from '../../mobile/native';
import type {KaraokeQueueItem, KaraokeSongSummary} from './contracts';
import {karaokeSongSummary} from './song-summary';

export function publicKaraokeTrack(track: Track) {
  const song = karaokeSongSummary({
    title: track.title, artist: track.artist, durationMs: Math.round(Math.max(0, track.duration || 0) * 1000),
  });
  if (!song) return;
  const key = JSON.stringify([song.title.normalize('NFKC'), song.artist.normalize('NFKC'), Math.round(song.durationMs / 1000)]);
  // IDs travel with snapshots. Generate them only from the public song summary.
  let first = 2166136261, second = 0;
  for (let at = 0; at < key.length; at++) {
    first = Math.imul(first ^ key.charCodeAt(at), 16777619);
    second = Math.imul(second, 31) + key.charCodeAt(at) | 0;
  }
  return {recordingId: `song-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`, song};
}

function sameSong(song: KaraokeSongSummary, candidate: Track): boolean {
  const duration = Math.round((candidate.duration || 0) * 1000);
  return matchesImportedMetadata({
    id: '', path: '', audioUrl: '', providerId: 'zenix.import:metadata', title: song.title, artist: song.artist, duration: song.durationMs / 1000,
  }, candidate)
    && (!song.durationMs || !duration || Math.abs(duration - song.durationMs) <= 3000);
}

export async function findKaraokeTrack(
  item: KaraokeQueueItem, tracks: readonly Track[], sources: readonly InstalledSource[], mobile: boolean, signal: AbortSignal,
): Promise<Track | undefined> {
  const song = item.song;
  const exact = tracks.find(track => publicKaraokeTrack(track)?.recordingId === item.recordingId);
  if (exact || !song) return exact;
  const matched = tracks.find(track => sameSong(song, track));
  if (matched) return matched;
  for (const source of sources.filter(source => source.enabled && source.manifest.capabilities.includes('search'))) {
    signal.throwIfAborted();
    try {
      const page = mobile
        ? await command<{items: Track[]}>('search', {id: source.id, keyword: song.title})
        : await window.yzqxy?.sources.search(source.id, song.title, null, 35);
      signal.throwIfAborted();
      const match = page?.items.find(candidate => sameSong(song, candidate));
      if (match) return match;
    } catch {
      signal.throwIfAborted();
    }
  }
}
