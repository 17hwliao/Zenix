import type {Track,PersonalState,PlayerState,RawLyrics,InstalledSource} from '../../../core/types';
import type {BusinessAdapter,ExecutionContext,ObjectReference,OperationRecovery,PreparedToolPlan,RemotePlatform,ToolName,ToolResult,ValidatedToolCall} from './contracts';
import {toolRegistry} from './registry';
import {validateToolCall} from './validation';
import {recordingFor} from '../../recording';

type Playlist=PersonalState['playlists'][number];
export type BusinessSnapshot={personal:PersonalState;playback:PlayerState;context:{playlistId?:string;selectedIds?:string[]};sources?:InstalledSource[];localTracks?:Track[];roaming?:{active:boolean}};
type ActiveTask={name:string;status:string;total:number;complete:number;kind:'background'|'playback'};
export type BusinessHost={
 snapshot():Promise<BusinessSnapshot>;
 selection():Promise<Track[]>;
 search(query:string,limit:number,signal:AbortSignal):Promise<Track[]>;
 control(action:string,args:Record<string,unknown>):Promise<void>;
 play(track:Track):Promise<void>;
 create(name:string,first?:Track):Promise<PersonalState>;
 add(id:string,track:Track):Promise<PersonalState>;
 remove(id:string,ids:string[],expected:string[]):Promise<PersonalState>;
 collect(kind:'liked'|'favorites',value:boolean,tracks:Track[]):Promise<PersonalState>;
 lyrics(track:Track):Promise<RawLyrics|null>;
 lyricOffset?(id:string):number;
 configureLyrics(args:Record<string,unknown>):Promise<void|ToolResult>;
 activities?():Promise<ActiveTask[]>;
 navigate(page:string,id?:string):Promise<void>;
 invoke<T=unknown>(args:Record<string,unknown>):Promise<T>;
 device():Promise<{identity:string;label:string;permissions:{handoff:boolean;submission:boolean}}|null>;
 transfer(kind:'handoff'|'submission',track:Track,snapshot:BusinessSnapshot):Promise<{id:string}>;
 roaming(action:string,args:Record<string,unknown>):Promise<void>;
 available?:ReadonlySet<ToolName>;
};
const label=(song:Track)=>`${song.title} · ${song.artist||'未知歌手'}`;
const fingerprint=(list:Playlist)=>JSON.stringify([list.id,list.name,list.tracks.map(song=>[song.id,song.providerId,song.remoteId])]);
const result=(message:string,data?:Record<string,unknown>,status:ToolResult['status']='completed'):ToolResult=>({status,message,...(data?{data}:{})});
const unique=(tracks:Track[])=>[...new Map(tracks.map(song=>[song.id,song])).values()];

