const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vm=require('node:vm');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {detectPlaylist,readLinkedPlaylist}=require('../src/core/playlistLinks.ts');
const {readInfo}=require('../electron/lx-catalog.cjs');
const {createBundle,restoreTracks}=require('../electron/playlist-format.cjs');
const {readTextPlaylist,readPlaylistFile}=require('../src/core/playlistFiles.ts');
const response=(args,data)=>({url:args.url,status:200,text:JSON.stringify(data)});
const qq=(id)=>({mid:'MID'+id,id,interval:185,title:'测试歌曲 '+id,singer:[{name:'测试歌手'}],album:{name:'专辑',mid:'ALBUM'},file:{media_mid:'MEDIA'+id}});

test('text import recognizes numbered titles, singer brackets, labelled fields and explicit column order without damaging hyphenated names',()=>{
  const result=readTextPlaylist('1. 如果的事 - 范玮琪、张韶涵\n2、像风一样-薛之谦\n王力宏《你不知道的事》\n歌名：Ditto 歌手：NewJeans\nAnti-Hero\n如果的事 - 范玮琪、张韶涵');
  assert.deepEqual(result.lists[0].tracks.map(t=>[t.title,t.artist]),[['如果的事','范玮琪、张韶涵'],['像风一样','薛之谦'],['你不知道的事','王力宏'],['Ditto','NewJeans'],['Anti-Hero','']]);
  assert.equal(result.duplicates,1);assert.equal(result.lists[0].autoReplacement,true);
  const reversed=readTextPlaylist('薛之谦 - 像风一样\nNewJeans\tDitto','artist-first');assert.deepEqual(reversed.lists[0].tracks.map(t=>[t.title,t.artist]),[['像风一样','薛之谦'],['Ditto','NewJeans']]);
  assert(result.lists[0].tracks.every(t=>t.source==='custom'&&t.providerId==='zenix.import:metadata'&&!t.audioUrl&&!t.path));
});

test('CSV and TSV headers take precedence, preserve quoted commas and report malformed rows',()=>{
  const parsed=readTextPlaylist('\uFEFF歌手,歌名,专辑\nNewJeans,Ditto,OMG\nArtist,"Hello, world",Album\n"broken quote,track,album');
  assert.deepEqual(parsed.lists[0].tracks.map(t=>[t.title,t.artist,t.album]),[['Ditto','NewJeans','OMG'],['Hello, world','Artist','Album']]);assert.equal(parsed.skipped,1);
  const tsv=readTextPlaylist('artist\ttitle\talbum\n王力宏\t你不知道的事\t十八般武艺','title-first');assert.equal(tsv.lists[0].tracks[0].title,'你不知道的事');
  const file=readPlaylistFile(new TextEncoder().encode('像风一样 - 薛之谦'),'清单.txt');assert.equal(file.lists[0].tracks[0].artist,'薛之谦');
  assert.throws(()=>readPlaylistFile(Uint8Array.from([255,255]),'清单.txt'),/UTF-8/);assert.throws(()=>readPlaylistFile(new TextEncoder().encode('{}'),'脚本.json'),/文本歌单/);
  assert.throws(()=>readTextPlaylist('歌曲\n'.repeat(5001)),/5000/);assert.throws(()=>readTextPlaylist('x'.repeat(2*1024*1024+1)),/2 MiB/);
  assert.deepEqual(readTextPlaylist('title,artist\nName,Artist\n2.0,Other').lists[0].tracks.map(t=>t.title),['Name','2.0'],'song names resembling headers or numeric lists remain intact');
});

