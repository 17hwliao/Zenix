import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import OrbitSongSpace from '../../src/features/space/OrbitSongSpace';
import type {Track} from '../../src/core/types';
const songs:Track[]=Array.from({length:296},(_,i)=>({id:`t${i}`,title:`歌曲 ${i}`,artist:'验收歌手',path:'',audioUrl:'',duration:180}));
function Preview(){const [tracks,setTracks]=useState(songs),[selected,setSelected]=useState('t0');Object.assign(window,{orbitAdd:()=>setTracks([...songs,{...songs[0],id:'extra'}])});return <OrbitSongSpace tracks={tracks} selectedId={selected} currentId="t0" playing={false} cardScale={1} onFocus={track=>{setSelected(track.id);(window as any).orbitCalls.focus.push(track.id);}} onPlay={track=>(window as any).orbitCalls.play.push(track.id)} onExpand={()=>(window as any).orbitCalls.expand++} renderCover={track=><div style={{background:'#718599',display:'grid',placeItems:'center',color:'white'}}>{track.id}</div>} renderActions={()=><><button>喜欢</button><button>收藏</button><button>加入歌单</button><button>选择版本</button></>}/>;}
Object.assign(window,{orbitCalls:{focus:[],play:[],expand:0}});createRoot(document.getElementById('root')!).render(<Preview/>);
