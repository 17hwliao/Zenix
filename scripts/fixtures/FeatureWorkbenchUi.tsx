import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import FeatureLauncher,{FeatureHost} from '../../src/features/FeatureLauncher';
import type {Track,PersonalState} from '../../src/core/types';
import {rules} from '../../src/features/space/state';
import '../../src/ui/Zenix.css';
import '../../src/mobile/mobile.css';

const mode=new URLSearchParams(location.search).get('mode')||'desktop';
const song:Track={id:'fixture-song',title:'像风一样',artist:'测试歌手',source:'custom',providerId:'fixture',remoteId:'song',path:'',audioUrl:'',duration:180};
const personal:PersonalState={liked:[song],favorites:[],history:[],playlists:[{id:'playlist',name:'我的测试歌单',tracks:[song]}]};
const snapshot={personal,sources:[{id:'fixture',enabled:true,manifest:{name:'测试音乐源',version:'1',capabilities:['search','resolve'],qualities:['high']}}],localTracks:[],playback:{track:song,playing:false,position:12,duration:180,volume:.75,muted:false,shuffle:false,repeat:'all',queue:[song],queueIndex:0,selectionRevision:1},cache:{enabled:true,limitMiB:512,usedBytes:0}};
const calls:Record<string,unknown>[]=[],subscriptions=new Map<string,(data:unknown)=>void>();let assistantSkin:{archive:string}|null=null;let listenerId=0,failedRead=false,failImport=false,pendingImport="",deferLyrics=false;let finishLyrics:((value:unknown)=>void)|undefined;
const none=()=>{},subscribe=()=>()=>{};
const featureState={schema:1,revision:0,bookmarks:[],lyrics:[],journal:[]};
const diagnostics={smooth:false,sources:{}};
const taskState={tasks:[],policy:{audio:'always',lyrics:'always',artwork:'always',preload:'always'},network:'unknown',cache:snapshot.cache};
async function invoke(args:Record<string,unknown>):Promise<unknown>{calls.push(args);switch(args.operation){case 'lanStatus':return{pending:pendingImport?{token:pendingImport}:null};case 'playlistPreview':if(pendingImport)throw Error('已有预览');pendingImport='fixture-preview';return{pending:{token:pendingImport}};case 'importConfirm':if(args.token!==pendingImport)throw Error('预览失效');if(failImport)throw Error('隔离保存失败');pendingImport='';return{};case 'importDiscard':if(args.token!==pendingImport)throw Error('预览失效');pendingImport='';return{};case 'personalFeatures':return args.action==='search'?[]:featureState;case 'offlineTasks':return taskState;case 'spaceFeatures':return rules.clean();case 'assistant':if(args.action==='skinSave')assistantSkin={archive:String(args.base64)};if(args.action==='skinReset')assistantSkin=null;return {enabled:false,skin:assistantSkin,error:''};case 'collaboration':return args.action==='hostStatus'?{listening:false,addresses:[],clients:[]}:{clients:[],tickets:[]};default:throw Error('unexpected fixture operation '+String(args.operation));}}
const bridge={personal:{load:async()=>{if(failedRead)throw Error('隔离资料读取失败，原资料保留');return personal;},onChanged:subscribe},library:{load:async()=>({tracks:[],roots:[],playlists:[],looseFiles:[]}),readLyrics:async()=>({text:'[00:00.00]第一句\n[00:10.00]第二句',source:'custom',format:'lrc'})},sources:{list:async()=>snapshot.sources,onChanged:subscribe,lyrics:async()=>({text:'[00:00.00]第一句\n[00:10.00]第二句',source:'custom',format:'lrc'}),diagnostics:async()=>diagnostics},companion:{invoke},desktop:{invoke,onCommand:subscribe},onMediaCommand:subscribe,onMediaSeek:subscribe};
Object.defineProperty(window,'yzqxy',{value:bridge,configurable:true});
const fixture={mode,calls,personal,snapshot,subscriptions,
  async native(method:string,args:Record<string,any>){if(method==='removeListener'){subscriptions.delete(String(args.callbackId));return true;}if(method!=='invoke')throw Error('unexpected native method '+method);calls.push({native:args.action,...args.payload});const data=args.payload||{};if(args.action==='snapshot'){if(failedRead)throw Error('隔离资料读取失败，原资料保留');return {value:snapshot};}if(args.action==='features')return {value:await invoke(data)};if(args.action==='playbackFeature')return {value:data.operation==='preferences'?{mode:'any',choices:{}}:data.operation==='replacementInfo'?null:{loop:null,rate:1,preview:false}};if(args.action==='sourceDiagnostics')return {value:diagnostics};if(args.action==='lyrics'&&deferLyrics)return new Promise(resolve=>{finishLyrics=value=>resolve({value});});if(args.action==='lyrics')return {value:{text:'[00:00.00]第一句\n[00:10.00]第二句',source:'custom',format:'lrc'}};if(args.action==='collaboration')return {value:await invoke({...data,operation:'collaboration'})};throw Error('unexpected native action '+String(args.action));},
  listen(_method:string,args:{eventName:string},callback:(data:unknown)=>void){const id=String(++listenerId);subscriptions.set(id,callback);return id;},
  async initialisePlayer(){const {player}=await import('../../src/core/player');player.setQueue([song],0);return player.snapshot;},
  async player(){return (await import('../../src/core/player')).player.snapshot;},
  setFailedRead(value:boolean){failedRead=value;},
  publishTrack(recording:Track){(snapshot.playback.track as Track).playbackRecording=recording;for(const fn of subscriptions.values())fn({playback:{...snapshot.playback,track:{...snapshot.playback.track}}});},
  async importTask(){const {startActivity}=await import('../../src/features/tasks/activities');return startActivity('隔离解析歌单',async()=>({playlists:[{name:'结果歌单',tracks:[song]}]}));},
  setImportFailure(value:boolean){failImport=value;},
  setDeferredLyrics(value:boolean){deferLyrics=value;},
  finishLyrics(){finishLyrics?.({text:'[00:01.00]旧录音歌词',format:'lrc',source:'custom'});finishLyrics=undefined;},
};
(window as any).workbenchFixture=fixture;
function Fixture(){const [clicks,setClicks]=useState(0);return <main style={{minHeight:'100vh',padding:20,background:'#162031',color:'white',boxSizing:'border-box'}}><h1 id="main-title">隔离的播放器主界面</h1><p>歌单与播放测试资料不会写入用户客户端。</p><button id="main-action" onClick={()=>setClicks(value=>value+1)}>主界面操作 {clicks}</button><div><FeatureLauncher/></div><FeatureHost mobile={mode==='mobile'}/><output id="main-result">{clicks}</output></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
