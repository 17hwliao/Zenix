const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const load=require('./fixtures/load-assistant-ts.cjs');
const {createBusinessAdapter}=load(path.resolve(__dirname,'../src/features/assistant/remote/business.ts'));
const song=n=>({id:'s'+n,title:'歌曲'+n,artist:'同名歌手',album:'专辑'+n,duration:180,path:'C:/private/'+n,audioUrl:'https://private/audio?secret=hidden',source:'custom'});
function fixture(platform='pc'){
 let personal={liked:[],favorites:[],history:[{track:song(3),playedAt:3},{track:song(2),playedAt:2}],playlists:[{id:'p',name:'歌单',tracks:[song(1),song(2)]}]};
 let playback={track:song(1),queue:[song(1),song(2),song(3)],queueIndex:0,playing:false,position:12,volume:.5,shuffle:true,repeat:'all'};
 const calls=[];let selected=[song(2)],failAdd=false,device=null;
 const host={snapshot:async()=>({personal,playback,context:{playlistId:'p'},sources:[{enabled:true,manifest:{capabilities:['search']}}]}),selection:async()=>selected,
  search:async()=>[song(4),song(5)],control:async(action,args)=>{calls.push(action);if(action==='volume')playback.volume=args.value;},play:async track=>{calls.push(track.id);playback={...playback,track,playing:false,sourceActivity:{phase:'resolving'}};},
  create:async(name,track)=>{calls.push('create');personal.playlists.push({id:'new',name,tracks:track?[track]:[]});return structuredClone(personal);},
  add:async(id,track)=>{if(failAdd)throw Error('disk failed');calls.push('add');personal.playlists.find(p=>p.id===id).tracks.push(track);return structuredClone(personal);},
  remove:async(id,ids)=>{calls.push('remove');const list=personal.playlists.find(p=>p.id===id);list.tracks=list.tracks.filter(s=>!ids.includes(s.id));return structuredClone(personal);},
  collect:async(kind,value,tracks)=>{calls.push('collect');personal[kind]=value?tracks:[];return structuredClone(personal);},lyrics:async()=>({text:'[00:00]第一句\n[00:10]第二句\n[00:20]第三句',format:'lrc',source:'custom'}),configureLyrics:async()=>calls.push('lyrics'),navigate:async(page)=>calls.push(page),
  invoke:async args=>{calls.push(args);if(args.operation==='offlineTasks')return {tasks:[{id:'task',name:'歌单',status:'queued',items:[{status:'pending'}]}]};if(args.operation==='stats')return {seconds:60,plays:1,uniqueTracks:1,topTracks:[]};if(args.operation==='exportFile')return false;return {status:'up-to-date',message:'最新'};},device:async()=>device,transfer:async()=>({id:'ticket'}),roaming:async()=>calls.push('roaming')};
 const objects=new Map();let next=0;const controller=new AbortController();
 const ctx={requestId:'request',operationId:'operation',signal:controller.signal,refs:{issue(kind,value){const key='opaque-'+(++next);objects.set(key,{kind,value});return key;},resolve(ref,kind){const row=objects.get(ref);if(!row||row.kind!==kind)throw Error('引用已失效');return row.value;},invalidate(kind){for(const [key,row]of objects)if(!kind||row.kind===kind)objects.delete(key);}}};
 return {adapter:createBusinessAdapter(platform,host),ctx,calls,host,personal,playback,controller,ref:(kind,value)=>ctx.refs.issue(kind,value),setCurrent:value=>{playback.track=value;},setAddFailure:()=>{failAdd=true;},setDevice:value=>{device=value;}};
}
test('A: context uses distinct current and selected refs and never exports native paths or audio URLs',async()=>{
 const f=fixture(),value=await f.adapter.readContext(f.ctx);assert.equal(value.data.current.title,'歌曲1');assert.equal(value.data.selected[0].title,'歌曲2');assert.notEqual(value.data.current.ref,value.data.selected[0].ref);assert(!JSON.stringify(value).includes('private'));assert(!JSON.stringify(value).includes('audioUrl'));
 const info=await f.adapter.execute({name:'music.query',args:{scope:'queue',from:-2,to:1}},f.ctx);assert.equal(info.data.songs.length,2);assert.match(info.data.order,/随机/);assert(!JSON.stringify(info).includes('第一句'));
});
test('A: searches create real version candidates, superseded candidate references are rejected',async()=>{
 const f=fixture();const a=await f.adapter.execute({name:'music.search',args:{query:'同名歌曲'}},f.ctx);
 const played=await f.adapter.execute({name:'music.play_result',args:{candidateRef:a.candidates[1].ref}},f.ctx);assert.equal(played.status,'loading_started');assert.deepEqual(f.calls,['s5']);
 await f.adapter.execute({name:'music.search',args:{query:'新搜索'}},f.ctx);await assert.rejects(f.adapter.execute({name:'music.play_result',args:{candidateRef:a.candidates[0].ref}},f.ctx),/失效/);
});

