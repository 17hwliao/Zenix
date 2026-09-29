import { useState } from 'react';
import { ArrowLeft, Heart, History, ListMusic, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import type { PersonalState } from '../core/types';
import type { TrackView } from './types';
import CoverArt from './CoverArt';
import { trackCoverUrl } from '../core/trackCover';
import './PersonalLibraryManager.css';

type Props = { initialSection: string; personal: PersonalState; tracks: TrackView[]; onClose: () => void; onPlayTrack: (track: TrackView, queue: TrackView[]) => void; onCreatePlaylist: (name: string) => void; onRenamePlaylist: (id: string, name: string) => void; onDeletePlaylist: (id: string) => void; onRemoveSaved: (kind: 'liked' | 'favorites' | 'history', id: string) => void; onRemovePersonalTrack: (id: string, trackId: string) => void; onAddToPlaylist: (id: string, track: TrackView) => void; };
export default function PersonalLibraryManager({ initialSection, personal, tracks, onClose, onPlayTrack, onCreatePlaylist, onRenamePlaylist, onDeletePlaylist, onRemoveSaved, onRemovePersonalTrack, onAddToPlaylist }: Props) {
  const [section, setSection] = useState(initialSection);
  const [query, setQuery] = useState('');
  const sections = [{ id: 'liked', label: '我的喜欢', icon: Heart }, { id: 'favorites', label: '我的收藏', icon: Star }, { id: 'history', label: '听歌历史', icon: History }, { id: 'playlists', label: '自定义歌单', icon: ListMusic }];
  const playlist = personal.playlists.find(item => item.id === section);
  const entries = section === 'liked' ? personal.liked.map(track => ({ id: track.id, track })) : section === 'favorites' ? personal.favorites.map(track => ({ id: track.id, track })) : section === 'history' ? personal.history.map(item => ({ id: item.id, track: item.track })) : playlist?.tracks.map(track => ({ id: track.id, track })) ?? [];
  const filtered = entries.filter(item => `${item.track.title} ${item.track.artist}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const title = sections.find(item => item.id === section)?.label ?? playlist?.name ?? '歌曲管理';
  const create = () => { const name = window.prompt('新歌单名称'); if (name?.trim()) onCreatePlaylist(name.trim()); };
  return <div className="zenix-manager" role="dialog" aria-modal="true" aria-label="歌曲与歌单管理">
    <aside><div className="zenix-manager-brand"><button onClick={onClose} aria-label="返回主页"><ArrowLeft size={18} /></button><span>Zenix / 我的空间</span></div><h2>音乐管理</h2><small>永久保存于这台设备</small><nav>{sections.map(item => <button key={item.id} className={section === item.id ? 'is-active' : ''} onClick={() => setSection(item.id)}><item.icon size={17} />{item.label}</button>)}</nav><div className="zenix-manager-list-head"><span>我的歌单</span><button onClick={create} title="新建歌单"><Plus size={17} /></button></div><nav>{personal.playlists.map(item => <button key={item.id} className={section === item.id ? 'is-active' : ''} onClick={() => setSection(item.id)}><ListMusic size={17} />{item.name}<small>{item.tracks.length}</small></button>)}</nav></aside>
    <main><header><div><small>PERSONAL LIBRARY</small><h1>{title}</h1><p>{section === 'history' ? '同一首歌曲只保留最近一次播放，记录保存在本地。' : '在这里删除的内容会从本地收藏或歌单中真正移除。'}</p></div><button onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
      {section === 'playlists' ? <div className="zenix-manager-empty"><ListMusic size={35} /><h3>创造你的下一张歌单</h3><p>在播放列表里给歌曲点「添加到歌单」，也可以在这里新建。</p><button onClick={create}><Plus size={16} />新建歌单</button></div> : <><div className="zenix-manager-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="在当前分类中搜索歌曲" />{playlist && <><button onClick={() => { const name = window.prompt('歌单名称', playlist.name); if (name?.trim()) onRenamePlaylist(playlist.id, name.trim()); }}><Pencil size={15} />重命名</button><button onClick={() => { if (window.confirm(`删除歌单「${playlist.name}」？`)) { onDeletePlaylist(playlist.id); setSection('playlists'); } }}><Trash2 size={15} />删除歌单</button></>}</div>
      {playlist && <div className="zenix-manager-add"><select defaultValue="" onChange={event => { const track = tracks.find(item => item.id === event.target.value); if (track) onAddToPlaylist(playlist.id, track); event.target.value = ''; }}><option value="">＋ 添加本地歌曲到此歌单</option>{tracks.filter(item => !playlist.tracks.some(saved => saved.id === item.id)).map(item => <option key={item.id} value={item.id}>{item.title} — {item.artist}</option>)}</select></div>}
      <div className="zenix-manager-tracks">{filtered.map((item, index) => <div key={`${item.id}-${index}`} className="zenix-manager-track"><button onClick={() => onPlayTrack(item.track, entries.map(entry => entry.track))}><span>{String(index + 1).padStart(2, '0')}</span><CoverArt title={item.track.title} coverUrl={trackCoverUrl(item.track)} /><span><strong>{item.track.title}</strong><small>{item.track.artist}</small></span></button><button className="zenix-manager-delete" onClick={() => playlist ? onRemovePersonalTrack(playlist.id, item.track.id) : onRemoveSaved(section as 'liked' | 'favorites' | 'history', item.id)} title="从本地收藏中删除" aria-label="删除"><Trash2 size={17} /></button></div>)}{!filtered.length && <div className="zenix-manager-empty">这里暂时没有歌曲</div>}</div></>}
    </main>
  </div>;
}
