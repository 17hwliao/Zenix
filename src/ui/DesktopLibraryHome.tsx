import {ArrowRight, ChevronRight, Compass, Download, FolderOpen, Heart, History, Home, Layers, ListMusic, Mic2, MonitorSmartphone, Music2, Pencil, Play, Search, Settings2, Sparkles} from 'lucide-react';
import type {PersonalState} from '../core/types';
import {trackCoverUrl} from '../core/trackCover';
import CoverArt from './CoverArt';
import type {TrackView} from './types';
import {motion, useReducedMotion} from 'framer-motion';
import {useState} from 'react';
import ZenbotCharacter,{useAssistantFigure} from '../features/assistant/ZenbotCharacter';
import {StyleQuickControls,StyleDialog,StyleButton} from '../features/themes/ApplicationStyleSettings';
import './BentoHome.css';

export const desktopHomeStyleKey = 'zenix.desktop.home-style.v1';
export type DesktopHomeStyle = 'library' | 'cards';

export function readDesktopHomeStyle(): DesktopHomeStyle {
  try { return localStorage.getItem(desktopHomeStyleKey) === 'cards' ? 'cards' : 'library'; }
  catch { return 'library'; }
}

type NavProps = {
  active: string;
  reducedMotion?: boolean;
  onHome(): void;
  onSpace(): void;
  onRoaming?: () => void;
  onCollection(id: string): void;
  onLibrary(): void;
  onTool(id: string): void;
  onSettings(): void;
};

export function DesktopLibraryNavigation({active, reducedMotion, onHome, onSpace, onRoaming, onCollection, onLibrary, onTool, onSettings}: NavProps) {
  const reduced = useReducedMotion();
  const item = (id: string, label: string, Icon: typeof Home, action: () => void) => (
    <button key={id} type="button" data-destination={id} aria-current={active === id ? 'page' : undefined} title={label} onClick={action}>
      {active === id && <motion.span className="zenix-nav-active-surface" layoutId="desktop-navigation-selection" transition={{duration:reduced||reducedMotion?0:.18}} aria-hidden="true"/>}
      <Icon size={19} aria-hidden="true"/><span>{label}</span>
    </button>
  );

  return <nav className="zenix-desktop-nav" aria-label="桌面主导航">
    <button type="button" className="zenix-desktop-brand" onClick={onHome} aria-label="Zenix 首页">Zenix</button>
    <div className="zenix-desktop-nav-scroll">
      <div className="zenix-desktop-nav-group">
        {item('home', '首页', Home, onHome)}
        {item('space', '音乐空间', Layers, onSpace)}
        {onRoaming && item('roaming', '音乐漫游', Compass, onRoaming)}
      </div>
      <div className="zenix-desktop-nav-group" role="group" aria-label="我的资料">
        <span className="zenix-desktop-nav-label" aria-hidden="true">我的资料</span>
        {item('liked', '喜欢与收藏', Heart, () => onCollection('liked'))}
        {item('playlists', '我的歌单', ListMusic, () => onCollection('playlists'))}
        {item('history', '听歌历史', History, () => onCollection('history'))}
        {item('library', '本地曲库', FolderOpen, onLibrary)}
      </div>
      <div className="zenix-desktop-nav-group" role="group" aria-label="工具">
        <span className="zenix-desktop-nav-label" aria-hidden="true">工具</span>
        {item('karaoke', 'K 歌', Mic2, () => onTool('karaoke'))}
        {item('tasks', '缓存与任务', Download, () => onTool('tasks'))}
        {item('connections', '设备协作', MonitorSmartphone, () => onTool('connections'))}
        {item('assistant', '音乐助手', Sparkles, () => onTool('assistant'))}
      </div>
    </div>
    <div className="zenix-desktop-nav-group zenix-desktop-nav-settings">{item('settings', '设置', Settings2, onSettings)}</div>
  </nav>;
}

type HomeProps = {
  name: string;
  subject: string;
  background: string;
  cropped?: boolean;
  personal: PersonalState;
  onEdit(): void;
  onSearch(): void;
  onOpenCollection(id: string): void;
  onPlay(track: TrackView, queue: TrackView[]): void;
  onSpace?: () => void;
  onTool?: (id:string) => void;
};

export function DesktopIdentity({name, subject, background, cropped, onEdit}: Pick<HomeProps,'name'|'subject'|'background'|'cropped'> & {onEdit?: () => void}) {
  return <div className="zenix-desktop-identity" data-cropped={cropped || undefined}>
    {background && <img className="zenix-desktop-identity-background" src={background} alt=""/>}
    <span className="zenix-desktop-monogram" aria-hidden="true">{subject ? <img src={subject} alt=""/> : (Array.from(name)[0] || 'Z').toUpperCase()}</span>
    <h2 title={name}>{name}</h2>
    {onEdit && <button type="button" onClick={onEdit}><Pencil size={16} aria-hidden="true"/>编辑名片</button>}
  </div>;
}

