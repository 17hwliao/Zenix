const test=require('node:test'),assert=require('node:assert/strict');
const prefs=require('../src/features/playback/preferences.cjs');
const track=(id,title='晴天',artist='周杰伦')=>({id,title,artist,providerId:'source',remoteId:id,source:'custom',duration:240,path:'',audioUrl:''});
test('version preferences preserve default order; explicit song choice outranks edition without changing candidate count',()=>{
  const original=track('original'),rows=[track('live','晴天 (Live)'),track('studio'),track('cover','晴天 (翻唱)')];
  assert.deepEqual(prefs.order(rows,original,prefs.clean(null)),rows);
  assert.equal(prefs.order(rows,original,{mode:'original',choices:{}})[0].id,'studio');
  assert.equal(prefs.order(rows,original,{mode:'live',choices:{}})[0].id,'live');
  const result=prefs.order(rows,original,{mode:'live',choices:{[prefs.songKey(original)]:{providerId:'source',remoteId:'studio'}}});
  assert.equal(result[0].id,'studio');assert.equal(result.length,3);assert.deepEqual(rows.map(row=>row.id),['live','studio','cover']);
});
test('preference storage bounds records and strips audio credentials',()=>{
  const entries=new Map(),storage={getItem:key=>entries.get(key),setItem:(key,value)=>entries.set(key,value)};
  const next=prefs.write({mode:'invalid',choices:{song:{providerId:'src',remoteId:'remote',audioUrl:'secret',headers:{Authorization:'secret'}}}},storage);
  assert.equal(next.mode,'any');assert.deepEqual(next.choices.song,{providerId:'src',remoteId:'remote'});assert(!entries.get(prefs.KEY).includes('secret'));assert.deepEqual(prefs.read(storage),next);
  entries.set(prefs.KEY,'broken');assert.deepEqual(prefs.read(storage),{mode:'any',choices:{}});
});
test('changing version preference and exclusions cannot replenish a persisted three-candidate round',async()=>{
  const {run}=require('../src/core/platformReplacement.cjs'),original=track('original'),rows=[track('one'),track('two','晴天 (Live)'),track('three')],tried=rows.slice(0,2).map(prefs.versionKey),calls=[];
  const state={status:'failed',attempts:2,tried,candidates:prefs.order(rows,original,{mode:'live',choices:{},excluded:{[prefs.songKey(original)]:[prefs.versionKey(rows[1])]}}),message:''};
  const result=await run(original,state,{search:async()=>{throw Error('continued round must not search again');},save:async()=>{},resolve:async target=>{calls.push(target.id);throw Error('explicit decoder failure');},check:async()=>{}},new AbortController().signal,()=>{},undefined,true);
  assert.deepEqual(calls,['three']);assert.equal(result.state.attempts,3);assert.equal(result.state.roundComplete,true);
});
function playerHarness(){
  const vm=require('node:vm'),ts=require('typescript'),fs=require('node:fs'),path=require('node:path'),instances=[];
  class Audio extends EventTarget{constructor(){super();instances.push(this);this.currentTime=0;this.duration=240;this.readyState=3;this.volume=.75;this.muted=false;this.paused=true;this.playbackRate=1;}get currentSrc(){return this.src||'';}load(){}removeAttribute(name){if(name==='src')this.src='';}pause(){this.paused=true;this.dispatchEvent(new Event('pause'));}async play(){this.paused=false;this.dispatchEvent(new Event('play'));this.dispatchEvent(new Event('playing'));}}
  const file=path.resolve(__dirname,'../src/core/player.ts'),module={exports:{}},storage=new Map();
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>name.includes('desktopReplacement')?{markReplacementPlayed:async()=>{}}:name.includes('trackCover')?{trackCoverUrl:()=>''}:{AudioGraph:class{resume(){}close(){}},defaultAudioSettings:{output:'default',gains:[]},validateAudio:value=>value},Audio,HTMLMediaElement:{HAVE_METADATA:1},Event,AbortController,DOMException,setTimeout,clearTimeout,console,navigator:{},window:{yzqxy:undefined},localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)}});
  return {player:module.exports.player,instances};
}

