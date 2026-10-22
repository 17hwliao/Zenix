const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {createRequire}=require('node:module');
const {AudioCache}=require('../electron/audio-cache.cjs');
function isolated(relative,stubs={}){
  const filename=path.resolve(__dirname,'..',relative),module={exports:{}},local=createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,require:id=>stubs[id]||local(id),__dirname:path.dirname(filename),Buffer,URL,Headers,Response,AbortSignal,AbortController,setTimeout,clearTimeout,console,Error});return module.exports;
}
async function cache(t){const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'zenix-audio-reuse-'));t.after(()=>fsp.rm(folder,{recursive:true,force:true}));const cache=new AudioCache(folder);await cache.load();return {folder,cache};}
test('stream token loops and seek ranges use completed disk cache without URL refresh or another HTTP request',async t=>{
  const {folder,cache:audioCache}=await cache(t),bytes=Buffer.alloc(16384,17);bytes.write('ID3');let requests=0;
  const server=http.createServer((_request,response)=>{requests++;response.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':bytes.length});response.end(bytes);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  const network=require('../electron/runtime/source-network.cjs');
  const {SourceManager}=isolated('electron/sources.cjs',{electron:{ipcMain:{on(){},handle(){}}},'./runtime/source-network.cjs':{...network,fetchAllowed:(_url,_hosts,options)=>fetch(`http://127.0.0.1:${server.address().port}/song`,options)}});
  const manager=new SourceManager(folder,()=>{});manager.audioCache=audioCache;t.after(()=>manager.close());
  manager.records=[{id:'fixture',enabled:true,kind:'zenix',manifest:{network:{mediaHosts:['audio.example.test']}}}];
  manager.sessions.set('current',{id:'fixture',trackId:'song',quality:'high',url:'https://audio.example.test/song',headers:{},expiresAt:0});
  const request=options=>new Request('https://stream.zenix.invalid/current',options);
  assert.deepEqual(Buffer.from(await (await manager.stream(request(),'current')).arrayBuffer()),bytes);assert.equal(requests,1);assert(await audioCache.find('song','high'));assert.equal(audioCache.jobs.size,0);
  manager.sessions.get('current').expiresAt=1;manager.refresh=()=>assert.fail('complete cache must not refresh an expired network URL');manager.records=[];
  for(let loop=0;loop<3;loop++)assert.deepEqual(Buffer.from(await (await manager.stream(request(),'current')).arrayBuffer()),bytes);
  const seek=await manager.stream(request({headers:{Range:'bytes=100-199'}}),'current');assert.equal(seek.status,206);assert.deepEqual(Buffer.from(await seek.arrayBuffer()),bytes.subarray(100,200));
  const head=await manager.stream(request({method:'HEAD'}),'current');assert.equal(head.body,null);assert.equal(head.headers.get('content-length'),String(bytes.length));assert.equal(requests,1,'loops, seeks and HEAD must cause zero additional HTTP');
  await audioCache.link('alias','high',audioCache.key('song','high'));audioCache.schedule('alias','high',()=>assert.fail('complete alias cannot trigger another download'));await audioCache.captureQueue;assert.equal(audioCache.jobs.size,0);
  const reloaded=new AudioCache(folder);await reloaded.load();manager.audioCache=reloaded;assert.deepEqual(Buffer.from(await (await manager.stream(request(),'current')).arrayBuffer()),bytes);assert.equal(requests,1,'cache remains offline after restart');
  manager.records=[{id:'fixture',enabled:true,kind:'zenix',manifest:{qualities:['high'],capabilities:['resolvePlayback'],network:{mediaHosts:['audio.example.test']}}}];
  manager.call=async()=>({url:'https://audio.example.test/song'});
  await fsp.writeFile(reloaded.file(reloaded.key('song','high')),Buffer.alloc(bytes.length,9));
  const recovered=await manager.resolve({id:'song',providerId:'fixture',remoteId:'song'},'high','',true);
  const recoveredToken=recovered.audioUrl.split('/').at(-1);
  assert.deepEqual(Buffer.from(await (await manager.stream(request(),recoveredToken)).arrayBuffer()),bytes,'forced recovery cannot return rejected cached bytes');assert.equal(requests,2);
  assert.deepEqual(Buffer.from(await (await manager.stream(request(),recoveredToken)).arrayBuffer()),bytes);assert.equal(requests,2,'recovered cache is reused on its next loop');
});
test('background completion validates audio even if the header is split across tiny HTTP chunks',async t=>{
  const {cache:audioCache}=await cache(t);
  for(const valid of [false,true]){
    const bytes=Buffer.alloc(4096,17);bytes.write(valid?'ID3':'bad');let offset=0;
    audioCache.schedule('header-'+valid,'high',async()=>new Response(new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}const end=Math.min(bytes.length,offset+(offset<4?1:1024));controller.enqueue(bytes.subarray(offset,end));offset=end;}}),{headers:{'Content-Type':'audio/mpeg','Content-Length':bytes.length}}));
    await audioCache.captureQueue;assert.equal(Boolean(await audioCache.find('header-'+valid,'high')),valid);
  }
});
test('consumer cancellation after the last declared byte commits full cache instead of scheduling a duplicate download',async t=>{
  const {cache:audioCache}=await cache(t),bytes=Buffer.alloc(4096,17);bytes.write('ID3');let cancelled=false,downloads=0;
  const response=new Response(new ReadableStream({pull(controller){controller.enqueue(bytes);},cancel(){cancelled=true;}}),{headers:{'Content-Length':bytes.length,'Content-Type':'audio/mpeg'}});
  const reader=audioCache.captureResponse('last-byte','high',response,async()=>{downloads++;throw Error('duplicate download');}).getReader();
  assert.equal((await reader.read()).value.byteLength,bytes.length);await reader.cancel();assert(cancelled);assert(await audioCache.find('last-byte','high'));assert.equal(downloads,0);assert.equal(audioCache.jobs.size,0);
});
test('source work releases unfinished HTTP on completion while leaving other active sources alone',async()=>{
  const {SourceRunner}=isolated('electron/runtime/source-runner.cjs',{electron:{}}),manager={runners:new Map()},first=new SourceRunner(manager,{id:'first'}),second=new SourceRunner(manager,{id:'second'});
  first.acquire();second.acquire();let firstSignal,secondSignal;
  const pending=first.network(signal=>new Promise(resolve=>{firstSignal=signal;signal.addEventListener('abort',()=>resolve('cancelled'),{once:true});}));
  const other=second.network(async signal=>{secondSignal=signal;return 'done';});
  try{first.release();assert.equal(await pending,'cancelled');assert(firstSignal.aborted);assert.equal(secondSignal.aborted,false);assert.equal(await other,'done');await assert.rejects(first.network(()=>assert.fail('idle heartbeat reached transport')),/没有待处理任务/);}
  finally{first.destroy();second.release();second.destroy();}
});
async function offlineSourceFixture(t){
  const {folder,cache:audioCache}=await cache(t),bytes=Buffer.alloc(4096,19);bytes.write('ID3');const fetched=[];
  const network=require('../electron/runtime/source-network.cjs');
  const {SourceManager}=isolated('electron/sources.cjs',{electron:{ipcMain:{on(){},handle(){}}},'./runtime/source-network.cjs':{...network,fetchAllowed:async(url,_hosts,options)=>{options.signal?.throwIfAborted();fetched.push(url);return new Response(bytes,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(bytes.length)}});}}});
  const manager=new SourceManager(folder,()=>{});manager.audioCache=audioCache;t.after(()=>manager.close());
  const source=(id,enabled=true)=>({id,enabled,kind:'zenix',manifest:{version:'1',name:id,capabilities:['search','resolvePlayback'],qualities:['high'],network:{apiHosts:['api.example.test'],mediaHosts:['audio.example.test'],artworkHosts:[]}}});
  manager.records=[source('first'),source('second')];
  const original={id:'source:playlist:imported',providerId:'lx.playlist:catalog',remoteId:'virtual',source:'custom',title:'如果的事',artist:'范玮琪、张韶涵',album:'fixture',duration:200,replacement:{status:'failed',attempts:2}};
  const candidate=(id,providerId='first')=>({...original,id:`source:${providerId}:${id}`,providerId,remoteId:id,replacement:undefined});
  const resolved=[];manager.call=async(id,method,payload,signal)=>{assert.equal(method,'resolvePlayback');assert.equal(signal.zenixStateDriven,true);resolved.push(id+':'+payload.remoteId);return {url:`https://audio.example.test/${payload.remoteId}`,actualQuality:'high'};};
  return {folder,manager,audioCache,original,candidate,fetched,resolved,source};
}
test('offline virtual-provider songs fall back to same-recording search, retain actual identity and reuse original cache key',async t=>{
  const {folder,manager,audioCache,original,candidate,fetched,resolved}=await offlineSourceFixture(t),before=JSON.stringify(original);manager.search=async()=>({items:[candidate('matched')],nextCursor:null});
  const prepared=await manager.prepareOffline(original,'high',new AbortController().signal);assert.equal(prepared.recording.remoteId,'matched');assert.equal(prepared.recording.providerId,'first');assert.deepEqual(resolved,['first:matched']);assert.equal(fetched.length,1);assert.equal(JSON.stringify(original),before,'offline preparation must not mutate playlist replacement state');
  const saved=await audioCache.find(original.id,'high');assert.equal(saved.recording.remoteId,'matched');assert.equal(saved.key,audioCache.key(original.id,'high'));
  for(let i=0;i<3;i++)await manager.prepareOffline(original,'high',new AbortController().signal);assert.equal(fetched.length,1,'completed original identity must avoid repeat requests');
  const reopened=new AudioCache(folder);await reopened.load();assert.equal((await reopened.find(original.id,'high')).recording.providerId,'first');
});
test('offline disabled original source is skipped while a same-recording enabled source can complete',async t=>{
  const {manager,original,candidate,resolved,source,audioCache}=await offlineSourceFixture(t);original.providerId='first';original.remoteId='original';manager.records=[source('first',false),source('second')];const searched=[];manager.search=async id=>{searched.push(id);return {items:[candidate('available','second')]};};
  const result=await manager.prepareOffline(original,'high',new AbortController().signal);assert.equal(result.recording.providerId,'second');assert.deepEqual(searched,['second']);assert.deepEqual(resolved,['second:available']);assert(await audioCache.find(original.id,'high'));
});
test('offline original candidate comes first and the entire fallback is limited to three distinct recordings',async t=>{
  const {manager,original,candidate,fetched}=await offlineSourceFixture(t);original.providerId='first';original.remoteId='original';const attempts=[];
  manager.call=async(id,_method,payload,signal)=>{assert.equal(signal.zenixStateDriven,true);attempts.push(id+':'+payload.remoteId);throw Error('fixture unavailable');};
  manager.search=async()=>({items:[{...original},candidate('second'),candidate('third'),candidate('fourth')]});
  await assert.rejects(manager.prepareOffline(original,'high',new AbortController().signal),/3\/3/);assert.deepEqual(attempts,['first:original','first:second','first:third']);assert.equal(fetched.length,0);
});
test('offline mismatched performers, versions and missing duration never become cached replacements',async t=>{
  const {manager,original,candidate,resolved,fetched,audioCache}=await offlineSourceFixture(t);
  manager.search=async()=>({items:[{...candidate('wrong-singer'),artist:'别人'},{...candidate('wrong-version'),title:'如果的事 (Live)'},{...candidate('unknown'),duration:0}]});
  await assert.rejects(manager.prepareOffline(original,'high',new AbortController().signal),/0\/3/);assert.equal(resolved.length,0);assert.equal(fetched.length,0);assert.equal(await audioCache.find(original.id,'high'),null);
});
test('offline cancellation discards a late search result without resolving, downloading or writing cache metadata',async t=>{
  const {manager,original,candidate,resolved,fetched,audioCache}=await offlineSourceFixture(t),before=await fsp.readFile(audioCache.indexFile,'utf8');let arrived,release;const started=new Promise(resolve=>{arrived=resolve;});manager.search=async()=>{arrived();return new Promise(resolve=>{release=()=>resolve({items:[candidate('too-late')]});});};
  const controller=new AbortController(),pending=manager.prepareOffline(original,'high',controller.signal);await started;controller.abort(new DOMException('cancelled','AbortError'));release();await assert.rejects(pending,/cancelled/);assert.equal(resolved.length,0);assert.equal(fetched.length,0);assert.equal(await fsp.readFile(audioCache.indexFile,'utf8'),before);assert.equal((await fsp.readdir(audioCache.folder)).filter(name=>name.endsWith('.bin')).length,0);
});
test('ordinary streamed cache retains actual resolved recording across original aliases and restart without persisting credentials',async t=>{
  const {folder,manager,audioCache,original,candidate,fetched}=await offlineSourceFixture(t);
  const actual={...candidate('actual-recording'),path:'C:\\private-secret\\song.mp3',audioUrl:'https://secret.invalid/token',headers:{Authorization:'private-secret'},playbackRecording:{id:original.id,providerId:'wrong'}};
  const signal=new AbortController().signal;signal.zenixStateDriven=true;
  const result=await manager.resolve(actual,'high',original.id,false,signal);const token=result.audioUrl.split('/').at(-1),session=manager.sessions.get(token);
  assert.equal(session.trackId,original.id);assert.equal(session.recording.id,actual.id);assert.equal(session.recording.remoteId,actual.remoteId);assert.equal(result.playbackRecording.id,actual.id);
  await (await manager.stream(new Request('https://stream.zenix.invalid/'+token),token)).arrayBuffer();assert.equal(fetched.length,1);
  const cached=await manager.cached(original,'high');assert.equal(cached.playbackProviderId,'cache');assert.equal(cached.playbackRecording.providerId,actual.providerId);assert.equal(cached.playbackRecording.id,actual.id);assert.notEqual(cached.playbackRecording.id,original.id);
  await audioCache.link('source:other-original','high',audioCache.key(original.id,'high'));const other=await manager.cached({...original,id:'source:other-original'},'high');assert.equal(other.playbackRecording.id,actual.id);
  const index=await fsp.readFile(audioCache.indexFile,'utf8');assert(!index.includes('private-secret'));assert(!index.includes('Authorization'));assert(!index.includes('https://'));assert(!index.includes('audioUrl'));assert(!index.includes('path'));
  const reloaded=new AudioCache(folder);await reloaded.load();manager.audioCache=reloaded;const restored=await manager.cached(original,'high');assert.equal(restored.playbackRecording.id,actual.id);assert.equal(fetched.length,1);
});
test('interrupted normal stream carries safe actual identity into its real background completion',async t=>{
  const {cache:audioCache}=await cache(t),bytes=Buffer.alloc(4096,23);bytes.write('ID3');let downloads=0;
  const actual={id:'source:actual:recording',providerId:'actual',remoteId:'recording',title:'真实版本',artist:'歌手',album:'专辑',duration:200,source:'custom',path:'C:\\private-secret',headers:{Authorization:'private-secret'},audioUrl:'https://secret.invalid/audio'};
  const schedule=audioCache.schedule.bind(audioCache);audioCache.schedule=(id,quality,fetcher,delay,recording)=>{assert.equal(delay,6000);return schedule(id,quality,fetcher,0,recording);};
  const response=new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,1024));}}),{headers:{'Content-Type':'audio/mpeg','Content-Length':String(bytes.length)}});
  const reader=audioCache.captureResponse('source:original:alias','high',response,async()=>{downloads++;return new Response(bytes,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(bytes.length)}});},actual).getReader();
  await reader.read();await reader.cancel();await audioCache.captureQueue;assert.equal(downloads,1);const completed=await audioCache.find('source:original:alias','high');assert.equal(completed.recording.id,actual.id);assert.equal(completed.recording.providerId,'actual');assert.equal(completed.recording.path,undefined);assert.equal(completed.recording.headers,undefined);assert.equal(completed.recording.audioUrl,undefined);
});
test('legacy cached bytes without recording metadata remain unknown instead of borrowing the request or its aliases',async t=>{
  const {folder,manager,audioCache,original,candidate}=await offlineSourceFixture(t),bytes=Buffer.alloc(4096,11);bytes.write('ID3');
  const response=new Response(bytes,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(bytes.length)}});await new Response(audioCache.captureResponse(original.id,'high',response,()=>assert.fail('legacy cache must not fetch'))).arrayBuffer();
  const requester={...original,playbackRecording:candidate('invented')};const cached=await manager.cached(requester,'high');assert.equal(cached.playbackProviderId,'cache');assert.equal(cached.playbackRecording,undefined);
  await audioCache.link('source:legacy:alias','high',audioCache.key(original.id,'high'));const alias=await manager.cached({...requester,id:'source:legacy:alias'},'high');assert.equal(alias.playbackRecording,undefined);
  const reloaded=new AudioCache(folder);await reloaded.load();manager.audioCache=reloaded;assert.equal((await manager.cached(requester,'high')).playbackRecording,undefined);
});
test('a known stream never switches to a different recording cached by offline preparation under the same playlist identity',async t=>{
  const {manager,audioCache,original,candidate,fetched}=await offlineSourceFixture(t),other=candidate('offline-B','second'),otherBytes=Buffer.alloc(4096,41);otherBytes.write('ID3');
  await audioCache.pin(original.id,'high','通勤');await audioCache.prepare(original.id,'high',async()=>new Response(otherBytes,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(otherBytes.length)}}),undefined,undefined,other);
  const selected=candidate('live-A'),signal=new AbortController().signal;signal.zenixStateDriven=true;
  const resolved=await manager.resolve(selected,'high',original.id,true,signal);assert.equal((await audioCache.find(original.id,'high')).recording.remoteId,'offline-B','fresh resolution must not delete another healthy fixed recording');
  const token=resolved.audioUrl.split('/').at(-1),request=()=>new Request('https://stream.zenix.invalid/'+token);const actual=Buffer.from(await (await manager.stream(request(),token)).arrayBuffer());assert.notDeepEqual(actual,otherBytes);assert.equal(fetched.length,1);
  for(let i=0;i<3;i++)assert.deepEqual(Buffer.from(await (await manager.stream(request(),token)).arrayBuffer()),actual);assert.equal(fetched.length,1,'the stream reuses its own recording cache without replacing offline bytes');assert.equal((await audioCache.find(original.id,'high')).recording.remoteId,'offline-B');assert.equal(audioCache.entries.size,2);
});
test('an in-flight offline cache and normal playback preserve both actual recordings and independent completion',async t=>{
  const {manager,audioCache,original,candidate,fetched}=await offlineSourceFixture(t),offline=candidate('offline-writing','second'),otherBytes=Buffer.alloc(4096,37);otherBytes.write('ID3');let release,started;const ready=new Promise(resolve=>{started=resolve;});
  const preparing=audioCache.prepare(original.id,'high',async()=>{started();await new Promise(resolve=>{release=resolve;});return new Response(otherBytes,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(otherBytes.length)}});},undefined,undefined,offline);await ready;
  const signal=new AbortController().signal;signal.zenixStateDriven=true;const result=await manager.resolve(candidate('foreground'),'high',original.id,false,signal),token=result.audioUrl.split('/').at(-1),request=()=>new Request('https://stream.zenix.invalid/'+token);
  const first=Buffer.from(await (await manager.stream(request(),token)).arrayBuffer());release();await preparing;
  assert.deepEqual(Buffer.from(await (await manager.stream(request(),token)).arrayBuffer()),first);assert.equal(fetched.length,1);assert.notDeepEqual(first,otherBytes);assert.equal((await audioCache.find(original.id,'high')).recording.remoteId,'offline-writing');assert.equal(audioCache.entries.size,2);
});
