import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FolderInput, ListMusic, Music2, Pencil, Play, Plus, Search, Trash2, X } from 'lucide-react';
import { library } from '../core';
import type { LibrarySnapshot, Playlist, Track } from '../core';
import './PlaylistManager.css';

export interface PlaylistManagerProps {
  onClose: () => void;
  onPlayTrack: (track: Track, queue: Track[]) => void;
}

function durationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function TrackArt({ track }: { track: Track }) {
  return <span className="yz-pl-art">
    {track.coverUrl ? <img src={track.coverUrl} alt="" loading="lazy" /> : <Music2 size={18} strokeWidth={1.5} />}
  </span>;
}

export function PlaylistManager({ onClose, onPlayTrack }: PlaylistManagerProps) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>(library.snapshot);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const unsubscribe = library.subscribe(setSnapshot);
    void library.init().catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : '曲库读取失败');
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { unsubscribe(); window.removeEventListener('keydown', onKeyDown); };
  }, []);

  useEffect(() => {
    if (selectedId && snapshot.playlists.some((playlist) => playlist.id === selectedId)) return;
    setSelectedId(snapshot.playlists[0]?.id ?? null);
  }, [snapshot.playlists, selectedId]);

  const selected = snapshot.playlists.find((playlist) => playlist.id === selectedId);
  const trackById = useMemo(() => new Map(snapshot.tracks.map((track) => [track.id, track])), [snapshot.tracks]);
  const playlistTracks = useMemo(() => selected?.trackIds
    .map((id) => trackById.get(id))
    .filter((track): track is Track => Boolean(track)) ?? [], [selected, trackById]);
  const availableTracks = useMemo(() => {
    const words = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return snapshot.tracks.filter((track) => words.every((word) =>
      `${track.title} ${track.artist} ${track.album ?? ''}`.toLocaleLowerCase().includes(word))).slice(0, 100);
  }, [snapshot.tracks, search]);
  const selectedTrackIds = useMemo(() => new Set(selected?.trackIds ?? []), [selected]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setNotice('');
    try {
      await action();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  function createPlaylist(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    void run(async () => {
      const existing = new Set(snapshot.playlists.map((playlist) => playlist.id));
      const next = await library.createPlaylist(name);
      setSelectedId(next.playlists.find((playlist) => !existing.has(playlist.id))?.id ?? null);
      setNewName('');
      setShowAdd(true);
    });
  }

  function renamePlaylist(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selected || !renameValue.trim() || busy) return;
    void run(async () => {
      await library.renamePlaylist(selected.id, renameValue.trim());
      setRenaming(false);
    });
  }

  function deletePlaylist(): void {
    if (!selected || busy) return;
    void run(async () => {
      await library.deletePlaylist(selected.id);
      setConfirmDelete(false);
      setShowAdd(false);
    });
  }

  function setTracks(ids: string[]): void {
    if (!selected || busy) return;
    void run(() => library.setPlaylistTracks(selected.id, ids));
  }

  function importPlaylist(): void {
    if (busy) return;
    void run(async () => {
      const existing = new Set(snapshot.playlists.map((playlist) => playlist.id));
      const next = await library.importPlaylist();
      if (next) {
        setSelectedId(next.playlists.find((playlist) => !existing.has(playlist.id))?.id ?? selectedId);
        setShowAdd(false);
      }
    });
  }

  function play(track: Track): void {
    onPlayTrack(track, playlistTracks);
    onClose();
  }

  return <div className="yz-pl-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="yz-pl-dialog" role="dialog" aria-modal="true" aria-label="歌单管理">
      <aside className="yz-pl-sidebar">
        <div className="yz-pl-sidebar-heading">
          <div><span className="yz-pl-eyebrow">YOUR COLLECTION</span><h2>我的歌单</h2></div>
          <button className="yz-pl-icon-button" type="button" title="关闭" aria-label="关闭歌单管理" onClick={onClose}><X size={18} /></button>
        </div>
        <form className="yz-pl-create" onSubmit={createPlaylist}>
          <input aria-label="新歌单名称" placeholder="新建歌单" value={newName} maxLength={100}
            onChange={(event) => setNewName(event.target.value)} disabled={busy} />
          <button type="submit" aria-label="创建歌单" title="创建歌单" disabled={!newName.trim() || busy}><Plus size={18} /></button>
        </form>
        <div className="yz-pl-list" aria-label="歌单列表">
          {snapshot.playlists.length === 0 && <p className="yz-pl-hint">还没有歌单，创建一个来收藏喜欢的歌曲。</p>}
          {snapshot.playlists.map((playlist: Playlist) => <button key={playlist.id} type="button"
            className={`yz-pl-list-item ${selectedId === playlist.id ? 'is-selected' : ''}`}
            onClick={() => { setSelectedId(playlist.id); setRenaming(false); setConfirmDelete(false); setShowAdd(false); }}>
            <span className="yz-pl-list-icon"><ListMusic size={18} strokeWidth={1.7} /></span>
            <span className="yz-pl-list-label"><strong>{playlist.name}</strong><small>{playlist.trackIds.length} 首歌曲</small></span>
          </button>)}
        </div>
        <button className="yz-pl-import" type="button" disabled={busy} onClick={importPlaylist}>
          <FolderInput size={17} strokeWidth={1.7} /> 导入 M3U 歌单
        </button>
      </aside>

      <main className="yz-pl-main">
        {!selected ? <div className="yz-pl-empty">
          <span className="yz-pl-empty-icon"><ListMusic size={35} strokeWidth={1.3} /></span>
          <h3>让音乐有处可去</h3>
          <p>在左侧创建歌单，或者导入已有的 M3U 文件。</p>
        </div> : <>
          <header className="yz-pl-header">
            <span className="yz-pl-eyebrow">PLAYLIST · {playlistTracks.length} TRACKS</span>
            {renaming ? <form className="yz-pl-rename" onSubmit={renamePlaylist}>
              <input autoFocus aria-label="歌单名称" value={renameValue} maxLength={100}
                onChange={(event) => setRenameValue(event.target.value)} disabled={busy} />
              <button type="submit" title="保存名称" aria-label="保存名称" disabled={!renameValue.trim() || busy}><Check size={18} /></button>
              <button type="button" title="取消" aria-label="取消重命名" onClick={() => setRenaming(false)}><X size={18} /></button>
            </form> : <h2>{selected.name}</h2>}
            <div className="yz-pl-actions">
              <button type="button" onClick={() => setShowAdd((value) => !value)} disabled={busy}>
                <Plus size={16} /> 添加歌曲
              </button>
              <button type="button" title="重命名歌单" aria-label="重命名歌单" disabled={busy}
                onClick={() => { setRenameValue(selected.name); setRenaming(true); setConfirmDelete(false); }}><Pencil size={16} /></button>
              <button type="button" title="导出 M3U8" aria-label="导出 M3U8" disabled={busy}
                onClick={() => void run(() => library.exportPlaylist(selected.id))}><Download size={16} /></button>
              <button type="button" className="yz-pl-danger" title="删除歌单" aria-label="删除歌单" disabled={busy}
                onClick={() => { setConfirmDelete(true); setRenaming(false); }}><Trash2 size={16} /></button>
            </div>
          </header>

          {confirmDelete && <div className="yz-pl-confirm" role="alertdialog" aria-label="确认删除歌单">
            <span>删除「{selected.name}」？磁盘上的音乐文件不会受影响。</span>
            <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button>
            <button type="button" className="yz-pl-danger" disabled={busy} onClick={deletePlaylist}>删除</button>
          </div>}

          <div className={`yz-pl-content ${showAdd ? 'has-add-panel' : ''}`}>
            <div className="yz-pl-tracks">
              {playlistTracks.length === 0 ? <div className="yz-pl-track-empty">
                <Music2 size={28} strokeWidth={1.4} /><p>这张歌单还没有歌曲</p>
                <button type="button" onClick={() => setShowAdd(true)}>从曲库添加</button>
              </div> : playlistTracks.map((track, index) => <div className="yz-pl-track" key={`${track.id}-${index}`}>
                <button type="button" className="yz-pl-track-play" onClick={() => play(track)} aria-label={`播放 ${track.title}`}>
                  <TrackArt track={track} /><span className="yz-pl-track-play-icon"><Play size={16} fill="currentColor" /></span>
                </button>
                <button type="button" className="yz-pl-track-text" onClick={() => play(track)}>
                  <strong>{track.title}</strong><small>{track.artist}{track.album ? ` · ${track.album}` : ''}</small>
                </button>
                <span className="yz-pl-duration">{durationLabel(track.duration)}</span>
                <button className="yz-pl-icon-button yz-pl-remove" type="button" title="从歌单移除" aria-label={`移除 ${track.title}`}
                  disabled={busy} onClick={() => setTracks(selected.trackIds.filter((id) => id !== track.id))}><X size={16} /></button>
              </div>)}
            </div>
            {showAdd && <aside className="yz-pl-add-panel" aria-label="添加歌曲">
              <div className="yz-pl-add-head"><strong>添加歌曲</strong><button type="button" title="收起" aria-label="收起添加歌曲" onClick={() => setShowAdd(false)}><X size={16} /></button></div>
              <label className="yz-pl-search"><Search size={16} /><input autoFocus placeholder="搜索曲库歌曲或艺人" value={search}
                onChange={(event) => setSearch(event.target.value)} /></label>
              <div className="yz-pl-add-list">
                {availableTracks.length === 0 && <p className="yz-pl-hint">曲库中没有匹配的歌曲。</p>}
                {availableTracks.map((track) => <div className="yz-pl-add-track" key={track.id}>
                  <TrackArt track={track} /><span><strong>{track.title}</strong><small>{track.artist}</small></span>
                  <button type="button" disabled={busy || selectedTrackIds.has(track.id)}
                    title={selectedTrackIds.has(track.id) ? '已添加' : '添加到歌单'} aria-label={selectedTrackIds.has(track.id) ? `${track.title} 已添加` : `添加 ${track.title}`}
                    onClick={() => setTracks([...selected.trackIds, track.id])}>{selectedTrackIds.has(track.id) ? <Check size={16} /> : <Plus size={16} />}</button>
                </div>)}
              </div>
            </aside>}
          </div>
        </>}
        {notice && <div className="yz-pl-notice" role="alert">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} /></button></div>}
      </main>
    </section>
  </div>;
}
