import type { LibraryProgress, LibrarySnapshot, Playlist, Track } from './types';

const EMPTY_SNAPSHOT: LibrarySnapshot = {
  tracks: [],
  roots: [],
  playlists: [],
  looseFiles: [],
};

type Listener = (snapshot: LibrarySnapshot) => void;
type ProgressListener = (progress: LibraryProgress | null) => void;

class MusicLibrary {
  private state: LibrarySnapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<Listener>();
  private progressListeners = new Set<ProgressListener>();
  private initialized = false;
  private unlistenChange?: () => void;
  private unlistenProgress?: () => void;

  get snapshot(): LibrarySnapshot {
    return this.state;
  }

  get tracks(): Track[] {
    return this.state.tracks;
  }

  get playlists(): Playlist[] {
    return this.state.playlists;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  subscribeProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  private publish(next: LibrarySnapshot): LibrarySnapshot {
    this.state = next;
    this.listeners.forEach((listener) => listener(next));
    this.progressListeners.forEach((listener) => listener(null));
    return next;
  }

  async init(): Promise<LibrarySnapshot> {
    const bridge = window.yzqxy;
    if (!bridge) return this.state;
    if (!this.initialized) {
      this.initialized = true;
      this.unlistenChange = bridge.library.onChanged((snapshot) => this.publish(snapshot));
      this.unlistenProgress = bridge.library.onProgress((progress) => {
        this.progressListeners.forEach((listener) => listener(progress));
      });
    }
    return this.publish(await bridge.library.load());
  }

  dispose(): void {
    this.unlistenChange?.();
    this.unlistenProgress?.();
    this.initialized = false;
  }

  private async run(action: () => Promise<LibrarySnapshot | null>): Promise<LibrarySnapshot | null> {
    const next = await action();
    return next ? this.publish(next) : null;
  }

  async importFolder(): Promise<LibrarySnapshot | null> {
    return window.yzqxy ? this.run(() => window.yzqxy!.library.importFolder()) : null;
  }

  async addFiles(): Promise<LibrarySnapshot | null> {
    return window.yzqxy ? this.run(() => window.yzqxy!.library.addFiles()) : null;
  }

  async rescan(): Promise<LibrarySnapshot> {
    if (!window.yzqxy) return this.state;
    return this.publish(await window.yzqxy.library.rescan());
  }

  async removeRoot(path: string): Promise<LibrarySnapshot> {
    if (!window.yzqxy) return this.state;
    return this.publish(await window.yzqxy.library.removeRoot(path));
  }

  async removeFile(path: string): Promise<LibrarySnapshot> {
    if (!window.yzqxy) return this.state;
    return this.publish(await window.yzqxy.library.removeFile(path));
  }

  async createPlaylist(name: string): Promise<LibrarySnapshot> {
    if (!window.yzqxy) return this.state;
    return this.publish(await window.yzqxy.library.createPlaylist(name));
  }

  async renamePlaylist(id: string, name: string): Promise<LibrarySnapshot> {
    if (!window.yzqxy) return this.state;
    return this.publish(await window.yzqxy.library.renamePlaylist(id, name));
  }

  async deletePlaylist(id: string): Promise<LibrarySnapshot> {
    if (!window.yzqxy) return this.state;
    return this.publish(await window.yzqxy.library.deletePlaylist(id));
  }

  async setPlaylistTracks(id: string, trackIds: string[]): Promise<LibrarySnapshot> {
    if (!window.yzqxy) return this.state;
    return this.publish(await window.yzqxy.library.setPlaylistTracks(id, trackIds));
  }

  async importPlaylist(): Promise<LibrarySnapshot | null> {
    return window.yzqxy ? this.run(() => window.yzqxy!.library.importPlaylist()) : null;
  }

  async exportPlaylist(id: string): Promise<boolean> {
    return window.yzqxy ? window.yzqxy.library.exportPlaylist(id) : false;
  }

  getTrack(id: string): Track | undefined {
    return this.state.tracks.find((track) => track.id === id);
  }

  search(query: string): Track[] {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return this.state.tracks;
    return this.state.tracks.filter((track) => {
      const text = `${track.title} ${track.artist} ${track.album ?? ''}`.toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }
}

export const library = new MusicLibrary();
