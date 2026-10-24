import {songQueryIntent} from './songQuery';
import type {Intent} from './intent';
export const libraryActions=new Set(['song-query','now-lyrics','now-artist','recent-songs','home','playlist-open','playlist-create','playlist-create-current','songs-collect','songs-remove']);
const unquote=(value:string)=>value.trim().replace(/^[《“"「]|[》”"」]$/g,'').trim();
export function libraryIntent(text:string,confidence:number):Intent|null{
 const action=(id:string,reply:string,args:Record<string,unknown>={}):Intent=>({kind:confidence>=.62?'action':'confirm',action:id,args,reply});
 const query=songQueryIntent(text,confidence);if(query)return query;
 if(/^(?:返回|回到|打开|回|进入)(?:软件)?(?:主界面|主页面|主页|首页)$/.test(text))return action('home','返回主界面');
 if(/(?:当前|现在|这首|正在播放|正在听|当前听歌)/.test(text)&&/(?:歌手|谁唱的|演唱者)/.test(text)&&!/(?:搜索|找歌|删除|收藏)/.test(text))return action('now-artist','查看当前歌曲的歌手');
 if((/^(?:查看|显示|告诉我|返回)?(?:完整)?歌词(?:是什么)?$/.test(text)||/(?:当前|这首|现在|正在听|正在播放)/.test(text)&&/歌词/.test(text))&&!/(?:搜索|找歌|删除|收藏)/.test(text))return action('now-lyrics',text.includes('这句')?'查看当前一句歌词':'查看当前歌曲的歌词',{lineOnly:/这句|唱到|哪一句/.test(text)});
 if(/听过|听歌历史|最近播放|播放记录/.test(text)&&!/(删除|清空)/.test(text))return action('recent-songs','查看最近听过的十首歌曲');
 const currentNew=text.match(/^(?:把|将)?(?:当前|这首|正在播放的)(?:的)?(?:歌曲|歌)?(?:加入|添加到|放进)(?:一个)?(?:新建的|新)歌单(?:[，,:：\s]*(?:叫|名叫|名字叫|命名为)?(.+))?$/);
 if(currentNew)return action('playlist-create-current','新建歌单并加入当前歌曲',{name:unquote(currentNew[1]||'')});
 const namedCreate=text.match(/^(?:创建|新建)(?:一个)?(?:名叫|叫)(.+?)的?歌单$/),create=text.match(/^(?:创建|新建)(?:一个)?(?:新)?歌单(?:[，,:：\s]*(?:叫|名叫|名字叫|命名为)?(.+))?$/);
 if(namedCreate||create)return action('playlist-create','创建新歌单',{name:unquote(namedCreate?.[1]||create?.[1]||'')});
 const open=text.match(/^(?:打开|进入|查看)(?:我的)?歌单[：:\s]*(.+)$/)||text.match(/^(?:打开|进入|查看)(?:我的)?(.+?)歌单$/);
 if(open)return action('playlist-open','打开歌单',{name:unquote(open[1])});
 const kinds:string[]=[];if(/喜欢/.test(text))kinds.push('liked');if(/收藏/.test(text))kinds.push('favorites');
 if(kinds.length&&/不要|不用|不想|不需要/.test(text.replace(/《[^》]*》|“[^”]*”/g,'')))return {kind:'unknown',reply:'识别到否定，没有修改喜欢或收藏。'};
 if(kinds.length&&!/删除|移出|移除|取消|清空|不喜欢|不收藏/.test(text)&&/批量|全部|所有|选中|这些|加入|添加|标为/.test(text)){
  const scope=/当前队列|播放队列/.test(text)?'queue':/当前歌单|这张歌单/.test(text)?'playlist':/当前歌曲|这首歌/.test(text)?'track':'selected';
  const named=text.match(/歌单[《“"](.+?)[》”"]/);
  return action('songs-collect',`批量加入${kinds.length===2?'喜欢和收藏':kinds[0]==='liked'?'喜欢':'收藏'}`,{scope:named?'playlist':scope,name:named?.[1],kinds});
 }
 if(/删除|移出|移除/.test(text)&&/歌曲|首歌|选中|歌单|《/.test(text)){
  if(/歌单$/.test(text)&&!text.includes('从'))return {kind:'unknown',reply:'这里支持从歌单移出歌曲；不会通过这条指令删除整个歌单或本地音频文件。'};
  const named=text.match(/(?:从)?歌单[《“"](.+?)[》”"]/),tail=(named?text.replace(named[0],''):text).split(/删除|移出|移除/).slice(1).join(''),titles=[...tail.matchAll(/《([^》]+)》/g)].map(match=>match[1]);
  return action('songs-remove','从歌单移出歌曲',{scope:/当前歌曲|这首歌/.test(text)?'track':/全部|所有/.test(text)?'playlist':'selected',name:named?.[1],titles});
 }
 return null;
}
