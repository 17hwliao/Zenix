const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { AudioCache } = require('../electron/audio-cache.cjs');
const { OfflineTasks, NetworkPreferences } = require('../electron/runtime/offline-tasks.cjs');
const bytes = Buffer.alloc(4096, 7); bytes.write('ID3');
const response = () => new Response(bytes, { headers: {'Content-Type':'audio/mpeg', 'Content-Length':String(bytes.length)} });
async function setup(t) { const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zenix-offline-tasks-')); t.after(() => fs.rm(folder, {recursive:true, force:true})); const cache = new AudioCache(folder); await cache.load(); return {folder, cache}; }
async function settled(tasks) { for (let i=0; i<300; i++) { if (!tasks.active) return; await new Promise(resolve=>setTimeout(resolve,10)); } assert.fail('offline task did not settle'); }
const song = id => ({id, providerId:'fixture', remoteId:id, title:id, artist:'fixture', source:'custom', audioUrl:'https://secret.invalid/token', headers:{Authorization:'secret'}});
test('fixed cache persists across age pruning, ordinary clear and restart; unpin permits cleanup', async t => {
  const {folder,cache} = await setup(t);
  await cache.pin('one','high','通勤',true); await cache.prepare('one','high',response);
  cache.entries.get(cache.key('one','high')).lastAccess=Date.now()-40*86400000;
  await cache.prune(); await cache.clear(); assert(await cache.find('one','high'));
  const reloaded=new AudioCache(folder); await reloaded.load(); assert.equal(reloaded.stats().pinnedCount,1);
  await reloaded.pin('one','high','通勤',false); await reloaded.clear(); assert.equal(await reloaded.find('one','high'),null);
});
test('fixed contents prevent a new cache from displacing them when budget is full', async t => {
  const {cache} = await setup(t); await cache.pin('fixed','high','通勤',true); await cache.prepare('fixed','high',response);
  cache.limitMiB=bytes.length/1048576;
  await assert.rejects(cache.prepare('new','high',response), /固定缓存/);
  assert(await cache.find('fixed','high')); assert.equal(await cache.find('new','high'),null);
});
test('concurrent preparation for one recording shares its complete file', async t => {
  const {cache} = await setup(t); let requests=0;
  const fetcher=async()=>{requests++; await new Promise(resolve=>setTimeout(resolve,20)); return response();};
  await Promise.all([cache.prepare('same','high',fetcher),cache.prepare('same','high',fetcher)]);
  assert.equal(requests,1); assert(await cache.find('same','high'));
});
test('offline tasks finish without any mounted page, persist sanitized data and retry failed items only', async t => {
  const {folder,cache} = await setup(t); const calls=[]; let allowSecond=false;
  const sources={prepareOffline:async(track,quality,signal,progress)=>{calls.push(track.id);if(track.id==='second'&&!allowSecond)throw Error('fixture unavailable'); await cache.prepare(track.id,quality,async()=>response(),signal,progress);}};
  const tasks=new OfflineTasks({folder,sources,cache});t.after(()=>tasks.close());await tasks.load();
  await tasks.invoke({action:'prepare',tracks:[song('first'),song('first'),song('second')],group:'通勤'});await settled(tasks);
  let current=tasks.state().tasks[0];assert.equal(current.status,'failed');assert.equal(current.items.length,2);assert.equal(current.items[0].status,'complete');
  const stored=await fs.readFile(tasks.file,'utf8');assert(!stored.includes('secret'));assert(!stored.includes('Authorization'));assert(!stored.includes('audioUrl'));
  allowSecond=true;await tasks.invoke({action:'retry',id:current.id});await settled(tasks);assert.deepEqual(calls,['first','second','second']);assert.equal(tasks.state().tasks[0].status,'complete');
  const reloaded=new OfflineTasks({folder,sources,cache});t.after(()=>reloaded.close());await reloaded.load();assert.equal(reloaded.state().tasks[0].status,'complete');
});
test('network preferences wait on unknown metering and never modify another transport', async t => {
  const network=new NetworkPreferences();network.configure({preload:'unmetered',audio:'always',artwork:'never'});assert(network.allows('audio'));assert(!network.allows('preload'));assert.throws(()=>network.require('artwork'),/封面/);network.network='unmetered';assert(network.allows('preload'));
  const {folder,cache}=await setup(t);let calls=0;network.network='unknown';
  const tasks=new OfflineTasks({folder,cache,network,sources:{prepareOffline:async()=>{calls++;}}});t.after(()=>tasks.close());await tasks.load();await tasks.invoke({action:'prepare',tracks:[song('waiting')]});assert.equal(tasks.state().tasks[0].status,'waiting');assert.equal(calls,0);
});
test('pause cancels its own download and preserves completed items for resume', async t => {
  const {folder,cache}=await setup(t);let started;const ready=new Promise(resolve=>{started=resolve;});let resumes=false;
  const sources={prepareOffline:async(track,quality,signal)=>{if(!resumes){started();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));}await cache.prepare(track.id,quality,response,signal);}};
  const tasks=new OfflineTasks({folder,sources,cache});t.after(()=>tasks.close());await tasks.load();await tasks.invoke({action:'prepare',tracks:[song('pause')]});await ready;
  const id=tasks.state().tasks[0].id;await tasks.invoke({action:'pause',id});await settled(tasks);assert.equal(tasks.state().tasks[0].status,'paused');assert.equal(tasks.state().tasks[0].items[0].status,'pending');
  resumes=true;await tasks.invoke({action:'resume',id});await settled(tasks);assert.equal(tasks.state().tasks[0].status,'complete');
});
test('corrupt task state remains read-only and is never overwritten with an empty queue', async t => {
  const {folder,cache}=await setup(t);const file=path.join(folder,'offline-tasks.json');await fs.writeFile(file,'broken');
  const tasks=new OfflineTasks({folder,cache,sources:{}});t.after(()=>tasks.close());assert((await tasks.load()).error);await assert.rejects(tasks.invoke({action:'prepare',tracks:[song('one')]}),/无法读取/);assert.equal(await fs.readFile(file,'utf8'),'broken');
});
test('corrupt cache index preserves every original byte and disables writes without blocking audio consumption', async t => {
  const {folder,cache}=await setup(t);await cache.pin('fixed','high','通勤');await cache.prepare('fixed','high',response);
  const file=cache.file(cache.key('fixed','high'));const original=await fs.readFile(file);const index='{"entries":broken';await fs.writeFile(cache.indexFile,index);
  const reopened=new AudioCache(folder);const state=await reopened.load();assert.equal(state.writable,false);assert.match(state.error,/已保留/);
  assert.equal(await reopened.find('fixed','high'),null);
  assert.deepEqual(Buffer.from(await new Response(reopened.captureResponse('online','high',response(),()=>assert.fail('background network'))).arrayBuffer()),bytes);
  reopened.schedule('online','high',()=>assert.fail('read-only cache may not schedule traffic'));
  for(const mutate of [()=>reopened.clear(),()=>reopened.configure({enabled:false}),()=>reopened.pin('new','high'),()=>reopened.prepare('new','high',response),()=>reopened.discard('fixed','high')])await assert.rejects(mutate(),/缓存索引/);
  assert.equal(await fs.readFile(cache.indexFile,'utf8'),index);assert.deepEqual(await fs.readFile(file),original);
  await fs.writeFile(cache.indexFile,'{}');const malformed=new AudioCache(folder);assert.equal((await malformed.load()).writable,false);assert.deepEqual(await fs.readFile(file),original);
  await fs.rm(cache.indexFile);const missing=new AudioCache(folder);assert.equal((await missing.load()).writable,false);assert.deepEqual(await fs.readFile(file),original);await assert.rejects(fs.stat(cache.indexFile),{code:'ENOENT'});
});
test('task persistence failure stops work, leaves prior file intact and exposes a real diagnostic', async t => {
  const {folder,cache}=await setup(t);let calls=0;const tasks=new OfflineTasks({folder,cache,sources:{prepareOffline:async()=>{calls++;}}});t.after(()=>tasks.close());await tasks.load();await tasks.save();const old=await fs.readFile(tasks.file,'utf8');
  const rename=fs.rename;fs.rename=async(from,to)=>{if(to===tasks.file)throw Object.assign(Error('fixture disk write failure'),{code:'EIO'});return rename(from,to);};
  try{await assert.rejects(tasks.invoke({action:'prepare',tracks:[song('one')]}),/无法保存/);assert(tasks.state().error);assert.equal(tasks.active,undefined);assert.equal(calls,0);await assert.rejects(tasks.invoke({action:'policy',policy:{preload:'never'}}),/无法保存/);assert.equal(await fs.readFile(tasks.file,'utf8'),old);}finally{fs.rename=rename;}
});
test('cache clear waits for its cancelled writer and gates new tasks without auto-resuming paused work', async t => {
  const {folder,cache}=await setup(t);let started;const ready=new Promise(resolve=>{started=resolve;});let exited=false;
  const tasks=new OfflineTasks({folder,cache,sources:{prepareOffline:async(track,quality,signal)=>{started();await new Promise(resolve=>signal.addEventListener('abort',()=>setTimeout(()=>{exited=true;resolve();},20),{once:true}));signal.throwIfAborted();}}});t.after(()=>tasks.close());await tasks.load();await tasks.invoke({action:'prepare',tracks:[song('one')]});await ready;
  const drain=tasks.pauseForCacheClear();assert(tasks.state().clearing);await assert.rejects(tasks.invoke({action:'prepare',tracks:[song('two')]}),/正在清理/);await assert.rejects(tasks.invoke({action:'resume',id:tasks.state().tasks[0].id}),/正在清理/);await drain;assert(exited);assert.equal(tasks.active,undefined);assert.equal(tasks.state().tasks[0].status,'paused');tasks.endCacheClear();assert.equal(tasks.state().clearing,false);assert.equal(tasks.active,undefined);assert.equal(tasks.state().tasks[0].status,'paused');
});
test('failed network-policy persistence keeps the previously applied policy', async t => {
  const {folder,cache}=await setup(t);const tasks=new OfflineTasks({folder,cache,sources:{}});t.after(()=>tasks.close());await tasks.load();await tasks.save();const original=await fs.readFile(tasks.file,'utf8'),rename=fs.rename;
  fs.rename=async(from,to)=>{if(to===tasks.file)throw Error('fixture disk failure');return rename(from,to);};
  try{await assert.rejects(tasks.invoke({action:'policy',policy:{audio:'never'}}),/无法保存/);assert.equal(tasks.state().policy.audio,'always');assert.equal(await fs.readFile(tasks.file,'utf8'),original);}finally{fs.rename=rename;}
});
test('ordinary streaming cache commit and clear are serialized while audio consumption continues', async t => {
  const {cache}=await setup(t),target=cache.file(cache.key('old-commit','high'));let began,release;const entered=new Promise(resolve=>{began=resolve;}),rename=fs.rename;
  fs.rename=async(from,to)=>{if(to===target){began();await new Promise(resolve=>{release=resolve;});}return rename(from,to);};
  try{
    const playback=new Response(cache.captureResponse('old-commit','high',response(),()=>assert.fail('no extra download'))).arrayBuffer();await entered;
    const clearing=cache.clear();assert(cache.clearing);assert.deepEqual(Buffer.from(await new Response(cache.captureResponse('during-clear','high',response(),()=>assert.fail('no background during clear'))).arrayBuffer()),bytes);
    await assert.rejects(cache.prepare('during-clear','high',response),/正在清理/);release();assert.deepEqual(Buffer.from(await playback),bytes);await clearing;assert.equal(cache.entries.size,0);assert.equal((await fs.readdir(cache.folder)).filter(name=>name.endsWith('.bin')).length,0);
    await new Response(cache.captureResponse('after-clear','high',response(),()=>assert.fail('no duplicate'))).arrayBuffer();assert(await cache.find('after-clear','high'));
  }finally{fs.rename=rename;release?.();}
});
