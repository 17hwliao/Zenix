/* Shared desktop/mobile matching contract. A pending result is never a failure. */
const LIMIT=3;
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g,'').trim().replace(/\s+/g,' ');
const titleKey=value=>normalize(value).replace(/[\s\p{P}]/gu,'');
const artists=value=>normalize(value).split(/、|,|，|&|／|\/|;|；|\s+(?:feat\.?|ft\.?|and)\s+/).map(titleKey).filter(Boolean).sort().join('|');
const edition=value=>[...new Set((normalize(value).match(/live|现场|翻唱|cover|伴奏|instrumental|remix|加速|sped\s*up|慢速|slowed|acoustic|不插电|demo|remaster(?:ed)?/g)||[]).map(v=>({现场:'live',翻唱:'cover',伴奏:'instrumental',加速:'spedup','sped up':'spedup',慢速:'slowed',不插电:'acoustic',remastered:'remaster'})[v]||v))].sort().join('|');
const recordingTitle=value=>titleKey(normalize(value).replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/g,part=>edition(part)?'':part));
function rank(original,candidate){
  if(!original.title||!original.artist||!candidate.remoteId||!candidate.providerId||candidate.source!=='custom')return 0;
  if(recordingTitle(original.title)!==recordingTitle(candidate.title)||artists(original.artist)!==artists(candidate.artist))return 0;
  if(edition(original.title)!==edition(candidate.title))return 1;
  const duration=Number(original.duration),other=Number(candidate.duration);
  if(!(duration>0&&other>0)||Math.abs(duration-other)>3)return 1;
  if(original.album&&candidate.album&&titleKey(original.album)!==titleKey(candidate.album))return 1;
  return normalize(original.title)===normalize(candidate.title)&&normalize(original.artist)===normalize(candidate.artist)?3:2;
}
const candidateKey=track=>`${track.providerId}\n${track.remoteId}`;
function cleanTarget(track){
  if(!track||track.source!=='custom'||typeof track.providerId!=='string'||!track.providerId||track.providerId.length>240||typeof track.remoteId!=='string'||!track.remoteId||track.remoteId.length>32768||typeof track.id!=='string'||typeof track.title!=='string')throw Error('替代歌曲信息无效');
  const duration=Number(track.duration);
  return {id:track.id.slice(0,32768),title:track.title.slice(0,300),artist:String(track.artist||'').slice(0,300),album:String(track.album||'').slice(0,300),duration:Number.isFinite(duration)?Math.min(86400,Math.max(0,duration)):0,source:'custom',providerId:track.providerId,remoteId:track.remoteId,path:'',audioUrl:''};
}
function cleanRecord(value){
  if(!value)return undefined;
  const statuses=['pending','verified','failed','needsChoice','original'];
  if(!statuses.includes(value.status)||!Number.isInteger(value.attempts)||value.attempts<0||value.attempts>LIMIT)throw Error('平替状态无效');
  const candidates=(Array.isArray(value.candidates)?value.candidates:[]).slice(0,12).map(cleanTarget);
  return {status:value.status,attempts:value.attempts,tried:(Array.isArray(value.tried)?value.tried:[]).slice(0,LIMIT).map(v=>String(v).slice(0,34000)),candidates,...(value.target?{target:cleanTarget(value.target)}:{}),message:String(value.message||'').slice(0,300)};
}
const queries=track=>[...new Set([`${track.title} ${track.artist}`.trim(),`${normalize(track.title)} ${artists(track.artist).replace(/\|/g,' ')}`.trim(),String(track.title).trim()])].slice(0,3);
// Refresh the URL of an already accepted candidate; this is the same reserved
// attempt, not permission to retry a failed candidate after the budget expires.
async function resume(previous,adapter,signal){
  signal.throwIfAborted();let state=cleanRecord(previous);const target=state?.target;
  if(!target||state.status!=='pending'||state.attempts<1)throw Error('没有待播放的替代版本');
  try{
    const resolved=await adapter.resolve(target,signal);signal.throwIfAborted();
    await adapter.check(resolved,signal);signal.throwIfAborted();
    await adapter.save(state,signal);signal.throwIfAborted();
    return {state,target,resolved};
  }catch(error){
    signal.throwIfAborted();state=cleanRecord({...state,status:'failed',target:undefined,message:'已选替代版本明确失败'});
    await adapter.save(state,signal);signal.throwIfAborted();return {state};
  }
}
async function run(original,previous,adapter,signal,report=()=>{},manual){
  signal.throwIfAborted();
  let state=cleanRecord(previous)||{status:'failed',attempts:0,tried:[],candidates:[],message:''};
  const persist=async patch=>{signal.throwIfAborted();state=cleanRecord({...state,...patch});await adapter.save(state,signal);signal.throwIfAborted();};
  if(state.attempts>=LIMIT)throw Error('本轮已尝试3次，请明确重新匹配后继续');
  let candidates=manual?[cleanTarget(manual)]:state.candidates;
  if(!candidates.length){
    const found=new Map();
    for(const query of queries(original)){
      signal.throwIfAborted();report(`正在搜索替代版本 · ${query}`);
      const rows=await adapter.search(query,signal);signal.throwIfAborted();
      for(const row of rows){if(rank(original,row)>0)found.set(candidateKey(row),cleanTarget(row));}
      if([...found.values()].some(row=>rank(original,row)>=2))break;
    }
    candidates=[...found.values()].sort((a,b)=>rank(original,b)-rank(original,a)||Math.abs(a.duration-original.duration)-Math.abs(b.duration-original.duration)).slice(0,12);
    await persist({candidates});
  }
  for(const target of candidates){
    if(!manual&&rank(original,target)<2)continue;
    const key=candidateKey(target);if(!manual&&state.tried.includes(key))continue;
    if(state.attempts>=LIMIT)break;
    await persist({status:'failed',target:undefined,attempts:state.attempts+1,tried:[...state.tried,key],message:'正在解析替代版本'});
    report(`正在验证替代音频 · ${state.attempts}/${LIMIT}`);
    try{
      const resolved=await adapter.resolve(target,signal);signal.throwIfAborted();
      await adapter.check(resolved,signal);signal.throwIfAborted();
      await persist({status:'pending',target,message:'音频响应已检查，待实际播放验证'});
      return {state,resolved,target};
    }catch(error){signal.throwIfAborted();await persist({message:'此候选明确失败，尝试下一候选'});}
  }
  await persist({target:undefined,status:state.attempts>=LIMIT?'failed':candidates.some(row=>rank(original,row)===1)?'needsChoice':'failed',message:state.attempts>=LIMIT?'本轮3次尝试已用完':candidates.length?'版本信息有差异，请手动选择':'未找到同名、同歌手的替代版本'});
  return {state};
}
const api={LIMIT,normalize,rank,candidateKey,cleanTarget,cleanRecord,queries,run,resume};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else globalThis.zenixPlatformReplacement=api;
