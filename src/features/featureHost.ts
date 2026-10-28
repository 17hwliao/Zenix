import type {PersonalState} from '../core/types';
import {command,type MobileSnapshot} from '../mobile/native';
import type {TransferPayload} from './connections/ConnectionsPanel';
import {versionPreferences} from './playback/preferences';
import {readSpace,writeSpace,commitSpace,rules} from './space/state';
import {recordingFor} from './recording';
import {libraryActions} from './assistant/libraryIntent';
import {libraryCommand} from './assistant/libraryCommands';
import {libraryHost} from './assistant/libraryHost';
import {controlActions} from './assistant/controlIntent';
type Invoke=<T>(args:Record<string,unknown>)=>Promise<T>;

export async function pauseHost(mobile:boolean,expected?:{id:string;selection?:number}){if(mobile){const state=await command<MobileSnapshot>('snapshot');if(expected&&(state.playback.track?.id!==expected.id||state.playback.selectionRevision!==expected.selection))return;if(state.playback.playWhenReady??state.playback.playing)await command('toggle');}else{const {player}=await import('../core/player');if(expected&&(player.snapshot.track?.id!==expected.id||player.snapshot.selectionRevision!==expected.selection))return;player.pause();}}
export async function executeAssistant(mobile:boolean,action:string,args:Record<string,unknown>,invoke:Invoke,openTasks:()=>void,signal?:AbortSignal){
  if(controlActions.has(action)){const [{controlCommand},{controlHost}]=await Promise.all([import('./assistant/controlCommands'),import('./assistant/controlHost')]);return controlCommand(action,args,controlHost(mobile),signal);}
  if(libraryActions.has(action))return libraryCommand(action,args,libraryHost(mobile),signal);
  if(action==='tasks'){openTasks();return;}
  if(action==='search'){const query=String(args.query||'').trim().slice(0,120);if(!query)throw Error('请输入歌曲名称');window.dispatchEvent(new CustomEvent('zenix-assistant-search',{detail:{query}}));return;}
  if(action==='bookmark'){const snapshot=mobile?await command<MobileSnapshot>('snapshot'):null,playback=snapshot?.playback||(await import('../core/player')).player.snapshot;if(!playback.track)throw Error('请先播放一首歌');const personal=snapshot?.personal||await window.yzqxy!.personal.load();return invoke({operation:'personalFeatures',action:'bookmarkAdd',track:recordingFor(playback.track,personal),seconds:playback.position,note:''});}
  if(!['play','pause','next','previous'].includes(action))throw Error('此操作尚未登记');
  if(mobile){if(action==='pause')return pauseHost(true);if(action==='play'){const state=await command<MobileSnapshot>('snapshot');if(!state.playback.track)throw Error('请先选择歌曲');if(!(state.playback.playWhenReady??state.playback.playing))await command('toggle');return;}return command(action);}
  const {player}=await import('../core/player');if(action==='play'){if(!player.snapshot.track)throw Error('请先选择歌曲');return player.play();}if(action==='pause')return player.pause();if(action==='next')return player.next();return player.previous();
}