test('metadata imports survive portable exchange and use the real playlist search/three-candidate playback without writes before confirmation',async t=>{
  const fsp=require('node:fs/promises'),folder=await fsp.mkdtemp(path.join(require('node:os').tmpdir(),'zenix-text-playlist-'));t.after(()=>fsp.rm(folder,{recursive:true,force:true}));
  const {PersonalStore}=require('../electron/personal.cjs'),{Companion}=require('../electron/runtime/companion.cjs');
  const store=new PersonalStore(folder);await store.load();await store.createPlaylist('原歌单');const before=store.snapshot();
  const parsed=readTextPlaylist('如果的事 - 范玮琪、张韶涵\n像风一样 - 薛之谦');
  const companion=new Companion({folder,personal:store,library:{snapshot:()=>({tracks:[]})},dialog:{},broadcast(){}});t.after(()=>companion.stop());
  const pending=await companion.invoke({operation:'playlistPreview',bundle:{format:'zenix-playlist',schemaVersion:1,playlists:parsed.lists}});
  assert.deepEqual(store.snapshot(),before);await companion.invoke({operation:'importConfirm',token:pending.pending.token});
  const imported=store.snapshot().playlists[1];assert.equal(imported.autoReplacement,true);assert.deepEqual(store.snapshot().playlists[0],before.playlists[0]);
  const reloaded=new PersonalStore(folder);await reloaded.load();assert.equal(reloaded.snapshot().playlists[1].autoReplacement,true);
  const {resolveReplacement}=require('../src/core/desktopReplacement.ts');let requests=0,resolves=0;
  const candidates=['a','b','c','d'].map(id=>({...imported.tracks[0],id,providerId:'source.fixture',remoteId:'remote-'+id}));
  global.window={yzqxy:{personal:{load:async()=>store.snapshot(),batch:(args)=>store.batch(args)},sources:{list:async()=>[{id:'source.fixture',enabled:true,manifest:{capabilities:['search','resolvePlayback'],qualities:['high']}}],search:async(id,query)=>{requests++;assert.equal(query,'如果的事');return {items:candidates};},resolve:async()=>{resolves++;if(resolves<3)throw Error('HTTP 404');return {audioUrl:'fixture-audio'};},probe:async()=>true}}};t.after(()=>{delete global.window;});
  const result=await resolveReplacement({...imported.tracks[0],playlistId:imported.id},[],()=>{},new AbortController().signal,()=>{throw Error('must search metadata');});
  assert.equal(requests,1);assert.equal(resolves,3);assert.equal(result.audioUrl,'fixture-audio');assert.equal(result.id,imported.tracks[0].id);assert.equal(store.snapshot().playlists[1].tracks[0].replacement.attempts,3);
  assert.deepEqual(store.snapshot().playlists[0],before.playlists[0]);
  global.localStorage={getItem:()=> 'high'};t.after(()=>{delete global.localStorage;});
  const {resolveOriginalTrack}=require('../src/core/sourcePlayback.ts');
  const direct=await resolveOriginalTrack(imported.tracks[0],[],()=>{},new AbortController().signal);
  assert.equal(direct.audioUrl,'fixture-audio');assert.equal(direct.id,imported.tracks[0].id,'metadata also plays outside its playlist without invented platform IDs');
});

test('Android text share inbox bounds untrusted input and protects new deliveries from stale consumers',async t=>{
  const fsp=require('node:fs/promises'),os=require('node:os'),{promisify}=require('node:util'),{execFile}=require('node:child_process');
  const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'zenix-share-inbox-'));t.after(()=>fsp.rm(folder,{recursive:true,force:true}));
  const stub=path.join(folder,'android/content');await fsp.mkdir(stub,{recursive:true});await fsp.writeFile(path.join(stub,'Intent.java'),'package android.content; public class Intent { public static final String ACTION_SEND="android.intent.action.SEND",EXTRA_TEXT="android.intent.extra.TEXT";private String action,type,text;public Intent(String action,String type,String text){this.action=action;this.type=type;this.text=text;}public String getAction(){return action;}public String getType(){return type;}public CharSequence getCharSequenceExtra(String key){return text;} }');
  const home=process.env.JAVA_HOME||'C:/Program Files/Android/Android Studio/jbr',bin=name=>path.join(home,'bin',name+(process.platform==='win32'?'.exe':''));
  const cached=path.join(os.homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');let jar;
  try{for(const child of await fsp.readdir(cached)){const candidate=path.join(cached,child,'json-20250517.jar');try{await fsp.access(candidate);jar=candidate;break;}catch{}}}catch{}
  if(!jar){jar=path.join(folder,'json.jar');const response=await fetch('https://repo.maven.apache.org/maven2/org/json/json/20250517/json-20250517.jar');assert(response.ok);await fsp.writeFile(jar,Buffer.from(await response.arrayBuffer()));}
  const root=path.resolve(__dirname,'../android/app/src/main/java/com/zenix/musicplayer');
  await promisify(execFile)(bin('javac'),['-cp',jar,'-d',folder,path.join(stub,'Intent.java'),path.join(root,'Json.java'),path.join(root,'PlaylistShareInbox.java'),path.join(__dirname,'fixtures/PlaylistShareCheck.java')],{timeout:30000,windowsHide:true});
  const {stdout}=await promisify(execFile)(bin('java'),['-cp',folder+path.delimiter+jar,'com.zenix.musicplayer.PlaylistShareCheck'],{timeout:30000,windowsHide:true});assert.match(stdout,/PLAYLIST_SHARE_PASS/);
});

