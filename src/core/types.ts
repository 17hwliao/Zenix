export interface Track {
  id: string;
  path: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  audioUrl: string;
  coverUrl?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  addedAt?: number;
  modifiedAt?: number;
  size?: number;
  source?: 'local' | 'online';
  providerId?: string;
  remoteId?: string;
  availability?: 'playable' | 'unavailable';
}

export interface LibraryRoot {
  path: string;
  name: string;
  trackCount: number;
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface LibrarySnapshot {
  tracks: Track[];
  roots: LibraryRoot[];
  playlists: Playlist[];
  looseFiles: string[];
}

export interface LibraryProgress {
  phase: 'scanning' | 'reading' | 'saving';
  current: number;
  total: number;
  path?: string;
}

export interface RawLyrics {
  text: string;
  format: string;
  source: 'sidecar' | 'embedded';
  translationText?: string;
}

export interface LyricLine {
  time: number;
  text: string;
  translation?: string;
  endTime?: number;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlayerState {
  track?: Track;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  queue: Track[];
  queueIndex: number;
  error?: string;
}

export type MediaCommand = 'play-pause' | 'play' | 'pause' | 'next' | 'previous';

export type AppearanceBackground = { kind: 'image' | 'video'; name: string; url: string };
export type AppearanceState = { completed: boolean; background: AppearanceBackground | null };
export type PersonalPlaylist = { id: string; name: string; tracks: Track[] };
export type HistoryEntry = { id: string; track: Track; playedAt: number };
export type PersonalState = { liked: Track[]; favorites: Track[]; history: HistoryEntry[]; playlists: PersonalPlaylist[] };

export interface DesktopBridge {
  desktopLyrics: {
    toggle(): Promise<boolean>;
    isVisible(): Promise<boolean>;
    update(payload: { previous: string; line: string; next: string; title: string; trackId: string; track: Track | null; playing: boolean; position: number; duration: number; lines: { time: number; text: string }[] }): Promise<void>;
    onVisibleChanged(callback: (visible: boolean) => void): () => void;
  };
  personal: {
    load(): Promise<PersonalState>;
    toggle(kind: 'liked' | 'favorites', track: Track): Promise<PersonalState>;
    record(track: Track): Promise<PersonalState>;
    createPlaylist(name: string): Promise<PersonalState>;
    renamePlaylist(id: string, name: string): Promise<PersonalState>;
    deletePlaylist(id: string): Promise<PersonalState>;
    addToPlaylist(id: string, track: Track): Promise<PersonalState>;
    removeFromPlaylist(id: string, trackId: string): Promise<PersonalState>;
    removeSaved(kind: 'liked' | 'favorites' | 'history', id: string): Promise<PersonalState>;
    onChanged(callback: (state: PersonalState) => void): () => void;
  };
  appearance: {
    load(): Promise<AppearanceState>;
    choose(): Promise<AppearanceState | null>;
    complete(): Promise<AppearanceState>;
    clear(): Promise<AppearanceState>;
    onChanged(callback: (state: AppearanceState) => void): () => void;
  };
  online: {
    search(query: string, offset: number, limit: number): Promise<{ tracks: Track[]; total: number; nextOffset: number; hasMore: boolean }>;
    resolve(remoteId: string): Promise<{ audioUrl: string | null; previewSeconds?: number; unavailableReason?: string }>;
    lyrics(remoteId: string): Promise<{ text: string; translationText?: string; wordByWordText?: string; romanizationText?: string }>;
  };
  library: {
    load(): Promise<LibrarySnapshot>;
    importFolder(): Promise<LibrarySnapshot | null>;
    addFiles(): Promise<LibrarySnapshot | null>;
    rescan(): Promise<LibrarySnapshot>;
    removeRoot(path: string): Promise<LibrarySnapshot>;
    removeFile(path: string): Promise<LibrarySnapshot>;
    readLyrics(trackId: string): Promise<RawLyrics | null>;
    createPlaylist(name: string): Promise<LibrarySnapshot>;
    renamePlaylist(id: string, name: string): Promise<LibrarySnapshot>;
    deletePlaylist(id: string): Promise<LibrarySnapshot>;
    setPlaylistTracks(id: string, trackIds: string[]): Promise<LibrarySnapshot>;
    importPlaylist(): Promise<LibrarySnapshot | null>;
    exportPlaylist(id: string): Promise<boolean>;
    onChanged(callback: (snapshot: LibrarySnapshot) => void): () => void;
    onProgress(callback: (progress: LibraryProgress) => void): () => void;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<boolean>;
    isMaximized(): Promise<boolean>;
    toggleFullscreen(): Promise<boolean>;
    close(): Promise<void>;
    onMaximizedChanged(callback: (maximized: boolean) => void): () => void;
  };
  onMediaCommand(callback: (command: MediaCommand) => void): () => void;
  onMediaSeek(callback: (request: { trackId: string; seconds: number }) => void): () => void;
}

declare global {
  interface Window {
    yzqxy?: DesktopBridge;
  }
}
