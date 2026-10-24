import type {AssistantLibraryHost,AssistantPlan,AssistantResult} from './libraryCommands';
import type {SpaceState,SpaceSnapshot} from '../space/state';
import type {Stats} from '../../ui/MusicTools';
export type ControlHost={library:AssistantLibraryHost;invoke:<T>(args:Record<string,unknown>)=>Promise<T>;ui:(action:string,args?:Record<string,unknown>)=>void;space:()=>Promise<SpaceState>;saveSpace:(value:SpaceState)=>Promise<unknown>;capture:()=>Promise<SpaceSnapshot>;mode:()=>Promise<void>;volume:(value:number)=>Promise<void>;offset:(id:string,delta:number)=>Promise<number>;overlayOff:()=>Promise<void>;updates:()=>Promise<{status:string;message:string}>;transfer:(kind:'handoff'|'submission',signal?:AbortSignal)=>Promise<AssistantResult>};
const day=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export async function controlCommand(action:string,args:Record<string,unknown>,host:ControlHost,signal?:AbortSignal):Promise<AssistantResult|AssistantPlan>{
 const check=()=>signal?.throwIfAborted();check();
 const result=(reply:string):AssistantResult=>({reply});
 let loaded:Awaited<ReturnType<AssistantLibraryHost["snapshot"]>>|undefined;
 const snapshot=async()=>{loaded??=await host.library.snapshot();check();return loaded;};
 if(action==='repeat-one'){await host.mode();return result('已设置单曲循环。');}
 if(action==='volume-down'){const {playback}=await snapshot();const volume=Math.max(0,playback.volume-.1);await host.volume(volume);return result(`音量已调到 ${Math.round(volume*100)}%。`);}
 if(action==='pure-lyrics'){const {playback}=await snapshot();if(!playback.track)throw Error('请先选择歌曲。');host.ui('pure-lyrics');return result('已打开当前歌曲的歌词纯净模式。');}
 if(action==='lyrics-earlier'){const {playback}=await snapshot();if(!playback.track)throw Error('请先选择歌曲。');const offset=await host.offset(playback.track.id,-.5);return result(`当前歌曲歌词偏移已设为 ${offset} 秒，负值表示提前。`);}
 if(action==='overlay-off'){await host.overlayOff();return result('悬浮歌词已关闭。');}
 if(action==='cache-playlist'){const {playback,personal,context}=await snapshot();
  const id=context.playlistId||(!context.collection||['home','queue'].includes(context.collection)?playback.track?.playlistId:undefined),list=personal.playlists.find(row=>row.id===id);if(!list?.tracks.length)throw Error('请先打开要缓存的自定义歌单，或播放其中的歌曲。');
  const tracks=structuredClone(list.tracks),name=list.name;
  return {kind:'confirmation',summary:`准备缓存歌单“${name}”的 ${tracks.length} 首歌曲，可能使用网络；固定保留完整缓存？`,items:tracks.map(track=>track.title),commit:async()=>{check();const value=await host.invoke<{tasks:{id:string}[]}>({operation:'offlineTasks',action:'prepare',tracks,name,group:name,quality:playback.quality||'high',pin:true});if(!value.tasks?.length)throw Error('没有确认后台任务已经建立。');return result('缓存任务已加入后台；可在“缓存与任务”查看，尚未代表全部歌曲缓存完成。');}};
 }
 if(action==='cache-only'){
  return {kind:'confirmation',summary:'限制后续音频、歌词、封面和后台预加载请求，只读取已有缓存或本地文件？当前已建立的播放连接可能继续传输；软件更新和局域网协作不受影响，可在网络使用偏好中恢复。',items:[],commit:async()=>{check();await host.invoke({operation:'offlineTasks',action:'policy',policy:{audio:'never',lyrics:'never',artwork:'never',preload:'never'}});return result('已限制后续音乐联网。当前已建立的播放连接可能继续传输；未缓存的歌曲可能无法播放。');}};
 }
 if(action==='network-tasks'){
  const state=await host.invoke<{tasks:{name:string;status:string;items:{status:string}[]}[]}>({operation:'offlineTasks',action:'state'});check();host.ui('tasks');
  return {reply:`当前有 ${state.tasks.filter(task=>['queued','running','waiting'].includes(task.status)).length} 个活动离线任务。`,items:state.tasks.map(task=>`${task.name}：${({queued:'排队中',running:'正在运行',waiting:'等待网络',paused:'已暂停',complete:'已完成',failed:'部分失败',cancelled:'已取消'} as Record<string,string>)[task.status]||task.status}，${task.items.filter(row=>['complete','local'].includes(row.status)).length}/${task.items.length}`)};
 }
 if(action==='space-open'){host.ui('space');return result('已返回音乐空间，播放保持原状。');}
 if(action==='space-zone'){
  const state=await host.space();check();const zones=state.zones.filter(zone=>zone.name===String(args.name));if(zones.length!==1)throw Error(zones.length?'有多个同名分区，请在音乐空间选择。':`没有找到“${String(args.name)}”分区。`);host.ui('space',{zone:zones[0].id});return result(`已打开“${zones[0].name}”分区，没有切歌。`);
 }
 if(action==='space-save'){
  const state=await host.space();check();if(state.bookmarks.length>=30)throw Error('空间书签已达到 30 个，请先整理。');const captured=await host.capture();check();await host.saveSpace({...state,bookmarks:[...state.bookmarks,{id:crypto.randomUUID(),name:`空间 ${new Date().toLocaleString()}`,...captured}]});return result('当前镜头、缩放与贴纸位置已保存为空间书签。');
 }
 if(action==='roam-reduce'){const {playback}=await snapshot();
  const track=playback.track;if(!track)throw Error('请先选择歌曲。');const state=await host.space();check();const {rules}=await import('../space/state');const key=rules.songKey(track);
  return {kind:'confirmation',summary:`减少《${track.title}》这首歌曲在漫游中出现？这不排除整类曲风，不删除歌曲。`,items:[],commit:async()=>{check();await host.saveSpace({...state,roaming:{...state.roaming,excluded:[...state.roaming.excluded.filter(row=>!(row.kind==='song'&&row.key===key)),{id:crypto.randomUUID(),kind:'song',effect:'reduce',key,label:`${track.title} · ${track.artist}`}]}});return result('已减少这首歌曲在漫游中出现；可在空间与漫游中撤销。');}};
 }
 if(action==='roam-light'||action==='roam-return'){await host.invoke({operation:'spaceFeatures',action:'roaming',edit:action==='roam-light'?'branch':'return',...(action==='roam-light'?{keyword:'轻音乐',count:3}:{})});return result(action==='roam-light'?'已设置三首轻音乐临时探索，从下一首开始；没有打断当前歌曲。':'已结束临时探索，返回原漫游路线。');}
 if(action==='week-stats'){
  const now=new Date(),from=new Date(now);from.setDate(from.getDate()-(from.getDay()+6)%7);const stats=await host.invoke<Stats>({operation:'stats',from:day(from),to:day(now)});check();
  return {reply:`本周累计听歌 ${Math.floor(stats.seconds/60)} 分钟，有效播放 ${stats.plays} 次，听过 ${stats.uniqueTracks} 首歌曲。`,items:stats.topTracks.slice(0,5).map(track=>`${track.title} · ${track.artist}，${track.plays} 次`)};
 }
 if(action==='sleep'){await host.invoke({operation:'timerSet',minutes:30});return result('已设置半小时后停止播放，保留应用、歌单和配置。可在睡眠定时器中取消。');}
 if(action==='handoff-pc'||action==='submit-pc')return host.transfer(action==='handoff-pc'?'handoff':'submission',signal);
 if(action==='backup-playlists'){const {personal}=await snapshot();if(!personal.playlists.length)throw Error('当前还没有自定义歌单。');const saved=await host.invoke({operation:'exportFile',ids:personal.playlists.map(row=>row.id)});return result(saved?'歌单已导出为 .zenixlist 文件，可再次导入；不包含音频文件。':'已取消保存，没有更改歌单。');}
 if(action==='update-check'){const state=await host.updates();check();if(state.status==='error')throw Error(state.message);return result(state.message);}
 throw Error('此操作尚未登记。');
}
