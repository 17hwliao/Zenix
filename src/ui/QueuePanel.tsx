import { useState } from 'react';
import { ChevronDown, Heart, ListPlus, Star, Trash2, X } from 'lucide-react';
import type { PersonalState } from '../core/types';
import type { PlaylistView, TrackView } from './types';
import CoverArt from './CoverArt';
import { trackCoverUrl } from '../core/trackCover';
import './QueuePanel.css';

type Props = {
  personal: PersonalState; tracks: TrackView[]; playlists: PlaylistView[];
  queue: TrackView[]; currentTrack: TrackView | null;
  onPlayTrack: (track: TrackView, queue?: TrackView[]) => void;
  onRemove: (index: number) => void; onToggleSaved: (kind: 'liked' | 'favorites', track: TrackView) => void;
  onAddToPlaylist: (id: string, track: TrackView) => void; onCreatePlaylist: (name: string, track?: TrackView) => void;
  onOpenManager: () => void; onClose: () => void;
};

export default function QueuePanel({ personal, tracks, playlists, queue, currentTrack, onPlayTrack, onRemove, onToggleSaved, onAddToPlaylist, onCreatePlaylist, onOpenManager, onClose }: Props) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [source, setSource] = useState('queue');
  const [adding, setAdding] = useState<string | null>(null);
  const entries = queue.length ? queue : currentTrack ? [currentTrack] : [];
  const choices = [
    { id: 'queue', label: '当前队列', tracks: entries },
    { id: 'favorites', label: '我的收藏', tracks: personal.favorites },
    { id: 'liked', label: '我的喜欢', tracks: personal.liked },
    { id: 'history', label: '听歌历史', tracks: personal.history.map(item => item.track) },
    ...personal.playlists.map(item => ({ id: item.id, label: item.name, tracks: item.tracks })),
    ...playlists.map(item => ({ id: item.id, label: item.name, tracks: item.trackIds.map(id => tracks.find(track => track.id === id)).filter((track): track is TrackView => Boolean(track)) })),
  ];
  const selected = choices.find(item => item.id === source) ?? choices[0];
  const visibleEntries = source === 'queue' || selected.tracks.length ? entries : [];
  const choose = (id: string) => {
    setSource(id); setSourceOpen(false);
    const list = choices.find(item => item.id === id)?.tracks ?? [];
    if (id !== 'queue' && list[0]) onPlayTrack(list[0], list);
  };
  const makePlaylist = (track?: TrackView) => {
    const name = window.prompt('新歌单名称');
    if (name?.trim()) { onCreatePlaylist(name.trim(), track); setAdding(null); }
  };
  return <aside className="zenix-queue" onClick={event => event.stopPropagation()} aria-label="播放列表">
    <div className="zenix-queue-head"><div><small>ZENIX · NOW PLAYING</small><h2>播放列表</h2></div><button onClick={onClose} aria-label="关闭"><X size={19} /></button></div>
    <div className="zenix-queue-switch"><button onClick={() => setSourceOpen(!sourceOpen)} aria-expanded={sourceOpen}><span>{selected.label}</span><small>{selected.tracks.length} 首</small><ChevronDown size={16} /></button>
      {sourceOpen && <div className="zenix-queue-menu">{choices.map(item => <button key={item.id} className={item.id === source ? 'is-active' : ''} onClick={() => choose(item.id)}><span>{item.label}</span><small>{item.tracks.length}</small></button>)}</div>}
    </div>
    <p className="zenix-queue-hint">点 × 仅从当前播放队列移除；收藏与歌单仍保存在本地。</p>
    <div className="zenix-queue-list">{visibleEntries.length ? visibleEntries.map((track, index) => <div className={`zenix-queue-row${currentTrack?.id === track.id ? ' is-current' : ''}`} key={`${track.id}-${index}`}>
      <button className="zenix-queue-track" onClick={() => onPlayTrack(track, entries)}><span className="zenix-queue-index">{String(index + 1).padStart(2, '0')}</span><CoverArt title={track.title} coverUrl={trackCoverUrl(track)} /><span><strong>{track.title}</strong><small>{track.artist || '未知艺术家'}</small></span></button>
      <div className="zenix-queue-actions"><button className={personal.liked.some(item => item.id === track.id) ? 'is-on' : ''} title="喜欢" aria-label="喜欢" onClick={() => onToggleSaved('liked', track)}><Heart size={16} fill={personal.liked.some(item => item.id === track.id) ? 'currentColor' : 'none'} /></button><button className={personal.favorites.some(item => item.id === track.id) ? 'is-on' : ''} title="收藏" aria-label="收藏" onClick={() => onToggleSaved('favorites', track)}><Star size={16} fill={personal.favorites.some(item => item.id === track.id) ? 'currentColor' : 'none'} /></button><button title="添加到歌单" aria-label="添加到歌单" onClick={() => setAdding(adding === `${index}` ? null : `${index}`)}><ListPlus size={17} /></button><button title="从当前队列移除" aria-label="从当前队列移除" onClick={() => onRemove(index)}><X size={17} /></button></div>
      {adding === `${index}` && <div className="zenix-queue-add"><strong>添加到歌单</strong>{personal.playlists.map(list => <button key={list.id} onClick={() => { onAddToPlaylist(list.id, track); setAdding(null); }}>{list.name}</button>)}<button onClick={() => makePlaylist(track)}>＋ 新建歌单并添加</button></div>}
    </div>) : <div className="zenix-queue-empty">队列里还没有歌曲。可在主页搜索，或导入本地音乐。</div>}</div>
    <div className="zenix-queue-foot"><button onClick={onOpenManager}><Trash2 size={15} />管理收藏与歌单</button><button onClick={() => makePlaylist()}><ListPlus size={16} />新建歌单</button></div>
  </aside>;
}
