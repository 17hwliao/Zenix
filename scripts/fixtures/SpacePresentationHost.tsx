import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import LatticePlayer from '../../src/ui/LatticePlayer';
import StickerSpace from '../../src/mobile/StickerSpace';
import {captureSpace,restoreSpace,rules,type SpaceState} from '../../src/features/space/state';
import SpaceFeaturesPanel from '../../src/features/space/SpaceFeaturesPanel';
import {presentationKey} from '../../src/features/space/presentation';
import type {Track} from '../../src/core/types';
const platform=new URLSearchParams(location.search).get('platform')||'desktop';
await(platform==='mobile'?import('../../src/mobile/mobile.css'):import('../../src/ui/Zenix.css'));
localStorage.removeItem(presentationKey);
localStorage.setItem('zenix.host-test.preserved',JSON.stringify({playlists:['我的歌单'],source:'fixture-source',liked:['song-2']}));
const tracks:Track[]=Array.from({length:296},(_,index)=>({id:`song-${index}`,path:'',audioUrl:'',title:index===1?'如果的事 · 测试长标题':'歌曲 '+(index+1),artist:'测试歌手',album:'测试专辑',duration:240,source:'custom',providerId:'fixture',remoteId:String(index)}));
const calls={played:[] as string[],sameObject:true,toggles:0,expanded:0};
const personal={liked:[tracks[2]],favorites:[],history:[],playlists:[]};
let savedSettings=rules.clean({zones:[{id:'night',name:'夜间',trackIds:[]}]});
const invoke=async <T,>(args:Record<string,unknown>):Promise<T>=>{
 if(args.action==='save')savedSettings=rules.clean({...args.value as SpaceState,revision:savedSettings.revision+1});
 return structuredClone(savedSettings) as T;
};
function Fixture(){
 const [songs,setSongs]=useState(tracks),[focusRequest,setFocusRequest]=useState(0);
 const [panel,setPanel]=useState(false);
 const play=(song:Track)=>{calls.played.push(song.id);calls.sameObject&&=tracks.includes(song);};
 const no=()=>{};
 const playback={track:tracks[0],playing:false,position:12,duration:240,volume:.75,muted:false,shuffle:false,repeat:'all' as const,queue:songs,queueIndex:0};
 Object.assign(window,{spaceHost:{calls,captureSpace,restoreSpace,append:()=>setSongs([...tracks,{...tracks[0],id:'extra',title:'追加歌曲'}]),focusCurrent:()=>setFocusRequest(value=>value+1),openPanel:()=>{savedSettings={...savedSettings,bookmarks:[(window as unknown as {savedSpace:SpaceState['bookmarks'][number]}).savedSpace]};setPanel(true);},closePanel:()=>setPanel(false),settings:()=>savedSettings}});
 const host=platform==='mobile'?<div className="mobile-app page-space"><header style={{height:70,padding:15,boxSizing:'border-box'}}>Zenix · 音乐空间</header><StickerSpace songs={songs} state={{personal,playback,sources:[],cache:{usedBytes:0,enabled:true,limitMiB:512}}} label="296 首测试歌单" focusRequest={focusRequest} play={play} full={()=>calls.expanded++} actions={song=><><button aria-label={`喜欢 ${song.title}`}>♡</button><button aria-label={`收藏 ${song.title}`}>☆</button></>} seek={no}/></div>
 :<LatticePlayer track={tracks[0]} personal={personal} queue={songs} queueIndex={0} displayTracks={songs} onPlayTrack={play} lyrics={[]} playing={false} position={12} duration={240} volume={.75} muted={false} shuffle={false} repeat="all" onBack={no} onTogglePlay={()=>calls.toggles++} onPrevious={no} onNext={no} onSeek={no} onVolumeChange={no} onOpenQueue={no} onExpandPlayer={()=>calls.expanded++} onOpenSettings={no} onOpenSearch={no}/>;
 return <div className={platform==='desktop'?'yz-shell yz-shell--player':'zenix-mobile'}>{host}{panel&&<aside style={{position:'fixed',inset:30,zIndex:100,overflow:'auto',padding:20,background:'#171b24'}}><SpaceFeaturesPanel mobile={platform==='mobile'} playback={playback} personal={personal} invoke={invoke}/></aside>}</div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
