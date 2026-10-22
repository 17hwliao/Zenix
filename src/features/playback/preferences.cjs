/* Version preferences contain catalogue references, never temporary audio URLs. */
const KEY='zenix.playback-preferences.v1';
const modes=['any','original','live','acoustic'];
const norm=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu,'');
const songKey=track=>`${norm(track?.title)}\n${norm(track?.artist)}`;
const versionKey=track=>`${track?.providerId||''}\n${track?.remoteId||track?.id||''}`;
function clean(value){
  const choices={},excluded={};
  for(const [key,row] of Object.entries(value?.choices||{}).slice(0,2000))if(key.length<=800&&row&&typeof row==='object'&&typeof row.providerId==='string'&&typeof row.remoteId==='string'&&row.providerId.length<=240&&row.remoteId.length<=32768)choices[key]={providerId:row.providerId,remoteId:row.remoteId};
  for(const [key,rows] of Object.entries(value?.excluded||{}).slice(0,2000))if(key.length<=800&&Array.isArray(rows)){const valid=[...new Set(rows.filter(row=>typeof row==='string'&&row.length<=34000))].slice(0,30);if(valid.length)excluded[key]=valid;}
  return {mode:modes.includes(value?.mode)?value.mode:'any',choices,...(Object.keys(excluded).length?{excluded}:{})};
}
function read(storage=globalThis.localStorage){try{return clean(JSON.parse(storage?.getItem(KEY)||'null'));}catch{return clean(null);}}
function write(value,storage=globalThis.localStorage){const next=clean(value);if(!storage)throw Error('当前环境无法保存版本偏好');storage.setItem(KEY,JSON.stringify(next));return next;}
function score(track,prefs,original){
  const remembered=prefs.choices[songKey(original)];
  if(remembered&&versionKey(remembered)===versionKey(track))return 10000;
  const text=String(track.title||'').toLowerCase(),live=/live|现场/.test(text),cover=/cover|翻唱|伴奏|instrumental|remix|加速|sped|slowed/.test(text),acoustic=/acoustic|不插电/.test(text);
  return (norm(original.artist)===norm(track.artist)?100:0)+(prefs.mode==='original'&&!live&&!cover?30:prefs.mode==='live'&&live?30:prefs.mode==='acoustic'&&acoustic?30:0);
}
function order(rows,original,prefs){prefs=clean(prefs);rows=rows.filter(row=>!prefs.excluded?.[songKey(original)]?.includes(versionKey(row)));if(prefs.mode==='any'&&!prefs.choices[songKey(original)])return [...rows];return rows.map((row,index)=>({row,index,score:score(row,prefs,original)})).sort((a,b)=>b.score-a.score||a.index-b.index).map(item=>item.row);}
const api={KEY,modes,songKey,versionKey,clean,read,write,order};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else globalThis.zenixPlaybackPreferences=api;
