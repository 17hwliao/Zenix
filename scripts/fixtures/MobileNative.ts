import type {MobileSnapshot,MobileUpdate} from '../../src/mobile/native';
export type {MobileSnapshot,MobileUpdate,MobileSearchPage} from '../../src/mobile/native';
export const isNativeMobile=true,isAndroid=false,isIOS=false,mobilePlatform='Android',supportsOverlay=false;
const songs=Array.from({length:5},(_,i)=>({id:`fixture-${i}`,title:i===1?'很长的歌曲标题，用于验证手机布局和滑动手势':'Fixture '+i,artist:'测试歌手',source:'local' as const,path:'',audioUrl:'',duration:120}));
const source=(id:string)=>({id,kind:'zenix' as const,enabled:true,status:'ready' as const,manifest:{id,name:id,version:'1',schemaVersion:1 as const,capabilities:['search','resolvePlayback'] as ('search'|'resolvePlayback')[],qualities:['high'],settings:[],network:{apiHosts:[],mediaHosts:[],artworkHosts:[]}},origin:{kind:'file' as const,label:'fixture'},installedAt:1,sha256:'fixture',lastError:''});
export const initialSnapshot:MobileSnapshot={playback:{track:songs[0],playing:false,playWhenReady:true,cacheStatus:'complete',position:0,duration:120,volume:.75,muted:false,shuffle:false,repeat:'all',queue:songs,queueIndex:0},personal:{liked:[],favorites:[],history:[],playlists:[{id:'list-fixture',name:'测试歌单',tracks:songs}]},sources:[source('Source A'),source('Source B')],cache:{usedBytes:123456,limitMiB:512,enabled:true},appearance:{completed:true,background:null},profile:{name:'Fixture',bio:'隔离界面测试'}};
let state=structuredClone(initialSnapshot);const listeners=new Set<(state:MobileUpdate)=>void>();const calls:{action:string;payload:Record<string,any>}[]=[];
(window as any).fixture={calls,get state(){return state;}};
export async function observe(callback:(state:MobileUpdate)=>void){listeners.add(callback);return{remove:async()=>{listeners.delete(callback);}};}
export async function command<T>(action:string,payload:Record<string,any>={}):Promise<T>{calls.push({action,payload});let value:any=state;
  if(action==='personal'){const personal=structuredClone(state.personal);if(payload.operation==='addToCollections'){for(const kind of payload.kinds as ('liked'|'favorites')[])if(!personal[kind].some(song=>song.id===payload.track.id))personal[kind].push(payload.track);}else if(payload.operation==='toggle'){const kind=payload.kind as 'liked'|'favorites';personal[kind]=personal[kind].some(song=>song.id===payload.track.id)?personal[kind].filter(song=>song.id!==payload.track.id):[...personal[kind],payload.track];}else if(payload.operation==='removeFromPlaylist'){personal.playlists=personal.playlists.map(list=>list.id===payload.id?{...list,tracks:list.tracks.filter(song=>song.id!==payload.trackId)}:list);}state={...state,personal};value=personal;}
  if(action==='removeQueue'){state={...state,playback:{...state.playback,queue:state.playback.queue.filter(song=>song.id!==payload.id)}};}
  if(action==='sourceMove'){const sources=[...state.sources],at=sources.findIndex(source=>source.id===payload.id),next=at+payload.direction;[sources[at],sources[next]]=[sources[next],sources[at]];state={...state,sources};value=sources;}
  if(action==='toggle'){state={...state,playback:{...state.playback,playWhenReady:!state.playback.playWhenReady}};}
  if(action==='features'){value=payload.operation==='lanStatus'?{listening:false,addresses:[]}:payload.operation==='timerState'?{endsAt:0}:true;}
  if(action==='search')value={items:songs,nextCursor:''};
  if(action==='sourceRemove')state={...state,sources:state.sources.filter(source=>source.id!==payload.id)};
  if(action==='artwork')value={};
  if(action==='lyrics')value=null;
  if(action==='play')state={...state,playback:{...state.playback,queue:payload.tracks,track:payload.tracks[payload.index],queueIndex:payload.index,playWhenReady:true}};
  for(const listener of listeners)listener(state);if(action==='removeQueue'||action==='play'||action==='toggle')value={playback:state.playback,cache:state.cache};return value;
}
export const readLyrics=async()=>null;
