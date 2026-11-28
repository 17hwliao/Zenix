import {useMemo, useState} from 'react';
import {FolderInput, FolderOpen, ListMusic, Music2, Play, Plus, RefreshCw, Search} from 'lucide-react';
import {PlaylistManager} from '../playlists/PlaylistManager';
import CoverArt from './CoverArt';
import {trackCoverUrl} from '../core/trackCover';
import type {TrackView} from './types';

export default function DesktopLocalLibrary({tracks, busy, onImportFolder, onAddFiles, onRefresh, onPlayTrack}: {
  tracks: TrackView[]; busy: boolean; onImportFolder(): void | Promise<void>; onAddFiles?: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>; onPlayTrack(track: TrackView, queue: TrackView[]): void;
}) {
  const [tab, setTab] = useState('tracks'), [query, setQuery] = useState(''), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const filtered = useMemo(() => tracks.filter(track => `${track.title} ${track.artist} ${track.album || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [tracks, query]);
  const run = async (action: () => void | Promise<void>) => {
    if (pending || busy) return;
    setPending(true); setError('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败，请重试。'); } finally { setPending(false); }
  };
  return <div className="zenix-local-library">
    <div className="zenix-library-topline"><nav className="zenix-collection-tabs" aria-label="本地曲库视图"><button aria-current={tab==='tracks'?'page':undefined} onClick={()=>setTab('tracks')}><Music2 size={16}/>全部歌曲<span>{tracks.length}</span></button><button aria-current={tab==='playlists'?'page':undefined} onClick={()=>setTab('playlists')}><ListMusic size={16}/>本地歌单</button></nav><div className="zenix-library-import-actions"><button className="zenix-workspace-primary" disabled={pending||busy} onClick={()=>void run(onImportFolder)}><FolderInput size={16}/>导入文件夹</button>{onAddFiles&&<button disabled={pending||busy} onClick={()=>void run(onAddFiles)}><Plus size={16}/>添加文件</button>}</div></div>
    {error&&<p role="alert" className="zenix-library-error">{error}</p>}
    {tab==='playlists'?<PlaylistManager embedded onClose={()=>setTab('tracks')} onPlayTrack={onPlayTrack}/>:<>
      <div className="zenix-library-toolbar"><label className="zenix-library-search"><Search size={16}/><input aria-label="搜索本地曲库" placeholder="搜索歌曲、艺人或专辑" value={query} onChange={event=>setQuery(event.target.value)}/></label>{onRefresh&&<button disabled={pending||busy} onClick={()=>void run(onRefresh)}><RefreshCw size={15}/>刷新曲库</button>}</div>
      {busy||pending?<p className="zenix-library-status" role="status">正在更新曲库，已有歌曲仍可播放…</p>:null}
      <div className="zenix-local-tracks" aria-label="本地歌曲"><div className="zenix-local-track-head" aria-hidden="true"><span>#</span><span>歌曲 / 艺人</span><span>专辑</span><span>时长</span></div>{filtered.map((track,index)=><button className="zenix-local-track" key={track.id} onClick={()=>onPlayTrack(track,filtered)} aria-label={`播放 ${track.title}`}><span className="zenix-local-track-number"><span>{String(index+1).padStart(2,'0')}</span><Play size={14}/></span><span className="zenix-local-track-song"><CoverArt title={track.title} coverUrl={trackCoverUrl(track)}/><span><strong>{track.title}</strong><small>{track.artist||'未知艺术家'}</small></span></span><span className="zenix-local-track-album">{track.album||'—'}</span><span className="zenix-local-track-duration">{track.duration>0?`${Math.floor(track.duration/60)}:${String(Math.floor(track.duration%60)).padStart(2,'0')}`:'—'}</span></button>)}</div>
      {!filtered.length&&<div className="zenix-workspace-state"><FolderOpen size={32}/><h2>{query?'没有找到匹配的歌曲':busy?'正在读取曲库':'把喜欢的音乐带进来'}</h2><p>{query?'试试其他歌名、艺人或专辑。':'导入本地文件夹或音频文件，在这里整理与播放。'}</p>{query?<button onClick={()=>setQuery('')}>清除搜索</button>:<button disabled={pending||busy} onClick={()=>void run(onImportFolder)}>导入文件夹</button>}</div>}
    </>}
  </div>;
}
