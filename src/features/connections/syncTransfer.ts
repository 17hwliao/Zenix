import type {PersonalState,Track,PersonalPlaylist} from '../../core/types';
import type {TransferPayload} from './ConnectionsPanel';
import {versionPreferences,type VersionPreferences} from '../playback/preferences';
import {rules,type SpaceState} from '../space/state';
import {redact} from '../../core/sourceDiagnostics';
export type SyncResult={status:'complete'|'partial';applied:string[];failed:string[];message:string};
export type SyncAdapter={loadPersonal:()=>Promise<PersonalState>;readVersion:()=>Promise<VersionPreferences>;readSpace:()=>Promise<SpaceState>;saveVersion:(next:VersionPreferences,expected:VersionPreferences)=>Promise<string|void>;saveSpace:(next:SpaceState)=>Promise<string|void>;preview:(lists:PersonalPlaylist[])=>Promise<string>;confirm:(token:string)=>Promise<void>;discard:(token:string)=>Promise<void>;addCollection:(kind:'liked'|'favorites',track:Track)=>Promise<PersonalState>};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const failure=(error:unknown)=>redact(error instanceof Error?error.message:'未完成').slice(0,140);
function track(value:unknown):asserts value is Track{if(!object(value)||typeof value.id!=='string'||!value.id||value.id.length>24000||typeof value.title!=='string'||!value.title.trim()||value.title.length>300||typeof value.artist!=='string'||value.artist.length>300||!['custom','online'].includes(String(value.source))||(value.album!==undefined&&(typeof value.album!=='string'||value.album.length>300))||typeof value.providerId!=='string'||value.providerId.length>120||typeof value.remoteId!=='string'||!value.remoteId||value.remoteId.length>20000||typeof value.duration!=='number'||!Number.isFinite(value.duration)||value.duration<0||value.duration>86400)throw Error('同步歌曲资料无效、过长或包含本地文件，尚未写入资料');}
const identity=(row:Track)=>`${row.source||'custom'}\0${row.providerId||''}\0${row.remoteId||row.id}`;
const base=(name:string)=>name.replace(/（导入(?: \d+)?）$/,'').normalize('NFKC').toLowerCase();
const signature=(list:PersonalPlaylist)=>JSON.stringify(list.tracks.map(row=>[identity(row),row.title,row.artist,row.album||'']));
export function containsList(existing:PersonalPlaylist[],list:PersonalPlaylist){return existing.some(row=>(base(row.name)===base(list.name)||base(row.name)===base(list.name.slice(0,85)))&&signature(row)===signature(list));}
export async function syncTransfer(payload:TransferPayload,adapter:SyncAdapter):Promise<SyncResult>{
  const sections=payload.sections||[];if(payload.kind!=='sync'||!sections.length||sections.some(value=>!['playlists','liked','favorites','preferences'].includes(value)))throw Error('同步范围无效，尚未写入资料');
  const incoming=payload.personal||{};let total=0;
  for(const kind of ['liked','favorites'] as const)if(sections.includes(kind)){const rows=incoming[kind];if(!Array.isArray(rows)||rows.length>2000)throw Error('同步收藏数量无效，尚未写入资料');rows.forEach(track);}
  if(sections.includes('playlists')){if(!Array.isArray(incoming.playlists)||incoming.playlists.length>100)throw Error('一次最多同步100个歌单，尚未写入资料');for(const list of incoming.playlists){if(!object(list)||typeof list.name!=='string'||!list.name.trim()||list.name.length>100||!Array.isArray(list.tracks)||(total+=list.tracks.length)>5000)throw Error('同步歌单无效或超过5000首，尚未写入资料');list.tracks.forEach(track);}}
  if(new TextEncoder().encode(JSON.stringify(payload)).length>1024*1024)throw Error('同步内容超过1 MiB，尚未写入资料');
  let version:{current:VersionPreferences;next:VersionPreferences}|undefined,space:SpaceState|undefined;
  if(sections.includes('preferences')){if(!object(payload.preferences))throw Error('同步偏好无效，尚未写入资料');if(payload.preferences.version!==undefined){if(!object(payload.preferences.version))throw Error('版本偏好无效');const current=await adapter.readVersion(),remote=versionPreferences.clean(payload.preferences.version),choices={...remote.choices,...current.choices},excluded={...remote.excluded};if(Object.keys(choices).length>2000)throw Error('合并后的版本选择超过2000条，尚未写入资料');for(const key of Object.keys(current.excluded||{})){excluded[key]=[...new Set([...(excluded[key]||[]),...current.excluded![key]])];if(excluded[key].length>30)throw Error('合并后的单曲排除项超过30条，尚未写入资料');}version={current,next:versionPreferences.clean({...current,choices,excluded})};}
    if(payload.preferences.roaming!==undefined){if(!object(payload.preferences.roaming))throw Error('漫游偏好无效');const current=await adapter.readSpace(),remote=rules.clean({roaming:payload.preferences.roaming}).roaming,keys=new Set(current.roaming.excluded.map(row=>`${row.kind}:${row.key}`)),addition=remote.excluded.filter(row=>!keys.has(`${row.kind}:${row.key}`));if(current.roaming.excluded.length+addition.length>500)throw Error('合并后的漫游排除项超过500条，尚未写入资料');space=rules.clean({...current,roaming:{...current.roaming,excluded:[...current.roaming.excluded,...addition]}});}}
  // All sections, local reads and bounded merge plans are validated before the
  // first persistent change. Runtime failures are reported per section below.
  const initial=await adapter.loadPersonal(),lists=(incoming.playlists||[]).filter(list=>!containsList(initial.playlists,list));let token:string|undefined;
  if(sections.includes('playlists')&&lists.length)token=await adapter.preview(lists);
  const applied:string[]=[],failed:string[]=[];
  const step=async(label:string,work:()=>Promise<string|void>)=>{try{const warning=await work();applied.push(label);if(warning)failed.push(`${label}：${warning}`);}catch(error){failed.push(`${label}：${failure(error)}`);}};
  if(version)await step('版本偏好',()=>adapter.saveVersion(version!.next,version!.current));
  if(space)await step('漫游偏好',()=>adapter.saveSpace(space!));
  if(token){try{await adapter.confirm(token);applied.push(`歌单${lists.length}个`);}catch(error){const current=await adapter.loadPersonal().catch(()=>null);if(current&&lists.every(list=>containsList(current.playlists,list)))applied.push(`歌单${lists.length}个（已核对保存）`);else failed.push(`歌单：${failure(error)}`);await adapter.discard(token).catch(()=>{});}}
  for(const kind of ['liked','favorites'] as const){if(!sections.includes(kind))continue;const label=kind==='liked'?'喜欢':'收藏',rows=incoming[kind]||[];let count=0;for(const row of rows){if(initial[kind].some(saved=>identity(saved)===identity(row)))continue;try{await adapter.addCollection(kind,row);count++;}catch(error){const current=await adapter.loadPersonal().catch(()=>null);if(current&&current[kind].some(saved=>identity(saved)===identity(row)))count++;failed.push(`${label}：${failure(error)}`);break;}}if(count)applied.push(`${label}${count}首`);}
  if(!failed.length)return {status:'complete',applied,failed,message:applied.length?`已完成：${applied.join('、')}。`:'所选资料已经存在，没有重复导入。'};
  const message=`${applied.length?'部分完成':'未完成'}：${applied.length?`${applied.join('、')}已保留；`:''}${failed.join('；')}。可重试，已完成内容不会重复导入。`.slice(0,300);
  if(!applied.length)throw Error(message);return {status:'partial',applied,failed,message};
}
