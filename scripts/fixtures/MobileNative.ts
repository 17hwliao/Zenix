import type {MobileSnapshot,MobileUpdate} from '../../src/mobile/native';
export type {MobileSnapshot,MobileUpdate,MobileSearchPage} from '../../src/mobile/native';
export const isNativeMobile=true,isAndroid=true,isIOS=false,mobilePlatform='Android',supportsOverlay=false;
const songs=Array.from({length:5},(_,i)=>({id:`fixture-${i}`,title:i===1?'很长的歌曲标题，用于验证手机布局和滑动手势':'Fixture '+i,artist:'测试歌手',source:'local' as const,path:'',audioUrl:'',duration:120}));
const source=(id:string)=>({id,kind:'zenix' as const,enabled:true,status:'ready' as const,manifest:{id,name:id,version:'1',schemaVersion:1 as const,capabilities:['search','resolvePlayback'] as ('search'|'resolvePlayback')[],qualities:['high'],settings:[],network:{apiHosts:[],mediaHosts:[],artworkHosts:[]}},origin:{kind:'file' as const,label:'fixture'},installedAt:1,sha256:'fixture',lastError:''});
export const initialSnapshot:MobileSnapshot={playback:{track:songs[0],playing:false,playWhenReady:true,cacheStatus:'complete',position:0,duration:120,volume:.75,muted:false,shuffle:false,repeat:'all',queue:songs,queueIndex:0},personal:{liked:[],favorites:[],history:[],playlists:[{id:'list-fixture',name:'测试歌单',tracks:songs}]},sources:[source('Source A'),source('Source B')],cache:{usedBytes:123456,limitMiB:512,enabled:true},appearance:{completed:true,background:null},profile:{name:'Fixture',bio:'隔离界面测试'}};
let state=structuredClone(initialSnapshot),linkedPending:any=null,remoteFixture:any={phase:'idle'};const listeners=new Set<(state:MobileUpdate)=>void>();const calls:{action:string;payload:Record<string,any>}[]=[];
(window as any).fixture={calls,get state(){return state;},search:undefined,setSnapshot(patch:Partial<MobileSnapshot>){state={...state,...patch};for(const listener of listeners)listener(state);}};
export async function observe(callback:(state:MobileUpdate)=>void){listeners.add(callback);return{remove:async()=>{listeners.delete(callback);}};}
export async function command<T>(action:string,payload:Record<string,any>={}):Promise<T>{calls.push({action,payload});let value:any=state;
  if(action==='remote'){
    if(payload.operation==='connect')remoteFixture={phase:'waiting',address:payload.address};
    else if(payload.operation==='disconnect')remoteFixture={phase:'idle'};
    else if(payload.operation==='status'&&remoteFixture.phase==='waiting'&&(window as any).fixture.remoteApproved)remoteFixture={...remoteFixture,phase:'connected',title:'电脑测试歌曲',artist:'测试歌手',duration:180,position:20,volume:.75,playing:false};
    else if(remoteFixture.phase==='connected'){if(payload.operation==='play-pause')remoteFixture={...remoteFixture,playing:!remoteFixture.playing};if(payload.operation==='next')remoteFixture={...remoteFixture,title:'电脑下一首'};if(payload.operation==='seek')remoteFixture={...remoteFixture,position:payload.seconds};if(payload.operation==='volume')remoteFixture={...remoteFixture,volume:payload.volume};}
    return remoteFixture as T;
  }
  if((window as any).fixture.failAction===action)throw new Error('隔离测试：操作失败');
  if(action==='importUrl'||action==='previewSourceText')value=(window as any).fixture.importPreview;
  if(action==='install'){const preview=(window as any).fixture.importPreview,record={...source(preview.manifest.id),kind:preview.kind,manifest:preview.manifest,networkPolicy:payload.networkPolicy};state={...state,sources:[...state.sources.filter(item=>item.id!==record.id),record]};value=state.sources;}
  if(action==='pickSourceBundle')value=(window as any).fixture.sourceBundleFile;
  if(action==='personal'){const personal=structuredClone(state.personal);if(payload.operation==='addToCollections'){for(const kind of payload.kinds as ('liked'|'favorites')[])if(!personal[kind].some(song=>song.id===payload.track.id))personal[kind].push(payload.track);}else if(payload.operation==='toggle'){const kind=payload.kind as 'liked'|'favorites';personal[kind]=personal[kind].some(song=>song.id===payload.track.id)?personal[kind].filter(song=>song.id!==payload.track.id):[...personal[kind],payload.track];}else if(payload.operation==='removeFromPlaylist'){personal.playlists=personal.playlists.map(list=>list.id===payload.id?{...list,tracks:list.tracks.filter(song=>song.id!==payload.trackId)}:list);}state={...state,personal};value=personal;}
  if(action==='removeQueue'){state={...state,playback:{...state.playback,queue:state.playback.queue.filter(song=>song.id!==payload.id)}};}
  if(action==='sourceMove'){const sources=[...state.sources],at=sources.findIndex(source=>source.id===payload.id),next=at+payload.direction;[sources[at],sources[next]]=[sources[next],sources[at]];state={...state,sources};value=sources;}
  if(action==='exportSourceBundle')value=(window as any).fixture.exportResult||{saved:true,count:state.sources.length};
  if(action==='mode'){state={...state,playback:{...state.playback,...payload}};}
  if(action==='toggle'){state={...state,playback:{...state.playback,playWhenReady:!state.playback.playWhenReady}};}
  if(action==='sourceDiagnostics'||action==='sourceDiagnosticsConfigure')value={smooth:payload.smooth===true,sources:{}};
  if(action==='features'){
    value=payload.operation==='backupInfo'?{undoAvailable:false,backgroundBytes:0}:payload.operation==='lanStatus'?{listening:false,addresses:[],pending:linkedPending?.preview}:payload.operation==='timerState'?{endsAt:0}:true;
    if(payload.operation==='playlistRequest')value={url:payload.url,status:200,text:JSON.stringify(payload.method==='POST'?{code:1}:{code:0,cdlist:[{dissname:'平台导入测试',songnum:3,songlist:[1,2].map(id=>({mid:'MID'+id,id,title:'分享歌曲'+id,singer:[{name:'分享歌手'}],interval:120,file:{media_mid:'MEDIA'+id}}))}]})};
    if(payload.operation==='playlistPreview'){linkedPending={bundle:payload.bundle,preview:{token:'linked-fixture-token',playlists:payload.bundle.playlists.map((list:any)=>({name:list.name,count:list.tracks.length,localCount:0}))}};value={listening:false,addresses:[],pending:linkedPending.preview};}
    if(payload.operation==='importConfirm'&&linkedPending){if(payload.token!==linkedPending.preview.token)throw Error('Stale fixture token');state={...state,personal:{...state.personal,playlists:[...state.personal.playlists,...linkedPending.bundle.playlists.map((list:any)=>({...list,id:'linked-fixture-list'}))]}};linkedPending=null;value={listening:false,addresses:[],pending:null};}
  }
  if(action==='search'){const handler=(window as any).fixture.search;if(handler)return await handler(payload);value={items:songs,nextCursor:''};}
  if(action==='sourceRemove')state={...state,sources:state.sources.filter(source=>source.id!==payload.id)};
  if(action==='artwork'){((window as any).fixture.artReads??=[]).push({panelTop:document.querySelector('.mobile-full-player')?.getBoundingClientRect().top});value={};}
  if(action==='lyrics')value=null;
  if(action==='play')state={...state,playback:{...state.playback,queue:payload.tracks,track:payload.tracks[payload.index],queueIndex:payload.index,playWhenReady:true}};
  for(const listener of listeners)listener(state);if(action==='removeQueue'||action==='play'||action==='toggle')value={playback:state.playback,cache:state.cache};return value;
}
export const readLyrics=async()=>{
  const fixture=(window as any).fixture;
  (fixture.lyricReads??=[]).push({at:performance.now(),panelTop:document.querySelector('.mobile-full-player')?.getBoundingClientRect().top});
  return fixture.lyrics??null;
};
