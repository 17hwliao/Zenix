import {querySongs} from './songQuery';
import type {PersonalState,PlayerState,RawLyrics,Track} from '../../core/types';
import {activeLyricIndex,parseLyrics} from '../../core/lyrics';
import {recordingFor,recordingIdentity} from '../recording';
import type {LibraryContext} from './libraryContext';

export type AssistantResult={reply:string;items?:string[];detail?:string;speech?:string[];ask?:{action:string;args:Record<string,unknown>}};
export type AssistantPlan={kind:'confirmation';summary:string;items:string[];commit:()=>Promise<AssistantResult>};
export type AssistantLibraryHost={snapshot:()=>Promise<{personal:PersonalState;playback:PlayerState;context:LibraryContext}>;lyrics:(track:Track)=>Promise<RawLyrics|null>;lyricOffset?:(id:string)=>number;navigate:(page:'home'|'playlist',id?:string)=>Promise<void>;create:(name:string,track?:Track)=>Promise<PersonalState>;remove:(id:string,ids:string[],expected:string[])=>Promise<PersonalState>;collect:(kinds:string[],tracks:Track[])=>Promise<PersonalState>};
const normalized=(text:string)=>text.normalize('NFKC').replace(/\s+/g,'').toLocaleLowerCase();
const ids=(tracks:Track[])=>tracks.map(track=>track.id);
const names=(tracks:Track[])=>tracks.map(track=>`${track.title}${track.artist?' · '+track.artist:''}`);
function playlist(personal:PersonalState,context:LibraryContext,name:unknown,fallback?:string){
 const query=String(name||'').trim();const found=query&&!['当前','当前歌单','这张'].includes(query)?personal.playlists.filter(list=>normalized(list.name)===normalized(query)):personal.playlists.filter(list=>list.id===(context.playlistId||(!context.collection||context.collection==='home'?fallback:undefined)));
 if(found.length>1)throw Error('有多个同名歌单，请先在歌单界面打开要操作的那一个，再说“当前歌单”。');
 if(!found.length)throw Error(query?`没有找到歌单“${query}”。请说出完整歌单名。`:'请先打开一个自定义歌单，或在指令中说出歌单名称。');return found[0];
}
/** Captures explicit targets before confirmation. Mutations never re-resolve "current" on commit. */
export async function libraryCommand(action:string,args:Record<string,unknown>,host:AssistantLibraryHost,signal?:AbortSignal):Promise<AssistantResult|AssistantPlan>{
 signal?.throwIfAborted();const snapshot=await host.snapshot();signal?.throwIfAborted();const {personal,playback,context}=snapshot;
 const actual=playback.track?recordingFor(playback.track,personal):undefined;
 if(action==='song-query')return querySongs(args,personal,playback,host.lyrics,signal,host.lyricOffset);
 if(action==='home'){await host.navigate('home');return {reply:'已返回主界面，音乐继续保持原来的播放状态。'};}
 if(action==='playlist-open'){const list=playlist(personal,context,args.name,playback.track?.playlistId);await host.navigate('playlist',list.id);return {reply:`已打开歌单“${list.name}”，共 ${list.tracks.length} 首，没有自动切歌。`};}
 if(action==='now-artist'){if(!actual)throw Error('当前还没有选择歌曲。');return {reply:`《${actual.title}》的歌手是${actual.artist||'未知，当前来源没有提供歌手信息'}。`};}
 if(action==='recent-songs')return querySongs({...args,scope:'history',field:args.field||'title'},personal,playback,host.lyrics,signal,host.lyricOffset);
 if(action==='now-lyrics'){
  if(!actual)throw Error('请先选择一首歌曲。');const raw=await host.lyrics(actual);signal?.throwIfAborted();if(!raw?.text.trim())return {reply:`《${actual.title}》暂时没有可用歌词。`};
  const lines=parseLyrics({...raw,text:raw.text.slice(0,120000)}),at=activeLyricIndex(lines,playback.position-(host.lyricOffset?.(playback.track!.id)||0)),current=at>=0?lines[at]?.text:undefined;
  return {reply:`《${actual.title}》${current?'在提问时唱到：“'+current+'”':'的歌词已找到，提问时尚未唱到第一句'}。`,detail:args.lineOnly?(current||'尚未唱到第一句'):lines.map(line=>line.text).join('\n')};
 }
 if(action==='playlist-create'||action==='playlist-create-current'){
  if(action==='playlist-create-current'&&!actual)throw Error('请先选择一首歌曲，再加入新歌单。');
  if(args.expectedRecording&&(!actual||recordingIdentity(actual)!==args.expectedRecording))throw Error('歌曲已变化，请重新确认要加入新歌单的歌曲。');
  const name=String(args.name||'').trim();if(!name)return {reply:'新歌单叫什么名字？直接告诉我名字即可，也可以取消。',ask:{action,args:{...args,...(actual&&action==='playlist-create-current'?{expectedRecording:recordingIdentity(actual)}:{})}}};
  if(name.length>100)throw Error('歌单名请控制在 100 个字以内。');if(personal.playlists.some(list=>normalized(list.name)===normalized(name)))throw Error('已有同名歌单，请换一个名称。');
  const first=action==='playlist-create-current'?structuredClone(actual):undefined;
  return {kind:'confirmation',summary:`创建歌单“${name}”${first?`，并加入《${first.title}》`:''}？`,items:first?names([first]):[],commit:async()=>{signal?.throwIfAborted();const state=await host.create(name,first);const added=state.playlists.find(list=>normalized(list.name)===normalized(name)&&(!first||list.tracks.some(track=>track.id===first.id)));if(!added)throw Error('尚未确认新歌单已经保存，请先查看歌单，避免重复创建。');return {reply:`已创建歌单“${added.name}”${first?`，并加入《${first.title}》`:''}。`};}};
 }
 if(action==='songs-collect'||action==='songs-remove'){
  let list:PersonalState['playlists'][number]|undefined,tracks:Track[]=[],scopeLabel='';
  if(action==='songs-remove'||args.scope==='playlist'||args.scope==='selected')list=playlist(personal,context,args.name,playback.track?.playlistId);
  if(args.scope==='track'){if(!playback.track)throw Error('请先选择一首歌曲。');tracks=[action==='songs-remove'?playback.track:actual!];scopeLabel='当前歌曲';}
  else if(args.scope==='queue'){tracks=playback.queue;scopeLabel='当前播放队列';}
  else if(args.scope==='playlist'){tracks=list!.tracks;scopeLabel=`歌单“${list!.name}”全部歌曲`;}
  else {const selected=new Set(context.selectedIds||[]);tracks=list!.tracks.filter(track=>selected.has(track.id));scopeLabel=`歌单“${list!.name}”中选中的歌曲`;}
  if(Array.isArray(args.titles)&&args.titles.length){tracks=[];for(const title of args.titles){const matches=list!.tracks.filter(track=>normalized(track.title)===normalized(String(title)));if(matches.length!==1)throw Error(`歌单中“${title}”${matches.length?'有多个版本，请先勾选要移出的版本':'不存在'}。`);tracks.push(matches[0]);}}
  tracks=[...new Map(tracks.map(track=>[track.id,structuredClone(track)])).values()];if(!tracks.length)throw Error('尚未选中歌曲。请在歌单批量整理中勾选，或明确说“当前歌单全部”“当前队列”。');if(tracks.length>5000)throw Error('单次最多操作 5000 首，请分批选择。');
  if(action==='songs-remove'&&tracks.some(track=>!list!.tracks.some(row=>row.id===track.id)))throw Error('要移出的歌曲不在当前歌单中，请先打开正确歌单。');
  const kinds=Array.isArray(args.kinds)?args.kinds.map(String):[];if(action==='songs-collect'&&(!kinds.length||kinds.some(kind=>!['liked','favorites'].includes(kind))))throw Error('请选择喜欢或收藏。');
  const pinned=tracks,sourceId=list?.id,expected=list?ids(list.tracks):undefined,label=action==='songs-remove'?`从歌单“${list!.name}”移出 ${tracks.length} 首歌曲（保留音频文件、历史及其他歌单）`:`将${scopeLabel}的 ${tracks.length} 首加入${kinds.map(kind=>kind==='liked'?'喜欢':'收藏').join('和')}（已存在的不重复添加）`;
  return {kind:'confirmation',summary:label+'？',items:names(tracks),commit:async()=>{
   signal?.throwIfAborted();if(sourceId){const fresh=await host.snapshot();signal?.throwIfAborted();const current=fresh.personal.playlists.find(row=>row.id===sourceId);if(!current||JSON.stringify(ids(current.tracks))!==JSON.stringify(expected))throw Error('歌单已经变化，请重新选择并确认；没有执行这次操作。');}
   const state=action==='songs-remove'?await host.remove(sourceId!,ids(pinned),expected!):await host.collect(kinds,pinned);
   if(action==='songs-remove'){const updated=state.playlists.find(row=>row.id===sourceId);if(!updated||pinned.some(track=>updated.tracks.some(row=>row.id===track.id)))throw Error('尚未确认歌曲移出结果，请查看歌单后再试。');}
   else if(kinds.some(kind=>pinned.some(track=>!state[kind as 'liked'|'favorites'].some(row=>row.id===track.id))))throw Error('尚未确认全部歌曲已保存，请查看喜欢或收藏后再试。');
   return {reply:action==='songs-remove'?`已从歌单移出 ${pinned.length} 首，音频文件和其他资料保留。`:`已确认 ${pinned.length} 首歌曲在${kinds.map(kind=>kind==='liked'?'喜欢':'收藏').join('和')}中；已有条目未重复添加。`};
  }};
 }
 throw Error('此音乐资料操作尚未登记。');
}
