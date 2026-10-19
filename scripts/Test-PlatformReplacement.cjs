const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {rank,run,cleanRecord}=require('../src/core/platformReplacement.cjs');
const track=(id='a',extra={})=>({id,title:'你不知道的事',artist:'王力宏',album:'十八般武艺',duration:280,source:'custom',providerId:'source.'+id,remoteId:'remote.'+id,path:'',audioUrl:'',...extra});
const empty=()=>({status:'failed',attempts:0,tried:[],candidates:[],message:''});
function fixture(candidates,resolve=async()=>({audioUrl:'fixture'})){let state;const calls=[],adapter={search:async()=>candidates,resolve:async(song,signal)=>{calls.push(song.id);return resolve(song,signal);},check:async()=>{},save:async value=>{state=structuredClone(value);}};return{adapter,calls,get state(){return state;}};}
test('replacement ranking keeps the recording, normalizes collaborator separators and requires confirmation for uncertain versions',()=>{
 assert.equal(rank(track(),track('b')),3);assert.equal(rank(track(),track('b',{artist:'其他歌手'})),0);
 assert.equal(rank(track('a',{artist:'甲、乙'}),track('b',{artist:'乙 / 甲'})),2);
 assert.equal(rank(track(),track('b',{album:'精选集'})),1);assert.equal(rank(track(),track('b',{duration:0})),1);
 assert.equal(rank(track(),track('b',{title:'你不知道的事 (Live)'})),1);assert.equal(rank(track(),track('b',{title:'你不知道的事 (Cover)',artist:'其他歌手'})),0);
 const clean=cleanRecord({...empty(),target:{...track(),audioUrl:'https://secret.invalid/token',headers:{Authorization:'secret'},replacement:empty()}});
 assert.equal(clean.target.audioUrl,'');assert(!('headers'in clean.target));assert(!('replacement'in clean.target));
});
test('one shared budget allows three attempts total, persists exhaustion and never calls a candidate twice automatically',async()=>{
 const f=fixture([track('a'),track('a'),track('b'),track('c'),track('d')],async()=>{throw Error('HTTP 503');});
 const result=await run(track('original'),undefined,f.adapter,new AbortController().signal);
 assert.deepEqual(f.calls,['a','b','c']);assert.equal(result.state.attempts,3);assert.equal(result.state.status,'failed');
 await assert.rejects(run(track(),f.state,f.adapter,new AbortController().signal),/3次/);assert.equal(f.calls.length,3);
});
test('a pending operation survives arbitrary clock movement; only its explicit completion advances the state',async()=>{
 let complete;const f=fixture([track('a')],()=>new Promise(resolve=>{complete=resolve;})),controller=new AbortController();
 const pending=run(track(),undefined,f.adapter,controller.signal);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.state.attempts,1);assert(!f.state.target);const old=Date.now;Date.now=()=>old()+10*60*1000;
 try{await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,1);complete({audioUrl:'fixture'});const result=await pending;assert.equal(result.state.status,'pending');assert.equal(result.state.attempts,1);}finally{Date.now=old;}
});
test('cancelled completion cannot publish a target and a continued round retains its used attempt',async()=>{
 let complete;const f=fixture([track('a'),track('b')],()=>new Promise(resolve=>{complete=resolve;})),controller=new AbortController();
 const pending=run(track(),undefined,f.adapter,controller.signal);await new Promise(resolve=>setImmediate(resolve));controller.abort();complete({audioUrl:'late'});await assert.rejects(pending,{name:'AbortError'});
 assert.equal(f.state.attempts,1);assert(!f.state.target);const resumed=fixture([]);const result=await run(track(),f.state,resumed.adapter,new AbortController().signal);assert.deepEqual(resumed.calls,['b']);assert.equal(result.state.attempts,2);
});
test('ambiguous editions never resolve without explicit choice and audio response errors consume the same budget',async()=>{
 const candidate=track('b',{duration:310}),f=fixture([candidate]);const result=await run(track(),undefined,f.adapter,new AbortController().signal);assert.equal(result.state.status,'needsChoice');assert.equal(f.calls.length,0);
 const chosen=await run(track(),result.state,f.adapter,new AbortController().signal,()=>{},candidate);assert.equal(chosen.state.status,'pending');assert.equal(chosen.state.attempts,1);
 const bad=fixture([track('a'),track('b'),track('c')]);bad.adapter.check=async()=>{throw Error('HTML not audio');};assert.equal((await run(track(),undefined,bad.adapter,new AbortController().signal)).state.attempts,3);
});

