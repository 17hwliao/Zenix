import type { PlaylistView, TrackView } from './types';

// Local collection summaries are derived in memory from the current library snapshot.
export type HomeTab = 'playlist' | 'radio' | 'album' | 'local';
export type LocalSection = 'folders' | 'albums' | 'artists' | 'playlists';

export interface LibraryCard {
  id: string;
  title: string;
  subtitle: string;
  coverUrl?: string;
  tracks: TrackView[];
  kind: 'track' | 'collection';
}

const text = (value: string | undefined, fallback: string) => value?.trim() || fallback;

const folderName = (path: string) => {
  const normalized = path.replaceAll('\\', '/');
  const parent = normalized.slice(0, normalized.lastIndexOf('/'));
  return parent.slice(parent.lastIndexOf('/') + 1) || '本地音乐';
};

const groupTracks = (tracks: TrackView[], field: (track: TrackView) => string, prefix: string): LibraryCard[] => {
  const groups = new Map<string, TrackView[]>();
  for (const track of tracks) {
    const title = field(track);
    groups.set(title, [...(groups.get(title) ?? []), track]);
  }
  return [...groups.entries()].map(([title, songs]) => ({
    id: `${prefix}:${title}`,
    title,
    subtitle: `${songs.length} 首歌曲`,
    coverUrl: songs.find(song => song.coverUrl)?.coverUrl,
    tracks: songs,
    kind: 'collection',
  }));
};

export function getLibraryCards(tracks: TrackView[], tab: HomeTab, localSection: LocalSection, playlists: PlaylistView[] = []): LibraryCard[] {
  if (tab === 'radio') {
    return tracks.length ? [{
      id: 'radio:all',
      title: '随机播放',
      subtitle: `${tracks.length} 首本地歌曲`,
      coverUrl: tracks.find(song => song.coverUrl)?.coverUrl,
      tracks,
      kind: 'collection',
    }] : [];
  }
  if (tab === 'album' || (tab === 'local' && localSection === 'albums')) {
    return groupTracks(tracks, track => text(track.album, '未知专辑'), 'album');
  }
  if (tab === 'local' && localSection === 'artists') {
    return groupTracks(tracks, track => text(track.artist, '未知艺术家'), 'artist');
  }
  if (tab === 'local' && localSection === 'folders') {
    return groupTracks(tracks, track => folderName(track.path), 'folder');
  }
  if (tab === 'local' && localSection === 'playlists') {
    const byId = new Map(tracks.map(track => [track.id, track]));
    const allSongs: LibraryCard[] = tracks.length ? [{
      id: 'playlist:all',
      title: '全部歌曲',
      subtitle: `${tracks.length} 首歌曲`,
      coverUrl: tracks.find(song => song.coverUrl)?.coverUrl,
      tracks,
      kind: 'collection',
    }] : [];
    return [...allSongs, ...playlists.map(playlist => {
      const songs = playlist.trackIds.map(id => byId.get(id)).filter((track): track is TrackView => Boolean(track));
      return { id: `playlist:${playlist.id}`, title: playlist.name, subtitle: `${songs.length} 首歌曲`, coverUrl: songs.find(song => song.coverUrl)?.coverUrl, tracks: songs, kind: 'collection' as const };
    })];
  }
  return tracks.map(track => ({
    id: `track:${track.id}`,
    title: track.title,
    subtitle: text(track.artist, '未知艺术家'),
    coverUrl: track.coverUrl,
    tracks: [track],
    kind: 'track',
  }));
}

export function filterCards(cards: LibraryCard[], query: string): LibraryCard[] {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) return cards;
  return cards.filter(card =>
    `${card.title} ${card.subtitle} ${card.tracks.map(song => `${song.title} ${song.artist} ${song.album ?? ''}`).join(' ')}`
      .toLocaleLowerCase().includes(keyword),
  );
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
