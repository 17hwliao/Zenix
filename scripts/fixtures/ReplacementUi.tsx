import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import PlatformReplacement from '../../src/ui/PlatformReplacement';
import {replacement} from '../../src/core/platformReplacement';
import type {PersonalState,Track} from '../../src/core/types';
const original:Track={id:'original',title:'你不知道的事',artist:'王力宏',album:'专辑',duration:280,source:'custom',providerId:'lx.playlist:catalog',remoteId:'original',path:'',audioUrl:''};
let state:PersonalState={liked:[],favorites:[],history:[],playlists:[{id:'list-fixture',name:'QQ 导入',tracks:[original]}]};
const fixture:any=(window as any).replacementFixture={calls:[],get state(){return state;},hold:false,cancelled:false,holdReset:false,inspections:0};
function App(){const [personal,update]=useState(state),[visible,setVisible]=useState(true);
 const apply=async(args:Record<string,any>,signal?:AbortSignal)=>{fixture.calls.push(args);if(fixture.holdReset&&args.edit==='replacement'&&args.state===null)await new Promise<void>(resolve=>fixture.releaseReset=resolve);signal?.throwIfAborted();const next=structuredClone(state),list=next.playlists[0];if(args.edit==='replacementPolicy')list.autoReplacement=args.enabled;if(args.edit==='replacementClear')list.tracks.forEach(song=>delete song.replacement);if(args.edit==='replacement'){if(args.state)list.tracks[0].replacement=args.state;else delete list.tracks[0].replacement;}state=next;update(next);return next;};
 const inspect=async(song:Track,signal:AbortSignal,candidate?:Track)=>{
   fixture.inspections++;
   if(fixture.hold)await new Promise<void>((resolve,reject)=>{fixture.complete=resolve;signal.addEventListener('abort',()=>{fixture.cancelled=true;reject(signal.reason);},{once:true});});
   const result=await replacement.run(song,song.replacement,{search:async()=>[{...original,id:'substitute',providerId:'source.wy',remoteId:'wy',album:'其他专辑'}],resolve:async()=>({audioUrl:'fixture'}),check:async()=>{},save:async record=>{await apply({edit:'replacement',state:record});}},signal,()=>{},candidate);
   return state;
 };
 return <main style={{maxWidth:900,margin:'auto',padding:12,boxSizing:'border-box'}}><button onClick={()=>setVisible(false)}>离开歌单</button>{visible&&<PlatformReplacement list={personal.playlists[0]} apply={apply} inspect={inspect} reload={async()=>state} changed={update}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