test('automatic playlist playback uses only the title and the first three unique results without manual metadata gates',async()=>{
 const candidates=[track('a',{artist:'不同歌手',duration:0}),track('a'),track('b',{album:'其他专辑'}),track('c',{title:'Live 版本'}),track('d')];
 const f=fixture(candidates,async song=>{if(song.id!=='c')throw Error('explicit failure');return{audioUrl:'audio'};});
 const queries=[];f.adapter.search=async query=>{queries.push(query);return candidates;};
 const result=await run(track(),undefined,f.adapter,new AbortController().signal,()=>{},undefined,true);
 assert.deepEqual(queries,['你不知道的事']);assert.deepEqual(f.calls,['a','b','c']);assert.equal(result.state.attempts,3);assert.equal(result.target.id,'c');assert.equal(result.state.candidates.length,3);
 const exhausted=fixture(candidates,async()=>{throw Error('HTTP 404');});
 assert.equal((await run(track(),undefined,exhausted.adapter,new AbortController().signal,()=>{},undefined,true)).state.status,'failed');assert.deepEqual(exhausted.calls,['a','b','c']);
});

test('automatic cancellation keeps its reservation and resumes the remaining title results without a fourth attempt',async()=>{
 let complete;const f=fixture([track('a'),track('b'),track('c'),track('d')],()=>new Promise(resolve=>complete=resolve));const abort=new AbortController();
 const task=run(track(),undefined,f.adapter,abort.signal,()=>{},undefined,true);await new Promise(resolve=>setImmediate(resolve));abort.abort();complete({audioUrl:'late'});await assert.rejects(task,{name:'AbortError'});
 const next=fixture([],async()=>{throw Error('failed');});const result=await run(track(),f.state,next.adapter,new AbortController().signal,()=>{},undefined,true);
 assert.deepEqual(next.calls,['b','c']);assert.equal(result.state.attempts,3);assert(!result.target);
});
test('playlist associations persist after reload, retain originals/order, reject stale writes and undo without touching other collections',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-replacement-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));const {PersonalStore}=require('../electron/personal.cjs'),store=new PersonalStore(folder);await store.load();await store.createPlaylist('Imported',track('original'));await store.addToPlaylist(store.snapshot().playlists[0].id,track('second'));const before=store.snapshot(),list=before.playlists[0],base={id:list.id,expected:list.tracks.map(song=>song.id)};
 await store.batch({...base,edit:'replacementPolicy',enabled:true});const record={...empty(),status:'pending',attempts:1,target:track('substitute'),candidates:[track('substitute')],tried:['fixture']};
 await store.batch({...base,edit:'replacement',trackId:list.tracks[0].id,expectedReplacement:'null',state:record});
 const loaded=new PersonalStore(folder);await loaded.load();assert.equal(loaded.snapshot().playlists[0].autoReplacement,true);assert.deepEqual(loaded.snapshot().playlists[0].tracks.map(song=>song.id),base.expected);assert.equal(loaded.snapshot().playlists[0].tracks[0].providerId,'source.original');assert.equal(loaded.snapshot().playlists[0].tracks[0].replacement.target.audioUrl,'');
 await assert.rejects(loaded.batch({...base,edit:'replacement',trackId:list.tracks[0].id,expectedReplacement:'null',state:null}),/状态已变化/);
 await loaded.batch({...base,edit:'replacementClear'});assert.deepEqual(loaded.snapshot().playlists[0].tracks,before.playlists[0].tracks);assert.deepEqual(loaded.snapshot().liked,before.liked);
});
test('audio prefix check rejects HTTP failures, JSON and fake HTML responses and releases the probe reader',async()=>{
 const {checkResponse}=require('../electron/runtime/audio-probe.cjs');let cancelled=false;
 await checkResponse(new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('ID3 fixture audio bytes'));},cancel(){cancelled=true;}})),new AbortController().signal);assert(cancelled);
 await assert.rejects(checkResponse(new Response('{"url":"fake"}'),new AbortController().signal),/不是可识别/);
 await assert.rejects(checkResponse(new Response('not found',{status:404}),new AbortController().signal),/404/);
});
test('desktop automatic fallback and decoder failures share the same persisted three-attempt budget',async()=>{
 const ts=require('typescript'),raw=require('node:fs');require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(raw.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
 const {resolveReplacement,markReplacementPlayed}=require('../src/core/desktopReplacement.ts');const {batchPlaylists}=require('../electron/runtime/playlist-batch.cjs');
 const original={...track('original'),playlistId:'test-list'},candidates=[track('a'),track('b'),track('c')];let state={liked:[],favorites:[],history:[],playlists:[{id:'test-list',name:'Imported',autoReplacement:true,tracks:[{...original,replacement:{...empty(),candidates}}]}]},calls=[];
 const beforeWindow=global.window;
 global.window={yzqxy:{personal:{load:async()=>structuredClone(state),batch:async args=>(state=batchPlaylists(state,args))},sources:{list:async()=>candidates.map(song=>({id:song.providerId,kind:'zenix',enabled:true,manifest:{qualities:['high'],capabilities:['search','resolvePlayback']}})),search:async(id,query)=>({items:candidates.filter(song=>song.providerId===id)}),cancelRequest:async()=>{},resolve:async(song)=>{calls.push(song.id);return{audioUrl:'fixture',playbackProviderId:song.providerId};},probe:async()=>{}}}};
 try{
  const normal=async()=>{throw Error('original unavailable');},signal=new AbortController().signal;
  const first=await resolveReplacement(original,[],()=>{},signal,normal);assert.equal(state.playlists[0].tracks[0].replacement.status,'pending');
  const second=await resolveReplacement(first,['decoder-a'],()=>{},signal,normal);const third=await resolveReplacement(second,['decoder-a','decoder-b'],()=>{},signal,normal);
  assert.deepEqual(calls,['a','b','c']);assert.equal(state.playlists[0].tracks[0].replacement.attempts,3);
  await markReplacementPlayed(third);assert.equal(state.playlists[0].tracks[0].replacement.status,'verified');
  await assert.rejects(resolveReplacement(third,['decoder-c'],()=>{},signal,normal),/3次/);assert.equal(calls.length,3);
 }finally{global.window=beforeWindow;}
});
test('real React replacement panel: opt-in, version confirmation, restore, cancellation and responsive geometry',{skip:process.platform!=='win32'},async t=>{
 const {createServer}=await import('vite'),folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-replacement-ui-'));const server=await createServer({cacheDir:path.join(folder,'vite'),server:{port:0,strictPort:false},logLevel:'error'});await server.listen();t.after(async()=>{await server.close();await fs.rm(folder,{recursive:true,force:true});});
 const env={...process.env,ZENIX_TEST_USER_DATA:folder,ZENIX_TEST_UI_URL:`http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/replacement-ui.html`};delete env.ELECTRON_RUN_AS_NODE;
 const {stdout}=await require('node:util').promisify(require('node:child_process').execFile)(require('electron'),[path.join(__dirname,'fixtures/ElectronReplacementUi.cjs')],{env,windowsHide:true,timeout:60000});assert.match(stdout,/REPLACEMENT_UI_PASS/);await fs.mkdir(path.join(__dirname,'../release/regression'),{recursive:true});await fs.copyFile(path.join(folder,'replacement-mobile.png'),path.join(__dirname,'../release/regression/replacement-mobile.png'));
});
test('complete cached audio is inspected locally and cannot be mistaken for a failed network resource',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-replacement-cache-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));const file=path.join(folder,'audio.bin'),bytes=Buffer.from('ID3 fixture complete cached audio');await fs.writeFile(file,bytes);const key='a'.repeat(64);
 const {SourceManager}=require('../electron/sources.cjs'),manager={audioCache:{entries:new Map([[key,{size:bytes.length}]]),file:()=>file}};
 await SourceManager.prototype.probe.call(manager,'yzqxy://cached-audio/'+key,new AbortController().signal);
 manager.audioCache.entries.get(key).size++;await assert.rejects(SourceManager.prototype.probe.call(manager,'yzqxy://cached-audio/'+key,new AbortController().signal),/不完整/);
});

