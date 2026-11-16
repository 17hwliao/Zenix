import {useCallback,useEffect,useRef,useState} from 'react';
import type {SpacePresentationSettings} from './presentationTypes';
import {
  defaultPresentation,
  legacyPresentationKey,
  normalizePresentation,
  presentationKey,
  readDisplayPreference,
  writeDisplayPreference,
  type DisplayPreferenceSnapshot,
} from './displayPreference';

export {defaultPresentation,legacyPresentationKey,normalizePresentation,presentationKey};
const eventName='zenix-space-presentation';
export function readPresentation():DisplayPreferenceSnapshot {
  return readDisplayPreference(localStorage);
}
/** Local display preference only. Commit storage first; a failed write never changes the displayed selection. */
export function useSpacePresentation(){
  const [snapshot,setSnapshot]=useState(readPresentation);
  const current=useRef(snapshot.value);
  const update=useCallback((next:ReturnType<typeof readPresentation>)=>{current.current=next.value;setSnapshot(next);},[]);
  useEffect(()=>{
    const sync=(event:Event)=>{
      if(event.type==='storage'&&(event as StorageEvent).key!==presentationKey&&(event as StorageEvent).key!==legacyPresentationKey&&(event as StorageEvent).key!==null)return;
      update(readPresentation());
    };
    window.addEventListener(eventName,sync);window.addEventListener('storage',sync);
    // Catch writes made by another mounted view between the initial read and subscription.
    const next=readPresentation();
    update(next);
    if(next.status==='migrated')window.dispatchEvent(new Event(eventName));
    return()=>{window.removeEventListener(eventName,sync);window.removeEventListener('storage',sync);};
  },[update]);
  const change=useCallback((patch:Partial<SpacePresentationSettings>)=>{
    try {
      const next=writeDisplayPreference(patch,current.current,localStorage);
      update(next);
      window.dispatchEvent(new Event(eventName));
      return true;
    }catch{
      setSnapshot(previous=>({...previous,error:'展示偏好保存失败，已保留上次选择。请检查存储空间后重试。'}));
      return false;
    }
  },[update]);
  const dismissError=useCallback(()=>setSnapshot(previous=>({...previous,error:''})),[]);
  return {...snapshot.value,...snapshot,value:snapshot.value,change,dismissError};
}