test('A: current lyric follows positive/negative display correction; all metadata excludes lyric bodies',async()=>{
 const f=fixture();let lyricReads=0,offset=5;
 const original=f.host.lyrics;f.host.lyricOffset=id=>{assert.equal(id,'s1');return offset;};f.host.lyrics=async song=>{lyricReads++;return original(song);};
 const query=fields=>f.adapter.execute({name:'music.query',args:{scope:'current',fields}},f.ctx);
 assert.equal((await query(['lyrics'])).data.songs[0].lyrics,'第一句');offset=-10;
 assert.equal((await query(['lyrics'])).data.songs[0].lyrics,'第三句');
 const all=(await query(['all'])).data.songs[0];assert.deepEqual(all.saved,{liked:false,favorites:false});assert.deepEqual(all.progress,{position:12,playing:false});assert.equal(all.coverAvailable,false);assert(!('lyrics'in all));assert.equal(lyricReads,2);
 offset=0;f.host.lyrics=async()=>({text:'[00:00]有界歌词\n'+' '.repeat(120000)+'\n[00:10]超出解析上限',format:'lrc',source:'custom'});
 assert.equal((await query(['lyrics'])).data.songs[0].lyrics,'有界歌词');
});
test('B: create plus current song is a fixed confirmation plan despite subsequent track changes',async()=>{
 const f=fixture(),ref=f.ref('track',structuredClone(song(1)));const plan=await f.adapter.execute({name:'playlist.create',args:{name:'新歌单',trackRefs:[ref]}},f.ctx);assert.equal(f.calls.length,0);f.setCurrent(song(8));const saved=await plan.commit();assert.equal(saved.status,'saved');assert.equal(f.personal.playlists.at(-1).tracks[0].id,'s1');assert.deepEqual(f.calls,['create']);
});
test('B: playlist mutations recheck fixed content before applying and cancellation cannot delete songs',async()=>{
 const f=fixture(),plan=await f.adapter.execute({name:'playlist.remove_tracks',args:{playlistRef:f.ref('playlist',{id:'p'}),trackRefs:[f.ref('track',song(1))]}},f.ctx);
 f.personal.playlists[0].tracks.push(song(3));assert.equal(await plan.validate(),false);await assert.rejects(plan.commit(),/变化/);assert.equal(f.calls.length,0);
 const fresh=await f.adapter.execute({name:'playlist.remove_tracks',args:{playlistRef:f.ref('playlist',{id:'p'}),trackRefs:[f.ref('track',song(1))]}},f.ctx);f.controller.abort();await assert.rejects(fresh.commit());assert.equal(f.calls.length,0);
});
test('B: single collection sets exact state directly, batch waits for confirmation and add failure reports partial creation',async()=>{
 const f=fixture();let value=await f.adapter.execute({name:'collection.set',args:{kind:'liked',value:true,trackRefs:[f.ref('track',song(1))]}},f.ctx);assert.equal(value.status,'saved');
 value=await f.adapter.execute({name:'collection.set',args:{kind:'liked',value:false,trackRefs:[f.ref('track',song(1))]}},f.ctx);assert.equal(value.status,'saved');assert.equal(f.personal.liked.length,0);
 const batch=await f.adapter.execute({name:'collection.set',args:{kind:'favorites',value:true,trackRefs:[f.ref('track',song(1)),f.ref('track',song(2))]}},f.ctx);assert.equal(batch.kind,'confirmation');assert.equal(f.personal.favorites.length,0);
 f.setAddFailure();const create=await f.adapter.execute({name:'playlist.create',args:{name:'部分歌单',trackRefs:[f.ref('track',song(1)),f.ref('track',song(2))]}},f.ctx);assert.equal((await create.commit()).status,'partial');assert.equal(f.personal.playlists.at(-1).tracks.length,1);
});
test('C: cache establishment differs from completion and export cancel is truthful',async()=>{
 const f=fixture(),plan=await f.adapter.execute({name:'cache.prepare',args:{playlistRef:f.ref('playlist',{id:'p'})}},f.ctx);assert.equal(plan.kind,'confirmation');const saved=await plan.commit();assert.equal(saved.status,'task_created');assert.match(saved.message,/尚未/);
 const tasks=await f.adapter.execute({name:'tasks.query',args:{}},f.ctx);assert.equal(tasks.data.tasks[0].complete,0);
 assert.equal((await f.adapter.execute({name:'backup.export_playlists',args:{scope:'all'}},f.ctx)).status,'cancelled');
});
test('C: device tools are platform and live-connection gated; optional collaboration failure leaves basic controls',async()=>{
 const pc=fixture();assert(!(await pc.adapter.capabilities()).includes('device.transfer'));const mobile=fixture('android');assert(!(await mobile.adapter.capabilities()).includes('device.transfer'));
 mobile.setDevice({identity:'peer1',label:'电脑',permissions:{handoff:true,submission:true}});assert((await mobile.adapter.capabilities()).includes('device.transfer'));
 const deviceRef=mobile.ref('device',{identity:'peer1'}),plan=await mobile.adapter.execute({name:'device.transfer',args:{deviceRef,kind:'handoff'}},mobile.ctx);mobile.setDevice({identity:'peer2',label:'另一台',permissions:{handoff:true,submission:true}});assert.equal(await plan.validate(),false);await assert.rejects(plan.commit(),/变化/);
 mobile.host.device=async()=>{throw Error('connection failed');};await mobile.adapter.execute({name:'playback.set_volume',args:{value:.2}},mobile.ctx);assert.equal(mobile.calls.at(-1),'volume');
});
test('all calls reject forged fields even when execute is invoked without coordinator',async()=>{
 const f=fixture();await assert.rejects(f.adapter.execute({name:'playback.control',args:{action:'pause',operation:'arbitrary'}},f.ctx),/未知字段/);assert.equal(f.calls.length,0);
});
test('restart recovery reads pinned object state without replay and plans reject expired references',async()=>{
 const f=fixture(),call={name:'collection.set',args:{kind:'liked',value:true,trackRefs:[f.ref('track',song(1))]}};
 const data=await f.adapter.recovery(call,f.ctx);await f.adapter.execute(call,f.ctx);const count=f.calls.length;
 const recovered=await f.adapter.reconcile({operationId:'old',requestId:'old-request',call,submittedAt:Date.now(),data},f.ctx);assert.equal(recovered.status,'saved');assert.equal(f.calls.length,count);
 const create=await f.adapter.execute({name:'playlist.create',args:{name:'安全恢复',trackRefs:[f.ref('track',song(2))]}},f.ctx);assert(!create.fingerprint.includes('private'));assert(!create.fingerprint.includes('audioUrl'));
 f.ctx.refs.invalidate('track');assert.equal(await create.validate(),false);await assert.rejects(create.commit(),/变化/);
 const unknown=await f.adapter.reconcile({operationId:'x',requestId:'x',call:{name:'playback.control',args:{action:'next'}},submittedAt:Date.now(),data:{tool:'playback.control'}},f.ctx);assert.equal(unknown.status,'unknown');assert.equal(f.calls.length,count);
});

