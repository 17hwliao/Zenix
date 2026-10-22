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
