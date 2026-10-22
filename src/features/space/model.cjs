'use strict';
const normal=value=>String(value||'').toLowerCase().replace(/[\s\p{P}]/gu,'');
const songKey=track=>normal(track?.title)+'|'+normal(track?.artist);
const versionKey=track=>String(track?.providerId||'')+':'+String(track?.remoteId||track?.id||'');
function identifier(value,limit){const text=String(value||'');if(text.length>limit)throw Error('歌曲引用过长，请减少空间内容');return text;}
function reference(track){return {id:identifier(track?.id,24000),title:String(track?.title||'').slice(0,500),artist:String(track?.artist||'').slice(0,500),album:String(track?.album||'').slice(0,500),source:['custom','local','online'].includes(track?.source)?track.source:'custom',providerId:String(track?.providerId||'').slice(0,300),remoteId:identifier(track?.remoteId,20000),duration:Number.isFinite(track?.duration)?Math.max(0,track.duration):0,path:'',audioUrl:''};}
function clean(raw={}){
 if(JSON.stringify(raw).length>2*1024*1024)throw Error('空间资料超过2 MiB，请减少书签内容');
 const p=raw.roaming||{},array=(v,n)=>Array.isArray(v)?v.slice(0,n):[];
 const camera=v=>({x:Math.max(-1e6,Math.min(1e6,Number(v?.x)||0)),y:Math.max(-1e6,Math.min(1e6,Number(v?.y)||0)),scale:Math.max(.4,Math.min(2.5,Number(v?.scale)||1))});
 return {schema:1,revision:Math.max(0,Math.floor(Number(raw.revision)||0)),motion:['full','light','reduced'].includes(raw.motion)?raw.motion:'full',bookmarks:array(raw.bookmarks,30).map(v=>({id:String(v.id||'').slice(0,100),name:String(v.name||'空间书签').slice(0,100),selectedId:identifier(v.selectedId,24000),camera:camera(v.camera),tracks:array(v.tracks,500).map(reference)})),zones:array(raw.zones,20).map(v=>({id:String(v.id||'').slice(0,100),name:String(v.name||'分区').slice(0,100),trackIds:[...new Set(array(v.trackIds,1000).map(String))]})),roaming:{scope:['all','saved','playlist'].includes(p.scope)?p.scope:'all',playlistId:String(p.playlistId||''),discovery:Math.max(0,Math.min(1,Number.isFinite(p.discovery)?p.discovery:.5)),artistGap:Math.max(0,Math.min(5,Math.floor(Number(p.artistGap)||0))),excluded:array(p.excluded,500).filter(v=>['song','version','artist'].includes(v.kind)&&typeof v.key==='string').map(v=>({id:String(v.id||''),kind:v.kind,effect:v.effect==='reduce'?'reduce':'exclude',key:identifier(v.key,24000),label:String(v.label||'').slice(0,500)}))}};
}
function allows(track,p,personal={}){
 const artists=String(track?.artist||'').split(/\s*[/、&＋+]\s*/).map(normal);
 if(p.excluded.some(v=>v.effect!=='reduce'&&(v.kind==='song'&&v.key===songKey(track)||v.kind==='version'&&v.key===versionKey(track)||v.kind==='artist'&&artists.includes(v.key))))return false;
 if(p.scope==='all')return true;
 const lists=p.scope==='playlist'?(personal.playlists||[]).filter(l=>l.id===p.playlistId).flatMap(l=>l.tracks||[]):[...(personal.liked||[]),...(personal.favorites||[]),...(personal.playlists||[]).flatMap(l=>l.tracks||[])];
 return lists.some(v=>songKey(v)===songKey(track));
}
function order(tracks,p,personal={},recent=[]){const known=new Set([...(personal.liked||[]),...(personal.favorites||[]),...(personal.history||[]).map(v=>v.track)].map(t=>normal(t?.artist)));return tracks.filter(track=>allows(track,p,personal)).map((track,index)=>({track,score:tracks.length-index+(known.has(normal(track.artist))?1-p.discovery:p.discovery)*8-(recent.slice(0,p.artistGap).includes(normal(track.artist))?100:0)-p.excluded.filter(v=>v.effect==='reduce'&&(v.kind==='song'&&v.key===songKey(track)||v.kind==='version'&&v.key===versionKey(track)||v.kind==='artist'&&String(track.artist||'').split(/\s*[/、&＋+]\s*/).map(normal).includes(v.key))).length*50})).sort((a,b)=>b.score-a.score).map(v=>v.track);}
const api={normal,songKey,versionKey,reference,clean,allows,order};if(typeof module!=='undefined'&&module.exports)module.exports=api;else globalThis.zenixSpaceRules=api;