/** Model arguments are converted into pinned client objects before any business call. */
export function createBusinessAdapter(platform:RemotePlatform,injected?:BusinessHost):BusinessAdapter {
 let hostPromise:Promise<BusinessHost>|undefined;
 const host=()=>hostPromise??=injected?Promise.resolve(injected):createDefaultBusinessHost(platform);
 const issue=(ctx:ExecutionContext,kind:ObjectReference['kind'],value:unknown,name:string):ObjectReference=>({kind,ref:ctx.refs.issue(kind,structuredClone(value),name),label:name});
 const describe=(ctx:ExecutionContext,song:Track)=>({...issue(ctx,'track',song,label(song)),title:song.title,artist:song.artist,album:song.album||'',duration:song.duration});
 const resolveTracks=(ctx:ExecutionContext,refs:unknown)=>unique((refs as string[]).map(ref=>structuredClone(ctx.refs.resolve<Track>(ref,'track'))));
 const readPlaylist=async(h:BusinessHost,ctx:ExecutionContext,ref:unknown)=>{
  const pinned=ctx.refs.resolve<{id:string}>(String(ref),'playlist');
  const list=(await h.snapshot()).personal.playlists.find(row=>row.id===pinned.id);
  if(!list)throw Error('歌单已不存在，请重新查找。');return structuredClone(list);
 };
 const plan=(ctx:ExecutionContext,summary:string,items:string[],stamp:string,validate:()=>Promise<boolean>,commit:()=>Promise<ToolResult>):PreparedToolPlan=>({
  kind:'confirmation',summary,items,fingerprint:stamp,validate,
  commit:async()=>{ctx.signal.throwIfAborted();if(!await validate())throw Error('目标已经变化，请重新查询并确认。');ctx.signal.throwIfAborted();return commit();},
 });
 const capabilities=async()=>{
  const h=await host(),snapshot=await h.snapshot();
  let device=false;if(platform==='android'){try{const peer=await h.device();device=!!peer&&(peer.permissions.handoff||peer.permissions.submission);}catch{/* Collaboration is optional; unrelated tools remain available. */}}
  return toolRegistry.filter(tool=>tool.platforms.includes(platform)&&(!h.available||h.available.has(tool.name))&&
   (!tool.conditions.includes('search')||!!snapshot.sources?.some(source=>source.enabled&&source.manifest.capabilities.includes('search')))&&
   (!tool.conditions.includes('device_connected')||device)).map(tool=>tool.name);
 };
 const readContext=async(ctx:ExecutionContext,include=['current','selection','playlist']):Promise<ToolResult>=>{
  const h=await host(),snapshot=await h.snapshot();ctx.signal.throwIfAborted();
  const current=include.includes('current')&&snapshot.playback.track?describe(ctx,recordingFor(snapshot.playback.track,snapshot.personal)):null;
  let selected:Track[]=[],selectionStatus='not_requested';if(include.includes('selection'))try{selected=await h.selection();selectionStatus=selected.length?'selected':'none';}catch{selectionStatus='unavailable';}
  const list=snapshot.personal.playlists.find(row=>row.id===snapshot.context.playlistId);
  let device:unknown=null;
  if(platform==='android'&&include.includes('devices')){try{const peer=await h.device();if(peer)device={...issue(ctx,'device',peer,peer.label),permissions:peer.permissions};}catch{device={status:'unavailable'};}}
  ctx.signal.throwIfAborted();
  return result('已读取当前设备上下文。',{...(include.includes('current')?{current}:{}),...(include.includes('selection')?{selected:selected.slice(0,10).map(song=>describe(ctx,song)),selectionStatus}:{}),...(include.includes('playlist')?{playlist:list?{...issue(ctx,'playlist',{id:list.id},list.name),count:list.tracks.length}:null}:{}),...(include.includes('devices')?{device}:{}),playback:{playing:snapshot.playback.playing,loading:!!snapshot.playback.sourceActivity,volume:snapshot.playback.volume,repeat:snapshot.playback.repeat,shuffle:snapshot.playback.shuffle,queueIndex:snapshot.playback.queueIndex,queueCount:snapshot.playback.queue.length},roaming:snapshot.roaming?.active??false});
 };
 const execute=async(input:ValidatedToolCall,ctx:ExecutionContext):Promise<ToolResult|PreparedToolPlan>=>{
  ctx.signal.throwIfAborted();const h=await host();
  const call=validateToolCall(input.name,input.args,{platform,available:new Set(await capabilities())}),a=call.args;
  ctx.signal.throwIfAborted();
  const prepare=(summary:string,items:string[],stamp:string,validate:()=>Promise<boolean>,commit:()=>Promise<ToolResult>)=>plan(ctx,summary,items,stamp,async()=>{
   try{for(const [key,value]of Object.entries(a)){
    const kind=key==='deviceRef'?'device':key==='playlistRef'||key==='playlistRefs'?'playlist':key==='candidateRef'?'candidate':'track';
    if(key.endsWith('Ref'))ctx.refs.resolve(String(value),kind);
    if(key.endsWith('Refs'))for(const ref of value as string[])ctx.refs.resolve(ref,kind);
   }}catch{return false;}
   return validate();
  },commit);
  if(call.name==='context.read')return readContext(ctx,a.include as string[]|undefined);
  if(call.name==='music.search'){
   ctx.refs.invalidate('candidate');const songs=await h.search(String(a.query),Number(a.limit||10),ctx.signal);ctx.signal.throwIfAborted();
   const candidates=songs.slice(0,Number(a.limit||10)).map(song=>issue(ctx,'candidate',song,label(song)));
   return {...result(candidates.length?`找到 ${candidates.length} 个歌曲候选。`:'搜索已完成，没有匹配歌曲。',{songs:songs.slice(0,candidates.length).map((song,index)=>({...candidates[index],title:song.title,artist:song.artist,album:song.album||''}))}),candidates};
  }
  if(call.name==='music.play_result'){
   const song=structuredClone(ctx.refs.resolve<Track>(String(a.candidateRef),'candidate'));ctx.signal.throwIfAborted();await h.play(song);
   const state=(await h.snapshot()).playback;
   if(state.track?.id!==song.id)return result('播放器已选择其他歌曲，本次指定版本的播放结果未确认。',undefined,'unknown');
   if(state.error)throw Error('指定版本播放失败，请重新选择候选。');
   return result(state.playing?'指定版本已开始播放。':'已选择指定版本并开始加载。',{song:describe(ctx,song)},state.playing?'playback_started':'loading_started');
  }
  if(call.name.startsWith('playback.')){
   await h.control(call.name==='playback.control'?String(a.action):call.name==='playback.set_volume'?'volume':'mode',a);
   const playback=(await h.snapshot()).playback;
   if(playback.error)throw Error('播放器报告失败，请查看当前播放状态。');
   return result('播放器已执行操作。',{playing:playback.playing,loading:!!playback.sourceActivity,volume:playback.volume,repeat:playback.repeat,shuffle:playback.shuffle},playback.sourceActivity?'loading_started':'completed');
  }
  if(call.name==='music.query')return queryMusic(h,ctx,a,describe);
  if(call.name==='playlist.find'){
   const lists=(await h.snapshot()).personal.playlists.filter(list=>!a.query||list.name.normalize('NFKC').toLowerCase().includes(String(a.query).normalize('NFKC').toLowerCase())).slice(0,Number(a.limit||10));
   const candidates=lists.map(list=>issue(ctx,'playlist',{id:list.id},list.name));
   return {...result(`找到 ${lists.length} 个歌单。`,{playlists:lists.map((list,index)=>({...candidates[index],count:list.tracks.length}))}),candidates};
  }
  if(call.name==='playlist.open'){const list=await readPlaylist(h,ctx,a.playlistRef);await h.navigate('playlist',list.id);return result(`已打开歌单“${list.name}”。`,undefined,'page_opened');}
  if(call.name==='playlist.create'){
   const songs=a.trackRefs?resolveTracks(ctx,a.trackRefs):[],name=String(a.name),before=structuredClone((await h.snapshot()).personal.playlists);
   if(before.some(list=>list.name===name))throw Error('已有同名歌单，请使用其他名字。');
   return prepare(`创建歌单“${name}”并加入 ${songs.length} 首歌曲？`,songs.map(label),JSON.stringify({tool:call.name,name,trackIds:songs.map(song=>song.id),baselineIds:before.map(list=>list.id)}),async()=>!(await h.snapshot()).personal.playlists.some(list=>list.name===name),async()=>{
    const saved=await h.create(name,songs[0]),list=saved.playlists.find(row=>!before.some(old=>old.id===row.id)&&row.name===name);
    if(!list)return result('创建结果尚未确认，请先查找歌单再决定下一步。',undefined,'unknown');
    return addSongs(h,list,songs.slice(1),`已创建歌单“${name}”`,ctx);
   });
  }
  if(call.name==='playlist.add_tracks'||call.name==='playlist.remove_tracks'){
   const list=await readPlaylist(h,ctx,a.playlistRef),songs=resolveTracks(ctx,a.trackRefs),stamp=fingerprint(list),remove=call.name==='playlist.remove_tracks';
   if(remove&&songs.some(song=>!list.tracks.some(row=>row.id===song.id)))throw Error('指定歌曲不在目标歌单中。');
   return prepare(`${remove?'从':'向'}歌单“${list.name}”${remove?'移出':'加入'} ${songs.length} 首歌曲？`,songs.map(label),JSON.stringify({tool:call.name,playlistId:list.id,trackIds:songs.map(song=>song.id),baselineIds:list.tracks.map(song=>song.id)}),async()=>{const fresh=(await h.snapshot()).personal.playlists.find(row=>row.id===list.id);return !!fresh&&fingerprint(fresh)===stamp;},async()=>{
    if(!remove)return addSongs(h,list,songs,'已更新歌单',ctx);
    const saved=await h.remove(list.id,songs.map(song=>song.id),list.tracks.map(song=>song.id)),fresh=saved.playlists.find(row=>row.id===list.id);
    return fresh&&!songs.some(song=>fresh.tracks.some(row=>row.id===song.id))?result(`已移出 ${songs.length} 首歌曲。`,undefined,'saved'):result('移出结果尚未确认，请先查看歌单。',undefined,'unknown');
   });
  }
  if(call.name==='collection.set'){
   const songs=resolveTracks(ctx,a.trackRefs),kind=a.kind as 'liked'|'favorites',value=Boolean(a.value);
   const commit=async()=>{const saved=await h.collect(kind,value,songs);const valid=songs.every(song=>saved[kind].some(row=>row.id===song.id)===value);return result(valid?`已${value?'加入':'取消'}${kind==='liked'?'喜欢':'收藏'}：${songs.map(label).join('、')}`:'保存结果尚未确认，请先查看收藏。',undefined,valid?'saved':'unknown');};
   return songs.length===1?commit():prepare(`为 ${songs.length} 首设置${kind==='liked'?'喜欢':'收藏'}为${value?'开启':'关闭'}？`,songs.map(label),JSON.stringify({tool:call.name,kind,value,trackIds:songs.map(song=>song.id)}),async()=>true,commit);
  }
  if(call.name==='lyrics.configure')return await h.configureLyrics(a)||result('歌词显示设置已应用。',undefined,'saved');
  if(call.name==='navigation.open'){await h.navigate(String(a.page));return result('已打开请求的页面。',undefined,'page_opened');}
  if(call.name==='cache.prepare'){
   const list=await readPlaylist(h,ctx,a.playlistRef),stamp=fingerprint(list);if(!list.tracks.length)throw Error('歌单没有歌曲。');
   return prepare(`为“${list.name}”的 ${list.tracks.length} 首歌曲建立缓存任务？`,list.tracks.slice(0,50).map(label),JSON.stringify({tool:call.name,playlistId:list.id,name:list.name,trackIds:list.tracks.map(song=>song.id)}),async()=>{const fresh=(await h.snapshot()).personal.playlists.find(row=>row.id===list.id);return !!fresh&&fingerprint(fresh)===stamp;},async()=>{
    const tasks=await h.invoke<{tasks:{id:string;status:string}[]}>({operation:'offlineTasks',action:'prepare',tracks:list.tracks,name:list.name,group:list.name,pin:a.pin!==false});
    if(!tasks.tasks?.length)throw Error('未能核实缓存任务已经建立。');
    return result('缓存任务已建立，尚未代表音频已全部下载。',{tasks:tasks.tasks.map(task=>({id:task.id,status:task.status}))},'task_created');
   });
  }
  if(call.name==='tasks.query'){
   const state=await h.invoke<{error?:string;tasks:{name:string;status:string;items:{status:string}[]}[]}>({operation:'offlineTasks',action:'state'});
   if(state.error)throw Error('缓存任务资料暂时无法读取，请在任务中心处理。');
   const activities=h.activities?await h.activities():[];
   const cached=state.tasks.filter(task=>a.include==='all'||['queued','running','waiting'].includes(task.status)).map(task=>({kind:'cache',name:task.name,status:task.status,total:task.items.length,complete:task.items.filter(item=>['complete','local'].includes(item.status)).length}));
   const visible=activities.filter(task=>a.include==='all'||['running','cancelling'].includes(task.status));
   const tasks=[...visible,...cached].slice(0,Number(a.limit||20));
   return result(`当前返回 ${tasks.length} 个任务；不代表操作系统的全部网络连接。`,{tasks,coverage:['cache',...(h.activities?['background','playback']:[])]});
  }
  if(call.name==='network.set_policy')return prepare('保存这次音乐联网偏好？已建立的连接可能继续传输。',[],JSON.stringify({tool:call.name,policy:a}),async()=>true,async()=>{await h.invoke({operation:'offlineTasks',action:'policy',policy:a});return result('联网偏好已保存，影响后续音乐请求。',undefined,'saved');});
  if(call.name==='roaming.configure'){
   const song=a.trackRef?structuredClone(ctx.refs.resolve<Track>(String(a.trackRef),'track')):undefined;
   return prepare('执行这次漫游设置？',song?[label(song)]:[],JSON.stringify({tool:call.name,action:a.action,trackId:song?.id}),async()=>true,async()=>{await h.roaming(String(a.action),{...a,track:song});return result('漫游操作已提交并应用。',undefined,'saved');});
  }
  if(call.name==='stats.query'){
   const now=new Date(),from=new Date(now);if(a.period==='week')from.setDate(from.getDate()-(from.getDay()+6)%7);else if(a.period==='month')from.setDate(1);else from.setMonth(0,1);
   const day=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
   const stats=await h.invoke<{seconds:number;plays:number;uniqueTracks:number;topTracks:{title:string;artist:string;plays:number}[]}>({operation:'stats',from:day(from),to:day(now)});
   return result('已读取听歌统计。',{seconds:stats.seconds,plays:stats.plays,uniqueTracks:stats.uniqueTracks,topTracks:stats.topTracks.slice(0,5).map(song=>({title:song.title,artist:song.artist,plays:song.plays}))});
  }
  if(call.name==='timer.configure'){const state=await h.invoke({operation:a.action==='cancel'?'timerCancel':'timerSet',...(a.action==='set'?{minutes:a.minutes}:{})});return result(a.action==='cancel'?'睡眠定时已取消。':`${a.minutes} 分钟后停止播放，应用继续保留。`,{timer:state},'saved');}
  if(call.name==='device.transfer'){
   const peer=ctx.refs.resolve<{identity:string}>(String(a.deviceRef),'device'),snapshot=await h.snapshot(),song=a.kind==='submission'?ctx.refs.resolve<Track>(String(a.trackRef),'track'):snapshot.playback.track;
   if(!song||song.source==='local')throw Error('请选择可在线解析的歌曲进行协作。');const pinned=structuredClone(song);
   const valid=async()=>{const live=await h.device();return live?.identity===peer.identity&&!!live.permissions[a.kind as 'handoff'|'submission'];};
   return prepare(`向电脑发送${a.kind==='handoff'?'播放接力':'下一首投稿'}《${pinned.title}》？`,[label(pinned)],JSON.stringify({tool:call.name,kind:a.kind,trackId:pinned.id}),valid,async()=>{const ticket=await h.transfer(a.kind as 'handoff'|'submission',pinned,snapshot);return result('协作请求已发送，等待电脑确认。',{ticket:ticket.id},'task_created');});
  }
  if(call.name==='backup.export_playlists'){
   const lists=a.scope==='all'?(await h.snapshot()).personal.playlists:await Promise.all((a.playlistRefs as string[]).map(ref=>readPlaylist(h,ctx,ref)));
   if(!lists.length)throw Error('没有可以导出的歌单。');const saved=await h.invoke<boolean>({operation:'exportFile',ids:lists.map(list=>list.id)});
   return result(saved?'歌单文件已保存。':'已取消保存。',undefined,saved?'saved':'cancelled');
  }
  const update=await h.invoke<{status:string;message:string}>({operation:'assistantUpdateCheck'});if(update.status==='error')throw Error(update.message);return result(update.message,{status:update.status});
 };
 const recovery=async(call:ValidatedToolCall,ctx:ExecutionContext):Promise<Record<string,unknown>>=>{
  ctx.signal.throwIfAborted();
  if(call.name==='collection.set')return {tool:call.name,kind:call.args.kind,value:call.args.value,trackIds:resolveTracks(ctx,call.args.trackRefs).map(song=>song.id)};
  return {tool:call.name,args:structuredClone(call.args)};
 };
 const reconcile=async(operation:OperationRecovery,ctx:ExecutionContext):Promise<ToolResult>=>{
  ctx.signal.throwIfAborted();const record=(operation.data||{}) as {tool:ToolName;name?:string;playlistId?:string;trackIds?:string[];baselineIds?:string[];kind?:'liked'|'favorites';value?:boolean;policy?:Record<string,unknown>;args?:Record<string,unknown>};
  const h=await host(),state=await h.snapshot(),ids=record.trackIds||[];
  if(record.tool==='playlist.create'){
   const matches=state.personal.playlists.filter(list=>list.name===record.name&&!record.baselineIds?.includes(list.id));
   if(matches.length===1)return result(ids.every(id=>matches[0].tracks.some(song=>song.id===id))?'已核实新歌单和指定歌曲已保存。':'新歌单已存在，部分指定歌曲尚未加入。',undefined,ids.every(id=>matches[0].tracks.some(song=>song.id===id))?'saved':'partial');
  }
  if(record.tool==='playlist.add_tracks'||record.tool==='playlist.remove_tracks'){
   const list=state.personal.playlists.find(row=>row.id===record.playlistId);if(list){const valid=ids.every(id=>list.tracks.some(song=>song.id===id)===(record.tool==='playlist.add_tracks'));if(valid)return result('已核实歌单当前内容符合该次操作目标。',undefined,'saved');}
  }
  if(record.tool==='collection.set'&&record.kind&&ids.every(id=>state.personal[record.kind!].some(song=>song.id===id)===record.value))return result('已核实喜欢或收藏符合该次操作目标。',undefined,'saved');
  if(record.tool==='network.set_policy'){
   const tasks=await h.invoke<{policy?:Record<string,unknown>}>({operation:'offlineTasks',action:'state'});if(record.policy&&tasks.policy&&Object.entries(record.policy).every(([key,value])=>tasks.policy![key]===value))return result('已核实联网策略已保存。',undefined,'saved');
  }
  if(record.tool==='playback.set_volume'&&state.playback.volume===record.args?.value)return result('已核实播放器的目标音量。',undefined,'completed');
  if(record.tool==='playback.set_mode'&&Object.entries(record.args||{}).every(([key,value])=>state.playback[key as 'repeat']===value))return result('已核实播放器循环设置。',undefined,'completed');
  return result('当前资料尚不能唯一确认此前操作的完成结果，请先查看对应歌单或任务。没有重放操作。',undefined,'unknown');
 };
 return {capabilities,readContext,execute,recovery,reconcile};
}

