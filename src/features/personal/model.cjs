const LIMITS = Object.freeze({bookmarks: 5000, lyrics: 1000, lyricChars: 120000, journal: 50, bytes: 12 * 1024 * 1024});
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
function text(value, max, label) { if (typeof value !== 'string' || value.length > max) throw Error(`${label}无效或过长`); return value; }
function trackRef(track) {
  if (!object(track)) throw Error('歌曲信息无效');
  return {id:text(track.id,24000,'歌曲标识'),title:text(track.title,300,'歌名'),artist:text(track.artist || '',300,'歌手'),album:text(track.album || '',300,'专辑'),source:['local','online','custom'].includes(track.source)?track.source:'local',providerId:text(track.providerId || '',120,'来源'),remoteId:text(track.remoteId || '',20000,'远程标识'),duration:Number.isFinite(track.duration)&&track.duration>=0?Math.min(track.duration,86400):0};
}
function key(track) { const row=trackRef(track); return `${row.source}\0${row.providerId}\0${row.remoteId || row.id}`; }
function empty() { return {schema:1,revision:0,bookmarks:[],lyrics:[],journal:[]}; }
function clean(raw) {
  if (!object(raw) || raw.schema!==1 || !Number.isSafeInteger(raw.revision) || raw.revision<0) throw Error('私人资料格式不受支持，原资料已保留');
  for (const [kind,max] of [['bookmarks',LIMITS.bookmarks],['lyrics',LIMITS.lyrics],['journal',LIMITS.journal]]) if(!Array.isArray(raw[kind]) || raw[kind].length>max)throw Error('私人资料数量超过限制');
  const bookmarks=raw.bookmarks.map(row=>{
    if(!object(row)||!Number.isFinite(row.seconds)||row.seconds<0||row.seconds>86400||!Number.isFinite(row.createdAt))throw Error('书签格式无效');
    return {id:text(row.id,100,'书签标识'),track:trackRef(row.track),seconds:row.seconds,note:text(row.note||'',2000,'备注'),lyric:text(row.lyric||'',2000,'歌词片段'),createdAt:row.createdAt};
  });
  const lyrics=raw.lyrics.map(row=>({track:trackRef(row.track),text:text(row.text,LIMITS.lyricChars,'歌词'),updatedAt:Number.isFinite(row.updatedAt)?row.updatedAt:0}));
  const journal=raw.journal.map(row=>{
    if(!object(row)||!Array.isArray(row.changes)||row.changes.length>1000)throw Error('歌单修改记录无效');
    return {id:text(row.id,100,'修改标识'),label:text(row.label,200,'操作名称'),createdAt:Number.isFinite(row.createdAt)?row.createdAt:0,undone:row.undone===true,changes:row.changes.map(change=>{
      if(!object(change))throw Error('修改记录无效');
      for(const side of ['before','after']) if(change[side]!==null && (!object(change[side]) || !Array.isArray(change[side].tracks)||change[side].tracks.length>10000||typeof change[side].name!=='string'))throw Error('歌单快照无效');
      return {id:text(change.id,100,'歌单标识'),before:change.before===null?null:clone(change.before),after:change.after===null?null:clone(change.after)};
    })};
  });
  if(new Set(bookmarks.map(row=>row.id)).size!==bookmarks.length)throw Error('书签标识重复');
  const result={schema:1,revision:raw.revision,bookmarks,lyrics,journal};
  if(new TextEncoder().encode(JSON.stringify(result)).length>LIMITS.bytes)throw Error('私人资料超过12 MiB，请先清理部分歌词或修改记录');
  return result;
}
function addBookmark(state, args, uuid, now) {
  const next=clone(state);next.bookmarks.unshift({id:uuid(),track:trackRef(args.track),seconds:args.seconds,note:args.note||'',lyric:args.lyric||'',createdAt:now});next.revision++;return clean(next);
}
function saveLyrics(state,track,value,now) {const next=clone(state),reference=trackRef(track),selected=key(reference);next.lyrics=next.lyrics.filter(row=>key(row.track)!==selected);next.lyrics.unshift({track:reference,text:value,updatedAt:now});if(next.lyrics.length>LIMITS.lyrics)next.lyrics.length=LIMITS.lyrics;next.revision++;return clean(next);}
function playlistChanges(before,after) {const old=new Map((before.playlists||[]).map(row=>[row.id,row])),next=new Map((after.playlists||[]).map(row=>[row.id,row]));return [...new Set([...old.keys(),...next.keys()])].flatMap(id=>canonical(old.get(id)||null)===canonical(next.get(id)||null)?[]:[{id,before:clone(old.get(id)||null),after:clone(next.get(id)||null)}]);}
function record(state,before,after,label,uuid,now) {const changes=playlistChanges(before,after);if(!changes.length)return state;const next=clone(state);next.journal.unshift({id:uuid(),label,createdAt:now,undone:false,changes});next.journal.length=Math.min(next.journal.length,LIMITS.journal);next.revision++;return clean(next);}
function undo(state,personal,id) {
  const row=state.journal.find(item=>item.id===id);if(!row||row.undone)throw Error('此操作不存在或已经撤销');
  const current=new Map(personal.playlists.map(list=>[list.id,list]));
  for(const change of row.changes)if(canonical(current.get(change.id)||null)!==canonical(change.after))throw Error('相关歌单已有后续修改，已保留当前资料，不能直接撤销');
  const result=clone(personal);for(const change of row.changes){const index=result.playlists.findIndex(list=>list.id===change.id);if(change.before===null){if(index>=0)result.playlists.splice(index,1);}else if(index>=0)result.playlists[index]=clone(change.before);else result.playlists.push(clone(change.before));}
  const names=new Set();for(const list of result.playlists){const name=list.name.normalize('NFKC').toLowerCase();if(names.has(name))throw Error('恢复后会产生同名歌单，请先调整名称');names.add(name);}
  const next=clone(state);next.journal.find(item=>item.id===id).undone=true;next.revision++;return {state:clean(next),personal:result};
}
const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase();
function search(state,personal,query) {
  const terms=normalize(query).trim().split(/\s+/).filter(Boolean);if(!terms.length)return [];
  const rows=[],seen=new Set();const matches=value=>terms.every(term=>normalize(value).includes(term));
  for(const bookmark of state.bookmarks)if(matches([bookmark.track.title,bookmark.track.artist,bookmark.note,bookmark.lyric].join(' ')))rows.push({kind:'bookmark',track:bookmark.track,seconds:bookmark.seconds,excerpt:bookmark.note||bookmark.lyric||'歌曲书签',id:bookmark.id});
  for(const document of state.lyrics){const metadata=`${document.track.title} ${document.track.artist}`;for(const line of document.text.split(/\r?\n/)){if(!line.trim()||!matches(`${metadata} ${line}`))continue;const time=line.match(/\[(\d+):(\d+(?:\.\d+)?)\]/);rows.push({kind:'lyric',track:document.track,seconds:time?Number(time[1])*60+Number(time[2]):null,excerpt:line.replace(/\[[^\]]*\]/g,'').slice(0,500),id:`${key(document.track)}:${rows.length}`});if(rows.length>=100)return rows;}}
  const tracks=[...(personal.liked||[]),...(personal.favorites||[]),...(personal.history||[]).map(row=>row.track),...(personal.playlists||[]).flatMap(list=>list.tracks)];
  for(const track of tracks){const id=key(track);if(seen.has(id)||!matches(`${track.title} ${track.artist} ${track.album||''}`))continue;seen.add(id);rows.push({kind:'track',track:trackRef(track),seconds:null,excerpt:track.album||'曲库歌曲',id});if(rows.length>=100)break;}
  return rows.slice(0,100);
}
function previewMerge(current,incoming){const ids=new Map(current.bookmarks.map(row=>[row.id,row]));let added=0,duplicates=0,conflicts=0;for(const row of incoming.bookmarks){const old=ids.get(row.id);if(!old)added++;else if(canonical(old)===canonical(row))duplicates++;else conflicts++;}return {added,duplicates,conflicts,lyrics:incoming.lyrics.length,revision:current.revision};}
function merge(current,incoming,uuid){const next=clone(current),ids=new Map(next.bookmarks.map(row=>[row.id,row]));for(const row of incoming.bookmarks){const old=ids.get(row.id);if(!old){next.bookmarks.push(clone(row));ids.set(row.id,row);}else if(canonical(old)!==canonical(row)){const copied={...clone(row),id:uuid()};next.bookmarks.push(copied);ids.set(copied.id,copied);}}
  const documents=new Set(next.lyrics.map(row=>key(row.track)));for(const row of incoming.lyrics)if(!documents.has(key(row.track))){next.lyrics.push(clone(row));documents.add(key(row.track));}next.revision++;return clean(next);}
const api={LIMITS,canonical,trackRef,key,empty,clean,addBookmark,saveLyrics,playlistChanges,record,undo,search,previewMerge,merge};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else globalThis.zenixPersonalFeatures=api;