export async function receiveTransfer(mobile:boolean,payload:TransferPayload){
  if(payload.kind==='sync')return mergeSync(mobile,payload);
  if(!payload.track||payload.track.source==='local')throw Error('本地音频不能通过歌曲清单接力，请在接收设备导入原文件');
  if(payload.kind==='submission'){
    if(mobile)await command('queueEdit',{operation:'next',track:payload.track});
    else{const {roaming}=await import('../core/roaming');if(roaming.snapshot.active)throw Error('请先结束漫游，再批准普通队列投稿');(await import('../core/player')).player.editQueue('next',{track:payload.track});}
    return;
  }
  const queue=payload.queue?.length?payload.queue:[payload.track];const index=queue.findIndex(row=>row.id===payload.track!.id);if(index<0)throw Error('接力歌曲不在传来的队列中');
  if(payload.playing===false){
    if(mobile)await command('handoffPrepare',{tracks:queue,index,seconds:payload.position||0});
    else{const {player}=await import('../core/player');player.pause();player.setQueue(queue,index);player.seek(payload.position||0);}
    return;
  }
  if(mobile){
    const selected=await command<MobileSnapshot>('play',{tracks:queue,index});const revision=selected.playback.selectionRevision;
    for(;;){const {playback}=await command<MobileSnapshot>('snapshot');if(playback.selectionRevision!==revision)throw Error('接收端已选择其他歌曲，接力结束');if(playback.error)throw Error(playback.error);if(playback.playing&&!playback.sourceActivity){await command('seek',{seconds:payload.position||0});return;}if(!(playback.playWhenReady??playback.playing))throw Error('接收端已暂停接力');await new Promise(resolve=>setTimeout(resolve,300));}
  }else{
    const {player}=await import('../core/player');await player.playTrack(payload.track,queue);if(player.snapshot.track?.id!==payload.track.id||player.snapshot.error||!player.snapshot.playing)throw Error(player.snapshot.error||'接收端未开始播放');player.seek(payload.position||0);
  }
}
async function mergeSync(mobile:boolean,payload:TransferPayload){
  const {syncTransfer}=await import('./connections/syncTransfer');
  const invoke:Invoke=mobile?args=>command('features',args):async args=>window.yzqxy!.companion!.invoke(args) as never;
  let versionRaw:string|null=null,spaceRaw:string|null=null;
  return syncTransfer(payload,{
    loadPersonal:async()=>mobile?(await command<MobileSnapshot>('snapshot')).personal:window.yzqxy!.personal.load(),
    readVersion:async()=>{versionRaw=localStorage.getItem(versionPreferences.KEY);const raw=versionRaw===null?null:JSON.parse(versionRaw);if(raw!==null&&(typeof raw!=='object'||Array.isArray(raw)))throw Error('本机版本偏好无法读取，原配置已保留');return mobile?versionPreferences.clean(await command('playbackFeature',{operation:'preferences'})):versionPreferences.clean(raw);},
    readSpace:async()=>{spaceRaw=localStorage.getItem('zenix.space.features.v1');return mobile?rules.clean(await command('features',{operation:'spaceFeatures',action:'read'})):readSpace();},
    saveVersion:async(next,expected)=>{
      if(mobile){const saved=await command('playbackFeature',{operation:'preferencesSave',value:next,expected});if(localStorage.getItem(versionPreferences.KEY)!==versionRaw)return '手机偏好已保存，界面缓存已有新修改，未覆盖';try{versionPreferences.write(versionPreferences.clean(saved));}catch{return '手机偏好已保存，界面缓存写入失败，原缓存保留';}}
      else{if(localStorage.getItem(versionPreferences.KEY)!==versionRaw)throw Error('本机版本偏好已有新修改，未覆盖');versionPreferences.write(next);}window.dispatchEvent(new CustomEvent('zenix-playback-preferences'));
    },
    saveSpace:async next=>{if(mobile){const saved=rules.clean(await command('features',{operation:'spaceFeatures',action:'save',value:next}));if(localStorage.getItem('zenix.space.features.v1')!==spaceRaw)return '漫游偏好已保存，界面缓存已有新修改，未覆盖';try{writeSpace(saved);}catch{return '漫游偏好已保存，界面缓存写入失败，原缓存保留';}}else commitSpace(next);},
    preview:async lists=>{const value=await invoke<{pending?:{token?:string}}>({operation:'playlistPreview',bundle:{format:'zenix-playlist',schemaVersion:1,playlists:lists}});if(!value.pending?.token)throw Error('接收端没有建立歌单导入预览，尚未写入资料');return value.pending.token;},
    confirm:async token=>{await invoke({operation:'importConfirm',token});},
    discard:async token=>{await invoke({operation:'importDiscard',token});},
    addCollection:async(kind,track)=>invoke<PersonalState>({operation:'personalFeatures',action:'collectionAdd',kind,track}),
  });
}
