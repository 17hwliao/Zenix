const test=require('node:test'),assert=require('node:assert/strict');
const {RemoteControl}=require('../electron/runtime/remote-control.cjs');
const {Collaboration,payload}=require('../electron/runtime/collaboration.cjs');
const skin=require('../src/features/assistant/skin-model.cjs');
const song={id:'one',title:'像风一样',artist:'歌手',duration:200,source:'custom',providerId:'source',remoteId:'one',audioUrl:'https://private.test?token=secret',path:'C:/private/music',headers:{Authorization:'secret'}};
test('collaboration uses separate grants, real HTTP inbox, explicit receipts and revocation',async t=>{
  const commands=[],remote=new RemoteControl((...args)=>commands.push(args));t.after(()=>remote.stop());await remote.start();
  const post=body=>new Promise((resolve,reject)=>{const request=require('node:http').request({host:'127.0.0.1',port:remote.port,path:'/api',method:'POST',headers:{'Content-Type':'application/json'}},response=>{let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode,text,value:()=>JSON.parse(text)}));});request.on('error',reject);request.end(JSON.stringify(body));});
  const pair=(await post({action:'pair',code:remote.status().code})).value(),token=pair.token;remote.approve(token,true);
  const request=extra=>post({action:'collaboration',token,request:extra});
  assert.equal((await request({action:'send',payload:{kind:'submission',track:song}})).status,400);
  remote.collaborate({action:'permissions',id:token,permissions:{submission:true}});
  const submitted=(await request({action:'send',payload:{kind:'submission',track:song}})).value();assert.equal(submitted.status,'pending');assert.equal(commands.length,0,'submission cannot trigger media commands');
  const state=remote.collaborate({action:'state'});assert.equal(state.tickets[0].payload.track.audioUrl,'');assert(!JSON.stringify(state).includes('secret'));assert(!JSON.stringify(state).includes('C:/private'));
  assert.equal((await request({action:'ack',id:submitted.id,accepted:true})).status,400,'sender cannot self-approve');
  remote.collaborate({action:'ack',id:submitted.id,accepted:true});assert.equal((await request({action:'state'})).value().tickets[0].status,'accepted');
  assert.throws(()=>remote.collaborate({action:'ack',id:submitted.id,accepted:true}),/已处理/);
  assert.equal((await request({action:'send',payload:{kind:'handoff',track:song,queue:[song],playing:true,position:42}})).status,400,'submission grant does not grant handoff');
  remote.collaborate({action:'permissions',id:token,permissions:{handoff:true,sync:true}});
  const transfer=remote.collaborate({action:'send',id:token,payload:{kind:'handoff',track:song,queue:[song],playing:true,position:42}});assert.equal(transfer.status,'pending');
  remote.collaborate({action:'permissions',id:token,permissions:{handoff:false,sync:true}});assert.equal((await request({action:'ack',id:transfer.id,accepted:true})).status,400,'revoked grant prevents acceptance');
  assert.equal(commands.length,0,'only receiver playback adapter may start/stop audio');
  await post({action:'disconnect',token});assert.equal((await request({action:'state'})).status,400);
  assert.equal(remote.collaborate({action:'state'}).tickets.length,0,'disconnect releases unconsumed private payloads');
});
test('sync carries selected portable metadata only and rejects unsafe local paths',()=>{
  const value=payload({kind:'sync',sections:['liked','preferences'],personal:{liked:[song],favorites:[song],playlists:[{name:'do not send',tracks:[song]}]},preferences:{version:{mode:'live',headers:{Authorization:'secret'}},roaming:{scope:'saved',password:'secret'}},headers:{Authorization:'secret'}});
  assert.deepEqual(Object.keys(value.personal),['liked']);assert.equal(value.preferences.version.mode,'live');assert.equal(value.preferences.roaming.scope,'saved');assert(!JSON.stringify(value).includes('secret'));assert(!JSON.stringify(value).includes('do not send'));
  assert.throws(()=>payload({kind:'submission',track:{...song,source:'local'}}),/本地文件/);
  assert.throws(()=>payload({kind:'handoff',track:song,queue:Array(501).fill(song)}),/500/);
});
test('collaboration limits pending requests and isolates clients',()=>{
  const clients=new Map([['one',{approved:true,label:'one',permissions:{submission:true}}],['two',{approved:true,label:'two',permissions:{submission:true}}]]),server=new Collaboration(clients);
  for(let n=0;n<8;n++)server.remote('one',{action:'send',payload:{kind:'submission',track:{...song,id:String(n)}}});assert.throws(()=>server.remote('one',{action:'send',payload:{kind:'submission',track:song}}),/过多/);
  const second=server.remote('two',{action:'send',payload:{kind:'submission',track:song}});assert.equal(server.state('two').tickets.length,1);assert.throws(()=>server.remote('one',{action:'cancel',id:second.id}),/已处理/);
  server.local({action:'claim',id:second.id});assert.throws(()=>server.remote('two',{action:'cancel',id:second.id}),/已经开始/);assert.throws(()=>server.local({action:'claim',id:second.id}),/已处理/);server.local({action:'ack',id:second.id,accepted:true});assert.equal(server.state('two').tickets[0].status,'accepted');
});
test('long structured LX references survive real HTTP submission, sync and handoff unchanged',async t=>{
  const remote=new RemoteControl(()=>{});t.after(()=>remote.stop());await remote.start();const post=body=>new Promise((resolve,reject)=>{const request=require('node:http').request({host:'127.0.0.1',port:remote.port,path:'/api',method:'POST',headers:{'Content-Type':'application/json'}},response=>{let text='';response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode,value:()=>JSON.parse(text)}));});request.on('error',reject);request.end(JSON.stringify(body));});
  const pair=(await post({action:'pair',code:remote.status().code})).value();remote.approve(pair.token,true);remote.collaborate({action:'permissions',id:pair.token,permissions:{submission:true,sync:true,handoff:true}});
  const info=JSON.stringify({source:'tx',songmid:'real-song-mid',name:'如果的事',singer:'范玮琪、张韶涵',albumName:'元资料'.repeat(700)}),long={...song,id:'lx:'+('x'.repeat(700)),remoteId:info};
  for(const item of [{kind:'submission',track:long},{kind:'handoff',track:long,queue:[long],position:42,playing:true},{kind:'sync',sections:['playlists'],personal:{playlists:[{name:'296首歌单',tracks:[long]}]}}]){const result=await post({action:'collaboration',token:pair.token,request:{action:'send',payload:item}});assert.equal(result.status,200);const received=result.value().payload,row=received.kind==='sync'?received.personal.playlists[0].tracks[0]:received.track;assert.equal(row.remoteId,info);assert.equal(row.id,long.id);assert.equal(JSON.parse(row.remoteId).songmid,'real-song-mid');}
  assert.throws(()=>payload({kind:'submission',track:{...song,remoteId:'x'.repeat(20001)}}),/过长/);
});
function png(w=180,h=180){const bytes=new Uint8Array(33);bytes.set([137,80,78,71,13,10,26,10]);const view=new DataView(bytes.buffer);view.setUint32(16,w);view.setUint32(20,h);return bytes;}
test('skin declaration validates PNG dimensions, archive paths and action fallback without executing skin code',()=>{
  const input={schema:1,name:'原创',width:180,height:180,frames:['frames/idle.png'],animations:{idle:{frames:[0],fps:12}}};const clean=skin.clean(input,{'frames/idle.png':png()});assert.equal(clean.animations.failure.frames[0],0);assert.equal(clean.name,'原创');assert(!('script'in clean));
  assert.throws(()=>skin.clean({...input,frames:['../attack.js']},{'../attack.js':png()}),/PNG/);
  assert.throws(()=>skin.clean(input,{'frames/idle.png':png(2048,2048)}),/尺寸/);
  assert.throws(()=>skin.clean({...input,animations:{idle:{frames:[99],fps:12}}},{'frames/idle.png':png()}),/索引/);
  assert.throws(()=>skin.clean({...input,hit:[0,0,300,180]},{'frames/idle.png':png()}),/区域/);
  assert.throws(()=>skin.clean({...input,width:2048,height:2048,frames:Array(5).fill('frames/idle.png')},{'frames/idle.png':png(2048,2048)}),/像素/);
  assert.deepEqual(skin.parse('搜索 像风一样'),{action:'search',args:{query:'像风一样'}});assert.equal(skin.parse('运行脚本 rm -rf'),null);assert.equal(skin.parse('删除所有用户资料'),null);assert.equal(skin.parse('下一首').action,'next');
});
test('assistant skin persistence is atomic, survives reopen and limits desktop-pet commands by sender',async t=>{
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-assistant-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const filename=path.resolve(__dirname,'../electron/runtime/assistant.cjs'),runtimeRequire=require('node:module').createRequire(filename),module={exports:{}};
  const production=await fs.readFile(filename,'utf8');const protection={encodeProtected:async value=>JSON.stringify({testProtected:value}),decodeProtected:async text=>({value:JSON.parse(text).testProtected})};
  vm.runInNewContext(production,{module,exports:module.exports,require:name=>name==='./protected-json.cjs'?protection:runtimeRequire(name),__dirname:path.dirname(filename),Buffer,Uint8Array,console});const{Assistant}=module.exports;
  const handlers=new Map(),commands=[],service=new Assistant({folder,dialog:{},getWindow:()=>null,execute:async value=>commands.push(value),ipcMain:{handle:(name,handler)=>handlers.set(name,handler)}});await service.load();
  const config={schema:1,width:180,height:180,name:'test',frames:['frames/idle.png'],animations:{idle:{frames:[0],fps:12}}},args={action:'skinSave',base64:'UEsDBA==',config,images:{'frames/idle.png':Buffer.from(png()).toString('base64')}};
  await service.invoke(args);const reopened=new Assistant({folder,dialog:{},getWindow:()=>null,execute:async()=>{}});await reopened.load();assert.equal((await reopened.invoke({action:'state'})).skin.archive,args.base64);
  service.window={webContents:{},isDestroyed:()=>false,close(){}};assert.throws(()=>handlers.get('assistant:pet-drag')({sender:{}},{phase:'start',token:'test'}),/无权/);const handler=handlers.get('assistant:pet-action');await assert.rejects(handler({sender:{}},{action:'next'}),/无权/);await assert.rejects(handler({sender:service.window.webContents},{action:'delete-all'}),/无效/);await handler({sender:service.window.webContents},{action:'next'});assert.deepEqual(commands,['next']);service.window=null;
  const before=await fs.readFile(service.file,'utf8');await assert.rejects(service.invoke({...args,config:{...config,frames:['../attack.js']}}),/PNG/);assert.equal(await fs.readFile(service.file,'utf8'),before);
  await fs.writeFile(service.file,'broken');const broken=new Assistant({folder,dialog:{},getWindow:()=>null});await broken.load();await assert.rejects(broken.invoke(args),/保留/);assert.equal(await fs.readFile(service.file,'utf8'),'broken');
});
test('handoff receipt polling outlives the panel and pauses only after an accepted receipt',async()=>{
  const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),exports={},scheduled=[],events=[],paused=[];let requests=0,status='pending';
  const source=ts.transpileModule(await fs.readFile(path.resolve(__dirname,'../src/features/connections/handoffCoordinator.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,setTimeout:callback=>{scheduled.push(callback);return callback;},clearTimeout:callback=>{const index=scheduled.indexOf(callback);if(index>=0)scheduled.splice(index,1);},window:{dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,args){Object.assign(this,{type,...args});}}});
  const invoke=async()=>{requests++;return {tickets:[{id:'receipt',status}]};},expected={id:'song',selection:7};exports.followHandoff(invoke,'receipt',expected,async value=>paused.push(value));exports.followHandoff(invoke,'receipt',expected,async value=>paused.push(value));await new Promise(setImmediate);assert.equal(requests,1);assert.equal(paused.length,0);status='processing';scheduled.shift()();await new Promise(setImmediate);assert.equal(paused.length,0);status='accepted';scheduled.shift()();await new Promise(setImmediate);assert.equal(paused.length,1);assert.equal(paused[0].selection,7);assert.equal(scheduled.length,0);assert.equal(events.length,1);
});
test('actual isolated Electron pet renders the original character and follows playback, motion and visibility',async t=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{promisify}=require('node:util'),{execFile}=require('node:child_process');const profile=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-pet-window-'));t.after(()=>fs.rm(profile,{recursive:true,force:true}));const env={...process.env,ZENIX_PET_TEST_PROFILE:profile};delete env.ELECTRON_RUN_AS_NODE;const result=await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/ElectronAssistantPet.cjs')],{env,timeout:20000,windowsHide:true});assert.match(result.stdout,/ASSISTANT_PET_PASS/);
});
