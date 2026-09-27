import { useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, Disc3, Heart, History, ImagePlus, ListMusic, Music2, Search, Settings2, Sparkles, Star } from 'lucide-react';
import type { PersonalState } from '../core/types';
import type { TrackView } from './types';
import CoverArt from './CoverArt';
import './PersonalHome.css';

type Props = {
  personal: PersonalState;
  tracks: TrackView[];
  currentTrack: TrackView | null;
  onPlayTrack: (track: TrackView, queue?: TrackView[]) => void;
  onOpenPlayer: () => void;
  onOpenSearch: (query: string) => void;
  onOpenManager: (id: string) => void;
  onOpenSettings: () => void;
  onChooseBackground?: () => void | Promise<void>;
  onImportFolder: () => void | Promise<void>;
  onAddFiles?: () => void | Promise<void>;
  onOpenLocalLibrary?: () => void;
  onImportPlaylist?: () => void | Promise<void>;
};

export default function PersonalHome({ personal, tracks, currentTrack, onPlayTrack, onOpenPlayer, onOpenSearch, onOpenManager, onOpenSettings, onChooseBackground, onImportFolder, onAddFiles, onOpenLocalLibrary, onImportPlaylist }: Props) {
  const [name, setName] = useState(() => localStorage.getItem('zenix.profile.name') || '我的音乐空间');
  const [tagline, setTagline] = useState(() => localStorage.getItem('zenix.profile.tagline') || '把喜欢的声音，留在自己的宇宙里。');
  const [query, setQuery] = useState('');
  const suggested = useMemo(() => {
    const word = query.trim().toLocaleLowerCase();
    if (!word) return [];
    return tracks.filter(track => `${track.title} ${track.artist}`.toLocaleLowerCase().includes(word)).slice(0, 4);
  }, [query, tracks]);
  const historyTracks = personal.history.slice(0, 24).map(entry => entry.track);
  const collections = [
    { id: 'liked', label: '我的喜欢', count: personal.liked.length, icon: Heart, tone: 'rose' },
    { id: 'favorites', label: '我的收藏', count: personal.favorites.length, icon: Star, tone: 'gold' },
    { id: 'history', label: '听歌历史', count: personal.history.length, icon: History, tone: 'blue' },
    { id: 'playlists', label: '自定义歌单', count: personal.playlists.length, icon: ListMusic, tone: 'violet' },
  ];
  const playQuick = (event: FormEvent) => {
    event.preventDefault();
    if (suggested[0]) { onPlayTrack(suggested[0], suggested); onOpenPlayer(); }
    else onOpenSearch(query);
  };

  return <div className="zenix-home-space">
    <header className="zenix-home-top"><span className="zenix-home-logo">Zenix<span>.</span></span><div><button onClick={onOpenSettings} title="个性化设置"><Settings2 size={17} />个性化设置</button><button onClick={onOpenPlayer} title="进入贴纸播放器"><Disc3 size={18} />进入音乐空间<ArrowRight size={16} /></button></div></header>
    <div className="zenix-home-scroll">
      <section className="zenix-profile-card">
        <div className="zenix-profile-orbit" aria-hidden="true"><span /></div>
        <div className="zenix-profile-main"><div className="zenix-profile-avatar">Z</div><span className="zenix-home-eyebrow"><Sparkles size={13} /> PERSONAL MUSIC SPACE</span>
          <input className="zenix-profile-name" aria-label="空间名称" value={name} maxLength={36} onChange={event => { setName(event.target.value); localStorage.setItem('zenix.profile.name', event.target.value); }} />
          <input className="zenix-profile-tagline" aria-label="空间简介" value={tagline} maxLength={100} onChange={event => { setTagline(event.target.value); localStorage.setItem('zenix.profile.tagline', event.target.value); }} />
          <div className="zenix-profile-stats"><span><strong>{tracks.length}</strong>本地歌曲</span><span><strong>{personal.liked.length}</strong>喜欢</span><span><strong>{personal.playlists.length}</strong>歌单</span></div>
        </div>
        <div className="zenix-profile-aside"><span>YOUR SPACE, YOUR SOUND</span><button onClick={() => void onChooseBackground?.()}><ImagePlus size={15} />更换空间背景</button></div>
      </section>

      <section className="zenix-home-search-section"><div><span className="zenix-home-eyebrow">QUICK SEARCH</span><h2>下一首，想听什么？</h2></div><form onSubmit={playQuick}><Search size={19} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索本地歌曲，或按 Enter 搜索在线音乐" aria-label="快速搜索歌曲" /><button type="submit"><ArrowRight size={18} /></button></form></section>
      {suggested.length > 0 && <div className="zenix-home-suggestions">{suggested.map(track => <button key={track.id} onClick={() => { onPlayTrack(track, suggested); onOpenPlayer(); }}><CoverArt title={track.title} coverUrl={track.coverUrl} /><span><strong>{track.title}</strong><small>{track.artist}</small></span><ArrowRight size={15} /></button>)}</div>}

      <section className="zenix-home-section"><div className="zenix-home-section-head"><div><span className="zenix-home-eyebrow">LIBRARY</span><h2>我的音乐收藏</h2></div><button onClick={() => onOpenManager('playlists')}>管理歌曲与歌单<ArrowRight size={15} /></button></div><div className="zenix-collection-cards">{collections.map(item => <button key={item.id} className={`zenix-collection-card tone-${item.tone}`} onClick={() => onOpenManager(item.id)}><item.icon size={25} strokeWidth={1.4} /><span><strong>{item.label}</strong><small>{item.count} {item.id === 'playlists' ? '个歌单' : '首歌曲'}</small></span><ArrowRight size={18} /></button>)}</div></section>

      <section className="zenix-home-section"><div className="zenix-home-section-head"><div><span className="zenix-home-eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>继续聆听</h2></div><button onClick={() => onOpenManager('history')}>全部历史<ArrowRight size={15} /></button></div>
        {historyTracks.length ? <div className="zenix-recent-strip">{historyTracks.slice(0, 8).map((track, index) => <button key={`${track.id}-${index}`} onClick={() => { onPlayTrack(track, historyTracks); onOpenPlayer(); }}><CoverArt title={track.title} coverUrl={track.coverUrl} /><strong>{track.title}</strong><small>{track.artist}</small></button>)}</div> : <div className="zenix-home-empty"><Music2 size={25} /><span>听过的歌曲会出现在这里</span>{currentTrack && <button onClick={onOpenPlayer}>继续播放</button>}</div>}
      </section>
      <div className="zenix-home-foot"><div><button onClick={() => void onImportFolder()}>导入文件夹</button>{onAddFiles && <button onClick={() => void onAddFiles()}>添加音乐文件</button>}{onImportPlaylist && <button onClick={() => void onImportPlaylist()}>导入 M3U 歌单</button>}{onOpenLocalLibrary && <button onClick={onOpenLocalLibrary}>管理本地曲库</button>}</div><span>ZENIX · MADE PERSONAL</span></div>
    </div>
  </div>;
}