test('default Android host uses the actual library/control routes and explicit native parameter contracts',async t=>{
 const f=defaultFixture(t,'android');
 await f.adapter.execute({name:'playback.set_volume',args:{value:.3}},f.ctx);
 assert.deepEqual(f.nativeCalls.filter(row=>row.action==='volume').map(row=>row.args),[{value:.3}]);
 await f.adapter.execute({name:'playback.set_mode',args:{repeat:'one',shuffle:false}},f.ctx);
 assert.deepEqual(f.nativeCalls.find(row=>row.action==='mode').args,{repeat:'one',shuffle:false});
 const found=await f.adapter.execute({name:'music.search',args:{query:'红豆',limit:1}},f.ctx);
 assert.equal(f.ctx.refs.resolve(found.candidates[0].ref,'candidate').id,'s7');
 assert.deepEqual(f.nativeCalls.find(row=>row.action==='search').args,{id:'source',keyword:'红豆'});
 const context=await f.adapter.readContext(f.ctx,['devices']);assert.equal(context.data.device.label,'已配对电脑');
 const trackRef=f.ctx.refs.issue('track',song(2));
 const plan=await f.adapter.execute({name:'device.transfer',args:{kind:'submission',deviceRef:context.data.device.ref,trackRef}},f.ctx);
 assert.equal((await plan.commit()).status,'task_created');
 assert.deepEqual(f.nativeCalls.find(row=>row.action==='collaboration'&&row.args.action==='send').args,{operation:'collaboration',action:'send',payload:{kind:'submission',track:song(2)}});
});

