import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, Heart, History, ListMusic, Music2, Pencil, Play, Plus, Search, Star, Trash2, X } from 'lucide-react';
import type { PersonalState } from '../core/types';
import type { TrackView } from './types';
import CoverArt from './CoverArt';
import { trackCoverUrl } from '../core/trackCover';
import './PersonalLibraryManager.css';

type Props = {
  initialSection: string; personal: PersonalState; tracks: TrackView[]; queue: TrackView[];
  onClose: () => void; onPlayTrack: (track: TrackView, queue: TrackView[]) => void;
  onCreatePlaylist: (name: string) => Promise<string | null>;
  onRenamePlaylist: (id: string, name: string) => Promise<boolean>;
  onDeletePlaylist: (id: string) => Promise<boolean>;
  onRemoveSaved: (kind: 'liked' | 'favorites' | 'history', id: string) => void;
  onRemovePersonalTrack: (id: string, trackId: string) => void;
  onAddToPlaylist: (id: string, track: TrackView) => void;
};

const sections = [
  { id: 'liked', label: '我的喜欢', icon: Heart },
  { id: 'favorites', label: '我的收藏', icon: Star },
  { id: 'history', label: '听歌历史', icon: History },
  { id: 'playlists', label: '自定义歌单', icon: ListMusic },
];