async function addSongs(host:BusinessHost,list:Playlist,songs:Track[],message:string,ctx:ExecutionContext):Promise<ToolResult>{
 let saved=list,added=0;
 for(const song of songs){if(saved.tracks.some(row=>row.id===song.id))continue;
  if(ctx.signal.aborted)return result(`${message}，已加入 ${added} 首，其余已取消。`,undefined,'partial');
  try{const state=await host.add(list.id,song),fresh=state.playlists.find(row=>row.id===list.id);if(!fresh?.tracks.some(row=>row.id===song.id))return result(`${message}，部分加歌结果未确认，请查看歌单。`,undefined,'unknown');saved=fresh;added++;}
  catch{return result(`${message}，已加入 ${added} 首，后续未完成。请先核对歌单。`,undefined,'partial');}
 }
 return result(`${message}，当前共 ${saved.tracks.length} 首。`,{count:saved.tracks.length},'saved');
}

async function queryMusic(host:BusinessHost,ctx:ExecutionContext,a:Record<string,unknown>,describe:(ctx:ExecutionContext,song:Track)=>Record<string,unknown>):Promise<ToolResult>{
 const {personal,playback,roaming}=await host.snapshot();let songs:Track[]=[];let order='当前歌曲';
 if(a.scope==='reference')songs=[ctx.refs.resolve<Track>(String(a.trackRef),'track')];
 else if(a.scope==='selected')songs=(await host.selection()).slice(0,10);
 else if(a.scope==='history'){songs=[...personal.history].sort((l,r)=>r.playedAt-l.playedAt).slice(0,Number(a.count||10)).map(row=>row.track);order='实际听歌历史，最近在前；重复曲目可能合并';}
 else if(a.scope==='queue'){
  const index=playback.queueIndex;if(!playback.track||index<0||playback.queue[index]?.id!==playback.track.id)throw Error('无法确认当前队列位置，请查询当前歌曲。');
  songs=playback.queue.slice(Math.max(0,index+Number(a.from||0)),Math.min(playback.queue.length,index+Number(a.to||0)+1));order=`当前队列顺序${playback.shuffle?'，随机播放的实际下一首可能不同':''}${roaming?.active?'，漫游后续未发现歌曲不在此列表中':''}`;
 }else songs=playback.track?[playback.track]:[];
 const fields=new Set((a.fields as string[]|undefined)||['all']),rows:Record<string,unknown>[]=[];
 for(const original of songs){ctx.signal.throwIfAborted();const song=recordingFor(original,personal),info=describe(ctx,song),row:Record<string,unknown>={ref:info.ref,title:song.title};
  for(const field of ['artist','album','duration','year'])if(fields.has('all')||fields.has(field))row[field]=song[field as 'artist']??null;
  if(fields.has('all')||fields.has('source'))row.source=song.source||'unknown';
  if(fields.has('all')||fields.has('saved'))row.saved={liked:personal.liked.some(item=>item.id===song.id),favorites:personal.favorites.some(item=>item.id===song.id)};
  if(fields.has('all')||fields.has('progress'))row.progress=original.id===playback.track?.id?{position:playback.position,playing:playback.playing}:null;
  if(fields.has('all')||fields.has('cover'))row.coverAvailable=Boolean(song.coverUrl);
  if(fields.has('lyrics')){
   try{const raw=await host.lyrics(song);ctx.signal.throwIfAborted();const {parseLyrics,activeLyricIndex}=await import('../../../core/lyrics');const lines=raw?parseLyrics({...raw,text:raw.text.slice(0,120000)}):[];const at=original.id===playback.track?.id?activeLyricIndex(lines,playback.position,host.lyricOffset?.(original.id)||0):0;row.lyrics=lines[at]?.text.slice(0,400)||null;}
   catch{ctx.signal.throwIfAborted();row.lyricsStatus='unavailable';}
  }
  rows.push(row);
 }
 return result(`已查询 ${rows.length} 首歌曲。`,{order,songs:rows});
}