test('playlist detection handles share text, old/mobile/hash links and exact host boundaries',()=>{
  assert.equal(detectPlaylist('分享歌单：https://y.qq.com/n/ryqq/playlist/123。').id,'123');
  assert.equal(detectPlaylist('https://i.y.qq.com/n2/m/share/details/taoge.html?id=123&appshare=android_qq').id,'123');
  assert.equal(detectPlaylist('https://i2.y.qq.com/n3/other/pages/details/playlist.html?id=123').id,'123');
  assert.equal(detectPlaylist('https://i2.y.qq.com/n3/other/pages/details/playlist.html?platform=11&appshare=android_qq&id=9794027351&ADTAG=wxfshare').id,'9794027351');
  assert.equal(detectPlaylist('https://y.qq.com/n/ryqq_v2/playlist/9712331714?ADTAG=h5_share_playlist').id,'9712331714');
  assert.equal(detectPlaylist('https://y.qq.com/#type=playlist&id=123').id,'123');
  assert.equal(detectPlaylist('http://music.163.com/#/playlist?id=123').url,'https://music.163.com/#/playlist?id=123');
  assert.equal(detectPlaylist('https://www.kuwo.cn/playlist_detail/123').id,'123');
  assert.equal(detectPlaylist('https://c6.y.qq.com/base/fcgi-bin/u?__=abc').platform,'tx');
  assert.equal(detectPlaylist('https://y.qq.com/n/ryqq/songDetail/123').id,'');
  for(const input of ['https://y.qq.com.evil.example/playlist/1','https://localhost/playlist/1','https://y.qq.com:444/playlist/1','https://secret@y.qq.com/playlist/1'])assert.throws(()=>detectPlaylist(input));
});

test('QQ keeps exact catalogue IDs including media MID; exchange roundtrip retains playable metadata',async()=>{
  const result=await readLinkedPlaylist('https://y.qq.com/n/ryqq/playlist/123',async args=>response(args,{code:0,cdlist:[{dissname:'我的 &amp; 歌单',songnum:3,songlist:[qq(1),qq(2),qq(1)]}]}));
  assert.equal(result.complete,true);assert.equal(result.name,'我的 & 歌单');assert.equal(result.tracks.length,2);assert.equal(result.duplicates,1);
  const bundle=createBundle([{name:result.name,tracks:result.tracks}]);
  const restored=restoreTracks(bundle,[])[0].tracks;assert.equal(restored[0].providerId,'lx.playlist:catalog');
  const info=readInfo(restored[0].remoteId);assert.equal(info.source,'tx');assert.equal(info.songmid,'MID1');assert.equal(info.strMediaMid,'MEDIA1');assert.equal(info.songId,1);assert.equal(info.name,'测试歌曲 1');assert.equal(restored[0].audioUrl,'');
  assert.equal(info.albumId,'ALBUM');assert.equal(info.albumMid,'ALBUM');
});