export default function DesktopLibraryHome({name, subject, background, cropped, personal, onEdit, onSearch, onOpenCollection, onPlay,onSpace,onTool}: HomeProps) {
  const [styleOpen,setStyleOpen]=useState(false);
  const figure=useAssistantFigure();
  const reduced=useReducedMotion();
  const latest=personal.history[0]?.track;
  return <main className="zenix-desktop-home" aria-label="首页内容">
    <header className="zx-home-heading"><div><small>WELCOME BACK</small><h1>把今天，交给音乐。</h1><p>熟悉的旋律，也可以有不一样的打开方式。</p></div><StyleButton/></header>
    <div className="zx-home-grid">
      <section className="bento-card card--ns zx-home-hero"><div className="zx-home-copy"><small>YOUR MUSIC, YOUR SPACE</small><h2>你的节奏，<br/>从<em>这里</em>开始。</h2><p>{latest ? <>继续听 {latest.title}，或去发现下一首喜欢。</> : '从一首喜欢的歌，走进自己的音乐空间。'}</p><div><button className="zx-action" type="button" onClick={()=>latest?onPlay(latest,personal.history.map(item=>item.track)):onSearch()}>{latest?<Play size={16}/>:<Search size={16}/ >}{latest?'继续播放':'搜索音乐'}</button>{onSpace&&<button className="zx-action" type="button" onClick={onSpace}>音乐空间<ArrowRight size={16}/></button>}</div></div><div className="zx-home-character" aria-label="首页助手人物"><ZenbotCharacter state="idle" figure={figure} reduced={Boolean(reduced)}/><span>{figure==='whale'?'DEEPSEEK':'ZENBOT'} / YOUR COMPANION</span></div></section>
      <section className="bento-card card--ns zx-home-profile"><DesktopIdentity name={name} subject={subject} background={background} cropped={cropped} onEdit={onEdit}/><div className="zx-home-counts"><button type="button" onClick={()=>onOpenCollection('liked')}><Heart size={17}/><strong>{personal.liked.length}</strong><span>喜欢</span></button><button type="button" onClick={()=>onOpenCollection('playlists')}><ListMusic size={17}/><strong>{personal.playlists.length}</strong><span>歌单</span></button></div></section>
      <div className="zx-home-collections"><DesktopLibraryCollections personal={personal} onSearch={onSearch} onOpenCollection={onOpenCollection} onPlay={onPlay}/></div>
      <section className="bento-card card--ns zx-home-tools"><h2>随心探索</h2><div>{([{id:'karaoke',name:'唱一首',icon:Mic2},{id:'connections',name:'设备协作',icon:MonitorSmartphone},{id:'tasks',name:'离线听',icon:Download}] as const).map(tool=><button type="button" key={tool.id} onClick={()=>onTool?onTool(tool.id):window.dispatchEvent(new CustomEvent('zenix-open-workbench',{detail:{tab:tool.id}}))}><tool.icon size={20}/>{tool.name}</button>)}</div></section>
      <div className="bento-card card--ns zx-home-style"><StyleQuickControls onOpen={()=>setStyleOpen(true)}/></div>
    </div>
    {styleOpen&&<StyleDialog onClose={()=>setStyleOpen(false)}/>}
  </main>;
}

export function DesktopLibraryCollections({personal,onSearch,onOpenCollection,onPlay}: Pick<HomeProps,'personal'|'onSearch'|'onOpenCollection'|'onPlay'>) {
  const recent = personal.history.slice(0, 4);
  const playlists = personal.playlists.slice(0, 4);

  return <>
    <section className="zenix-desktop-section" aria-labelledby="zenix-desktop-recent">
      <header><h2 id="zenix-desktop-recent">最近播放</h2>{recent.length > 0 && <button type="button" aria-label="查看听歌历史" onClick={() => onOpenCollection('history')}><ChevronRight size={20}/></button>}</header>
      {recent.length > 0 ? <div className="zenix-desktop-recent">{recent.map(({id, track}) => (
        <button key={id} type="button" className="zenix-desktop-track" aria-label={`播放 ${track.title}`} onClick={() => onPlay(track, personal.history.map(entry => entry.track))}>
          <CoverArt title={track.title} coverUrl={trackCoverUrl(track)}/>
          <span className="zenix-desktop-track-caption"><span><strong title={track.title}>{track.title}</strong><small>{track.artist || '未知歌手'}</small></span><Play size={17} aria-hidden="true"/></span>
        </button>
      ))}</div> : <div className="zenix-desktop-empty"><Music2 size={24} aria-hidden="true"/><span>听过的歌曲会显示在这里</span><button type="button" onClick={onSearch}><Search size={15} aria-hidden="true"/>搜索音乐</button></div>}
    </section>

    <section className="zenix-desktop-section" aria-labelledby="zenix-desktop-playlists">
      <header><h2 id="zenix-desktop-playlists">我的歌单</h2><button type="button" aria-label="管理我的歌单" onClick={() => onOpenCollection('playlists')}><ChevronRight size={20}/></button></header>
      {playlists.length > 0 ? <ul className="zenix-desktop-playlists">{playlists.map(list => (
        <li key={list.id}>
          <button type="button" className="zenix-desktop-playlist-open" onClick={() => onOpenCollection(list.id)}>
            <CoverArt title={list.name} coverUrl={trackCoverUrl(list.tracks[0])}/><strong title={list.name}>{list.name}</strong><small>{list.tracks.length} 首</small>
          </button>
          <button type="button" className="zenix-desktop-playlist-play" disabled={!list.tracks.length} aria-label={`播放歌单 ${list.name}`} onClick={() => {
            const queue = list.tracks.map(track => ({...track, playlistId: list.id}));
            if (queue.length) onPlay(queue[0], queue);
          }}><Play size={17}/></button>
        </li>
      ))}</ul> : <div className="zenix-desktop-empty"><ListMusic size={24} aria-hidden="true"/><span>还没有歌单</span><button type="button" onClick={() => onOpenCollection('playlists')}>管理歌单<ArrowRight size={15} aria-hidden="true"/></button></div>}
    </section>
  </>;
}
