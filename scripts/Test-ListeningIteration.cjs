const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {RemoteControl}=require('../electron/runtime/remote-control.cjs');
const {DesktopControls,validateShortcuts}=require('../electron/runtime/desktop-controls.cjs');
const {DesktopTray}=require('../electron/runtime/desktop-tray.cjs');
const {PersonalStore}=require('../electron/personal.cjs');

test('LAN remote requires a correct code and explicit host approval, revokes sessions and rejects web-origin/host spoofing',async t=>{
  const commands=[],remote=new RemoteControl((...command)=>commands.push(command));t.after(()=>remote.stop());await remote.start();
  const url=`http://127.0.0.1:${remote.port}`,post=async(body,headers={})=>new Promise((resolve,reject)=>{const request=require('node:http').request(url+'/api',{method:'POST',headers:{'Content-Type':'application/json',...headers}},response=>{let raw='';response.on('data',chunk=>raw+=chunk);response.on('end',()=>resolve({status:response.statusCode,json:async()=>JSON.parse(raw)}));});request.on('error',reject);request.end(JSON.stringify(body));});
  assert.equal((await post({action:'pair',code:'incorrect'})).status,400);
  const pair=await (await post({action:'pair',code:remote.status().code})).json();
  assert.equal((await post({action:'next',token:pair.token})).status,400);assert.equal(commands.length,0);
  assert.equal((await (await post({action:'pairStatus',token:pair.token})).json()).approved,false);
  remote.approve(pair.token,true);remote.update({title:'Fixture',artist:'Artist',duration:120,position:35,volume:.7,playing:true,headers:'SECRET',url:'PRIVATE'});
  const status=await(await post({action:'status',token:pair.token})).json();assert.deepEqual(status,{title:'Fixture',artist:'Artist',playing:true,duration:120,position:35,volume:.7});
  assert.equal((await post({action:'next',token:pair.token},{Origin:'https://untrusted.example'})).status,400);
  assert.equal((await post({action:'next',token:pair.token},{Host:`untrusted.example:${remote.port}`})).status,400);
  assert.equal((await post({action:'seek',token:pair.token,seconds:999})).status,400);assert.equal(commands.length,0);
  assert.equal((await post({action:'seek',token:pair.token,seconds:40})).status,200);assert.deepEqual(commands,[['seek',40]]);
  await post({action:'disconnect',token:pair.token});assert.equal((await post({action:'next',token:pair.token})).status,400);
  const html=await(await fetch(url)).text();assert(html.includes('nonce="'));assert(!html.includes('__NONCE__'));assert(!html.includes(pair.token));
});

test('shortcut save is transactional, reports collisions and does not overwrite damaged configuration',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-controls-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const registered=new Map(),commands=[];const globalShortcut={register(key,handler){if(key==='Control+Alt+Q')return false;registered.set(key,handler);return true;},unregister(key){registered.delete(key);}};
  const controls=new DesktopControls({folder,globalShortcut,command:action=>commands.push(action),show(){}});t.after(()=>controls.stop());
  await controls.invoke({operation:'shortcutsSave',shortcuts:[{action:'next',key:'Control+Alt+N',scope:'global'}]});registered.get('Control+Alt+N')();assert.deepEqual(commands,['next']);
  await assert.rejects(controls.invoke({operation:'shortcutsSave',shortcuts:[{action:'previous',key:'Control+Alt+P',scope:'global'},{action:'next',key:'Control+Alt+Q',scope:'global'}]}),/占用/);
  assert(registered.has('Control+Alt+N'));assert(!registered.has('Control+Alt+P'));
  const persisted=JSON.parse(await fs.readFile(path.join(folder,'desktop-controls.json'),'utf8'));assert.equal(persisted.shortcuts[0].action,'next');
  await controls.invoke({operation:'shortcutsSave',shortcuts:[{action:'previous',key:'Control+Alt+N',scope:'global'}]});registered.get('Control+Alt+N')();assert.equal(commands.at(-1),'previous','reassigning an existing accelerator updates its handler');
  assert.throws(()=>validateShortcuts([{action:'next',key:'Control+K',scope:'global'}]),/保留/);
  assert.throws(()=>validateShortcuts([{action:'next',key:'Control+N'},{action:'previous',key:'Control+N'}]),/冲突/);
  controls.stop();assert.equal(registered.size,0);
  await fs.writeFile(path.join(folder,'desktop-controls.json'),'broken');const broken=new DesktopControls({folder,globalShortcut,command(){},show(){}});t.after(()=>broken.stop());await assert.rejects(broken.invoke({operation:'shortcutsSave',shortcuts:[]}),/保留原文件/);assert.equal(await fs.readFile(path.join(folder,'desktop-controls.json'),'utf8'),'broken');
});

