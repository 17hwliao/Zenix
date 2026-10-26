import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import PresentationControls from '../../src/features/space/PresentationControls';
import SimpleSongList from '../../src/features/space/SimpleSongList';
import {presentationKey,useSpacePresentation} from '../../src/features/space/presentation';
import type {Track} from '../../src/core/types';
const calls={play:0,expand:0};
const songs=(count:number):Track[]=>Array.from({length:count},(_,index)=>({id:`song-${index}`,title:`${index+1} 长中文歌曲名称测试这里有很长的内容用于检查溢出`,artist:'歌手名称很长的中文内容',album:'测试专辑名称很长的中文内容',duration:180,path:'',audioUrl:''}));
localStorage.setItem('zenix.space.features.v1','preserved-other-preference');
if(new URLSearchParams(location.search).has('broken'))localStorage.setItem(presentationKey,'{broken');
function Observer(){const pref=useSpacePresentation();return <output id="observer">{pref.mode}:{pref.cardScale}</output>;}
function App(){const pref=useSpacePresentation(),[tracks,setTracks]=useState(songs(296)),[selectedId,setSelected]=useState('song-1');
Object.assign(window,{presentationFixture:{calls,change:pref.change,append:()=>setTracks(songs(310))}});
return <main style={{height:'100vh',display:'flex',flexDirection:'column',gap:8,padding:12,boxSizing:'border-box'}}><PresentationControls value={pref} onChange={pref.change} error={pref.error} onDismissError={pref.dismissError}/><Observer/><div style={{flex:1,minHeight:0}}><SimpleSongList tracks={tracks} selectedId={selectedId} currentId="song-0" playing cardScale={pref.cardScale} onFocus={track=>setSelected(track.id)} onPlay={()=>calls.play++} onExpand={()=>calls.expand++} renderCover={()=> <span aria-hidden="true">♫</span>} renderActions={()=> <button type="button" aria-label="收藏歌曲">收藏</button>}/></div></main>;}
createRoot(document.getElementById('root')!).render(<App/>);
