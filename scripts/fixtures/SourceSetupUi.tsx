import {createRoot} from 'react-dom/client';
import SourceSettings from '../../src/ui/SourceSettings';
import {useMusicSearch} from '../../src/ui/useMusicSearch';
import type {InstalledSource} from '../../src/core/types';
let rows: InstalledSource[] = [];
let values = {lxCatalog:'wy',__allowHttp:'false',__allowedHosts:'audio.example.test',credential:'retained'};
const field = {key:'lxCatalog',label:'搜索平台',type:'select' as const,options:['tx','wy','kg'],default:'tx'};
const source:InstalledSource={id:'lx.fixture',kind:'lx',catalog:'wy',enabled:true,manifest:{id:'lx.fixture',name:'Fixture',version:'1',schemaVersion:1,entry:'index.js',capabilities:['search','resolvePlayback'],qualities:['high'],network:{apiHosts:[],mediaHosts:[],artworkHosts:[]},settings:[field],lxPlatforms:{tx:{name:'QQ',qualitys:['320k']},wy:{name:'网易',qualitys:['320k']},kg:{name:'酷狗',qualitys:['320k']}}},origin:{kind:'url',label:'https://raw.githubusercontent.com/cdyUuu/lx-music-xinghai-source/main/xinghai-music-source.js'},sha256:'a'.repeat(64),installedAt:1,status:'idle',lastError:'',networkPolicy:{allowHttp:false,hosts:['audio.example.test']}};
let change:(sources:InstalledSource[])=>void=()=>{};
const fixture:any=(window as any).sourceFixture={writes:[],searches:[],confirms:[],setRows(){rows=[structuredClone(source)];change(rows);},get values(){return values;}};
window.addEventListener('zenix-source-search',(event)=>fixture.searches.push((event as CustomEvent).detail));
(window as any).yzqxy={cache:{stats:async()=>null},sources:{
  list:async()=>rows,onChanged:(callback:any)=>{change=callback;return()=>{};},
  getSettings:async()=>({...values}),configure:async(_id:string,next:typeof values)=>{fixture.writes.push(next);values=next;rows=rows.map(row=>({...row,catalog:next.lxCatalog}));change(rows);},
  importUrl:async()=>({token:'preview',kind:'lx',manifest:source.manifest,origin:source.origin,sha256:'a'.repeat(64),previousVersion:'1'}),
  cancelImport:async()=>{},confirmImport:async(_token:string,policy:any)=>{fixture.confirms.push(policy);return rows;},
  diagnostics:async()=>({smooth:false,sources:{}}),configureDiagnostics:async()=>({smooth:false,sources:{}}),
  cancelRequest:async()=>{},search:async()=>{fixture.searchCalls=(fixture.searchCalls||0)+1;if(fixture.searchCalls===1)throw Error('网易云搜索失败（405）：操作频繁');return {items:[],nextCursor:null};}
}};
function SearchHarness(){const result=useMusicSearch('银河',true,[]);return <div><button id="retry-search" onClick={result.submit}>重新搜索</button><output id="search-state">{result.loading?'loading':result.searchError||'empty'}</output></div>;}
const root=createRoot(document.getElementById('root')!);root.render(<main style={{maxWidth:800,margin:'auto',padding:12,boxSizing:'border-box'}}><SourceSettings/></main>);
fixture.showSearch=()=>root.render(<SearchHarness/>);