test('QQ short links and paged fallback keep order and report progress',async()=>{
  const calls=[],progress=[];
  const result=await readLinkedPlaylist('https://c6.y.qq.com/base/fcgi-bin/u?__=abc',async args=>{
    calls.push(args);
    if(args.url.includes('fcgi-bin/u?'))return {url:'https://i.y.qq.com/n2/m/share/details/taoge.html?id=123',status:200,text:'page'};
    if(args.method!=='POST')return response(args,{code:0,subcode:1});
    const offset=JSON.parse(args.body).req_1.param.song_begin;
    return response(args,{code:0,req_1:{code:0,data:{dirinfo:{title:'Paged'},total_song_num:120,songlist:Array.from({length:offset?20:100},(_,i)=>qq(offset+i+1))}}});
  },undefined,message=>progress.push(message));
  assert.equal(result.complete,true);assert.equal(result.tracks.length,120);assert.equal(readInfo(result.tracks.at(-1).remoteId).songmid,'MID120');assert.equal(calls.filter(x=>x.method==='POST').length,2);assert(progress.length>2);
});

test('QQ duplicate pages, private lists and mid-flight cancellation cannot claim a complete import',async()=>{
  const partial=await readLinkedPlaylist('https://y.qq.com/n/ryqq/playlist/123',async args=>args.method==='POST'?response(args,{code:0,req_1:{code:0,data:{dirinfo:{title:'Blocked page'},total_song_num:200,songlist:[qq(1)]}}}):response(args,{code:1}));
  assert.equal(partial.complete,false);assert.equal(partial.tracks.length,1);assert(partial.warnings.some(x=>x.includes('重复')));
  await assert.rejects(readLinkedPlaylist('https://y.qq.com/n/ryqq/playlist/123',async args=>response(args,{code:1})),/未开放/);
  const abort=new AbortController();let calls=0;
  await assert.rejects(readLinkedPlaylist('https://y.qq.com/n/ryqq/playlist/123',async args=>{calls++;abort.abort();return response(args,{code:1});},abort.signal),{name:'AbortError'});assert.equal(calls,1);
});

test('NetEase supplements metadata from track IDs and preserves original playlist order',async()=>{
  const wy=(id)=>({id,name:'WY'+id,ar:[{name:'歌手'}],al:{id:9,name:'专辑'},dt:120000});
  const calls=[];
  const result=await readLinkedPlaylist('https://music.163.com/playlist?id=1',async args=>{calls.push(args);return response(args,args.url.includes('playlist/detail')?{code:200,playlist:{name:'WY',trackCount:3,trackIds:[{id:3},{id:1},{id:2}],tracks:[wy(1)]}}:{code:200,songs:[wy(2),wy(3)]});});
  assert.equal(result.complete,true);assert.equal(calls.length,2);assert.deepEqual(result.tracks.map(x=>readInfo(x.remoteId).songmid),['3','1','2']);assert.equal(result.tracks[0].duration,120);
  const denied=await readLinkedPlaylist('https://music.163.com/playlist?id=1',async args=>response(args,args.url.includes('playlist/detail')?{code:200,playlist:{name:'WY',trackCount:3,trackIds:[{id:1},{id:2},{id:3}],tracks:[wy(1)]}}:{code:403}));
  assert.equal(denied.complete,false);assert.equal(denied.skipped,2);
});

test('Kuwo pagination distinguishes unavailable entries from imported tracks',async()=>{
  const result=await readLinkedPlaylist('https://www.kuwo.cn/playlist_detail/9',async args=>{
    const page=Number(new URL(args.url).searchParams.get('pn'));
    return response(args,{result:'ok',title:'KW',total:3,musiclist:page===0?[{id:1,name:'First',artist:'A',duration:60},{id:2,name:'Second',artist:'B',duration:70}]:[{id:3,name:'Third',artist:'C',duration:80}]});
  });
  assert.equal(result.complete,true);assert.equal(result.tracks.length,3);assert.equal(readInfo(result.tracks[2].remoteId).source,'kw');
  const partial=await readLinkedPlaylist('https://www.kuwo.cn/playlist_detail/9',async args=>response(args,{result:'ok',title:'KW',total:1,musiclist:[{name:'Missing ID'}]})).catch(e=>e);
  assert.match(partial.message,/未取得/);
});

