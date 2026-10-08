const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),ts=require('typescript');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {createBundle,decodeBundle,restoreTracks,MAX_BYTES}=require('../electron/playlist-format.cjs');
const {PersonalStore}=require('../electron/personal.cjs');
const {PlaylistLan,seal,unseal,privateAddress}=require('../electron/runtime/playlist-lan.cjs');
const {ListeningStore}=require('../electron/runtime/listening-store.cjs');
const {ListeningTracker}=require('../src/core/listeningTracker.ts');
const {Companion}=require('../electron/runtime/companion.cjs');
const song={id:'source:fixture:1',source:'custom',remoteId:'catalog-fixture-1',providerId:'fixture-source',title:'星空 / Fixture',artist:'合成测试',album:'测试专辑',duration:90,path:'C:\\private\\music.wav',audioUrl:'https://example.com/audio?secret=fixture-secret',coverUrl:'file:///private',headers:{Authorization:'fixture-secret'}};
const bundle=()=>createBundle([{name:'测试歌单',tracks:[song,{...song,id:'local-fixture',source:'local',title:'本地 Fixture'}]}]);
async function temporary(t){const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'zenix-companion-'));t.after(()=>fsp.rm(folder,{recursive:true,force:true}));return folder;}
test('playlist file exchange preserves order and identifiers, strips private fields, rejects invalid/oversize input',()=>{
  const text=JSON.stringify(bundle());assert(!text.includes('fixture-secret'));assert(!text.includes('private'));assert(!text.includes('audioUrl'));assert.equal(decodeBundle(text).playlists[0].tracks[0].remoteId,song.remoteId);
  for(const value of ['{}','not-json',JSON.stringify({format:'zenix-playlist',schemaVersion:2,playlists:[]})])assert.throws(()=>decodeBundle(value));assert.throws(()=>decodeBundle('x'.repeat(MAX_BYTES+1)));
  assert.throws(()=>createBundle([{name:'测试',tracks:Array(5001).fill(song)}]));
  const local={...song,id:'my-local',source:'local',title:'本地 Fixture',audioUrl:'local://fixture'};const restored=restoreTracks(bundle(),[local]);assert.equal(restored[0].tracks[1].id,'my-local');assert.equal(restoreTracks(bundle(),[])[0].tracks[1].availability,'unavailable');
});
test('playlist import persists independent IDs and avoids overwriting names, originals and favorite/history data',async t=>{
  const folder=await temporary(t),store=new PersonalStore(folder);await store.load();await store.createPlaylist('测试歌单',song);await store.toggle('liked',song);
  const original=store.snapshot();await store.importPlaylists(restoreTracks(bundle(),[]));await store.importPlaylists(restoreTracks(bundle(),[]));const next=store.snapshot();assert.equal(next.playlists.length,3);assert.deepEqual(next.liked,original.liked);assert.deepEqual(next.playlists[0],original.playlists[0]);assert.equal(new Set(next.playlists.map(list=>list.id)).size,3);assert.equal(new Set(next.playlists.map(list=>list.name)).size,3);
  const reopened=new PersonalStore(folder);await reopened.load();assert.equal(reopened.snapshot().playlists.length,3);
});
test('real LAN HTTP exchange: encrypted payload, wrong pairing rejected, receiver closes after one transfer',async t=>{
  let received;const receiver=new PlaylistLan(value=>{received=value;});t.after(()=>receiver.stop());const state=await receiver.start(),port=receiver.server.address().port;
  const sender=new PlaylistLan(()=>{});assert(!privateAddress('8.8.8.8'));assert(!privateAddress('169.254.169.254'));assert(privateAddress('192.168.1.1'));
  await assert.rejects(sender.send(`127.0.0.1:${port}`,'ffffffffffffffff',bundle()));assert.equal(received,undefined);await sender.send(`127.0.0.1:${port}`,state.code,bundle());assert.deepEqual(received,bundle());
  await new Promise(resolve=>setImmediate(resolve));assert.equal(receiver.status().listening,false);const wire=seal(JSON.stringify(bundle()),state.code);assert(!wire.includes('测试歌单'));assert.deepEqual(JSON.parse(unseal(wire,state.code)),bundle());assert.throws(()=>unseal(wire,'0000000000000000'));await assert.rejects(sender.send('8.8.8.8:80',state.code,bundle()));
});
test('audible listening clock excludes pause/buffering/seeking, counts once per play and handles repeat',async()=>{
  let clock=0;const written=[];const tracker=new ListeningTracker(async(track,seconds,plays)=>written.push({track,seconds,plays}),()=>clock);
  const tick=seconds=>{for(let i=0;i<seconds;i++){clock+=1000;tracker.tick();}};
  tracker.handle({type:'selected',track:song});tick(5);tracker.handle({type:'audible',track:song});tick(20);tracker.handle({type:'waiting',track:song});tick(40);tracker.handle({type:'audible',track:song});tick(15);tracker.handle({type:'pause',track:song});tick(60);
  assert.equal(written.reduce((n,x)=>n+x.seconds,0),35);assert.equal(written.reduce((n,x)=>n+x.plays,0),1);tracker.handle({type:'ended',track:song});tracker.handle({type:'audible',track:song});tick(35);tracker.close();assert.equal(written.reduce((n,x)=>n+x.plays,0),2);assert.equal(written.reduce((n,x)=>n+x.seconds,0),70);
});
test('listening aggregates actual seconds by local day, persists, and leaves corrupt originals intact',async t=>{
  const folder=await temporary(t),store=new ListeningStore(folder);await store.load();const now=new Date(2026,9,7,12).getTime();await store.record(song,10,0,now);await store.record(song,10,1,now);await store.record({...song,title:'另一首'},5,0,now);
  const stats=await store.query('2026-10-01','2026-10-31');assert.equal(stats.seconds,25);assert.equal(stats.plays,1);assert.equal(stats.uniqueTracks,2);assert.equal(stats.activeDays,1);const reopened=new ListeningStore(folder);await reopened.load();assert.equal((await reopened.query('2026-10-07','2026-10-07')).seconds,25);
  await fsp.writeFile(store.file,'broken-fixture');const broken=new ListeningStore(folder);await broken.load();await assert.rejects(broken.record(song,10,1));assert.equal(await fsp.readFile(store.file,'utf8'),'broken-fixture');
});
test('sleep timer replacement and cancellation: only final task pauses, state is cleared and app stays alive',async t=>{
  const {mock}=t;mock.timers.enable({apis:['setTimeout','Date']});const messages=[];const companion=new Companion({folder:await temporary(t),personal:{},library:{},dialog:{},broadcast:(channel,value)=>messages.push([channel,value])});t.after(()=>companion.stop());
  await companion.invoke({operation:'timerSet',minutes:1});mock.timers.tick(30000);await companion.invoke({operation:'timerSet',minutes:2});mock.timers.tick(60000);assert.equal(messages.length,0);await companion.invoke({operation:'timerCancel'});mock.timers.tick(200000);assert.equal(messages.length,0);
  await companion.invoke({operation:'timerSet',minutes:1});mock.timers.tick(60000);assert.deepEqual(messages,[['media:command','pause']]);assert.equal((await companion.invoke({operation:'timerState'})).endsAt,0);await assert.rejects(companion.invoke({operation:'timerSet',minutes:0}));
});
test('production Android/Node codec and AES-GCM exchange over real TCP in both directions',async t=>{
  const folder=await temporary(t),home=process.env.JAVA_HOME||(fs.existsSync('C:/Program Files/Android/Android Studio/jbr')?'C:/Program Files/Android/Android Studio/jbr':''),bin=name=>home?path.join(home,'bin',name+(process.platform==='win32'?'.exe':'')):name;
  const localJar=path.join(os.homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517/d67181bbd819ccceb929b580a4e2fcb0c8b17cd8/json-20250517.jar');const jar=fs.existsSync(localJar)?localJar:path.join(folder,'json.jar');
  if(!fs.existsSync(jar)){const response=await fetch('https://repo.maven.apache.org/maven2/org/json/json/20250517/json-20250517.jar');if(!response.ok)throw Error('JVM JSON test dependency unavailable');await fsp.writeFile(jar,Buffer.from(await response.arrayBuffer()));}
  const javaRoot=path.resolve(__dirname,'../android/app/src/main/java/com/zenix/musicplayer');await promisify(execFile)(bin('javac'),['-cp',jar,'-d',folder,...['Json.java','PlaylistExchange.java','PlaylistLan.java'].map(name=>path.join(javaRoot,name)),path.join(__dirname,'fixtures/PlaylistContractCheck.java')],{timeout:30000,windowsHide:true});
  let received;const receiver=new PlaylistLan(value=>{received=value;});t.after(()=>receiver.stop());const state=await receiver.start(),port=receiver.server.address().port;const wire=path.join(folder,'wire.json');await fsp.writeFile(wire,seal(JSON.stringify(bundle()),state.code));
  const child=spawn(bin('java'),['-cp',folder+path.delimiter+jar,'com.zenix.musicplayer.PlaylistContractCheck',wire,state.code,`127.0.0.1:${port}`],{windowsHide:true});t.after(()=>child.kill());let stdout='',stderr='';child.stderr.on('data',data=>stderr+=data);const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(stderr||stdout)));});
  const ready=new Promise((resolve,reject)=>{child.stdout.on('data',data=>{stdout+=data;const match=/READY (\d+) ([0-9a-f]{16})/.exec(stdout);if(match)resolve(match);});child.on('exit',()=>{if(!/READY/.test(stdout))reject(Error(stderr||stdout));});});
  const match=await ready;await new PlaylistLan(()=>{}).send(`127.0.0.1:${match[1]}`,match[2],bundle());await done;assert.deepEqual(received,bundle());assert.match(stdout,/PLAYLIST_CONTRACT_PASS/);
});