test('a third scanned success reaches desktop playback; decoder failure cannot start a fourth candidate',async()=>{
 const {resolveReplacement}=require('../src/core/desktopReplacement.ts'),{batchPlaylists}=require('../electron/runtime/playlist-batch.cjs');
 const original={...track('original'),playlistId:'third-list'},target=track('third');let state={liked:[],favorites:[],history:[],playlists:[{id:'third-list',tracks:[{...original,replacement:{...empty(),status:'pending',attempts:3,target,candidates:[target],tried:['a','b',require('../src/core/platformReplacement.cjs').candidateKey(target)]}}],autoReplacement:true}]},calls=0;
 const before=global.window;global.window={yzqxy:{personal:{load:async()=>structuredClone(state),batch:async args=>(state=batchPlaylists(state,args)),cancelBatch:async()=>{}},sources:{list:async()=>[{id:target.providerId,enabled:true,manifest:{qualities:['high']}}],resolve:async()=>{calls++;return{audioUrl:'fixture'};},probe:async()=>{},cancelRequest:async()=>{}}}};
 try{const normal=async()=>{throw Error('original unavailable');},signal=new AbortController().signal;const played=await resolveReplacement(original,[],()=>{},signal,normal);assert(played.replacementPlayback);assert.equal(calls,1);assert.equal(state.playlists[0].tracks[0].replacement.attempts,3);await assert.rejects(resolveReplacement(played,['decoder'],()=>{},signal,normal),/3次/);assert.equal(calls,1);}finally{global.window=before;}
});