for(const platform of ['pc','android'])test(`default ${platform} host rehydrates selected local files before create and never exposes paths`,async t=>{
  const f=defaultFixture(t,platform),local={...song(4),source:'local',path:'C:/real/song.flac'};
  f.state.localTracks=[local];f.selected={...local,path:'',audioUrl:''};
  const context=await f.adapter.readContext(f.ctx,['selection']);const ref=context.data.selected[0].ref;
  assert.equal(f.ctx.refs.resolve(ref,'track').path,local.path);assert(!JSON.stringify(context).includes(local.path));
  const create=await f.adapter.execute({name:'playlist.create',args:{name:'本地歌曲',trackRefs:[ref]}},f.ctx);await create.commit();
  assert.equal(f.state.personal.playlists.at(-1).tracks[0].path,local.path);
  f.state.localTracks=[];assert.equal((await f.adapter.readContext(f.ctx,['selection'])).data.selectionStatus,'unavailable');
});

test('default host reports pure-lyrics navigation, overlay permission and partial settings truthfully',async t=>{
 const f=defaultFixture(t,'android');
 assert.equal((await f.adapter.execute({name:'lyrics.configure',args:{pure:true}},f.ctx)).status,'page_opened');
 assert.deepEqual(f.uiCalls.at(-1),{action:'lyrics-mode',args:{pure:true}});
 f.overlayPermitted=false;
 assert.equal((await f.adapter.execute({name:'lyrics.configure',args:{overlay:true}},f.ctx)).status,'needs_input');
 const partial=await f.adapter.execute({name:'lyrics.configure',args:{offsetSeconds:-.5,overlay:true}},f.ctx);
 assert.equal(partial.status,'partial');assert.deepEqual(partial.data.applied,['offsetSeconds']);
 assert(f.nativeCalls.some(row=>row.action==='lyricsConfigure'&&row.args.offset===-.5));
 localStorage.setItem('zenix.lyric.s1',JSON.stringify({offset:5}));f.state.playback.position=12;
 assert.equal((await f.adapter.execute({name:'music.query',args:{scope:'current',fields:['lyrics']}},f.ctx)).data.songs[0].lyrics,'第一句');
 f.state.playback.track=undefined;
 await assert.rejects(f.adapter.execute({name:'lyrics.configure',args:{pure:true}},f.ctx),/选择歌曲/);
});

test('default PC snapshot includes real roaming, and tasks query covers bounded cache/background/playback without leaking details',async t=>{
 const f=defaultFixture(t,'pc');f.roaming.active=true;
 assert.equal((await f.adapter.readContext(f.ctx,['current'])).data.roaming,true);
 const found=await f.adapter.execute({name:'music.search',args:{query:'红豆',limit:1}},f.ctx);assert.equal(f.ctx.refs.resolve(found.candidates[0].ref,'candidate').id,'s7');
 f.state.playback.sourceActivity={phase:'resolving',message:'private address/token must not leak',startedAt:1};
 f.activities.push({name:'歌单导入',state:'running',total:5,done:2,message:'private internal URL'});
 const value=await f.adapter.execute({name:'tasks.query',args:{}},f.ctx);
 assert.deepEqual(value.data.tasks.map(row=>row.kind),['playback','background','cache']);
 assert(!JSON.stringify(value).includes('private'));assert.equal((await f.adapter.execute({name:'tasks.query',args:{limit:1}},f.ctx)).data.tasks.length,1);
 f.offlineError=true;await assert.rejects(f.adapter.execute({name:'tasks.query',args:{}},f.ctx),/无法读取/);
});

