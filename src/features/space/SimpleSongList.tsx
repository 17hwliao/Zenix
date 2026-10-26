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
  <div className="space-song-list-summary">共 {tracks.length} 首歌曲<span>点击歌名查看，播放请使用播放按钮</span></div>
  <div className="space-song-list-scroll">
   {tracks.length===0?<p className="space-song-list-empty">当前范围还没有歌曲。可以搜索歌曲，或选择其他歌单。</p>:<ol>
    {tracks.slice(0,visible).map((track,index)=>{const focused=selectedId===track.id,current=currentId===track.id;return <li key={`${track.id}:${index}`} className={`${focused?'is-focused ':''}${current?'is-current':''}`}>
     <span className="space-song-number" aria-hidden="true">{index+1}</span>
     <button type="button" className="space-song-cover" aria-label={`查看 ${track.title}`} onClick={()=>onFocus(track)}>{renderCover(track)}</button>
     <div className="space-song-info"><button type="button" className="space-song-title" aria-pressed={focused} title={track.title} onClick={()=>onFocus(track)}>{track.title||'未命名歌曲'}</button><span className="space-song-artist" title={track.artist}>{track.artist||'未知歌手'}</span><span className="space-song-album" title={track.album}>{track.album||'未知专辑'}</span><span className="space-song-status">{current?(playing?'正在播放':'当前歌曲 · 已暂停'):focused?'已选中':''}</span></div>
     <span className="space-song-duration" aria-label="时长">{duration(track.duration)}</span>
     <div className="space-song-list-actions"><button type="button" className="space-song-play" aria-label={`播放 ${track.title}`} onClick={()=>onPlay(track)}>播放</button>{focused&&current&&onExpand&&<button type="button" aria-label={`放大 ${track.title}`} onClick={onExpand}>放大</button>}{renderActions?.(track)}</div>
    </li>;})}
   </ol>}
   {visible<tracks.length&&<button className="space-song-list-more" type="button" onClick={()=>setVisible(count=>count+60)}>继续显示歌曲（已显示 {Math.min(visible,tracks.length)} / {tracks.length} 首）</button>}
  </div>
 </section>;
}
