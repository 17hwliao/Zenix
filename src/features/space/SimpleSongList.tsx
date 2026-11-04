import {Maximize2,Pause,Play} from 'lucide-react';
import {useEffect,useState} from 'react';
import type {SongPresentationProps} from './presentationTypes';
import './spacePresentation.css';
const duration=(seconds:number)=>Number.isFinite(seconds)&&seconds>0?`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`:'—';
export default function SimpleSongList({tracks,selectedId,currentId,playing,compact,onFocus,onPlay,onExpand,renderCover,renderActions}:SongPresentationProps){
 const [visible,setVisible]=useState(60);
 const firstId=tracks[0]?.id;
 // Appending source results must not remount rows or move the user's scroll position.
 useEffect(()=>setVisible(60),[firstId]);
 return <section className={`space-song-list${compact?' is-compact':''}`} aria-label="简约歌曲列表">
  <header className="space-song-list-summary"><strong>歌曲</strong><span>{tracks.length} 首</span></header>
  <div className="space-song-list-scroll">
   {tracks.length===0?<p className="space-song-list-empty">当前范围还没有歌曲。可以搜索歌曲，或选择其他歌单。</p>:<ol>
    {tracks.slice(0,visible).map((track,index)=>{const focused=selectedId===track.id,current=currentId===track.id;return <li key={`${track.id}:${index}`} className={`${focused?'is-focused ':''}${current?'is-current':''}`}>
     <span className="space-song-number" aria-hidden="true">{index+1}</span>
     <button type="button" className="space-song-cover" aria-label={`查看 ${track.title}`} onClick={()=>onFocus(track)}>{renderCover(track)}</button>
     <div className="space-song-info"><button type="button" className="space-song-title" aria-pressed={focused} title={track.title} onClick={()=>onFocus(track)}>{track.title||'未命名歌曲'}</button><span className="space-song-artist" title={track.artist}>{track.artist||'未知歌手'}</span></div><span className="space-song-album" title={track.album}>{track.album||'—'}</span>
     <span className="space-song-duration" aria-label="时长">{duration(track.duration)}</span>
     <button type="button" className="space-song-play" aria-label={`${current&&playing?'暂停':'播放'} ${track.title}`} title={current&&playing?'暂停':'播放'} onClick={()=>onPlay(track)}>{current&&playing?<Pause size={17}/>:<Play size={17}/>}</button>
     {focused&&(renderActions||current&&onExpand)&&<div className="space-song-list-actions" aria-label={`${track.title} 的歌曲操作`}>{current&&onExpand&&<button type="button" aria-label={`放大 ${track.title}`} title="放大" onClick={onExpand}><Maximize2 size={16}/></button>}{renderActions?.(track)}</div>}
    </li>;})}
   </ol>}
   {visible<tracks.length&&<button className="space-song-list-more" type="button" onClick={()=>setVisible(count=>count+60)}>继续显示歌曲（已显示 {Math.min(visible,tracks.length)} / {tracks.length} 首）</button>}
  </div>
 </section>;
}