export default function PersonalLibraryManager({ initialSection, personal, tracks, queue, onClose, onPlayTrack, onCreatePlaylist, onRenamePlaylist, onDeletePlaylist, onRemoveSaved, onRemovePersonalTrack, onAddToPlaylist }: Props) {
  const [section, setSection] = useState(initialSection);
  const [query, setQuery] = useState('');
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editor, setEditor] = useState<'create' | 'rename' | null>(null);
  const [draftName, setDraftName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const playlist = personal.playlists.find(item => item.id === section);
  const entries = section === 'liked' ? personal.liked.map(track => ({ id: track.id, track }))
    : section === 'favorites' ? personal.favorites.map(track => ({ id: track.id, track }))
      : section === 'history' ? personal.history.map(item => ({ id: item.id, track: item.track }))
        : playlist?.tracks.map(track => ({ id: track.id, track })) ?? [];
  const filtered = entries.filter(item => `${item.track.title} ${item.track.artist}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const title = sections.find(item => item.id === section)?.label ?? playlist?.name ?? '歌曲管理';
  const availableTracks = useMemo(() => {
    const unique = new Map<string, TrackView>();
    for (const track of [...queue, ...personal.history.map(item => item.track), ...personal.liked, ...personal.favorites, ...tracks]) {
      if (!unique.has(track.id)) unique.set(track.id, track);
    }
    return [...unique.values()];
  }, [queue, personal.history, personal.liked, personal.favorites, tracks]);
  const addableTracks = availableTracks.filter(track => !playlist?.tracks.some(item => item.id === track.id)
    && `${track.title} ${track.artist}`.toLocaleLowerCase().includes(pickerQuery.trim().toLocaleLowerCase())).slice(0, 80);

  useEffect(() => {
    if (busy) return;
    if (section !== 'playlists' && !sections.some(item => item.id === section) && !playlist) setSection('playlists');
  }, [section, playlist, busy]);

  const selectSection = (next: string) => {
    setSection(next); setQuery(''); setPickerOpen(false); setEditor(null); setConfirmDelete(false); setMessage('');
  };
  const openCreate = () => { setEditor('create'); setDraftName(''); setConfirmDelete(false); setMessage(''); };
  const submitEditor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draftName.trim();
    if (!name || busy) return;
    setBusy(true); setMessage('');
    try {
      if (editor === 'create') {
        const id = await onCreatePlaylist(name);
        if (!id) { setMessage('新建失败，请检查名称后重试。'); return; }
        setSection(id); setPickerOpen(true); setPickerQuery('');
        setMessage('歌单已创建，可以开始添加歌曲。');
      } else if (editor === 'rename' && playlist) {
        if (!(await onRenamePlaylist(playlist.id, name))) { setMessage('重命名失败，请重试。'); return; }
        setMessage('歌单名称已更新。');
      }
      setEditor(null);
    } finally { setBusy(false); }
  };
  const deletePlaylist = async () => {
    if (!playlist || busy) return;
    setBusy(true);
    try {
      if (await onDeletePlaylist(playlist.id)) {
        selectSection('playlists'); setMessage('歌单已删除，歌曲仍保留在其他收藏和本地曲库。');
      } else setMessage('删除失败，请重试。');
    } finally { setBusy(false); }
  };

  return <div className="zenix-manager" role="dialog" aria-modal="true" aria-label="歌曲与歌单管理">
    <aside>
      <div className="zenix-manager-brand"><button onClick={onClose} aria-label="返回主页"><ArrowLeft size={18} /></button><span>Zenix / 我的空间</span></div>
      <h2>音乐管理</h2><small>歌单保存在这台设备</small>
      <nav aria-label="收藏分类">{sections.map(item => <button key={item.id} className={section === item.id ? 'is-active' : ''} onClick={() => selectSection(item.id)}><item.icon size={17} />{item.label}</button>)}</nav>
      <div className="zenix-manager-list-head"><span>我的歌单</span><button onClick={openCreate} title="新建歌单" aria-label="新建歌单"><Plus size={17} /></button></div>
      <nav aria-label="自定义歌单">{personal.playlists.map(item => <button key={item.id} className={section === item.id ? 'is-active' : ''} onClick={() => selectSection(item.id)}><ListMusic size={17} /><span className="zenix-manager-nav-name">{item.name}</span><small>{item.tracks.length}</small></button>)}</nav>
    </aside>
    <main>
      <header><div><small>PERSONAL LIBRARY</small><h1>{title}</h1><p>{section === 'history' ? '每首歌只保留最近一次播放记录。' : playlist ? `${playlist.tracks.length} 首歌曲 · 只在这里删除才会从歌单移除。` : '在这台设备上整理你的音乐。'}</p></div><button onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
      {editor && <form className="zenix-manager-editor" onSubmit={event => void submitEditor(event)}><label htmlFor="zenix-playlist-name">{editor === 'create' ? '新建歌单' : '重命名歌单'}</label><div><input id="zenix-playlist-name" autoFocus maxLength={100} value={draftName} onChange={event => setDraftName(event.target.value)} placeholder="输入歌单名称" /><button type="submit" disabled={!draftName.trim() || busy}>{busy ? '保存中…' : editor === 'create' ? '创建' : '保存'}</button><button type="button" onClick={() => setEditor(null)}>取消</button></div></form>}
      {message && <p className="zenix-manager-message" role="status">{message}</p>}
      {section === 'playlists' ? <div className="zenix-manager-overview">
        <div className="zenix-manager-overview-head"><div><h3>自定义歌单</h3><p>从近期播放、喜欢、收藏或本地曲库添加歌曲。</p></div><button onClick={openCreate}><Plus size={16} />新建歌单</button></div>
        {personal.playlists.length ? <div className="zenix-manager-grid">{personal.playlists.map(item => <button key={item.id} className="zenix-manager-playlist-card" onClick={() => selectSection(item.id)}><span className="zenix-manager-playlist-art">{item.tracks[0] ? <CoverArt title={item.tracks[0].title} coverUrl={trackCoverUrl(item.tracks[0])} /> : <ListMusic size={34} />}</span><strong>{item.name}</strong><small>{item.tracks.length} 首歌曲</small></button>)}</div> : <div className="zenix-manager-empty"><ListMusic size={35} /><h3>还没有自定义歌单</h3><p>创建歌单后，可以从播放列表或歌曲旁的“加入歌单”添加。</p><button onClick={openCreate}><Plus size={16} />新建歌单</button></div>}
      </div> : <>
        <div className="zenix-manager-toolbar"><label className="zenix-manager-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索当前列表" aria-label="搜索当前列表" /></label>{playlist && <><button onClick={() => playlist.tracks[0] && onPlayTrack(playlist.tracks[0], playlist.tracks)} disabled={!playlist.tracks.length}><Play size={15} />播放全部</button><button onClick={() => { setPickerOpen(value => !value); setPickerQuery(''); }}><Plus size={15} />添加歌曲</button><button onClick={() => { setEditor('rename'); setDraftName(playlist.name); setConfirmDelete(false); }}><Pencil size={15} />重命名</button><button onClick={() => { setConfirmDelete(true); setEditor(null); }}><Trash2 size={15} />删除</button></>}</div>
        {confirmDelete && playlist && <div className="zenix-manager-confirm" role="alertdialog" aria-label="确认删除歌单"><span>删除「{playlist.name}」？歌单中的歌曲不会从其他位置删除。</span><button onClick={() => void deletePlaylist()} disabled={busy}>确认删除</button><button onClick={() => setConfirmDelete(false)}>取消</button></div>}
        {playlist && pickerOpen && <section className="zenix-manager-picker"><div><strong>添加歌曲</strong><button onClick={() => setPickerOpen(false)} aria-label="收起添加歌曲"><X size={16} /></button></div><label className="zenix-manager-search"><Search size={15} /><input value={pickerQuery} onChange={event => setPickerQuery(event.target.value)} placeholder="搜索近期播放、收藏与本地歌曲" aria-label="搜索可添加的歌曲" /></label><div className="zenix-manager-picker-list">{addableTracks.map(track => <button key={track.id} onClick={() => onAddToPlaylist(playlist.id, track)}><CoverArt title={track.title} coverUrl={trackCoverUrl(track)} /><span><strong>{track.title}</strong><small>{track.artist || '未知艺术家'}</small></span><Plus size={16} /></button>)}{!addableTracks.length && <p>没有可添加的歌曲。先去搜索音乐或导入本地文件。</p>}</div></section>}
        <div className="zenix-manager-tracks">{filtered.map((item, index) => <div key={`${item.id}-${index}`} className="zenix-manager-track"><button onClick={() => onPlayTrack(item.track, entries.map(entry => entry.track))}><span>{String(index + 1).padStart(2, '0')}</span><CoverArt title={item.track.title} coverUrl={trackCoverUrl(item.track)} /><span><strong>{item.track.title}</strong><small>{item.track.artist || '未知艺术家'}</small></span></button><button className="zenix-manager-delete" onClick={() => playlist ? onRemovePersonalTrack(playlist.id, item.track.id) : onRemoveSaved(section as 'liked' | 'favorites' | 'history', item.id)} title={playlist ? '从歌单移除' : '从当前分类移除'} aria-label={`移除 ${item.track.title}`}><Trash2 size={17} /></button></div>)}{!filtered.length && <div className="zenix-manager-empty"><Music2 size={28} /><p>{query ? '没有匹配的歌曲' : playlist ? '歌单里还没有歌曲' : '这里暂时没有歌曲'}</p>{playlist && !query && <button onClick={() => setPickerOpen(true)}><Plus size={16} />添加歌曲</button>}</div>}</div>
      </>}
    </main>
  </div>;
}
