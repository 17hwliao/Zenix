'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module,filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),
  {compilerOptions:{module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,filename);

const {
  accompanimentSearchGroups,
  canOfferAccompaniment,
  discardRevokedBlobCandidate,
  discoverAccompaniment,
} = require('../src/features/karaoke/prep-accompaniment.ts');

const audioUrl = 'yzqxy://stream/e20c446b-9212-4914-935c-7b1e99553b34';
function lxSource(id,platform,enabled=true) {
  return {id,kind:'lx',catalog:platform,enabled,manifest:{
    capabilities:['search','resolvePlayback'],qualities:['high','standard'],
    lxPlatforms:{[platform]:{name:platform,qualitys:['320k']}},
  }};
}
function lxTrack(providerId, source, songmid, overrides={}) {
  return {id:providerId+':'+songmid,source:'custom',path:'',audioUrl:'',title:'雨落',artist:'原唱',duration:180,
    providerId,remoteId:Buffer.from(JSON.stringify({source,songmid})).toString('base64url'),...overrides};
}
function attachBridge(t, sources) {
  const previous = global.window;
  global.window = {yzqxy:{sources:{cancelRequest:async()=>{},...sources}}};
  t.after(()=>{global.window = previous;});
}

test('LX source catalogs are deduplicated by actual platform, including Android settings',()=>{
  const direct=lxSource('lx.alpha','tx');
  const configured={...lxSource('lx.beta','kw'),catalog:undefined,settings:{lxCatalog:'tx'}};
  const fallback=lxSource('lx.gamma','kw');
  const other={...lxSource('network.xyz','kw'),kind:'zenix'};
  assert.deepEqual(accompanimentSearchGroups([direct,configured,fallback,other,lxSource('lx.off','wy',false)])
    .map(group=>group.map(source=>source.id)),[['lx.alpha','lx.beta'],['lx.gamma'],['network.xyz']]);
});

test('title/header guesses become review candidates, not automatic pairings',async t=>{
  const a=lxSource('lx.alpha','tx'), b=lxSource('lx.beta','tx'), c=lxSource('lx.gamma','kg');
  const original=lxTrack(a.id,'tx','vocals');
  const alteration=lxTrack(a.id,'tx','altered',{title:'雨落（现场版 伴奏）',artist:'有人',duration:130});
  const match=lxTrack(a.id,'tx','official',{title:'雨落（原版伴奏）'});
  const canonicalMatch=lxTrack(a.id,'tx','canonical',{title:'雨落（纯伴奏）'});
  const duplicate=lxTrack(c.id,'tx','canonical',{title:'雨落（纯伴奏）'});
  const searches=[];
  attachBridge(t,{
    search:async id=>{searches.push(id);return {items:id===a.id?[original,alteration,match,canonicalMatch]:[duplicate]};},
    probe:async()=>assert.fail('catalog title is not trusted pairing proof'),
  });
  assert.equal(canOfferAccompaniment(original,alteration),true,'same-titled live cut merits review');
  assert.equal(canOfferAccompaniment(original,match),true,'same-titled claimed original also merits review');
  const result=await discoverAccompaniment(original,[a,b,c],false,new AbortController().signal);
  assert.deepEqual(searches,[a.id,c.id]);
  assert.equal(result.status,'review');
  assert.equal(result.track,undefined);
  assert.deepEqual(result.candidates.map(row=>row.id),[canonicalMatch.id,match.id,alteration.id]);
});

test('confirmed desktop pair rejects an aliased cache, checks media bytes and prepares a decoder',async t=>{
  const a=lxSource('lx.alpha','tx'), b=lxSource('lx.beta','tx');
  const original=lxTrack(a.id,'tx','vocals');
  const confirmed=lxTrack(a.id,'tx','backing',{title:'雨落（纯伴奏）'});
  const events=[];
  attachBridge(t,{
    cachedBest:async()=>({audioUrl:'yzqxy://cached-audio/bad',playbackRecording:original}),
    resolve:async(row,_quality,alias,skipCache,_requestId,_replacement,preserveCache)=>{events.push('resolve:'+row.providerId);assert.equal(alias,'');assert.equal(skipCache,true);assert.equal(preserveCache,true);return{audioUrl,playbackRecording:row};},
    probe:async(url)=>{events.push('prefix');assert.equal(url,audioUrl);},
    search:async()=>assert.fail('verified pairing should bypass search'),
  });
  const previous = global.Audio;
  global.Audio = class extends EventTarget {
    duration=181;
    set src(value) {assert.equal(value,audioUrl);queueMicrotask(()=>this.dispatchEvent(new Event('canplay')));}
    load(){events.push('release');}
    removeAttribute(){}
  };
  t.after(()=>{global.Audio=previous;});
  const result=await discoverAccompaniment(original,[a,b],false,new AbortController().signal,confirmed);
  assert.equal(result.status,'ready');
  assert.equal(result.track.duration,181);
  assert.equal(result.track.audioUrl,'','ephemeral stream URL is not saved as a pairing');
  assert.deepEqual(events,['resolve:'+a.id,'prefix','release']);
});

test('native verification remains separate from native playback',async()=>{
  const source=lxSource('lx.alpha','tx');
  const original=lxTrack(source.id,'tx','vocals');
  const confirmed=lxTrack(source.id,'tx','backing',{title:'雨落（纯伴奏）'});
  const controller=new AbortController();
  const result=await discoverAccompaniment(original,[source],true,controller.signal,confirmed,{verifyNative:async(row,signal)=>{
    assert.equal(row,confirmed);assert.equal(signal,controller.signal);return true;
  }});
  assert.equal(result.status,'ready');assert.equal(result.track,confirmed);
});

test('a failed restored Blob candidate is removed before its object URL is revoked',()=>{
  const revoked={...lxTrack('lx.alpha','tx','stale'),audioUrl:'blob:revoked'};
  const valid=lxTrack('lx.alpha','tx','valid');
  const mixed=discardRevokedBlobCandidate({status:'review',candidates:[revoked,valid]},revoked.audioUrl);
  assert.equal(mixed.status,'review');
  assert.deepEqual(mixed.candidates.map(row=>row.id),[valid.id]);
  assert.match(mixed.message,/忽略/);
  const onlyStale=discardRevokedBlobCandidate({status:'review',candidates:[revoked]},revoked.audioUrl);
  assert.equal(onlyStale.status,'error');
  assert.equal(onlyStale.candidates.length,0);
  assert.match(onlyStale.message,/无法再播放/);
});

test('missing vs failed remain distinguishable and obsolete searches are cancelled',async t=>{
  const source=lxSource('lx.alpha','tx');
  const original=lxTrack(source.id,'tx','vocals');
  let fail=true;
  let wait=false;
  let requestId,resolveLate, cancelled;
  attachBridge(t,{search:async(_id,_keyword,_cursor,_size,token)=>{
    if (wait) return new Promise(resolve=>{requestId=token;resolveLate=resolve;});
    if(fail)throw Error('offline');
    return {items:[]};
  },cancelRequest:async token=>{cancelled=token;}});
  const sig=new AbortController().signal;
  assert.equal((await discoverAccompaniment(original,[source],false,sig)).status,'error');
  fail=false;
  assert.equal((await discoverAccompaniment(original,[source],false,sig)).status,'missing');
  wait=true;
  const cancelledSearch=new AbortController();
  const promise=discoverAccompaniment(original,[source],false,cancelledSearch.signal);
  assert.ok(requestId);
  cancelledSearch.abort();
  resolveLate({items:[lxTrack(source.id,'tx','backing',{title:'雨落（纯伴奏）'})]});
  await assert.rejects(promise, error=>error.name==='AbortError');
  assert.equal(cancelled,requestId);
});