test('close hides the desktop player without quitting; explicit exit and system quit can close it',()=>{
  const app=new EventEmitter();app.quit=()=>app.emit('before-quit');let menu,hidden=0,prevented=0;
  class Tray extends EventEmitter{setToolTip(){}setContextMenu(value){menu=value;}isDestroyed(){return false;}destroy(){}}
  const tray=new DesktopTray({app,Tray,Menu:{buildFromTemplate:value=>value},show(){},command(){},icon:'fixture'});
  tray.close({preventDefault(){prevented++;}},{hide(){hidden++;}});assert.equal(hidden,1);assert.equal(prevented,1);
  menu.find(item=>item.label==='退出 Zenix').click();tray.close({preventDefault(){prevented++;}},{hide(){hidden++;}});assert.equal(hidden,1);assert.equal(prevented,1);
});

test('playlist batch moves persist both lists together, preserve unrelated data and reject stale selections',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-playlist-batch-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const store=new PersonalStore(folder);await store.load();const song=id=>({id,title:id,artist:'Artist',duration:90,path:'',audioUrl:'',source:'custom',providerId:'fixture',remoteId:id});
  await store.createPlaylist('A',song('one'));await store.createPlaylist('B');await store.toggle('liked',song('liked'));const before=store.snapshot(),a=before.playlists[0].id,b=before.playlists[1].id;
  await store.batch({id:a,target:b,edit:'move',ids:['one'],expected:['one']});const persisted=await new PersonalStore(folder).load();assert.equal(persisted.playlists[0].tracks.length,0);assert.equal(persisted.playlists[1].tracks[0].id,'one');assert.equal(persisted.liked[0].id,'liked');
  await assert.rejects(store.batch({id:a,target:b,edit:'move',ids:['one'],expected:['one']}),/已变化/);assert.deepEqual(store.snapshot(),persisted);
  const save=store.save;store.save=async()=>{throw Error('disk full');};await assert.rejects(store.batch({id:b,edit:'remove',ids:['one'],expected:['one']}),/disk full/);store.save=save;assert.deepEqual(store.snapshot(),persisted);
});

test('equalized audio follows the chosen output device and bypass restores unity gain',async()=>{
  const vm=require('node:vm'),ts=require('typescript'),contexts=[],exports={};
  const parameter=()=>({value:0,setTargetAtTime(value){this.value=value;}});
  class Context {
    constructor(){contexts.push(this);this.currentTime=0;this.destination={};this.nodes=[];}
    async setSinkId(value){if(value==='missing')throw Error('device missing');this.output=value;}
    node(extra={}){const node={connect:target=>{node.connected=target;},...extra};this.nodes.push(node);return node;}
    createMediaElementSource(){return this.node();}
    createBiquadFilter(){return this.node({frequency:parameter(),Q:parameter(),gain:parameter()});}
    createGain(){return this.node({gain:parameter()});}
    async resume(){}async close(){this.closed=true;}
  }
  const source=ts.transpileModule(await fs.readFile(path.resolve(__dirname,'../src/core/audioSettings.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,AudioContext:Context});
  const graph=new exports.AudioGraph({}),settings={...exports.defaultAudioSettings,enabled:true,output:'headphones',gains:[4,0,0,0,0,0,0,0,0,0]};
  await graph.apply(settings);assert.equal(contexts.length,1);assert.equal(contexts[0].output,'headphones');assert(contexts[0].nodes.at(-1).gain.value<1,'positive EQ has headroom');
  await graph.apply({...settings,enabled:false,output:'speakers'});assert.equal(contexts[0].output,'speakers');assert.equal(contexts[0].nodes.at(-1).gain.value,1,'bypass must not keep attenuation');
  await assert.rejects(graph.apply({...settings,output:'missing'}),/device missing/);assert.equal(contexts[0].output,'speakers');graph.close();assert(contexts[0].closed);
});