test('desktop cancellation reaches the real personal commit after its backup wait, preserving reserved attempts and other data',async t=>{
 const {desktopReplacementAdapter}=require('../src/core/desktopReplacement.ts'),{PersonalStore}=require('../electron/personal.cjs'),{EventEmitter}=require('node:events');
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-replacement-cancel-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));const personal=new PersonalStore(folder);await personal.load();await personal.createPlaylist('Imported',track('original'));await personal.toggle('liked',track('like'));await personal.toggle('favorites',track('favorite'));const initial=personal.snapshot(),list=initial.playlists[0];
 const handlers=new Map(),main=require('node:fs').readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8');
 const start=main.indexOf('  const personalRequests=new Map();'),end=main.indexOf("  handleApp('personal:load'",start);assert(start>=0&&end>start);const sender=new EventEmitter();sender.id=1;
 Function('personal','handleApp','broadcast',main.slice(start,end))(personal,(name,handler)=>handlers.set(name,handler),()=>{});
 const invoke=(name,...args)=>Promise.resolve().then(()=>handlers.get(name)({sender},...args));
 let unblock,entered;const barrier=new Promise(resolve=>unblock=resolve),waiting=new Promise(resolve=>entered=resolve),batch=personal.batch.bind(personal);
 personal.batch=async(args,signal)=>{if(args.state?.status==='pending'){personal.backupBarrier=barrier;entered();}return batch(args,signal);};
 const before=global.window;global.window={yzqxy:{personal:{batch:(...args)=>invoke('personal:batch',...args),cancelBatch:id=>invoke('personal:cancel-batch',id)}}};
 try{const adapter=desktopReplacementAdapter(list,list.tracks[0]);adapter.search=async()=>[track('candidate')];adapter.resolve=async()=>({audioUrl:'fixture'});adapter.check=async()=>{};const control=new AbortController(),pending=run(list.tracks[0],undefined,adapter,control.signal);await waiting;control.abort();await new Promise(resolve=>setImmediate(resolve));unblock();await assert.rejects(pending,{name:'AbortError'});const after=personal.snapshot();assert.equal(after.playlists[0].tracks[0].replacement.attempts,1);assert(!after.playlists[0].tracks[0].replacement.target);assert.deepEqual(after.liked,initial.liked);assert.deepEqual(after.favorites,initial.favorites);assert.deepEqual(after.playlists[0].tracks.map(song=>song.id),list.tracks.map(song=>song.id));const loaded=new PersonalStore(folder);await loaded.load();assert.deepEqual(loaded.snapshot(),after);}finally{global.window=before;unblock();}
});

test('desktop replacement streams cache under candidate identity, never the original source-song alias',async()=>{
 const {SourceManager}=require('../electron/sources.cjs');const record={kind:'zenix',manifest:{qualities:['high'],network:{mediaHosts:['audio.example.test']}}};
 const manager={sessions:new Map(),record:()=>record,call:async()=>({url:'https://audio.example.test/fixture.mp3'}),mediaHeaders:SourceManager.prototype.mediaHeaders,diagnostics:{record:()=>''}};
 const candidate=track('replacement'),original='source:original:remote';const result=await SourceManager.prototype.resolve.call(manager,candidate,'high',original,true,new AbortController().signal,true);
 assert.equal(manager.sessions.get(result.audioUrl.split('/').at(-1)).trackId,candidate.id);
 const normal=await SourceManager.prototype.resolve.call(manager,candidate,'high',original,true,new AbortController().signal,false);
 assert.equal(manager.sessions.get(normal.audioUrl.split('/').at(-1)).trackId,original,'normal same-recording fallback retains its existing cache alias contract');
});

