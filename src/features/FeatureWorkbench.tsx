import {useCallback,useEffect,useState,useRef} from 'react';
import type {InstalledSource,PersonalState,PlayerState,Track,RawLyrics} from '../core/types';
import {command,observe,type MobileSnapshot} from '../mobile/native';
import {desktopTool} from '../ui/MusicTools';
import {useDialogFocus} from '../ui/useDialogFocus';
import PersonalFeaturesPanel from './personal/PersonalFeaturesPanel';
import PlaybackFeaturesPanel from './playback/PlaybackFeaturesPanel';
import LyricPractice from './playback/LyricPractice';
import TasksPanel from './tasks/TasksPanel';
import ActivitiesPanel from './tasks/ActivitiesPanel';
import SpaceFeaturesPanel from './space/SpaceFeaturesPanel';
import ConnectionsPanel from './connections/ConnectionsPanel';
import AssistantPanel from './assistant/AssistantPanel';
import {receiveTransfer,executeAssistant,pauseHost} from './featureHost';
import {useSpaceSettings} from './space/state';
import {versionPreferences} from './playback/preferences';
import {recordingFor} from './recording';
import {openRecording} from './openRecording';
import './FeatureWorkbench.css';

const emptyPersonal:PersonalState={liked:[],favorites:[],history:[],playlists:[]};
const emptyPlayback:PlayerState={playing:false,position:0,duration:0,volume:.75,muted:false,shuffle:false,repeat:'all',queue:[],queueIndex:-1};
export default function FeatureWorkbench({mobile,initialMobile,initialTab='personal',close}:{mobile:boolean;initialMobile?:MobileSnapshot;initialTab?:string;close:()=>void}){
  const [tab,setTab]=useState(initialTab),[personal,setPersonal]=useState(initialMobile?.personal||emptyPersonal),[playback,setPlayback]=useState(initialMobile?.playback||emptyPlayback),[sources,setSources]=useState<InstalledSource[]>(initialMobile?.sources||[]),[error,setError]=useState('');
  const [localTracks,setLocalTracks]=useState<Track[]>(initialMobile?.localTracks||[]);
  const focus=useDialogFocus(true,close);
  const opening=useRef<AbortController|null>(null);
  useEffect(()=>()=>opening.current?.abort(),[]);
  const space=useSpaceSettings();
  const invoke=useCallback(async<T,>(args:Record<string,unknown>):Promise<T>=>{
    if(args.operation==='collaboration')return mobile?command<T>('collaboration',args):window.yzqxy!.desktop.invoke<T>(args);
    if(args.operation==='spaceFeatures'&&!mobile)return (await import('./space/desktop')).desktopSpaceFeature<T>(args);
    return mobile?command<T>('features',args):desktopTool<T>(args);
  },[mobile]);
  const playbackInvoke=useCallback(async<T,>(action:string,args:Record<string,unknown>={}):Promise<T>=>{const value=mobile?await command<T>('playbackFeature',{operation:action,...args}):await(await import('./playback/desktop')).desktopPlaybackFeature<T>(action,args);if(mobile&&['preferences','preferencesSave'].includes(action))versionPreferences.write(versionPreferences.clean(value));return value;},[mobile]);
  useEffect(()=>{let alive=true;const stops:(()=>void)[]=[];
    const accept=(value:Partial<MobileSnapshot>)=>{if(!alive)return;if(value.personal)setPersonal(value.personal);if(value.playback)setPlayback(value.playback);if(value.sources)setSources(value.sources);if(value.localTracks)setLocalTracks(value.localTracks);};
    void(async()=>{try{if(mobile){accept(await command<MobileSnapshot>('snapshot'));versionPreferences.write(versionPreferences.clean(await command('playbackFeature',{operation:'preferences'})));const listener=await observe(value=>{if(!alive)return;if(value.personal)setPersonal(value.personal);if(value.sources)setSources(value.sources);if(value.localTracks)setLocalTracks(value.localTracks);if(value.playback)setPlayback(previous=>'queue' in value.playback! ? value.playback as PlayerState : {...previous,...value.playback});});if(!alive)await listener.remove();else stops.push(()=>{void listener.remove();});}else{const bridge=window.yzqxy;if(!bridge)throw Error('请在安装版中使用音乐工作台');const {player}=await import('../core/player');if(!alive)return;stops.push(player.subscribe(setPlayback),bridge.personal.onChanged(setPersonal),bridge.sources.onChanged(setSources));const [p,s,l]=await Promise.all([bridge.personal.load(),bridge.sources.list(),bridge.library.load()]);if(alive){setPersonal(p);setSources(s);setLocalTracks(l.tracks);}}}catch(e){if(alive)setError(e instanceof Error?e.message:String(e));}})();
    return()=>{alive=false;stops.forEach(stop=>stop());};
  },[mobile]);
  const lyrics=useCallback((track:Track):Promise<RawLyrics|null>=>mobile?command<RawLyrics|null>('lyrics',{track}):track.source==='local'?window.yzqxy!.library.readLyrics(track.id):window.yzqxy!.sources.lyrics(track),[mobile]);
  const open=async(reference:Partial<Track>&{id:string},seconds:number|null)=>{
    const all=[...localTracks,...playback.queue,...personal.liked,...personal.favorites,...personal.history.map(row=>row.track),...personal.playlists.flatMap(list=>list.tracks)];
    if(reference.source==='local'&&!all.some(track=>track.id===reference.id&&track.path))throw Error('本机尚未找到此书签对应的音频，请先导入原文件');
    const song=all.find(track=>track.id===reference.id&&(!reference.providerId||track.providerId===reference.providerId)&&(!reference.remoteId||track.remoteId===reference.remoteId))||{...reference,path:'',audioUrl:'',title:reference.title||'',artist:reference.artist||'',duration:reference.duration||0} as Track;
    const queue=playback.queue.some(track=>track.id===song.id)?playback.queue.map(track=>track.id===song.id?song:track):[song];
    opening.current?.abort();const controller=new AbortController();opening.current=controller;
    await openRecording(mobile,song,queue,seconds,controller.signal);
  };
  return <div className="zenix-feature-backdrop" onPointerDown={event=>{if(event.target===event.currentTarget)close();}}><section className="zenix-feature-workbench" ref={focus} role="dialog" aria-modal="true" aria-label="音乐工作台" tabIndex={-1}>
    <header><h2>音乐工作台</h2><button aria-label="关闭音乐工作台" onClick={close}>关闭</button></header>
    <nav aria-label="音乐工作台分类">{[['personal','私人资料'],['playback','播放与版本'],['tasks','缓存与任务'],['space','空间与漫游'],['connections','设备协作'],['assistant','音乐助手']].map(([key,label])=><button key={key} aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}</nav>
    <div className="zenix-feature-content">{error&&<p role="alert">{error}<button onClick={()=>setError('')}>关闭提示</button></p>}
      {tab==='personal'&&<PersonalFeaturesPanel personal={personal} playback={playback} invoke={invoke} onOpen={open} readLyrics={lyrics} saveText={async(name,text)=>{const result=await invoke<{saved:boolean}>({operation:'featureTextSave',name,text});if(!result.saved)throw Error('已取消保存');}}/>}
      {tab==='playback'&&<><PlaybackFeaturesPanel playback={playback} sources={sources} invoke={playbackInvoke} diagnostics={mobile?()=>command('sourceDiagnostics'):()=>window.yzqxy!.sources.diagnostics()}/><LyricPractice track={playback.track} readLyrics={track=>lyrics(recordingFor(track,personal))} invoke={playbackInvoke}/></>}
      {tab==='tasks'&&<><TasksPanel invoke={invoke} personal={personal} current={playback.track}/><ActivitiesPanel invoke={invoke}/></>}
      {tab==='space'&&<SpaceFeaturesPanel mobile={mobile} playback={playback} personal={personal} invoke={invoke}/>}
      {tab==='connections'&&<ConnectionsPanel mobile={mobile} playback={playback} personal={personal} invoke={invoke} onReceive={payload=>receiveTransfer(mobile,payload)} onPause={expected=>pauseHost(mobile,expected)} preferences={{version:versionPreferences.read(),roaming:space.roaming}}/>}
      {tab==='assistant'&&<AssistantPanel mobile={mobile} playback={playback} invoke={invoke} execute={(action,args)=>executeAssistant(mobile,action,args,invoke,()=>setTab('tasks'))}/>}
    </div>
  </section></div>;
}
