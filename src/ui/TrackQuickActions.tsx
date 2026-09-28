import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Heart, ListPlus, Star, X } from 'lucide-react';
import type { PersonalState } from '../core/types';
import type { TrackView } from './types';
import './TrackQuickActions.css';

type Props = {
  track: TrackView;
  personal: PersonalState;
  onToggleSaved?: (kind: 'liked' | 'favorites', track: TrackView) => void;
  onAddToPlaylist?: (id: string, track: TrackView) => void;
  onCreatePlaylist?: (name: string, track: TrackView) => void;
  compact?: boolean;
};

export default function TrackQuickActions({ track, personal, onToggleSaved, onAddToPlaylist, onCreatePlaylist, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [placement, setPlacement] = useState({ left: 0, top: 0 });
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const liked = personal.liked.some(item => item.id === track.id);
  const favorite = personal.favorites.some(item => item.id === track.id);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (anchor.current?.contains(event.target as Node) || menu.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    const reposition = () => setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('resize', reposition);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape, true); window.removeEventListener('resize', reposition); };
  }, [open]);

  const toggleMenu = () => {
    if (!open && anchor.current) {
      const rect = anchor.current.getBoundingClientRect();
      setPlacement({ left: Math.max(8, Math.min(window.innerWidth - 230, rect.right - 220)), top: Math.max(8, rect.top - Math.min(260, 70 + personal.playlists.length * 37)) });
    }
    setOpen(value => !value);
  };
  const create = () => {
    if (!name.trim()) return;
    onCreatePlaylist?.(name.trim(), track);
    setName('');
    setOpen(false);
  };

  return <div className={`yz-track-actions${compact ? ' is-compact' : ''}`}>
    <button type="button" className={liked ? 'is-on' : ''} title={liked ? '取消喜欢' : '喜欢'} aria-label={liked ? '取消喜欢' : '喜欢'} aria-pressed={liked} onClick={() => onToggleSaved?.('liked', track)}><Heart size={compact ? 15 : 17} fill={liked ? 'currentColor' : 'none'} /></button>
    <button type="button" className={favorite ? 'is-on' : ''} title={favorite ? '取消收藏' : '收藏'} aria-label={favorite ? '取消收藏' : '收藏'} aria-pressed={favorite} onClick={() => onToggleSaved?.('favorites', track)}><Star size={compact ? 15 : 17} fill={favorite ? 'currentColor' : 'none'} /></button>
    <button ref={anchor} type="button" title="加入歌单" aria-label="加入歌单" aria-expanded={open} onClick={toggleMenu}><ListPlus size={compact ? 16 : 18} /></button>
    {open && createPortal(<div ref={menu} className="yz-track-actions-menu" style={placement}>
      <div className="yz-track-actions-menu-head"><strong>加入歌单</strong><button type="button" onClick={() => setOpen(false)} aria-label="关闭"><X size={15} /></button></div>
      <div className="yz-track-actions-menu-list">{personal.playlists.map(list => <button type="button" key={list.id} onClick={() => { onAddToPlaylist?.(list.id, track); setOpen(false); }}>{list.name}<small>{list.tracks.length} 首</small></button>)}</div>
      <form onSubmit={event => { event.preventDefault(); create(); }}><input value={name} onChange={event => setName(event.target.value)} placeholder="新歌单名称" aria-label="新歌单名称" /><button type="submit" disabled={!name.trim()}>新建</button></form>
    </div>, document.body)}
  </div>;
}