test('real Electron UI: file import/export, timer cancellation, memory PNG, responsive layouts and native music window',{skip:process.platform!=='win32'?'Electron fixture runs on Windows':false},async t=>{
  const folder=await temporary(t);const {createServer}=await import('vite');const httpServer=require('node:http').createServer();const server=await createServer({cacheDir:path.join(folder,'vite-cache'),optimizeDeps:{entries:['scripts/fixtures/companion-ui.html']},server:{middlewareMode:true,hmr:{server:httpServer}},logLevel:'error'});httpServer.on('request',server.middlewares);await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));t.after(async()=>{await server.close();await new Promise(resolve=>httpServer.close(resolve));});const env={...process.env,ZENIX_TEST_USER_DATA:folder,ZENIX_TEST_UI_URL:`http://127.0.0.1:${httpServer.address().port}/scripts/fixtures/companion-ui.html`};delete env.ELECTRON_RUN_AS_NODE;
  const {stdout,stderr}=await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/ElectronCompanionUi.cjs')],{env,timeout:45000,windowsHide:true});assert.match(stdout,/COMPANION_UI_PASS/,stderr);
  const output=path.resolve(__dirname,'../release/regression');await fsp.mkdir(output,{recursive:true});for(const name of ['playlist-transfer.png','music-memories.png','desktop-music-widget.png'])await fsp.copyFile(path.join(folder,name),path.join(output,name));
});
