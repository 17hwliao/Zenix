import type {Track,PersonalPlaylist,ReplacementState,SourceProgress} from './types';
import {replacement} from './platformReplacement';
import {sourceRequest} from './sourceDeadline';
export async function replacementContext(track:Track){
  if(!track.playlistId||!window.yzqxy)return undefined;
  const personal=await window.yzqxy.personal.load(),list=personal.playlists.find(list=>list.id===track.playlistId),song=list?.tracks.find(song=>song.id===track.id);
  return list&&song?{list,song}:undefined;
}
export async function replacementMutation(args:Record<string,unknown>,signal?:AbortSignal){
  signal?.throwIfAborted();const requestId=signal?crypto.randomUUID():undefined;
  const cancel=()=>{if(requestId)void window.yzqxy!.personal.cancelBatch(requestId).catch(()=>{});};
  signal?.addEventListener('abort',cancel,{once:true});
  try{return await window.yzqxy!.personal.batch(args,requestId);}
  finally{signal?.removeEventListener('abort',cancel);}
}
export function desktopReplacementAdapter(list:PersonalPlaylist,song:Track){
  let saved=song.replacement;
  return {
    save:async(state:ReplacementState|undefined,signal?:AbortSignal)=>{await replacementMutation({id:list.id,edit:'replacement',trackId:song.id,expected:list.tracks.map(song=>song.id),expectedReplacement:JSON.stringify(saved||null),state},signal);saved=replacement.cleanRecord(state);},
    search:async(query:string,signal:AbortSignal,limit=Infinity)=>{
      const sources=(await window.yzqxy!.sources.list()).filter(source=>source.enabled&&source.manifest.capabilities.includes('search')&&source.manifest.capabilities.includes('resolvePlayback'));
      signal.throwIfAborted();
      if(!sources.length)throw Error('请先启用支持搜索和播放的音乐源');
      const rows:Track[]=[];
      let completed=0;
      // Serial requests keep script/HTTP concurrency bounded and cancelable.
      for(const source of sources){signal.throwIfAborted();try{const page=await sourceRequest(id=>window.yzqxy!.sources.search(source.id,query,null,25,id,true),signal,0);for(const row of page.items){try{const target=replacement.cleanTarget(row);if(!rows.some(value=>replacement.candidateKey(value)===replacement.candidateKey(target)))rows.push(target);}catch{}}completed++;if(rows.length>=limit)break;}catch{signal.throwIfAborted();}}
      if(!completed)throw Error('替代版本搜索失败，请检查网络或音乐源后重试');
      return rows;
    },
    resolve:async(target:Track,signal:AbortSignal)=>{
      const cached=await sourceRequest(()=>window.yzqxy!.sources.cachedBest?.(target,['high','standard','lossless'])||Promise.resolve(null),signal,0);if(cached)return cached;
      const source=(await window.yzqxy!.sources.list()).find(source=>source.id===target.providerId&&source.enabled);if(!source)throw Error('替代音源已关闭或移除');
      let qualities=source.manifest.qualities;
      if(source.kind==='lx'){const info=JSON.parse(atob(target.remoteId!.replace(/-/g,'+').replace(/_/g,'/')));const formats=source.manifest.lxPlatforms?.[info.source]?.qualitys||[];qualities=['high','standard','lossless'].filter(tier=>formats.includes(({high:'320k',standard:'128k',lossless:'flac'} as Record<string,string>)[tier]));}
      const quality=['high','standard','lossless'].find(tier=>qualities.includes(tier));if(!quality)throw Error('替代音源不支持此歌曲目录或品质');
      return sourceRequest(id=>window.yzqxy!.sources.resolve(target,quality,song.id,true,id,true),signal,0);
    },
    check:async(result:{audioUrl:string},signal:AbortSignal)=>sourceRequest(id=>window.yzqxy!.sources.probe(result.audioUrl,id),signal,0),
  };
}
export async function markReplacementPlayed(track:Track){
  if(!track.replacementPlayback)return;
  const ctx=await replacementContext(track);if(!ctx?.song.replacement?.target)return;
  const state=ctx.song.replacement;
  if(replacement.candidateKey(state.target!)!==track.replacementPlayback.split('\u0000')[0]||state.status==='verified')return;
  await desktopReplacementAdapter(ctx.list,ctx.song).save({...state,status:'verified',message:'实际播放验证通过'});
}
export async function resolveReplacement(track:Track,failed:readonly string[],report:(progress:SourceProgress)=>void,signal:AbortSignal,normal:()=>Promise<Track>):Promise<Track>{
  const ctx=await replacementContext(track);signal.throwIfAborted();if(!ctx)return normal();
  let previous=ctx.song.replacement;
  const adapter=desktopReplacementAdapter(ctx.list,ctx.song);
  if(track.replacementPlayback&&failed.length&&previous){previous={...previous,status:'failed',target:undefined,message:'音频解码失败，继续本轮剩余候选'};await adapter.save(previous,signal);}
  if(previous?.status==='verified'&&previous.target){previous={...previous,status:'pending',attempts:1,tried:[replacement.candidateKey(previous.target)]};await adapter.save(previous,signal);}
  const automatic=ctx.list.autoReplacement===true;
  if(automatic&&!previous?.target&&!failed.length&&!track.replacementPlayback){
    const cached=await sourceRequest(()=>window.yzqxy!.sources.cachedBest?.(track,['lossless24','lossless','high','standard'])||Promise.resolve(null),signal,0);if(cached)return{...track,...cached};
  }
  if(automatic&&!failed.length&&replacement.roundComplete(previous)){previous={status:'failed',attempts:0,tried:[],candidates:[],message:'',roundComplete:false};await adapter.save(previous,signal);}
  if(!previous?.target&&!track.replacementPlayback&&!automatic)return normal();
  else if(!previous?.target&&!ctx.list.autoReplacement)throw Error('替代版本无法播放，请在歌单中重新选择或恢复原曲');
  let result;
  if(previous?.target){result=await replacement.resume(previous,adapter,signal);if(!result.target){previous=result.state;if(!ctx.list.autoReplacement)throw Error(previous.message);}}
  if(!result?.target)result=await replacement.run(ctx.song,previous,adapter,signal,message=>report({phase:'resolving',message}),undefined,automatic);
  if(!result.target||!result.resolved)throw Object.assign(Error(result.state.message),automatic?{code:'AUTOMATIC_REPLACEMENT_UNAVAILABLE'}:{});
  return {...track,...result.resolved,id:track.id,title:track.title,artist:track.artist,replacementPlayback:replacement.candidateKey(result.target)+'\u0000'+result.state.attempts,playbackQuality:'replacement'};
}