test('playlist transport validates every redirect before connecting and sends no supplied secrets',async()=>{
  const calls=[],module={exports:{}};let replies=[];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../electron/runtime/playlist-http.cjs'),'utf8'),{module,URL,Buffer,AbortSignal,require(id){assert.equal(id,'./source-network.cjs');return {fetchPublicOnce:async(...args)=>{calls.push(args);return replies.shift();},readLimited:async()=>Buffer.from('{}')};}});
  const {playlistRequest}=module.exports;
  for(const url of ['http://y.qq.com/','https://y.qq.com:444/','https://y.qq.com.evil.example/','https://user:pass@y.qq.com/','https://127.0.0.1/'])await assert.rejects(playlistRequest({url}));
  const redirect=location=>({status:302,headers:new Headers({location}),body:{cancel:async()=>{}}});
  replies=[redirect('https://127.0.0.1/')];await assert.rejects(playlistRequest({url:'https://c6.y.qq.com/base/fcgi-bin/u?__=x'}));assert.equal(calls.length,1);
  replies=[redirect('https://y.qq.com/n/ryqq/playlist/1'),{status:200}];
  const result=await playlistRequest({url:'https://c6.y.qq.com/base/fcgi-bin/u?__=x',headers:{Cookie:'SECRET',Authorization:'SECRET'}});
  assert.equal(result.url,'https://y.qq.com/n/ryqq/playlist/1');assert(!JSON.stringify(calls).includes('SECRET'));
  replies=[{status:307,headers:new Headers({location:'https://u.y.qq.com/cgi-bin/musicu.fcg?format=json'}),body:{cancel:async()=>{}}},{status:200}];
  await playlistRequest({url:'https://u.y.qq.com/cgi-bin/musicu.fcg',method:'POST',body:'{"req":"fixture"}'});
  assert.equal(calls.at(-1)[2].method,'POST');assert.equal(calls.at(-1)[2].body,'{"req":"fixture"}','307 preserves the request method and body');
});

test('confirmed platform imports persist as separate playlists, preserving existing data and rejecting stale confirmations',async t=>{
  const fsp=require('node:fs/promises'),folder=await fsp.mkdtemp(path.join(require('node:os').tmpdir(),'zenix-playlist-links-'));
  t.after(async()=>{const absolute=path.resolve(folder),root=path.resolve(require('node:os').tmpdir());assert(absolute.startsWith(root+path.sep));await fsp.rm(absolute,{recursive:true,force:true});});
  const {PersonalStore}=require('../electron/personal.cjs'),{Companion}=require('../electron/runtime/companion.cjs');
  const personal=new PersonalStore(folder);await personal.load();await personal.createPlaylist('原歌单');
  const before=personal.snapshot(),companion=new Companion({folder,personal,library:{snapshot:()=>({tracks:[]})},dialog:{},broadcast(){}});t.after(()=>companion.stop());
  const result=await readLinkedPlaylist('https://y.qq.com/n/ryqq/playlist/1',async args=>response(args,{code:0,cdlist:[{dissname:'原歌单',songnum:1,songlist:[qq(1)]}]}));
  const status=await companion.invoke({operation:'playlistPreview',bundle:{format:'zenix-playlist',schemaVersion:1,playlists:[{name:result.name,tracks:result.tracks}]}});
  assert.deepEqual(personal.snapshot(),before,'a preview never writes user data');
  await assert.rejects(companion.invoke({operation:'importConfirm',token:'wrong'}),/失效/);
  await companion.invoke({operation:'importConfirm',token:status.pending.token});
  const state=personal.snapshot();assert.deepEqual(state.playlists[0],before.playlists[0]);assert.notEqual(state.playlists[1].name,'原歌单');assert.equal(state.playlists[1].tracks[0].providerId,'lx.playlist:catalog');
  const reopened=new PersonalStore(folder);await reopened.load();assert.deepEqual(reopened.snapshot(),state);
  await assert.rejects(companion.invoke({operation:'importConfirm',token:status.pending.token}),/失效/);
});