test('automatic resume after cancelling the third reservation cannot reset the round; complete cached originals remain playable',async()=>{
 const {resolveReplacement}=require('../src/core/desktopReplacement.ts'),{batchPlaylists}=require('../electron/runtime/playlist-batch.cjs');
 const original={...track('original'),playlistId:'cancel-third'},before=global.window;let lookups=0,cached=null;
 let state={liked:[],favorites:[],history:[],playlists:[{id:'cancel-third',autoReplacement:true,tracks:[{...original,replacement:{...empty(),attempts:3,tried:['a','b','c'],message:'正在解析替代版本'}}]}]};
 global.window={yzqxy:{personal:{load:async()=>structuredClone(state),batch:async args=>(state=batchPlaylists(state,args)),cancelBatch:async()=>{}},sources:{cachedBest:async()=>cached,cancelRequest:async()=>{},list:async()=>{lookups++;throw Error('must not search fourth candidate');}}}};
 try{await assert.rejects(resolveReplacement(original,[],()=>{},new AbortController().signal,async()=>{throw Error('must not resolve original');}),{code:'AUTOMATIC_REPLACEMENT_UNAVAILABLE'});assert.equal(lookups,0);assert.equal(state.playlists[0].tracks[0].replacement.attempts,3);
  delete state.playlists[0].tracks[0].replacement;cached={audioUrl:'yzqxy://cached-audio/complete'};
  assert.equal((await resolveReplacement(original,[],()=>{},new AbortController().signal,async()=>{throw Error('network forbidden');})).audioUrl,cached.audioUrl);assert.equal(lookups,0,'automatic mode does not require online searches for complete cached original audio');
 }finally{global.window=before;}
});


test('completed pools of one or two candidates start a new automatic round after source recovery',async()=>{
 const {resolveReplacement}=require('../src/core/desktopReplacement.ts'),{batchPlaylists}=require('../electron/runtime/playlist-batch.cjs');
 for(const count of [1,2]){let healthy=false,searches=0,resolves=0;const original={...track('original'),playlistId:'short-pool'},candidates=Array.from({length:count},(_,i)=>track('candidate-'+i));let state={liked:[],favorites:[],history:[],playlists:[{id:'short-pool',autoReplacement:true,tracks:[original]}]};const before=global.window;
 global.window={yzqxy:{personal:{load:async()=>structuredClone(state),batch:async args=>(state=batchPlaylists(state,args))},sources:{cachedBest:async()=>null,list:async()=>[{id:'source.candidate-0',enabled:true,manifest:{capabilities:['search','resolvePlayback'],qualities:['high']}},...candidates.slice(1).map(s=>({id:s.providerId,enabled:true,manifest:{capabilities:['search','resolvePlayback'],qualities:['high']}}))],search:async(id)=>{searches++;return{items:candidates.filter(s=>s.providerId===id)};},resolve:async()=>{resolves++;if(!healthy)throw Error('HTTP 503');return{audioUrl:'fixture'};},probe:async()=>{},cancelRequest:async()=>{}}}};
 try{const play=()=>resolveReplacement(original,[],()=>{},new AbortController().signal,async()=>{throw Error('unexpected original lookup');});await assert.rejects(play());assert.equal(state.playlists[0].tracks[0].replacement.roundComplete,true);const searched=searches;healthy=true;const result=await play();assert(result.replacementPlayback);assert(searches>searched);assert.equal(resolves,count+1);assert.equal(state.playlists[0].tracks[0].replacement.attempts,1);}finally{global.window=before;}
 }
});

test('mobile policy refresh sends only selection identity and revision, never an old queue snapshot',async()=>{
 const ts=require('typescript'),vm=require('node:vm'),raw=require('node:fs'),calls=[],module={exports:{}};
 const source=ts.transpileModule(raw.readFileSync(path.resolve(__dirname,'../src/mobile/replacement.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{module,exports:module.exports,require:name=>{assert.equal(name,'./native');return{command:async(action,payload)=>calls.push({action,payload})};}});
 const old={track:{id:'old',playlistId:'list'},queue:[track('old')],queueIndex:0,selectionRevision:7};await module.exports.refreshMobileReplacement('list',old,true);
 assert.equal(calls.length,1);assert.equal(calls[0].action,'replacementPolicyRefresh');assert.deepEqual({...calls[0].payload},{id:'list',trackId:'old',selectionRevision:7,enabled:true});assert(!('tracks'in calls[0].payload));
 await module.exports.refreshMobileReplacement('list',{...old,selectionRevision:undefined},true);assert.equal(calls.length,1,'older unsupported snapshots cannot fall back to replaying the stale queue');
});