test('production selection revisions and recording guard prevent late bookmark seeks after reselection',async()=>{
 const {player,instances}=playerHarness(),local={...track('local'),source:'local',audioUrl:'file:///fixture.wav'};
 player.setQueue([local]);const revision=player.snapshot.selectionRevision,expected={selectionRevision:revision,id:'local',recordingIdentity:'local\0source\0local'};
 player.seek(30,expected);assert.equal(instances[0].currentTime,30);
 player.setQueue([local]);assert(player.snapshot.selectionRevision>revision,'even selecting the same song creates a new owner');
 assert.throws(()=>player.seek(90,expected),/歌曲已变化/);assert.notEqual(instances[0].currentTime,90);
 const actual={...local,id:'actual',providerId:'new-provider',remoteId:'recording'};player.setQueue([{...local,playbackRecording:actual}]);
 assert.throws(()=>player.configurePractice({enabled:true,start:1,end:3,expected:{...local,playbackProviderId:'',replacementPlayback:'',recordingIdentity:'local\0old-provider\0recording'}}),/版本已变化/);
 player.dispose();
});
test('production player A–B loop executes, resets on song change, and validates bounds',async()=>{
  const {player,instances}=playerHarness(),song={...track('local'),source:'local',audioUrl:'file:///fixture.wav'};
  player.setQueue([song],0);player.configurePractice({enabled:true,start:5,end:10,rate:.75});assert.equal(instances[0].currentTime,5);assert.equal(instances[0].playbackRate,.75);
  instances[0].currentTime=10.2;instances[0].dispatchEvent(new Event('timeupdate'));assert.equal(instances[0].currentTime,5);
  assert.throws(()=>player.configurePractice({enabled:true,start:10,end:5}),/区间/);assert.throws(()=>player.configurePractice({rate:2}),/速度/);
  assert.throws(()=>player.configurePractice({enabled:true,start:1,end:2,expected:{...song,remoteId:'stale-version'}}),/版本已变化/);assert.equal(player.practiceState().loop.start,5);
  player.setQueue([{...song,id:'second'}]);assert.equal(player.practiceState().loop,null);assert.equal(instances[0].playbackRate,1);player.dispose();
});
test('production audition error and explicit cancellation return to original intent without losing a pending seek',async()=>{
  const {player,instances}=playerHarness(),local={...track('local'),source:'local',audioUrl:'file:///fixture.wav'};
  player.setQueue([local]);player.seek(70);await player.previewVersion({...local,id:'audition'});await player.stopPreview(true);assert.equal(instances[0].paused,true);assert.equal(player.snapshot.position,70);
  await player.play();player.setTrackResolver(async()=>{throw Error('preview source failed');});await assert.rejects(player.previewVersion(track('remote')),/preview source failed/);assert.equal(player.snapshot.track.id,'local');assert.equal(player.snapshot.playing,true);assert.equal(instances[0].currentTime,70);
  let reject;player.setTrackResolver((_track,_failed,_report,signal)=>new Promise((resolve,fail)=>{reject=fail;signal.addEventListener('abort',()=>fail(new DOMException('cancelled','AbortError')),{once:true});}));
  const pending=player.previewVersion(track('remote'));await new Promise(done=>setImmediate(done));await player.stopPreview(true);await assert.rejects(pending,/cancelled/);assert.equal(player.snapshot.track.id,'local');assert.equal(player.snapshot.playing,true);assert.equal(player.snapshot.position,70);assert.equal(player.practiceState().preview,false);player.dispose();
});
test('production audition preserves seek ownership when original source parsing was still pending',async()=>{
  const {player,instances}=playerHarness(),original=track('original');let finishOld,calls=0;
  player.setTrackResolver(()=>++calls===1?new Promise(resolve=>{finishOld=resolve;}):Promise.resolve({...original,audioUrl:'fresh-resolution'}));
  player.setQueue([original]);player.seek(70);
  await player.previewVersion({...track('local'),source:'local',audioUrl:'file:///sample.wav'});await player.stopPreview(true);await player.play();
  instances[0].currentTime=0;instances[0].dispatchEvent(new Event('loadedmetadata'));assert.equal(instances[0].currentTime,70);
  finishOld({...original,audioUrl:'stale-resolution'});await new Promise(done=>setImmediate(done));assert.equal(instances[0].src,'fresh-resolution');assert.equal(player.snapshot.track.id,original.id);player.dispose();
});
test('production audition preserves original queue and progress; user selection cancels late preview results',async()=>{
  const {player,instances}=playerHarness(),song={...track('local'),source:'local',audioUrl:'file:///fixture.wav'};
  player.setQueue([song,{...song,id:'next'}]);await player.play();player.seek(42);
  await player.previewVersion({...song,id:'audition'});assert.equal(player.snapshot.queue.length,2);assert.equal(player.snapshot.track.id,'local');assert.equal(player.snapshot.position,42);assert.equal(instances[0].paused,true);assert.equal(instances[1].paused,false);
  await player.stopPreview(true);assert.equal(instances[0].paused,false);assert.equal(player.snapshot.position,42);
  let resolve;player.setTrackResolver(()=>new Promise(done=>{resolve=done;}));const pending=player.previewVersion(track('remote'));
  await new Promise(done=>setImmediate(done));player.setQueue([{...song,id:'user-selected'}]);resolve({...track('remote'),audioUrl:'fixture'});await pending;await player.stopPreview(true);
  assert.equal(player.snapshot.track.id,'user-selected');assert.equal(player.snapshot.playing,false);assert.equal(player.practiceState().preview,false);player.dispose();
});
