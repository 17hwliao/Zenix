import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {Track} from '../../core/types';
import {activitySnapshot,observeActivities,cancelActivity,retryActivity,finishActivity,confirmActivityImport,discardActivityImport} from './activities';

type Invoke=<T>(args:Record<string,unknown>)=>Promise<T>;
type ImportResult={playlists:{name:string;tracks:Track[];autoReplacement?:boolean}[]};
export default function ActivitiesPanel({invoke}:{invoke:Invoke}){
 const rows=useSyncExternalStore(observeActivities,activitySnapshot),[message,setMessage]=useState(''),[busy,setBusy]=useState('');
 const lock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const labels={running:'执行中',cancelling:'正在取消',cancelled:'已取消',complete:'已完成',failed:'未完成'};
 async function confirm(id:string){
  if(lock.current)return;
  lock.current=true;setBusy(id);
  try{
   await confirmActivityImport(id,invoke);
   if(mounted.current)setMessage('已创建独立歌单，原资料保留');
  }catch(error){if(mounted.current)setMessage(String(error));}
  finally{lock.current=false;if(mounted.current)setBusy('');}
 }
 return <section><h3>导入与批量处理</h3><p>明确选择后台执行后，离开页面仍继续；关闭应用会结束尚未完成的界面任务，已经写入的资料保留。</p>
  {!rows.length&&<p>暂无后台导入或批量任务。</p>}
  {rows.map(row=>{
   const result=(row.state==='complete'?row.result:undefined) as ImportResult|undefined;
   return <article key={row.id}><strong>{row.name}</strong><p>{labels[row.state]}{row.total?` · ${row.done}/${row.total}`:''} · {row.message}</p>
    {row.state==='running'&&<button onClick={()=>cancelActivity(row.id)}>取消</button>}
    {['failed','cancelled'].includes(row.state)&&<button onClick={()=>retryActivity(row.id)}>继续未完成项</button>}
    {result?.playlists&&<div aria-label="后台歌单解析预览"><p>请核对歌名与歌手。确认后创建独立歌单；原有资料保留。</p>
     {result.playlists.map((list,index)=><details key={index} open={result.playlists.length===1}><summary>{list.name} · {list.tracks.length} 首</summary><ol>{list.tracks.slice(0,30).map((track,number)=><li key={number}>{track.title} · {track.artist||'未指定歌手'}</li>)}</ol>{list.tracks.length>30&&<p>预览前 30 首，确认后导入全部 {list.tracks.length} 首。</p>}<p>{list.autoReplacement?'播放时自动匹配可播放版本（最多三个候选）':'播放使用原有歌曲信息'}</p></details>)}
     <button disabled={Boolean(busy)||rows.some(item=>item.importBusy)} onClick={()=>void confirm(row.id)}>{row.importToken?'重试确认导入':'确认导入解析结果'}</button>
     {row.importToken&&<button disabled={Boolean(busy)||row.importBusy} onClick={()=>{void discardActivityImport(row.id,invoke).then(()=>{if(mounted.current)setMessage('已放弃导入预览，原资料保留');}).catch(error=>{if(mounted.current)setMessage(String(error));});}}>放弃导入预览</button>}
    </div>}
    {!['running','cancelling'].includes(row.state)&&<button disabled={busy===row.id||row.importBusy||Boolean(row.importToken)} onClick={()=>finishActivity(row.id)}>移除任务记录</button>}
   </article>;
  })}
  {message&&<p role="status">{message}<button onClick={()=>setMessage('')}>关闭提示</button></p>}
 </section>;
}
