import type { AppearanceBackground } from '../core/types';
import type { PersonalState } from '../core/types';

export type RepeatMode = 'off' | 'all' | 'one';

export interface TrackView {
  id: string;
  path: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  coverUrl?: string;
  audioUrl?: string;
}

export interface LyricLineView {
  time: number;
  text: string;
  translation?: string;
  endTime?: number;
}

export interface PlaylistView {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ZenixShellProps {
  desktopLyricsVisible?: boolean;
  onToggleDesktopLyrics?: () => void;
  personal?: PersonalState;
  onToggleSaved?: (kind: 'liked' | 'favorites', track: TrackView) => void;
  onCreatePersonalPlaylist?: (name: string, firstTrack?: TrackView) => void;
  onAddToPersonalPlaylist?: (id: string, track: TrackView) => void;
  onRemovePersonalTrack?: (id: string, trackId: string) => void;
  onRemoveSaved?: (kind: 'liked' | 'favorites' | 'history', id: string) => void;
  onRenamePersonalPlaylist?: (id: string, name: string) => void;
  onDeletePersonalPlaylist?: (id: string) => void;
  onSetQueue?: (tracks: TrackView[], index: number) => void;
  onRemoveFromQueue?: (index: number) => void;
  appearanceBackground?: AppearanceBackground | null;
  interactionLocked?: boolean;
  appearanceBusy?: boolean;
  onChooseBackground?: () => void | Promise<void>;
  onClearBackground?: () => void | Promise<void>;
  tracks: TrackView[];
  playlists?: PlaylistView[];
  currentTrack?: TrackView | null;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  muted?: boolean;
  shuffle?: boolean;
  repeat?: RepeatMode;
  queue?: TrackView[];
  queueIndex?: number;
  recentTracks?: TrackView[];
  lyrics?: LyricLineView[];
  onlineResults?: TrackView[];
  onlineSearching?: boolean;
  onlineHasMore?: boolean;
  playerViewRequestKey?: number | string;
  libraryBusy?: boolean;
  onPlayTrack: (track: TrackView, queue?: TrackView[]) => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute?: () => void;
  onToggleShuffle?: () => void;
  onCycleRepeat?: () => void;
  onImportFolder: () => void | Promise<void>;
  onAddFiles?: () => void | Promise<void>;
  onImportPlaylist?: () => void | Promise<void>;
  onOpenPlaylists?: () => void;
  onRefreshLibrary?: () => void | Promise<void>;
  onSearchOnline?: (query: string) => void | Promise<void>;
  onLoadMore?: () => void | Promise<void>;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  onReplayIntro?: () => void;
}
