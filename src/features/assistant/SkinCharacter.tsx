import {useEffect,useState} from 'react';
import {unzipSync,strFromU8} from 'fflate';
import {clean,type Skin} from './skin';
import DefaultCharacter from './DefaultCharacter';
import {useSpaceSettings} from '../space/state';
type Invoke=<T=unknown>(args:Record<string,unknown>)=>Promise<T>;
/** Saved appearance is read independently of player/voice state. Failure falls back locally. */
export default function SkinCharacter({state,invoke}:{state:string;invoke:Invoke}){
 const motion=useSpaceSettings().motion;
 const [skin,setSkin]=useState<{config:Skin;urls:string[]}>(),[frame,setFrame]=useState(0),[visible,setVisible]=useState(!document.hidden);
 useEffect(()=>{let alive=true,revision=0,urls:string[]=[];
  const load=async()=>{const token=++revision;try{const result=await invoke<{skin?:{archive?:string}}>({operation:'assistant',action:'state'});if(!alive||token!==revision)return;const archive=result.skin?.archive;if(!archive){urls.forEach(URL.revokeObjectURL);urls=[];setSkin(undefined);return;}if(archive.length>12*1024*1024)throw Error('皮肤过大');const bytes=Uint8Array.from(atob(archive),value=>value.charCodeAt(0));let total=0;const files=unzipSync(bytes,{filter:entry=>{total+=entry.originalSize;if(total>17*1024*1024||entry.originalSize>2*1024*1024)throw Error('皮肤资源过大');return true;}});const config=clean(JSON.parse(strFromU8(files['skin.json'])),files),next=config.frames.map(name=>URL.createObjectURL(new Blob([files[name].slice().buffer as ArrayBuffer],{type:'image/png'})));urls.forEach(URL.revokeObjectURL);urls=next;setFrame(0);setSkin({config,urls:next});}catch{if(alive&&token===revision){urls.forEach(URL.revokeObjectURL);urls=[];setSkin(undefined);}}};
  void load();window.addEventListener('zenix-assistant-skin-changed',load);const visibility=()=>setVisible(!document.hidden);document.addEventListener('visibilitychange',visibility);return()=>{alive=false;revision++;urls.forEach(URL.revokeObjectURL);window.removeEventListener('zenix-assistant-skin-changed',load);document.removeEventListener('visibilitychange',visibility);};
 },[invoke]);
 useEffect(()=>{if(!skin)return;const animation=skin.config.animations[state]||skin.config.animations.idle;setFrame(animation.frames[0]);if(!visible||motion==='reduced'||matchMedia('(prefers-reduced-motion:reduce)').matches||animation.frames.length===1)return;let index=0;const timer=setInterval(()=>{index=animation.loop?(index+1)%animation.frames.length:Math.min(index+1,animation.frames.length-1);setFrame(animation.frames[index]);},1000/animation.fps);return()=>clearInterval(timer);},[skin,state,visible,motion]);
 return skin?<span className="pet-body pet-portrait" data-skin={skin.config.name}><img src={skin.urls[frame]||skin.urls[0]} alt={skin.config.name} draggable={false} onError={()=>setSkin(undefined)}/><small className="pet-brand">Zenix</small></span>:<DefaultCharacter state={state}/>;
}
