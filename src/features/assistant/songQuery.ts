import type {Intent} from './intent';
import type {PersonalState,PlayerState,RawLyrics,Track} from '../../core/types';
import {parseLyrics,activeLyricIndex} from '../../core/lyrics';
import {recordingFor,recordingIdentity} from '../recording';

const digits='零一二三四五六七八九';
function number(text:string){if(/^\d+$/.test(text))return Number(text);if(text==='两')return 2;if(text==='十')return 10;if(text.startsWith('十'))return 10+digits.indexOf(text[1]);if(text.endsWith('十'))return digits.indexOf(text[0])*10;return digits.indexOf(text);}
const N='([0-9]+|[零一二两三四五六七八九十]+)';
export type SongField='all'|'title'|'artist'|'album'|'duration'|'year'|'source'|'saved'|'lyrics'|'progress'|'cover';
function field(text:string):SongField{if(/(?:全部|所有|详细|完整)(?:的)?(?:资料|信息)/.test(text))return 'all';if(/歌词|唱到|哪一句/.test(text))return 'lyrics';if(/歌手|谁唱|演唱者/.test(text))return 'artist';if(/封面/.test(text))return 'cover';if(/专辑/.test(text))return 'album';if(/时长|多长|几分钟/.test(text))return 'duration';if(/年份|哪年/.test(text))return 'year';if(/音源|来源|平台|音质|版本/.test(text))return 'source';if(/喜欢|收藏|哪些歌单/.test(text))return 'saved';if(/进度|播放状态/.test(text))return 'progress';if(/歌名|名字|名称|哪首|什么歌/.test(text))return 'title';return 'all';}
export function songQueryIntent(text:string,confidence:number):Intent|null{
 if(/删除|移除|加入|添加|创建|新建|播放一首|搜索|找歌/.test(text)||/^(?:打开|进入|播放|切到|返回)/.test(text)&&!/返回.*(?:信息|资料|歌词|歌手|名字|名称)/.test(text))return null;
 const query=/信息|资料|歌手|谁唱|演唱|歌词|唱到|哪一句|封面|专辑|时长|多长|几分钟|年份|哪年|来源|音源|平台|音质|版本|哪些歌单|进度|播放状态|歌名|名字|名称|哪首|什么歌|介绍/.test(text)||/是否.*(?:喜欢|收藏)|有没有.*(?:喜欢|收藏)|(?:喜欢|收藏)(?:状态|了吗|了没有)/.test(text);
 if(!query)return null;
 const args:Record<string,unknown>={field:field(text),from:0,to:0,scope:'queue',lineOnly:/这句|唱到|哪一句/.test(text)};
 if(/最近|听过|听歌历史|播放记录|最近播放/.test(text)){
  const match=text.match(new RegExp(N+'\\s*首'));const count=match?number(match[1]):10;
  if(count<1||count>10)return {kind:'unknown',reply:'听歌记录一次支持查询 1 到 10 首，请缩小范围。'};
  return {kind:confidence>=.62?'action':'confirm',action:'recent-songs',args:{count,field:args.field},reply:`查询最近听过的 ${count} 首歌曲`};
 }
 const range=text.match(new RegExp('(前|后|上|下)(?:面|边)?(?:的)?(?:第)?'+N+'首(?:歌曲|歌)?(?:到|至)(前|后|上|下)(?:面|边)?(?:的)?(?:第)?'+N+'首'));
 const around=text.match(new RegExp('前后(?:各|的|分别)?\\s*'+N+'\\s*首'));
 const relative=text.match(new RegExp('(前|后|上|下)(?:面|边)?(?:的)?(第)?\\s*'+N+'\\s*首'));
 if(range){const left=number(range[2])*(/[前上]/.test(range[1])?-1:1),right=number(range[4])*(/[前上]/.test(range[3])?-1:1);args.from=Math.min(left,right);args.to=Math.max(left,right);}
 else if(/(?:到|至)/.test(text)&&relative)return {kind:'unknown',reply:'请明确范围，例如“前面第三首到后面第二首的信息”。'};
 else if(around){args.from=-number(around[1]);args.to=number(around[1]);}
 else if(relative){const at=number(relative[3])*(/[前上]/.test(relative[1])?-1:1);args.from=relative[2]?at:Math.min(at,at<0?-1:1);args.to=relative[2]?at:Math.max(at,at<0?-1:1);}
 else if(/上一首|前一首/.test(text))args.from=args.to=-1;
 else if(/下一首|后一首/.test(text))args.from=args.to=1;
 else if(!/当前|现在|这首|正在听|正在播放|歌词/.test(text))return null;
 if(Number(args.from)<-10||Number(args.to)>10||relative&&number(relative[3])<1||range&&(number(range[2])<1||number(range[4])<1)||around&&number(around[1])<1)return {kind:'unknown',reply:'以当前歌曲为中心，前后分别支持十首以内，请缩小范围。'};
 return {kind:confidence>=.62?'action':'confirm',action:'song-query',args,reply:'查询指定范围的歌曲资料'};
}
const position=(offset:number)=>offset===0?'当前歌曲':offset<0?`前面第 ${-offset} 首`:`后面第 ${offset} 首`;
function duration(value:number,zero=false){if(!Number.isFinite(value)||value<0||value===0&&!zero)return '未知';const seconds=Math.round(value);return `${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;}
function same(a:Track,b:Track){return a.id===b.id&&recordingIdentity(a)===recordingIdentity(b);}
export async function querySongs(args:Record<string,unknown>,personal:PersonalState,playback:PlayerState,lyrics:(track:Track)=>Promise<RawLyrics|null>,signal?:AbortSignal,offset?:(id:string)=>number){
 const scope=args.scope==='history'?'history':'queue',from=Number(args.from??0),to=Number(args.to??0),what=(args.field||'all') as SongField;
 if(!['all','title','artist','album','duration','year','source','saved','lyrics','progress','cover'].includes(what))throw Error('歌曲查询字段无效。');
 let selected:{track:Track;label:string;current:boolean}[]=[],notice='';
 if(scope==='history'){
  const count=Number(args.count??10);if(!Number.isInteger(count)||count<1||count>10)throw Error('听歌记录一次支持 1 到 10 首。');
  selected=[...personal.history].sort((a,b)=>b.playedAt-a.playedAt).slice(0,count).map((row,index)=>({track:row.track,label:`最近第 ${index+1} 首`,current:false}));notice='听歌记录按最近播放在前排列，重复歌曲可能被历史记录合并。';
 }else{
  if(!Number.isInteger(from)||!Number.isInteger(to)||from< -10||to>10||from>to)throw Error('查询位置须在当前歌曲前后各十首以内。');
  if(!playback.track)throw Error('请先选择一首歌曲。');
  const index=playback.queueIndex,valid=Number.isInteger(index)&&index>=0&&index<playback.queue.length&&same(playback.queue[index],playback.track);
  // Never choose the first duplicate or silently substitute listening history.
  if(!valid&&(from!==0||to!==0))throw Error('当前歌曲在播放队列中的位置无法确认，暂时只能查询当前歌曲。');
  for(let offset=from;offset<=to;offset++){const row=offset===0?playback.track:playback.queue[index+offset];if(row)selected.push({track:row,label:position(offset),current:offset===0});}
  const requested=to-from+1;notice=`按当前播放队列顺序查询${playback.shuffle?'；随机播放时，实际下一首可能不同':''}。`;
  if(selected.length<requested)notice+=`请求 ${requested} 首，队列边界内实际有 ${selected.length} 首；没有循环补齐。`;
 }
 if(!selected.length)return {reply:scope==='history'?'还没有听歌记录。':'这个方向已经没有歌曲了。',items:[],speech:[]};
 const items:string[]=[],details:string[]=[],speech:string[]=[];
 for(const entry of selected){
  signal?.throwIfAborted();const track=recordingFor(entry.track,personal),rows:string[]=[];
  const put=(kind:SongField,value:string)=>{if(what==='all'||what===kind)rows.push(value);};
  put('title',`歌名：${track.title}`);put('artist',`歌手：${track.artist||'来源未提供'}`);put('album',`专辑：${track.album||'来源未提供'}`);put('duration',`时长：${duration(entry.current?playback.duration||track.duration:track.duration)}`);
  put('cover',`封面：${track.coverUrl||entry.track.coverUrl?'已提供':'来源未提供'}`);
  put('year',`年份：${track.year||'来源未提供'}`);
  put('source',`来源：${track.source==='local'?'本地音乐':track.providerId||'未提供'}；${entry.current?`当前播放音质：${entry.track.actualQuality||entry.track.playbackQuality||'未提供'}`:'播放音质尚未确定'}${track.id!==entry.track.id?`；由《${entry.track.title}》平替为当前版本`:''}`);
  const liked=personal.liked.some(row=>same(row,track)||same(row,entry.track)),favorite=personal.favorites.some(row=>same(row,track)||same(row,entry.track)),lists=personal.playlists.filter(list=>list.tracks.some(row=>same(row,track)||same(row,entry.track))).map(list=>list.name);
  put('saved',`喜欢：${liked?'是':'否'}；收藏：${favorite?'是':'否'}；所在歌单：${lists.join('、')||'未加入自定义歌单'}`);
  put('progress',entry.current?`当前${playback.playing?'正在播放':playback.error?'播放失败':playback.playWhenReady?'正在加载':'暂停'}，进度 ${duration(playback.position,true)}`:'这首歌曲当前未在播放');
  if(what==='all'||what==='lyrics'){
   try{const raw=await lyrics(track);signal?.throwIfAborted();const lines=raw?.text.trim()?parseLyrics({...raw,text:raw.text.slice(0,120000)}):[];const at=entry.current?activeLyricIndex(lines,playback.position-(offset?.(entry.track.id)||0)):-1;const content=!lines.length?'暂无可用歌词':args.lineOnly?(entry.current?(at>=0?lines[at].text:'尚未唱到第一句'):'该歌曲未播放，不能确定唱到哪一句'):lines.map(line=>line.text).join('\n');rows.push('歌词：'+content);}
   catch(error){signal?.throwIfAborted();rows.push('歌词：读取失败，其他资料仍可查看。');}
  }
  const content=`${entry.label}，《${track.title}》。\n${rows.join('\n')}`;items.push(`${entry.label} · ${track.title}${track.artist?' · '+track.artist:''}`);details.push(content);speech.push(content);
 }
 return {reply:`已查询 ${selected.length} 首歌曲。${notice}`,items,detail:details.join('\n\n'),speech};
}
