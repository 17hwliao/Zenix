const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {promisify}=require('node:util');
const {execFile}=require('node:child_process');
const load=require('./fixtures/load-assistant-ts.cjs');
const {resultSummaryLines}=load(path.join(__dirname,'../src/features/assistant/remote/presentation.ts'));
const summary=data=>resultSummaryLines({status:'completed',message:'已查询。',data});
test('remote result presenter exposes requested song fields, real context and playlist names',()=>{
 const lines=summary({order:'当前队列顺序，随机播放的实际下一首可能不同',songs:[{ref:'private-ref',title:'红豆',artist:'王菲',album:'唱游',duration:240,year:1998,saved:{liked:true,favorites:false},progress:{position:12,playing:true},coverAvailable:true,lyrics:'还没好好的感受'}],context:{current:{title:'传奇',artist:'王菲'},selected:[{title:'红豆',artist:'王菲'}],playlist:{label:'夜间',count:296},playback:{playing:true,volume:0.4,repeat:'one',shuffle:false,queueCount:296},roaming:true},playlists:[{label:'通勤',count:12}]});
 assert.match(lines.join('\n'),/红豆 · 歌手：王菲 · 专辑：唱游 · 时长：4:00 · 年份：1998/);
 assert.match(lines.join('\n'),/进度：0:12，播放中/);assert.match(lines.join('\n'),/当前歌词：还没好好的感受/);
 assert.match(lines.join('\n'),/当前歌曲：传奇/);assert.match(lines.join('\n'),/界面选中：红豆/);
 assert.match(lines.join('\n'),/当前歌单：夜间，296 首/);assert.match(lines.join('\n'),/歌单：通勤，12 首/);
 assert.match(lines.join('\n'),/音量 40%，单曲循环，队列 296 首/);assert.match(lines.join('\n'),/随机播放的实际下一首可能不同/);
});
test('remote result presenter reads task progress and statistics without declaring queued cache complete',()=>{
 const lines=summary({tasks:[{id:'secret-task-id',name:'缓存夜间',kind:'cache',status:'queued',total:296,complete:0},{name:'解析歌曲',kind:'playback',status:'running',total:1,complete:0}],stats:{seconds:125,plays:4,uniqueTracks:3,topTracks:[{title:'红豆',artist:'王菲',plays:2}]}});
 assert.match(lines.join('\n'),/缓存夜间：排队中，已完成 0\/296/);assert.match(lines.join('\n'),/解析歌曲：进行中/);
 assert.match(lines.join('\n'),/累计听歌 2 分 5 秒/);assert.match(lines.join('\n'),/播放 4 次/);assert.match(lines.join('\n'),/听过 3 首不同歌曲/);assert.match(lines.join('\n'),/常听歌曲：红豆 · 歌手：王菲，2 次/);
 assert.doesNotMatch(lines.join('\n'),/secret-task-id/);
});
test('remote result presenter allowlists display fields and bounds untrusted text and collections',()=>{
 const lines=summary({message:'private-message',apiKey:'secret-key',paths:['C:\\Users\\secret'],songs:Array.from({length:90},()=>({id:'secret-song-id',ref:'secret-reference',path:'/private/music/secret.mp3',audioUrl:'https://secret/audio',title:'歌'.repeat(600),artist:'歌手'}))});
 assert.equal(lines.length,30);assert(lines.every(line=>line.length<=400));assert.doesNotMatch(lines.join('\n'),/secret|private|https|C:/);
 const safe=summary({songs:[{title:'https://private.example/a',artist:'C:\\private\\user.mp3'},{title:'/private/music/a.mp3',artist:'session:track:identifier'}],device:{identity:'secret-peer',label:'书房电脑'},timer:{token:'secret-token'},ticket:'secret-ticket'}).join('\n');
 assert.doesNotMatch(safe,/private|session:track|secret-peer|secret-token|secret-ticket/);assert.match(safe,/地址已省略/);assert.match(safe,/路径已省略/);assert.match(safe,/协作设备：书房电脑/);
});
test('remote result presenter supports legacy display once and handles empty or malformed values',()=>{
 assert.deepEqual(summary({items:['红豆 — 王菲'],detail:'第一句\n第二句'}),['红豆 — 王菲','第一句','第二句']);
 assert.deepEqual(summary({songs:[null,1],tasks:[false],seconds:NaN,volume:Infinity}),[]);
 assert.deepEqual(resultSummaryLines(),[]);assert.deepEqual(summary({}),[]);
 assert.deepEqual(summary({songs:[{title:'同曲'},{title:'同曲'}]}),['同曲','同曲'],'ordered repeated songs are not silently deduplicated');
});
test('remote assistant controlled UI: secret handling, native cancel ownership, immutable confirmations, explicit candidate playback and PC/mobile layout',{skip:process.platform!=='win32'},async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-remote-assistant-ui-'));
 t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const {createServer}=await import('vite');const http=require('node:http').createServer();
 const server=await createServer({cacheDir:path.join(folder,'vite'),optimizeDeps:{entries:['scripts/fixtures/remote-assistant-ui.html']},server:{middlewareMode:true,hmr:false},logLevel:'error'});
 http.on('request',server.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await server.close();await new Promise(resolve=>http.close(resolve));});
 const env={...process.env,ZENIX_TEST_USER_DATA:folder,ZENIX_TEST_UI_URL:`http://127.0.0.1:${http.address().port}/scripts/fixtures/remote-assistant-ui.html`};delete env.ELECTRON_RUN_AS_NODE;
 const {stdout,stderr}=await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/ElectronRemoteAssistantUi.cjs')],{env,timeout:60000,windowsHide:true});
 assert.match(stdout,/REMOTE_ASSISTANT_UI_PASS/,stderr);
});
