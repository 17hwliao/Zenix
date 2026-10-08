export interface Track {
  id: string;
  path: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  audioUrl: string;
  coverUrl?: string;
  coverHint?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  addedAt?: number;
  modifiedAt?: number;
  size?: number;
  source?: 'local' | 'online' | 'custom';
  providerId?: string;
  remoteId?: string;
  actualQuality?: string;
  playbackProviderId?: string;
  playbackQuality?: string;
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
  source: 'sidecar' | 'embedded' | 'custom';
  translationText?: string;
}

export interface LyricLine {
  time: number;
  text: string;
  translation?: string;
  endTime?: number;
}

export type RepeatMode = 'off' | 'all' | 'one';

export type SourceProgress = {
  phase: 'cache' | 'connecting' | 'resolving' | 'checking' | 'buffering' | 'retrying' | 'switching' | 'failed';
  message: string;
  detail?: string;
};
export type SourceActivity = SourceProgress & { startedAt: number };
export interface RoamingStatus {
  active: boolean;
  phase: 'idle' | 'searching' | 'playing' | 'paused' | 'exhausted' | 'failed';
  message: string;
  discovered: number;
  tracks: Track[];
}

export interface PlayerState {
  track?: Track;
  playing: boolean;
  playWhenReady?: boolean;
  cacheStatus?: 'local' | 'disabled' | 'stream' | 'none' | 'partial' | 'complete';
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  queue: Track[];
  queueIndex: number;
  error?: string;
  sourceActivity?: SourceActivity;
}

export type MediaCommand = 'play-pause' | 'play' | 'pause' | 'next' | 'previous';

export type AppearanceBackground = { kind: 'image' | 'video'; name: string; url: string };
export type AppearanceState = { completed: boolean; background: AppearanceBackground | null };
export type PersonalPlaylist = { id: string; name: string; tracks: Track[] };
export type HistoryEntry = { id: string; track: Track; playedAt: number };
export type PersonalState = { liked: Track[]; favorites: Track[]; history: HistoryEntry[]; playlists: PersonalPlaylist[] };

export type SourceManifest = {
  id: string; name: string; version: string; capabilities: string[]; qualities: string[];
  network: { apiHosts: string[]; mediaHosts: string[]; artworkHosts: string[] };
  settings: { key: string; label: string; type: 'text' | 'select'; options: string[]; default: string }[];
  lxPlatforms?: Record<string, { name: string; qualitys: string[] }>;
};
export type InstalledSource = { networkPolicy?: { allowHttp: boolean; hosts: string[] | null }; id: string; kind?: 'zenix' | 'lx'; manifest: SourceManifest; enabled: boolean; origin: { kind: 'file' | 'url'; label: string }; sha256: string; installedAt: number; status: string; lastError: string };
export type SourcePreview = { token: string; kind?: 'zenix' | 'lx'; manifest: SourceManifest; origin: { kind: 'file' | 'url'; label: string }; sha256: string; previousVersion: string | null };
export type SourceSearchPage = { items: Track[]; nextCursor: string | null };
export type AudioCacheStats = { enabled: boolean; limitMiB: number; usedBytes: number; trackCount: number; metadataBytes?: number; metadataLimitMiB?: number; metadataError?: string };

export interface DesktopBridge {
  companion?: { invoke(args: Record<string, unknown>): Promise<unknown> };
  updates: { invoke(args: import('./updates').UpdateRequest): Promise<import('./updates').UpdateState | string> };
  cache: {
    stats(): Promise<AudioCacheStats>;
    configure(options: { enabled?: boolean; limitMiB?: number }): Promise<AudioCacheStats>;
    clear(): Promise<AudioCacheStats>;
  };
  desktopLyrics: {
    toggle(): Promise<boolean>;
    isVisible(): Promise<boolean>;
    update(payload: { previous: string; line: string; next: string; title: string; trackId: string; track?: Track | null; playing: boolean; position: number; duration: number; lines?: { time: number; text: string }[] }): Promise<void>;
    onVisibleChanged(callback: (visible: boolean) => void): () => void;
  };
  personal: {
    load(): Promise<PersonalState>;
    toggle(kind: 'liked' | 'favorites', track: Track): Promise<PersonalState>;
    record(track: Track): Promise<PersonalState>;
    createPlaylist(name: string, firstTrack?: Track): Promise<PersonalState>;
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
  sources: {
    list(): Promise<InstalledSource[]>;
    importFile(): Promise<SourcePreview | null>;
    importFolder(): Promise<SourcePreview | null>;
    importUrl(url: string): Promise<SourcePreview>;
    importText(text: string, originUrl: string): Promise<SourcePreview>;
    confirmImport(token: string, policy?: { allowHttp: boolean; hosts: string[] | null }): Promise<InstalledSource[]>;
    cancelImport(token: string): Promise<void>;
    setEnabled(id: string, enabled: boolean): Promise<InstalledSource[]>;
    configure(id: string, values: Record<string, string>): Promise<Record<string, string>>;
    getSettings(id: string): Promise<Record<string, string>>;
    remove(id: string): Promise<InstalledSource[]>;
    search(id: string, keyword: string, cursor?: string | null, pageSize?: number, requestId?: string): Promise<SourceSearchPage>;
    cancelRequest(requestId: string): Promise<void>;
    cached(track: Track, quality?: string): Promise<{ audioUrl: string; actualQuality: string; coverUrl?: string; playbackProviderId: string } | null>;
    cachedBest(track: Track, qualities: string[]): Promise<{ audioUrl: string; actualQuality: string; coverUrl?: string; playbackProviderId: string; playbackQuality: string } | null>;
    resolve(track: Track, quality?: string, cacheAsId?: string, skipCache?: boolean, requestId?: string): Promise<{ audioUrl: string; actualQuality: string; coverUrl?: string; playbackProviderId: string }>;
    lyrics(track: Track): Promise<RawLyrics | null>;
    openFolder(): Promise<string>;
    onChanged(callback: (sources: InstalledSource[]) => void): () => void;
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
    isFullscreen(): Promise<boolean>;
    onFullscreenChanged(callback: (fullscreen: boolean) => void): () => void;
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