async function createDefaultBusinessHost(platform:RemotePlatform):Promise<BusinessHost>{
 const mobile=platform==='android';
 const [{libraryHost},{controlHost},{command},{captureSpace},{requestAssistantUi}]=await Promise.all([import('../libraryHost'),import('../controlHost'),import('../../../mobile/native'),import('../../space/state'),import('../controlUi')]);
 const library=libraryHost(mobile),control=controlHost(mobile);
 const snapshot=async():Promise<BusinessSnapshot>=>{const state:BusinessSnapshot=await library.snapshot();let sources:InstalledSource[]|undefined;try{sources=mobile?(await command<{sources:InstalledSource[]}>('snapshot')).sources:await window.yzqxy!.sources.list();}catch{/* A broken optional source cannot disable personal-library controls. */}const roaming=mobile?state.roaming:(await import('../../../core/roaming')).roaming.snapshot;return {...state,sources,roaming};};
 return {
  snapshot,
  selection:async()=>{
   const state:BusinessSnapshot=await library.snapshot(),list=state.personal.playlists.find(row=>row.id===state.context.playlistId);
   if(state.context.selectedIds?.length&&list)return list.tracks.filter(song=>state.context.selectedIds!.includes(song.id));
   const space=await captureSpace('selection'),selected=space.tracks.filter(song=>song.id===space.selectedId);
   // Space snapshots deliberately remove paths/URLs. Rehydrate local files before saving them into personal data.
   const local=selected.some(song=>song.source==='local')?(mobile?state.localTracks||[]:(await window.yzqxy!.library.load()).tracks):[];
   return selected.map(song=>{if(song.source!=='local')return song;const actual=local.find(row=>row.id===song.id&&row.source==='local');if(!actual?.path)throw Error('选中的本地歌曲已不可用，请重新导入原文件。');return structuredClone(actual);});
  },
  search:async(query,limit,signal)=>{const state=await snapshot(),sources=(state.sources||[]).filter(source=>source.enabled&&source.manifest.capabilities.includes('search')),songs:Track[]=[],failures:string[]=[];let completed=0;
   for(const source of sources){signal.throwIfAborted();try{const page=mobile?await command<{items:Track[]}>('search',{id:source.id,keyword:query}):await window.yzqxy!.sources.search(source.id,query,null,limit,undefined,true);signal.throwIfAborted();completed++;songs.push(...page.items);if(songs.length>=limit)break;}catch(error){signal.throwIfAborted();failures.push(error instanceof Error?error.message:'搜索失败');}}
   if(!completed)throw Error(failures[0]||'没有可用的搜索源');return unique(songs).slice(0,limit);},
  control:async(action,args)=>{if(mobile){if(action==='pause'||action==='play'){const {playback}=await library.snapshot();if(Boolean(playback.playWhenReady??playback.playing)!==(action==='play'))await command('toggle');}else await command(action==='seek'?'seek':action==='volume'?'volume':action==='mode'?'mode':action,action==='seek'?{seconds:args.positionSeconds}:args);return;}const {player}=await import('../../../core/player');if(action==='pause')player.pause();else if(action==='play')await player.play();else if(action==='next')await player.next();else if(action==='previous')await player.previous();else if(action==='seek')player.seek(Number(args.positionSeconds));else if(action==='volume')player.setVolume(Number(args.value));else{if(args.repeat!==undefined)player.setRepeat(args.repeat as 'off'|'all'|'one');if(typeof args.shuffle==='boolean'&&args.shuffle!==player.snapshot.shuffle)player.setShuffle(args.shuffle);}},
  play:async song=>{if(mobile){await command('play',{tracks:[song],index:0});return;}await(await import('../../../core/player')).player.playTrack(song,[song]);},
  create:library.create,
  add:async(id,track)=>mobile?command('personal',{operation:'addToPlaylist',id,track}):window.yzqxy!.personal.addToPlaylist(id,track),
  remove:library.remove,
  collect:async(kind,value,songs)=>{if(value)return library.collect([kind],songs);let personal=(await library.snapshot()).personal;for(const song of songs){if(!personal[kind].some(row=>row.id===song.id))continue;personal=mobile?await command('personal',{operation:'removeSaved',kind,id:song.id}):await window.yzqxy!.personal.removeSaved(kind,song.id);}return personal;},
  lyrics:library.lyrics,
  lyricOffset:library.lyricOffset,
  configureLyrics:async args=>{
   const {playback}=await library.snapshot();if((args.pure!==undefined||args.offsetSeconds!==undefined)&&!playback.track)throw Error('请先选择歌曲');
   const applied:string[]=[];
   try{
    if(args.offsetSeconds!==undefined){const id=playback.track!.id,value=Number(args.offsetSeconds),saved=await control.offset(id,value-(library.lyricOffset?.(id)||0));if(saved!==value)throw Error('歌词偏移未能保存为指定值');applied.push('offsetSeconds');}
    if(args.overlay!==undefined){
     if(mobile){const state=await command<{permitted:boolean;enabled:boolean}>('overlayEnable',{enabled:args.overlay});if(args.overlay&&!state.permitted)return result('请先授予悬浮歌词权限。',{applied},applied.length?'partial':'needs_input');if(state.enabled!==args.overlay)throw Error('未能确认悬浮歌词已切换');}
     else{const overlay=window.yzqxy!.desktopLyrics;if(await overlay.isVisible()!==args.overlay)await overlay.toggle();if(await overlay.isVisible()!==args.overlay)throw Error('未能确认悬浮歌词已切换');}
     applied.push('overlay');
    }
    if(args.pure!==undefined){requestAssistantUi('lyrics-mode',{pure:args.pure});applied.push('pure');}
    return result(args.pure!==undefined?'歌词页面已接受显示模式切换；已完成的其他设置已保存。':'歌词设置已保存。',{applied},applied.length===1&&applied[0]==='pure'?'page_opened':'saved');
   }catch(error){if(applied.length)return result('部分歌词设置已应用，其余未能完成，请核对后再试。',{applied},'partial');throw error;}
  },
  activities:async()=>{
   const {activitySnapshot}=await import('../../tasks/activities'),state=await library.snapshot();
   const tasks:ActiveTask[]=activitySnapshot().map(row=>({kind:'background',name:row.name,status:row.state,total:row.total,complete:row.done}));
   if(state.playback.sourceActivity&&state.playback.sourceActivity.phase!=='failed')tasks.unshift({kind:'playback',name:'当前歌曲音源解析与播放准备',status:'running',total:0,complete:0});
   return tasks;
  },
  navigate:async(page,id)=>{if(page==='home'||page==='playlist')return library.navigate(page,id);requestAssistantUi(page);},
  invoke:async<T,>(args:Record<string,unknown>):Promise<T>=>args.operation==='assistantUpdateCheck'?await control.updates() as T:control.invoke<T>(args),
  device:async()=>{if(!mobile)return null;const status=await control.invoke<{phase:string;connectionId?:string}>({operation:'collaboration',action:'status'});if(status.phase!=='connected'||!status.connectionId)return null;const state=await control.invoke<{permissions:{handoff:boolean;submission:boolean}}>({operation:'collaboration',action:'state'});return {identity:status.connectionId,label:'已配对电脑',permissions:state.permissions};},
  transfer:async(kind,track,state)=>{const ticket=await control.invoke<{id:string}>({operation:'collaboration',action:'send',payload:{kind,track,...(kind==='handoff'?{queue:state.playback.queue,position:state.playback.position,playing:state.playback.playWhenReady??state.playback.playing}:{})}});if(kind==='handoff'&&(state.playback.playWhenReady??state.playback.playing)){const {followHandoff}=await import('../../connections/handoffCoordinator');const {pauseHost}=await import('../../featureHost');followHandoff(control.invoke,ticket.id,{id:track.id,selection:state.playback.selectionRevision},expected=>pauseHost(true,expected));}return ticket;},
  roaming:async(action,args)=>{
   if(action==='temporary_branch'||action==='return'){await control.invoke({operation:'spaceFeatures',action:'roaming',edit:action==='return'?'return':'branch',keyword:args.keyword,count:args.count});return;}
   if(action==='reduce_track'){const song=args.track as Track,state=await control.space();const {rules}=await import('../../space/state');await control.saveSpace({...state,roaming:{...state.roaming,excluded:[...state.roaming.excluded.filter(row=>row.kind!=='song'||row.key!==rules.songKey(song)),{id:crypto.randomUUID(),kind:'song',effect:'reduce',key:rules.songKey(song),label:label(song)}]}});return;}
   if(mobile){
    if(action==='start'){await command('roamingStart');return;}
    const state=await command<{roaming?:{active:boolean;phase:string};playback:PlayerState}>('snapshot');
    if(!state.roaming?.active)throw Error('当前没有正在进行的漫游');
    const wanted=state.playback.playWhenReady??state.playback.playing;
    if(action==='pause'){if(wanted)await command('toggle');}
    else if(['failed','exhausted'].includes(state.roaming.phase))await command('roamingRetry');
    else if(!wanted)await command('toggle');
    return;
   }
   const {roaming}=await import('../../../core/roaming');
   if(action!=='start'&&!roaming.snapshot.active)throw Error('当前没有正在进行的漫游');
   if(action==='pause')(await import('../../../core/player')).player.pause();else await roaming.start();
  },
 };
}
