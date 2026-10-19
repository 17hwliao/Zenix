import {useEffect,useRef,useState} from 'react';
import type {PersonalPlaylist,PersonalState,Track} from '../core/types';
import {replacement} from '../core/platformReplacement';
import {desktopReplacementAdapter} from '../core/desktopReplacement';
import {resolveOriginalTrack} from '../core/sourcePlayback';
import './PlatformReplacement.css';
type Props={list:PersonalPlaylist;apply:(args:Record<string,unknown>,signal?:AbortSignal)=>Promise<PersonalState>;inspect?:(song:Track,signal:AbortSignal,candidate?:Track)=>Promise<PersonalState>;reload?:()=>Promise<PersonalState>;changed?:(state:PersonalState)=>void;policyChanged?:(enabled:boolean)=>void|Promise<void>;autoOnly?:boolean};
function platformLabel(song:Track){try{const info=JSON.parse(atob(song.remoteId!.replace(/-/g,'+').replace(/_/g,'/')));return ({tx:'QQ 音乐',wy:'网易云音乐',kw:'酷我音乐',kg:'酷狗音乐',mg:'咪咕音乐'} as Record<string,string>)[info.source]||'自定义音源';}catch{return '自定义音源';}}
export async function inspectDesktop(list:PersonalPlaylist,song:Track,signal:AbortSignal,candidate?:Track){
  const adapter=desktopReplacementAdapter(list,song);
  if(!song.replacement&&!candidate){try{const resolved=await resolveOriginalTrack(song,[],()=>{},signal);await adapter.check(resolved,signal);signal.throwIfAborted();await adapter.save({status:'original',attempts:0,tried:[],candidates:[],message:'原曲音频响应正常，待实际播放验证'},signal);return window.yzqxy!.personal.load();}catch{signal.throwIfAborted();}}
  await replacement.run(song,song.replacement,adapter,signal,()=>{},candidate);
  return window.yzqxy!.personal.load();
}
export default function PlatformReplacement({list,apply,inspect,reload,changed,policyChanged,autoOnly=false}:Props){
  const [selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[limit,setLimit]=useState(30),[versions,setVersions]=useState('');
  const control=useRef<AbortController|undefined>(undefined),stop=useRef(false),skip=useRef(false),mounted=useRef(true),latest=useRef(list);latest.current=list;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stop.current=true;control.current?.abort();};},[list.id]);
  const mutate=async(args:Record<string,unknown>,signal?:AbortSignal)=>{const value=await apply({id:list.id,expected:latest.current.tracks.map(song=>song.id),...args},signal);const next=value.playlists.find(item=>item.id===list.id);if(next)latest.current=next;if(mounted.current)changed?.(value);return value;};
  async function run(ids:string[],reset=false,candidate?:Track){
    if(busy)return;setBusy(true);stop.current=false;
    const resetDone=new Set<string>();let manual=candidate,outcome='本轮处理结束，请查看每首歌的匹配状态';
    try{for(let index=0;index<ids.length&&!stop.current;index++){
      let song=latest.current.tracks.find(song=>song.id===ids[index]);if(!song||song.source!=='custom')continue;
      skip.current=false;control.current=new AbortController();
      if(reset&&!resetDone.has(song.id)){await mutate({edit:'replacement',trackId:song.id,expectedReplacement:JSON.stringify(song.replacement||null),state:null},control.current.signal);resetDone.add(song.id);song={...song,replacement:undefined};}
      if(stop.current||!mounted.current)break;
      if(control.current.signal.aborted)continue;
      const current=song;setMessage(`正在处理 ${index+1}/${ids.length} · ${song.title}，等待当前阶段返回`);
      try{const value=await(inspect?inspect(current,control.current.signal,manual):inspectDesktop(latest.current,current,control.current.signal,manual));const next=value.playlists.find(item=>item.id===list.id);if(next)latest.current=next;if(mounted.current)changed?.(value);}
      catch(error){
        if(control.current.signal.aborted&&skip.current&&!stop.current&&mounted.current){
          const value=await(reload?reload():window.yzqxy!.personal.load()),next=value.playlists.find(item=>item.id===list.id);if(!next||stop.current||!mounted.current)break;latest.current=next;changed?.(value);
          const previous=next.tracks.find(item=>item.id===current.id)?.replacement;
          await mutate({edit:'replacement',trackId:current.id,expectedReplacement:JSON.stringify(previous||null),state:{...(previous||{attempts:0,tried:[],candidates:[]}),status:'failed',target:undefined,message:'用户已跳过当前候选'}});manual=undefined;index--;continue;
        }
        if(!control.current.signal.aborted&&mounted.current){outcome=error instanceof Error?error.message:'匹配失败';setMessage(outcome);}
      }
    }}catch(error){outcome=error instanceof Error?error.message:'任务未完成，请重试';}finally{control.current=undefined;if(mounted.current){setBusy(false);setMessage(stop.current?'已取消，已完成结果和已用次数保留':outcome);}}
  }
  const labels={pending:'待播放验证',verified:'播放验证通过',failed:'未找到可用替代',needsChoice:'需要选择版本',original:'原曲响应正常'};
  return <details open className="platform-replacement" aria-label="歌单平台平替"><summary>歌单自动平替 <small>原曲保留 · 每首最多尝试前三个搜索结果</small></summary>
    <label className="replacement-policy"><input type="checkbox" checked={list.autoReplacement===true} disabled={busy} onChange={event=>{const enabled=event.target.checked;void mutate({edit:'replacementPolicy',enabled}).then(()=>policyChanged?.(enabled)).catch(error=>setMessage(String(error)));}}/><span>播放此歌单时自动平替<small>按歌名搜索，依次尝试前三个结果，成功即播放；三个都失败则继续下一首。不需要逐首勾选或扫描。</small></span></label>
    <p role="status">{message||'仅在播放本歌单时生效；歌曲结束后继续队列。解析和缓冲按状态等待，可通过暂停或切歌取消。'}</p>
    {!autoOnly&&<details className="replacement-manual"><summary>高级：手动检查与恢复原曲</summary>
    <div className="replacement-buttons"><button disabled={busy||!list.tracks.some(song=>song.source==='custom')} onClick={()=>void run(list.tracks.filter(song=>song.source==='custom'&&!song.replacement?.target&&song.replacement?.status!=='original').map(song=>song.id))}>扫描／继续当前歌单</button><button disabled={busy||!selected.length} onClick={()=>void run(selected)}>处理选中 {selected.length||''}</button><button disabled={busy||!list.tracks.some(song=>song.replacement)} onClick={()=>void mutate({edit:'replacementClear'}).catch(error=>setMessage(String(error)))}>全部恢复原曲</button>{busy&&<><button onClick={()=>{skip.current=true;control.current?.abort();}}>跳过当前候选</button><button onClick={()=>{stop.current=true;control.current?.abort();}}>取消任务</button></>}</div>
    <p>手动检查不会播放声音或打断当前歌曲；自动平替无需执行这里的操作。</p>
    <div className="replacement-rows">{list.tracks.slice(0,limit).map(song=><div className="replacement-row" key={song.id}>
      <label><input type="checkbox" disabled={busy||song.source!=='custom'} checked={selected.includes(song.id)} onChange={event=>setSelected(event.target.checked?[...selected,song.id]:selected.filter(id=>id!==song.id))}/><span><strong>{song.title}</strong><small>{song.artist}</small><em>{song.replacement?`${labels[song.replacement.status]} · ${song.replacement.attempts}/3`:'尚未检查'}</em></span></label>
      {song.replacement?.target&&<p>原曲：{song.title} · {song.artist}<br/>替代：{song.replacement.target.title} · {song.replacement.target.artist}<br/>{platformLabel(song.replacement.target)} · {song.replacement.target.album||'专辑信息未知'} · {song.replacement.target.duration}秒</p>}
      {song.source==='custom'&&<div className="replacement-buttons"><button disabled={busy} onClick={()=>void run([song.id],true)}>重新匹配</button>{song.replacement&&<button disabled={busy} onClick={()=>void mutate({edit:'replacement',trackId:song.id,expectedReplacement:JSON.stringify(song.replacement),state:null}).catch(error=>setMessage(String(error)))}>恢复原曲</button>}{!!song.replacement?.candidates.length&&<button onClick={()=>setVersions(versions===song.id?'':song.id)}>查看／选择版本</button>}</div>}
      {versions===song.id&&song.replacement?.candidates.map(candidate=><div className="replacement-candidate" key={replacement.candidateKey(candidate)}><span>{candidate.title} · {candidate.artist}<small>{platformLabel(candidate)} · {candidate.album||'专辑未知'} · {candidate.duration}秒</small></span><button disabled={busy||song.replacement!.attempts>=3} onClick={()=>void run([song.id],false,candidate)}>确认尝试此版本</button></div>)}
    </div>)}</div>{limit<list.tracks.length&&<button onClick={()=>setLimit(value=>value+30)}>继续显示 · 共 {list.tracks.length} 首</button>}
    </details>}
  </details>;
}