function defaultFixture(t,platform){
 const originalWindow=global.window,originalStorage=global.localStorage;
 const state={personal:{liked:[],favorites:[],history:[],playlists:[]},playback:{track:song(1),queue:[song(1)],queueIndex:0,playing:false,position:0,volume:.5,repeat:'off',shuffle:false},sources:[{id:'source',enabled:true,manifest:{capabilities:['search']}}],localTracks:[]};
 const nativeCalls=[],uiCalls=[],activities=[],roaming={active:false};const data=new Map();
 global.localStorage={getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};
 global.window=new EventTarget();global.window.addEventListener('zenix-assistant-control',event=>{const {action,args,accept}=event.detail;uiCalls.push({action,args});accept();});
 t.after(()=>{global.window=originalWindow;global.localStorage=originalStorage;});
 const f={state,nativeCalls,uiCalls,activities,roaming,selected:song(2),overlayPermitted:true,offlineError:false};
 const create=async(name,track)=>{state.personal.playlists.push({id:'new-'+state.personal.playlists.length,name,tracks:track?[structuredClone(track)]:[]});return structuredClone(state.personal);};
 const invoke=async args=>{if(args.operation==='offlineTasks')return {error:f.offlineError?'disk error':undefined,tasks:[{name:'缓存歌单',status:'running',items:[]}]};throw Error('unexpected feature operation '+args.operation);};
 const command=async(action,args={})=>{
  nativeCalls.push({action,args:structuredClone(args)});
  if(action==='snapshot')return structuredClone(state);
  if(action==='volume'){assert.deepEqual(Object.keys(args),['value']);state.playback.volume=args.value;return;}
  if(action==='mode'){Object.assign(state.playback,args);return;}
  if(action==='search'){assert.deepEqual(Object.keys(args),['id','keyword']);return {items:[song(7)]};}
  if(action==='collaboration'){
   assert.equal(args.operation,'collaboration');
   if(args.action==='status')return {phase:'connected',connectionId:'paired-session'};
   if(args.action==='state')return {permissions:{handoff:true,submission:true}};
   if(args.action==='send')return {id:'ticket'};
  }
  if(action==='overlayEnable')return {enabled:!!args.enabled&&f.overlayPermitted,permitted:f.overlayPermitted};
  if(action==='lyricsConfigure')return;
  if(action==='lyrics')return {text:'[00:00]第一句\n[00:10]第二句',format:'lrc',source:'custom'};
  if(action==='personal'&&args.operation==='createPlaylist')return create(args.name,args.track);
  if(action==='features')return invoke(args);
  throw Error('unexpected native action '+action);
 };
 global.window.yzqxy={personal:{load:async()=>structuredClone(state.personal),createPlaylist:create},library:{load:async()=>({tracks:state.localTracks})},sources:{list:async()=>state.sources,search:async(id,query,cursor,pageSize,requestId,stateDriven)=>{assert.deepEqual([id,cursor,requestId,stateDriven],['source',null,undefined,true]);return {items:[song(7)]};}},companion:{invoke}};
 const {createBusinessAdapter}=require('./fixtures/load-remote-business-default.cjs')({
  'mobile/native':{command},'core/updates':{updatePreferences:()=>({channel:'stable'}),invokeUpdate:async()=>({status:'up-to-date'})},
  'core/player':{player:{get snapshot(){return state.playback;}}},'core/roaming':{roaming:{get snapshot(){return roaming;}}},
  'features/space/state':{captureSpace:async()=>({selectedId:f.selected.id,tracks:[f.selected]})},
  'features/featureHost':{pauseHost:async()=>{}},'features/connections/handoffCoordinator':{followHandoff:()=>{}},
  'features/tasks/activities':{activitySnapshot:()=>activities},
 });
 f.adapter=createBusinessAdapter(platform);f.ctx=fixture(platform).ctx;return f;
}
