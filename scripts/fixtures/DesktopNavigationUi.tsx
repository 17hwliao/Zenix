import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import DesktopWorkspace from '../../src/ui/DesktopWorkspace';
import ZenixShell from '../../src/ui/ZenixShell';
import {FeatureHost} from '../../src/features/FeatureLauncher';
import type {LibrarySnapshot, PersonalState, Track} from '../../src/core/types';

localStorage.clear();
localStorage.setItem('zenix.ui-sounds.v1', '{"enabled":false}');
localStorage.setItem('zenix.assistant.figure.v1', 'whale');
localStorage.setItem('zenix.assistant.ui.v1', '{"hidden":true}');
const songs: Track[] = Array.from({length: 32}, (_, index) => ({id:`local-${index}`, title: index===0?'夜航 / First Light':`雨后散步 ${index}`, artist:'Zenix 隔离资料', album:'城市的另一面', duration:186, source:'local', path:'', audioUrl:''}));
const initial: PersonalState = {liked:songs.slice(0,12), favorites:[songs[1]], history:songs.map(track=>({id:track.id,track,playedAt:1})), playlists:[{id:'personal-list',name:'慢慢听',tracks:songs.slice(0,3)}]};
let catalog: LibrarySnapshot = {tracks:songs, roots:[], looseFiles:[], playlists:[{id:'disk-list',name:'磁盘歌单',trackIds:[songs[0].id],createdAt:1,updatedAt:1}]};
const subscribe = () => () => {};
const model = {enabled:false,endpoint:'',model:'',keyPresent:false,keyHint:'',revision:'fixture'};
const calls: Record<string,unknown>[] = [];
const fixture = {calls,plays:[] as string[],toggles:0,failCreate:false,failTasks:false};
async function invoke(args: Record<string,unknown>) {
  calls.push(args);
  if (args.operation==='assistant') return {enabled:false,skin:null,figure:{id:'whale',scale:.7,wandering:false}};
  if (args.operation==='offlineTasks') {if(fixture.failTasks)throw Error('隔离任务服务暂不可用');return {tasks:[],policy:{audio:'always',lyrics:'always',artwork:'always',preload:'always'},network:'unknown',cache:{enabled:true,usedBytes:0,limitMiB:512}};}
  if (args.operation==='collaboration') return args.action==='hostStatus'?{listening:false,addresses:[],clients:[]}:{clients:[],tickets:[]};
  throw Error(`Unexpected fixture operation: ${args.operation}`);
}
Object.defineProperty(window, 'yzqxy', {configurable:true, value:{
  personal:{load:async()=>initial,onChanged:subscribe},
  library:{load:async()=>catalog,onChanged:subscribe,onProgress:subscribe,readLyrics:async()=>null,createPlaylist:async(name:string)=>{catalog={...catalog,playlists:[...catalog.playlists,{id:'new-local',name,trackIds:[],createdAt:1,updatedAt:1}]};return catalog;}},
  sources:{list:async()=>[],onChanged:subscribe,lyrics:async()=>null,diagnostics:async()=>({smooth:false,sources:{}})},
  companion:{invoke},desktop:{invoke,onCommand:subscribe},onMediaCommand:subscribe,onMediaSeek:subscribe,
  assistantModel:{invoke:async(args:Record<string,unknown>)=>args.action==='historyRead'?null:model,onDelta:subscribe},
}});
(window as any).navigationFixture=fixture;
const noop = () => {};
function Fixture() {
  const [personal,setPersonal] = useState(initial);
  return <><ZenixShell tracks={songs} currentTrack={songs[0]} queue={songs} personal={personal} playing={false} position={25} duration={186} volume={.6}
    onPlayTrack={track=>fixture.plays.push(track.id)} onTogglePlay={()=>fixture.toggles++} onPrevious={noop} onNext={noop} onSeek={noop} onVolumeChange={noop} onImportFolder={async()=>{calls.push({operation:'importFolder'});}} onAddFiles={async()=>{calls.push({operation:'addFiles'});}} onRefreshLibrary={async()=>{calls.push({operation:'refresh'});}}
    onCreatePersonalPlaylist={async name=>{calls.push({operation:'createPersonal',name});if(fixture.failCreate)throw Error('隔离保存失败，名称保留');const id='created-list';setPersonal(value=>({...value,playlists:[...value.playlists,{id,name,tracks:[]}]}));return id;}}
    onRenamePersonalPlaylist={async(id,name)=>{setPersonal(value=>({...value,playlists:value.playlists.map(list=>list.id===id?{...list,name}:list)}));return true;}}
    onDeletePersonalPlaylist={async id=>{setPersonal(value=>({...value,playlists:value.playlists.filter(list=>list.id!==id)}));return true;}}
    onAddToPersonalPlaylist={(id,track)=>setPersonal(value=>({...value,playlists:value.playlists.map(list=>list.id===id?{...list,tracks:[...list.tracks,track as Track]}:list)}))}
    onRemoveSaved={(kind,id)=>setPersonal(value=>({...value,[kind]:value[kind].filter(item=>item.id!==id)}))}
    onStartRoaming={noop}/><FeatureHost/></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
let probeRoot:ReturnType<typeof createRoot>;
function ProbePanel({fail}:{fail:boolean}){if(fail)throw Error('isolated collection failure');return <p data-probe-recovered>Independent collection available</p>;}
Object.assign(fixture,{probeWorkspace(page:string,fail:boolean){
  if(!probeRoot){const node=document.createElement('div');node.id='workspace-probe';document.body.append(node);probeRoot=createRoot(node,{onCaughtError:()=>{}});}
  flushSync(()=>probeRoot.render(<DesktopWorkspace page={page} title={page} description="" onHome={()=>{}}><ProbePanel fail={fail}/></DesktopWorkspace>));
}});
