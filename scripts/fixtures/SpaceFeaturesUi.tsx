import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import StickerSpace from '../../src/mobile/StickerSpace';
import LatticePlayer from '../../src/ui/LatticePlayer';
import {captureSpace,restoreSpace,writeSpace} from '../../src/features/space/state';
import type {Track} from '../../src/core/types';
import '../../src/ui/Zenix.css';
import '../../src/mobile/mobile.css';
const tracks:Track[]=Array.from({length:20},(_,i)=>({id:'song-'+i,title:'歌曲 '+i,artist:'测试歌手',source:'custom',providerId:'fixture',remoteId:String(i),duration:120,path:'',audioUrl:''}));
const personal={liked:[],favorites:[],history:[],playlists:[]},playback={track:tracks[0],playing:false,position:12,duration:120,volume:.75,muted:false,shuffle:false,repeat:'all' as const,queue:tracks,queueIndex:0};
function Fixture(){const [mode,setMode]=useState(new URLSearchParams(location.search).get('mode')||'desktop');const calls={play:0};const no=()=>{},play=()=>calls.play++;(window as any).spaceFixture={captureSpace,restoreSpace,writeSpace,setMode,calls,tracks};return mode==='none'?<div>没有空间</div>:mode==='mobile'?<StickerSpace songs={tracks} state={{playback,personal,sources:[],cache:{usedBytes:0,enabled:true,limitMiB:128}}} label="测试空间" play={play} full={no} actions={()=>null} seek={no} focusRequest={0}/>:<LatticePlayer track={tracks[0]} personal={personal} queue={tracks} queueIndex={0} displayTracks={tracks} onPlayTrack={play} lyrics={[]} playing={false} position={12} duration={120} volume={.75} muted={false} shuffle={false} repeat="all" onBack={no} onTogglePlay={no} onPrevious={no} onNext={no} onSeek={no} onVolumeChange={no} onOpenQueue={no} onExpandPlayer={no} onOpenSettings={no} onOpenSearch={no}/>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
