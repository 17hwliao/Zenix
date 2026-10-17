const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),vm=require('node:vm');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {detectPlaylist,readLinkedPlaylist}=require('../src/core/playlistLinks.ts');
const {readInfo}=require('../electron/lx-catalog.cjs');
const {createBundle,restoreTracks}=require('../electron/playlist-format.cjs');
const response=(args,data)=>({url:args.url,status:200,text:JSON.stringify(data)});
const qq=(id)=>({mid:'MID'+id,id,interval:185,title:'测试歌曲 '+id,singer:[{name:'测试歌手'}],album:{name:'专辑',mid:'ALBUM'},file:{media_mid:'MEDIA'+id}});

test('playlist detection handles share text, old/mobile/hash links and exact host boundaries',()=>{
  assert.equal(detectPlaylist('分享歌单：https://y.qq.com/n/ryqq/playlist/123。').id,'123');
  assert.equal(detectPlaylist('https://i.y.qq.com/n2/m/share/details/taoge.html?id=123&appshare=android_qq').id,'123');
  assert.equal(detectPlaylist('https://i2.y.qq.com/n3/other/pages/details/playlist.html?id=123').id,'123');
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
