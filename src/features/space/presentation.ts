import {useCallback,useEffect,useRef,useState} from 'react';
import type {SpacePresentationSettings} from './presentationTypes';

export const presentationKey='zenix.space.presentation.v1';
const eventName='zenix-space-presentation';
export const defaultPresentation:SpacePresentationSettings={mode:'sticker',cardScale:1};
export function normalizePresentation(raw:unknown):SpacePresentationSettings {
  if(!raw||typeof raw!=='object')throw Error('invalid presentation');
  const value=raw as Partial<SpacePresentationSettings>;
  if(!['sticker','orbit','list'].includes(String(value.mode))||typeof value.cardScale!=='number'||!Number.isFinite(value.cardScale))throw Error('invalid presentation');
  return {mode:value.mode!,cardScale:Math.min(1.25,Math.max(.65,value.cardScale))};
}
export function readPresentation():{value:SpacePresentationSettings;error:string} {
  try {
    const raw=localStorage.getItem(presentationKey);
    return {value:raw===null?{...defaultPresentation}:normalizePresentation(JSON.parse(raw)),error:''};
  } catch {
    return {value:{...defaultPresentation},error:'无法读取音乐空间展示偏好，暂用默认贴纸。原歌单和其他设置未改动。'};
  }
}
/** Local display preference only. Commit storage first; a failed write never changes the displayed selection. */
export function useSpacePresentation(){
  const [snapshot,setSnapshot]=useState(readPresentation);
  const current=useRef(snapshot.value);
  const update=useCallback((next:ReturnType<typeof readPresentation>)=>{current.current=next.value;setSnapshot(next);},[]);
  useEffect(()=>{
    const sync=(event:Event)=>{
      if(event.type==='storage'&&(event as StorageEvent).key!==presentationKey&&(event as StorageEvent).key!==null)return;
      update(readPresentation());
    };
    window.addEventListener(eventName,sync);window.addEventListener('storage',sync);
    // Catch writes made by another mounted view between the initial read and subscription.
    update(readPresentation());
    return()=>{window.removeEventListener(eventName,sync);window.removeEventListener('storage',sync);};
  },[update]);
  const change=useCallback((patch:Partial<SpacePresentationSettings>)=>{
    try {
      const next=normalizePresentation({...current.current,...patch});
      localStorage.setItem(presentationKey,JSON.stringify(next));
      update({value:next,error:''});
      window.dispatchEvent(new Event(eventName));
    }catch{
      setSnapshot(previous=>({...previous,error:'展示偏好保存失败，已保留上次选择。请检查存储空间后重试。'}));
    }
  },[update]);
  const dismissError=useCallback(()=>setSnapshot(previous=>({...previous,error:''})),[]);
  return {...snapshot.value,change,error:snapshot.error,dismissError};
}
