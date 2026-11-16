import {createRoot} from 'react-dom/client';
import LatticePlayer from '../../src/ui/LatticePlayer';
import StickerSpace from '../../src/mobile/StickerSpace';
import {presentationKey,legacyPresentationKey} from '../../src/features/space/presentation';
import type {Track} from '../../src/core/types';

const params=new URLSearchParams(location.search),platform=params.get('platform')==='mobile'?'mobile':'desktop';
await(platform==='mobile'?import('../../src/mobile/mobile.css'):import('../../src/ui/Zenix.css'));
if(params.has('reset')){
 localStorage.removeItem(presentationKey);
 localStorage.removeItem(legacyPresentationKey);
 for(let index=localStorage.length-1;index>=0;index--){const key=localStorage.key(index);if(key?.startsWith('zenix.space.presentation.corrupt.'))localStorage.removeItem(key);}
}
if(params.has('corrupt'))localStorage.setItem(presentationKey,'{broken');
localStorage.setItem('zenix.space.presentation.fixture-preserved',JSON.stringify({playlists:['我的歌单'],liked:['song-2']}));

const tracks:Track[]=Array.from({length:96},(_,index)=>({id:`song-${index}`,path:'',audioUrl:'',title:index===1?'如果的事 · 测试长标题':'歌曲 '+(index+1),artist:'测试歌手',album:'测试专辑',duration:240,source:'custom',providerId:'fixture',remoteId:String(index)}));
const personal={liked:[tracks[2]],favorites:[],history:[],playlists:[]};
const calls={played:[] as string[]};
const no=()=>{};
const play=(song:Track)=>calls.played.push(song.id);
const playback={track:tracks[0],playing:false,position:12,duration:240,volume:.75,muted:false,shuffle:false,repeat:'all' as const,queue:tracks,queueIndex:0};
const snapshot={personal,playback,sources:[],cache:{usedBytes:0,enabled:true,limitMiB:512}};
const actions=(song:Track)=><><button aria-label={`喜欢 ${song.title}`}>♡</button><button aria-label={`收藏 ${song.title}`}>☆</button></>;
const host=platform==='mobile'
 ?<div className="zenix-mobile page-space"><header style={{height:70,padding:15,boxSizing:'border-box'}}>Zenix · 音乐空间</header><StickerSpace songs={tracks} state={snapshot} label="96 首测试歌单" focusRequest={0} play={play} full={no} actions={actions} seek={no}/></div>
 :<div className="yz-shell yz-shell--player"><LatticePlayer track={tracks[0]} personal={personal} queue={tracks} queueIndex={0} displayTracks={tracks} onPlayTrack={play} lyrics={[]} playing={false} position={12} duration={240} volume={.75} muted={false} shuffle={false} repeat="all" onBack={no} onTogglePlay={no} onPrevious={no} onNext={no} onSeek={no} onVolumeChange={no} onOpenQueue={no} onExpandPlayer={no} onOpenSettings={no} onOpenSearch={no}/></div>;
Object.assign(window,{onboardingFixture:{platform,calls}});
createRoot(document.getElementById('root')!).render(host);
