const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const load=require('./fixtures/load-assistant-ts.cjs'),{understand}=load(path.join(__dirname,'../src/features/assistant/intent.ts')),{libraryCommand}=load(path.join(__dirname,'../src/features/assistant/libraryCommands.ts'));
const song=(id,title=id)=>({id,title,artist:'示例歌手',path:'',audioUrl:'',source:'custom',providerId:'demo',remoteId:id,duration:100});
function fixture(){const state={personal:{liked:[],favorites:[],history:Array.from({length:12},(_,i)=>({id:String(i),track:song(String(i)),playedAt:i})),playlists:[{id:'one',name:'通勤',tracks:[song('a'),song('b')]}]},playback:{track:{...song('a'),playlistId:'one'},queue:[song('a'),song('b')],position:15},context:{playlistId:'one',selectedIds:['b']}};let writes=0,navigation;
 const host={snapshot:async()=>structuredClone(state),lyrics:async()=>({text:'[00:00]第一句\n[00:10]第二句',format:'lrc',source:'custom'}),navigate:async(page,id)=>{navigation={page,id};},create:async(name,track)=>{writes++;state.personal.playlists.push({id:'new',name,tracks:track?[track]:[]});return structuredClone(state.personal);},remove:async(id,ids,expected)=>{const list=state.personal.playlists.find(row=>row.id===id);assert.deepEqual(list.tracks.map(track=>track.id),expected);writes++;list.tracks=list.tracks.filter(track=>!ids.includes(track.id));return structuredClone(state.personal);},collect:async(kinds,tracks)=>{writes++;for(const kind of kinds)for(const track of tracks)if(!state.personal[kind].some(row=>row.id===track.id))state.personal[kind].push(track);return structuredClone(state.personal);}};
 return {state,host,writes:()=>writes,navigation:()=>navigation};
}
test('assistant library speech phrases map to bounded operations and preserve playlist names',()=>{
 for(const [text,action] of [['帮我返回主界面','home'],['当前听歌的歌词是什么','song-query'],['给我返回当前的歌曲的歌手是谁','song-query'],['给我返回当前听过的歌曲的前10首歌曲的名字','recent-songs'],['帮我打开通勤歌单','playlist-open'],['创建一个新歌单','playlist-create'],['帮我把当前的歌曲加入一个新歌单','playlist-create-current'],['给我批量喜欢当前歌单全部歌曲','songs-collect'],['帮我删除选中的歌曲','songs-remove']])assert.equal(understand(text).action,action,text);
 assert.equal(understand('打开歌单《夜晚，开车》').args.name,'夜晚，开车');assert.equal(understand('创建一个叫通勤的歌单').args.name,'通勤');
 assert.deepEqual(understand('从歌单《通勤》删除《晴天》').args.titles,['晴天']);
 assert.equal(understand('不要删除当前歌曲').kind,'unknown');assert.equal(understand('把当前歌曲不要加入收藏').kind,'unknown');assert.equal(understand('打开我的通勤歌单').args.name,'通勤');assert.equal(understand('删除全部歌单').kind,'unknown');assert.equal(understand('返回主页然后删除歌曲').kind,'unknown');assert.equal(understand('打开通勤歌单',.3).kind,'confirm');
});
test('read operations follow actual recording, ordered history and lyrics without writing or changing playback',async()=>{
 const f=fixture(),before=structuredClone(f.state.playback);f.state.playback.track.playbackRecording={...song('real'),artist:'实际歌手'};
 assert.match((await libraryCommand('now-artist',{},f.host)).reply,/实际歌手/);
 const history=await libraryCommand('recent-songs',{},f.host);assert.equal(history.items.length,10);assert.match(history.items[0],/11/);assert.match(history.items[9],/2/);
 const lyrics=await libraryCommand('now-lyrics',{},f.host);assert.match(lyrics.reply,/第二句/);assert.match(lyrics.detail,/第一句/);
 await libraryCommand('playlist-open',{name:'通勤'},f.host);assert.deepEqual(f.navigation(),{page:'playlist',id:'one'});await libraryCommand('home',{},f.host);assert.equal(f.navigation().page,'home');assert.equal(f.writes(),0);assert.deepEqual({...f.state.playback.track,playbackRecording:undefined},{...before.track,playbackRecording:undefined});
});
test('mutation plans do not write before confirmation; selected scope, idempotent likes and removal preserve other data',async()=>{
 const f=fixture();const plan=await libraryCommand('songs-collect',{scope:'playlist',kinds:['liked','favorites']},f.host);assert.equal(plan.kind,'confirmation');assert.equal(f.writes(),0);await plan.commit();await (await libraryCommand('songs-collect',{scope:'playlist',kinds:['liked','favorites']},f.host)).commit();assert.equal(f.state.personal.liked.length,2);assert.equal(f.state.personal.favorites.length,2);
 const before=structuredClone(f.state.personal);const removal=await libraryCommand('songs-remove',{scope:'selected'},f.host);assert.deepEqual(removal.items,['b · 示例歌手']);await removal.commit();assert.deepEqual(f.state.personal.playlists[0].tracks.map(track=>track.id),['a']);assert.deepEqual(f.state.personal.liked,before.liked);assert.deepEqual(f.state.personal.history,before.history);assert.equal(f.state.playback.queue.length,2);
});
test('changed playlists, ambiguous names, empty selection and canceled pending work never mutate',async()=>{
 const f=fixture(),controller=new AbortController();const plan=await libraryCommand('songs-remove',{scope:'selected'},f.host);f.state.personal.playlists[0].tracks.push(song('c'));await assert.rejects(plan.commit(),/已经变化/);assert.equal(f.writes(),0);
 f.state.context.selectedIds=[];await assert.rejects(libraryCommand('songs-remove',{scope:'selected'},f.host),/尚未选中/);
 f.state.personal.playlists.push({...f.state.personal.playlists[0],id:'duplicate'});await assert.rejects(libraryCommand('playlist-open',{name:'通勤'},f.host),/同名/);
 const collect=await libraryCommand('songs-collect',{scope:'queue',kinds:['liked']},f.host,controller.signal);controller.abort();await assert.rejects(collect.commit(),{name:'AbortError'});assert.equal(f.writes(),0);
 const pending=libraryCommand('now-lyrics',{},f.host,controller.signal);await assert.rejects(pending,{name:'AbortError'});
});
test('new playlist asks for name, pins confirmed track, rejects stale naming context and duplicate names',async()=>{
 const f=fixture(),ask=await libraryCommand('playlist-create-current',{},f.host);assert(ask.ask);assert.equal(f.writes(),0);
 f.state.playback.track=song('b');await assert.rejects(libraryCommand(ask.ask.action,{...ask.ask.args,name:'新的'},f.host),/歌曲已变化/);
 const plan=await libraryCommand('playlist-create-current',{name:'新的'},f.host);f.state.playback.track=song('c');await plan.commit();assert.equal(f.state.personal.playlists.at(-1).tracks[0].id,'b');
 await assert.rejects(libraryCommand('playlist-create',{name:'新的'},f.host),/同名/);assert.equal(f.writes(),1);
});
test('delayed lyric fetch is pinned to original song and cancellation prevents stale reply',async()=>{
 const f=fixture(),controller=new AbortController();let resolve;f.host.lyrics=track=>{assert.equal(track.id,'a');return new Promise(done=>resolve=done);};const pending=libraryCommand('now-lyrics',{},f.host,controller.signal);await new Promise(setImmediate);f.state.playback.track=song('b');controller.abort();resolve({text:'[00:00]歌词',format:'lrc'});await assert.rejects(pending,{name:'AbortError'});assert.equal(f.writes(),0);
});
test('desktop collection persistence adds both kinds in one save, keeps unrelated data and rejects invalid batch atomically',async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-assistant-library-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));const {PersonalStore}=require('../electron/personal.cjs'),store=new PersonalStore(folder);await store.load();await store.createPlaylist('保留');await store.record(song('history'));let saves=0;const save=store.save.bind(store);store.save=(...args)=>{saves++;return save(...args);};
 await store.collectMany(['liked','favorites'],[song('a'),song('a'),song('b')]);assert.equal(saves,1);await store.collectMany(['liked'],[song('a')]);assert.equal(store.snapshot().liked.length,2);const before=store.snapshot();await assert.rejects(store.collectMany(['liked'],[song('c'),null]),/无效/);assert.deepEqual(store.snapshot(),before);await assert.rejects(store.collectMany(['history'],[song('a')]),/无效/);
 const loaded=new PersonalStore(folder);assert.deepEqual(await loaded.load(),before);assert.equal(before.playlists[0].name,'保留');assert.equal(before.history[0].track.id,'history');
});
test('relative song queries distinguish exact positions, ranges, history counts and playback commands',()=>{
 const cases=[['前面第3首歌曲的歌手是谁',-3,-3,'artist'],['下一首歌的专辑',1,1,'album'],['后面五首歌曲的名字',1,5,'title'],['前后各两首的全部信息',-2,2,'all'],['当前歌曲前3首到后2首的资料',-3,2,'all'],['当前歌曲的歌词是什么',0,0,'lyrics'],['前面第三首到前面第一首的歌手信息',-3,-1,'artist'],['前后各三首的全部歌词',-3,3,'lyrics']];
 for(const [text,from,to,field]of cases){const intent=understand(text);assert.equal(intent.action,'song-query',text);assert.equal(intent.args.from,from,text);assert.equal(intent.args.to,to,text);assert.equal(intent.args.field,field,text);}
 assert.equal(understand('前面第十一首歌曲的信息').kind,'unknown');assert.equal(understand('后面0首歌的信息').kind,'unknown');assert.equal(understand('下一首').action,'next');assert.equal(understand('上一首').action,'previous');assert.equal(understand('最近听过的三首歌曲的歌手').args.count,3);assert.equal(understand('最近听过的20首歌曲的信息').kind,'unknown');
});
test('bounded relative query uses exact queue index including duplicates, reports boundaries and speaks real data',async()=>{
 const f=fixture();f.state.playback.queue=Array.from({length:25},(_,i)=>({...song('q'+i),album:'专辑'+i,year:2020}));f.state.playback.queue[11]=song('a');f.state.playback.queue[12]=song('a');f.state.playback.track={...f.state.playback.queue[12]};f.state.playback.queueIndex=12;
 const exact=await libraryCommand('song-query',{from:-1,to:-1,field:'title'},f.host);assert.match(exact.detail,/前面第 1 首/);assert.match(exact.detail,/歌名：a/);
 const all=await libraryCommand('song-query',{from:-10,to:10,field:'all'},f.host);assert.equal(all.items.length,21);assert.equal(all.speech.length,21);assert.match(all.detail,/专辑：专辑2/);assert.match(all.speech.join(''),/歌词：第一句/);assert.equal(f.writes(),0);
 f.state.playback.queueIndex=0;f.state.playback.track=f.state.playback.queue[0];const edge=await libraryCommand('song-query',{from:-3,to:2,field:'artist'},f.host);assert.equal(edge.items.length,3);assert.match(edge.reply,/实际有 3 首/);assert.match(edge.detail,/示例歌手/);assert.equal((await libraryCommand('song-query',{from:-3,to:-1,field:'title'},f.host)).items.length,0);
 f.state.playback.queueIndex=99;await assert.rejects(libraryCommand('song-query',{from:1,to:2},f.host),/位置无法确认/);assert((await libraryCommand('song-query',{from:0,to:0,field:'artist'},f.host)).detail);await assert.rejects(libraryCommand('song-query',{from:-11,to:0},f.host),/十首以内/);
 const history=await libraryCommand('recent-songs',{count:3,field:'artist'},f.host);assert.equal(history.items.length,3);assert.match(history.speech.join(''),/示例歌手/);
});
test('lyric failure preserves metadata, cancellation rejects pending ranges and speech is chunked without truncation',async()=>{
 const f=fixture();f.host.lyrics=async()=>{throw Error('offline');};const info=await libraryCommand('song-query',{field:'all'},f.host);assert.match(info.detail,/歌手：示例歌手/);assert.match(info.detail,/歌词：读取失败/);assert.match(info.detail,/进度 0 分 15 秒/);
 const controller=new AbortController();let resolve;f.host.lyrics=()=>new Promise(done=>resolve=done);const pending=libraryCommand('song-query',{field:'lyrics'},f.host,controller.signal);await new Promise(setImmediate);controller.abort();resolve(null);await assert.rejects(pending,{name:'AbortError'});
 const {speechChunks}=load(path.join(__dirname,'../src/features/assistant/speechText.ts')),text='歌名晴天，歌手周杰伦。'+('完整资料🎵\n'.repeat(180))+'最后一首的完整歌词。',chunks=speechChunks([text]);assert(chunks.length>2);assert(chunks.every(part=>part.length<=260));assert.equal(chunks.join(''),text);assert.match(chunks.at(-1),/最后一首的完整歌词/);
});

test('current lyric query uses the same per-recording time correction as the player',async()=>{
 const f=fixture();f.state.playback.position=.75;f.host.lyricOffset=()=>-.5;f.host.lyrics=async()=>({text:'[00:00]第一句\n[00:01]第二句',format:'lrc'});
 const value=await libraryCommand('song-query',{from:0,to:0,field:'lyrics',lineOnly:true},f.host);assert.match(value.detail,/第二句/);assert.doesNotMatch(value.detail,/第一句/);
});
