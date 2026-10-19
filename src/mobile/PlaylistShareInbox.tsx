import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import MusicTools, { type ToolInvoke } from '../ui/MusicTools';
import { command, isAndroid } from './native';
const invoke: ToolInvoke = args => command('features', args);
type Shared = { text: string; token: string };
export default function PlaylistShareInbox() {
  const [pending,setPending]=useState<Shared>(),[opened,setOpened]=useState<Shared>();
  const consumed=useRef(new Set<string>());
  useEffect(()=>{
    if(!isAndroid)return;
    let alive=true;
    const read=()=>{void invoke<Shared>({operation:'playlistSharePeek'}).then(value=>{if(alive&&value?.text&&value.token&&!consumed.current.has(value.token))setPending(value);}).catch(()=>{});};
    read();window.addEventListener('zenix-playlist-share',read);window.addEventListener('focus',read);
    return()=>{alive=false;window.removeEventListener('zenix-playlist-share',read);window.removeEventListener('focus',read);};
  },[]);
  async function consume(open:boolean){if(!pending)return;const value=pending;consumed.current.add(value.token);if(consumed.current.size>32)consumed.current.delete(consumed.current.values().next().value!);if(open)setOpened(value);setPending(undefined);await invoke({operation:'playlistShareConsume',token:value.token}).catch(()=>{});}
  return <>{pending&&<div className="mobile-share-inbox" role="status"><span>收到音乐分享，可预览导入歌单</span><button onClick={()=>void consume(true)}>查看</button><button aria-label="忽略此次歌单分享" onClick={()=>void consume(false)}>忽略</button></div>}{opened&&createPortal(<MusicTools key={opened.token} invoke={invoke} platform="Android" initialImport={opened.text} close={()=>setOpened(undefined)}/>,document.body)}</>;
}
