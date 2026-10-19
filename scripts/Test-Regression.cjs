const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { BoundedCache } = require('../electron/runtime/bounded-cache.cjs');
const { PersonalStore } = require('../electron/personal.cjs');
const { AudioCache } = require('../electron/audio-cache.cjs');
const { LyricsHoverTracker } = require('../electron/runtime/lyrics-hover.cjs');
const { serveFile } = require('../electron/runtime/media-protocol.cjs');
const { captureBody, audioHeader } = require('../electron/runtime/audio-capture.cjs');
const { parseLyrics, activeLyricIndex } = require('../src/core/lyrics.ts');
const { sourceDeadline } = require('../src/core/sourceDeadline.ts');
const { stickerSlotsForCount, expandedStickerLayout, focusedStickerRect } = require('../src/ui/stickerMosaic.ts');
const track = (id, extra = {}) => ({ id, path: '', title: 'Fixture', artist: 'Artist', album: '', source: 'custom', providerId: 'first', remoteId: id, duration: 90, audioUrl: 'https://example.com/transient', ...extra });
const temporary = async () => { const root = path.resolve(__dirname, '../release/regression'); await fsp.mkdir(root, { recursive: true }); return fsp.mkdtemp(path.join(root, 'case-')); };

test('bounded cache count, bytes, recency and expiry', () => {
  const cache = new BoundedCache({ maxEntries: 2, maxBytes: 5, sizeOf: v => v.length });
  cache.set('a', '12'); cache.set('b', '34'); cache.get('a'); cache.set('c', '56');
  assert.equal(cache.get('b'), undefined); assert.equal(cache.bytes, 4);
  cache.set('big', '123456'); assert.equal(cache.size, 2);
  cache.set('expired', 'x', -1); assert.equal(cache.get('expired'), undefined);
  cache.clear(); assert.equal(cache.bytes, 0); assert.equal(cache.size, 0);
});

test('media streaming bounds unread bytes, supports seek ranges and cancels reads', async () => {
  const folder = await temporary(), file = path.join(folder, 'large.wav');
  await fsp.writeFile(file, Buffer.alloc(8 * 1024 * 1024, 17));
  const original = fs.createReadStream; let stream;
  fs.createReadStream = (...args) => (stream = original(...args));
  try {
    const response = await serveFile(file, new Request('https://example.com/media'));
    await new Promise(resolve => setTimeout(resolve, 60));
    assert(stream.bytesRead <= 3 * 64 * 1024, `Eager read: ${stream.bytesRead} bytes`);
    await response.body.cancel(); await new Promise(resolve => setTimeout(resolve, 20)); assert(stream.destroyed);
    const range = await serveFile(file, new Request('https://example.com/media', { headers: { range: 'bytes=100-199' } }));
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 100);
    const suffix = await serveFile(file, new Request('https://example.com/media', { headers: { range: 'bytes=-50' } })); assert.equal((await suffix.arrayBuffer()).byteLength, 50);
    assert.equal((await serveFile(file, new Request('https://example.com/media', { headers: { range: 'bytes=99999999-' } }))).status, 416);
    assert.equal((await serveFile(file, new Request('https://example.com/media', { method: 'HEAD' }))).body, null);
    assert.equal((await serveFile(file + '.missing', new Request('https://example.com/media'))).status, 404);
  } finally { fs.createReadStream = original; }
});
for (const count of [0, 1, 2, 5, 12, 25, 108, 120, 300, 500]) test(`finite mosaic ${count} posters, valid geometry and no overlap`, () => {
  const slots = stickerSlotsForCount(count); assert.equal(slots.length, count);
  for (const focus of [...new Set([0, Math.floor(count / 2), count - 1])].filter(i => i >= 0 && i < count)) {
    const expanded = expandedStickerLayout(focus, slots), rects = slots.map((slot, i) => expanded.get(i) || slot);
    assert.deepEqual(focusedStickerRect(focus,slots),expanded.get(focus),'camera rectangle matches the full PC mosaic without computing a repartition');
    for (let i = 0; i < rects.length; i++) {
      const a = rects[i]; assert(a.columns > 0 && a.rows > 0);
      for (let j = i + 1; j < rects.length; j++) { const b = rects[j]; assert(a.x + a.columns <= b.x || b.x + b.columns <= a.x || a.y + a.rows <= b.y || b.y + b.rows <= a.y, `Overlap ${i},${j}`); }
    }
  }
});
test('LRC mixed English/Chinese, offsets, multi-tags and translation', () => {
  const lines = parseLyrics({ text: '[offset:100]\n[00:01.00][00:03.00]You are my only one\n[00:05.00]我不能忘记她', format: 'lrc', translationText: '[00:01.00]你是唯一' });
  assert.equal(lines.length, 3); assert.equal(lines[0].text, 'You are my only one'); assert.equal(lines[0].translation, '你是唯一');
  assert.equal(activeLyricIndex(lines, 0), -1); assert.equal(activeLyricIndex(lines, 99), 2); assert.equal(activeLyricIndex([], 99), -1);
});
test('VTT markup and clock handling', () => { const lines = parseLyrics('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<b>Hello world</b>\n', 'vtt'); assert.equal(lines[0].time, 1); assert.equal(lines[0].text, 'Hello world'); });
test('QRC wrapper and word timing', () => { const lines = parseLyrics('<LyricInfo LyricContent="[1000,2000](1000,500,0)Hello &amp; world"/>', 'qrc'); assert.equal(lines[0].text, 'Hello & world'); assert.equal(lines[0].time, 1); });
test('YRC and KRC word timestamps', () => { for (const format of ['yrc', 'krc']) { const lines = parseLyrics('[1000,2000](1000,500,0)Hello (1500,500,0)world', format); assert.equal(lines[0].time, 1); assert(lines[0].text.includes('Hello')); } });
test('empty and untimed lyrics', () => { assert.deepEqual(parseLyrics(''), []); assert.equal(parseLyrics('Plain English\n中文').length, 2); });
test('deadline clears abort subscription on success, timeout and cancel', async () => {
  const control = new AbortController(); let subscriptions = 0;
  const add = control.signal.addEventListener.bind(control.signal), remove = control.signal.removeEventListener.bind(control.signal);
  control.signal.addEventListener = (...args) => { subscriptions++; return add(...args); }; control.signal.removeEventListener = (...args) => { subscriptions--; return remove(...args); };
  assert.equal(await sourceDeadline(() => Promise.resolve(7), control.signal, 20), 7); assert.equal(subscriptions, 0);
  await assert.rejects(sourceDeadline(() => new Promise(() => {}), control.signal, 10)); assert.equal(subscriptions, 0);
  const promise = sourceDeadline(() => new Promise(() => {}), control.signal, 100); control.abort(); await assert.rejects(promise); assert.equal(subscriptions, 0);
});
test('saved collections deduplicate, strip URLs and persist independently of queue', async () => {
  const folder = await temporary(), store = new PersonalStore(folder); await store.load();
  await store.record(track('1')); await store.record(track('1')); assert.equal(store.snapshot().history.length, 1); assert.equal(store.snapshot().history[0].track.audioUrl, '');
  await store.toggle('liked', track('1')); const created = await store.createPlaylist(' My   List ', track('1')), id = created.playlists[0].id;
  await store.addToPlaylist(id, track('1')); assert.equal(store.snapshot().playlists[0].tracks.length, 1);
  await assert.rejects(store.createPlaylist('my list')); await assert.rejects(store.createPlaylist(' '));
  await store.renamePlaylist(id, 'Renamed'); const reloaded = new PersonalStore(folder); await reloaded.load(); assert.equal(reloaded.snapshot().playlists[0].name, 'Renamed');
  await reloaded.removeFromPlaylist(id, '1'); assert.equal(reloaded.snapshot().liked.length, 1); await reloaded.deletePlaylist(id); assert.equal(reloaded.snapshot().playlists.length, 0);
});
test('persistent listening history is preserved during memory optimization', async () => {
  const folder = await temporary(), store = new PersonalStore(folder); await store.load();
  store.data.history = Array.from({ length: 300 }, (_, i) => ({ id: String(i), track: track(String(i)), playedAt: i }));
  await store.record(track('new')); assert.equal(store.snapshot().history.length, 301); assert.equal(store.snapshot().history[0].track.id, 'new'); const again = new PersonalStore(folder); await again.load(); assert.equal(again.snapshot().history.length, 301);
});
test('audio disk cache rejects missing files and clears persisted mappings', async () => {
  const folder = await temporary(), cache = new AudioCache(folder); await cache.load();
  const key = cache.key('song', 'high'); assert.notEqual(key, cache.key('song', 'standard'));
  cache.entries.set(key, { key, trackId: 'song', quality: 'high', size: 4, lastAccess: Date.now() });
  assert.equal(await cache.find('song', 'high'), null); assert.equal(cache.entries.size, 0);
  await fsp.writeFile(cache.file(key), Buffer.from('1234')); cache.entries.set(key, { key, trackId: 'song', quality: 'high', size: 4, lastAccess: Date.now() });
  await cache.save(); const next = new AudioCache(folder); await next.load(); assert(await next.find('song', 'high')); await next.clear(); assert.equal(next.stats().usedBytes, 0);
});
test('cache capture streams to disk and cancellation closes readers', async () => {
  const folder = await temporary(), temporaryFile = path.join(folder, 'capture.part'), output = path.join(folder, 'complete.wav');
  const bytes = Buffer.alloc(4096); bytes.write('RIFF'); let commits = 0, finishes = 0;
  const body = new ReadableStream({ start(c) { c.enqueue(bytes.subarray(0, 32)); c.enqueue(bytes.subarray(32)); c.close(); } });
  const wrapped = captureBody(body, { temporary: temporaryFile, expected: bytes.length, signal: new AbortController().signal, commit: async () => { commits++; await fsp.rename(temporaryFile, output); }, partial: () => {}, finished: () => finishes++ });
  assert.equal((await new Response(wrapped).arrayBuffer()).byteLength, 4096); assert.equal(commits, 1); assert.equal(finishes, 1); assert.deepEqual(await fsp.readFile(output), bytes);
  let cancelled = false; const open = new ReadableStream({ pull(c) { c.enqueue(bytes); }, cancel() { cancelled = true; } });
  const abandoned = captureBody(open, { temporary: temporaryFile, expected: 99999, signal: new AbortController().signal, commit: () => assert.fail(), partial: () => {}, finished: () => finishes++ });
  const originalOpen = fsp.open; let opened = 0, closed = 0;
  fsp.open = async (...args) => { const handle = await originalOpen(...args); opened++; const close = handle.close.bind(handle); handle.close = async () => { closed++; await close(); }; await new Promise(resolve => setTimeout(resolve, 30)); return handle; };
  try { const reader = abandoned.getReader(); await reader.read(); await reader.cancel(); assert(cancelled); assert.equal(open.locked, false); assert.equal(finishes, 2); assert(!fs.existsSync(temporaryFile)); assert.equal(opened, closed); }
  finally { fsp.open = originalOpen; }
  assert(!audioHeader(Buffer.from('<html>'))); assert(audioHeader(Buffer.from('fLaCfixture')));
});
test('LRC hover hysteresis prevents boundary flicker and timer leaks', () => {
  let cursor = { x: 20, y: 20 }; const transitions = [];
  const tracker = new LyricsHoverTracker({ getBounds: () => ({ x: 0, y: 0, width: 100, height: 100 }), getCursor: () => cursor, onChange: value => transitions.push(value), onSample: () => {}, onStop: () => {} });
  tracker.start(); cursor = { x: -2, y: 20 }; for (let i = 0; i < 50; i++) tracker.sample(); assert.deepEqual(transitions, [true]);
  tracker.setPinned(true); cursor = { x: -100, y: -100 }; tracker.sample(); assert(tracker.hovered); tracker.stop(); assert.equal(tracker.timer, null); assert.equal(tracker.hovered, false);
});
class FakeAudio extends EventTarget {
  constructor() { super(); this.src = ''; this.volume = 1; this.muted = false; this.currentTime = 0; this.duration = 90; this.readyState = 4; this.paused = true; }
  async play() { this.paused = false; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() {} removeAttribute(key) { if (key === 'src') this.src = ''; } getAttribute(key) { return this[key]; }
}
global.Audio = FakeAudio; global.HTMLMediaElement = { HAVE_METADATA: 1 }; global.window = {};
const preferences = new Map(); global.localStorage = { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) };
const { player } = require('../src/core/player.ts');
test('queue controls, seek, mute and listener cleanup', async () => {
  const songs = ['a', 'b', 'c'].map(id => track(id, { source: 'local', audioUrl: 'file://fixture.wav' })); player.setQueue(songs);
  let calls = 0; const dispose = player.subscribe(() => calls++); await player.play(); assert(player.snapshot.playing); player.pause(); assert(!player.snapshot.playing);
  player.seek(35); assert.equal(player.snapshot.position, 35); const before = calls; dispose(); player.seek(50); assert.equal(calls, before);
  player.setMuted(false); player.toggleMute(); assert(player.snapshot.muted); player.setVolume(.25); assert.equal(player.snapshot.volume, .25);
  await player.next(); assert.equal(player.snapshot.track.id, 'b'); player.seek(0); await player.previous(); assert.equal(player.snapshot.track.id, 'a');
  player.setQueue([]); assert.equal(player.snapshot.queue.length, 0); assert.equal(player.snapshot.track, undefined);
});
test('shuffle previous navigation has bounded history', async () => {
  player.setQueue(['a', 'b', 'c'].map(id => track(id, { source: 'local', audioUrl: 'file://fixture.wav' }))); player.setShuffle(true);
  for (let i = 0; i < 600; i++) await player.next();
  assert.equal(player.history.length, 300); player.setShuffle(false); player.setQueue([]);
});
test('removing the selected queue item preserves paused, playing and pending playback intent', async () => {
  const songs = ['a', 'b'].map(id => track(id, { source: 'local', audioUrl: 'file://fixture.wav' }));
  player.setQueue(songs); player.removeFromQueue(0);
  assert.equal(player.snapshot.track.id, 'b'); assert.equal(player.snapshot.playing, false);
  player.setQueue(songs); await player.play(); player.removeFromQueue(0); await new Promise(resolve => setImmediate(resolve));
  assert.equal(player.snapshot.track.id, 'b'); assert.equal(player.snapshot.playing, true); player.pause();
  const jobs = [];
  player.setTrackResolver((song, _failed, _report, signal) => new Promise(resolve => jobs.push({ song, signal, resolve })));
  player.setQueue(['pending-a', 'pending-b'].map(id => track(id, { audioUrl: '' })));
  const first = player.play(); await Promise.resolve(); player.removeFromQueue(0); await Promise.resolve();
  assert.equal(jobs.length, 2); assert.equal(jobs[0].signal.aborted, true);
  jobs[1].resolve({ ...jobs[1].song, audioUrl: 'https://example.com/b' }); await new Promise(resolve => setImmediate(resolve));
  jobs[0].resolve({ ...jobs[0].song, audioUrl: 'https://example.com/a' }); await first;
  assert.equal(player.snapshot.track.id, 'pending-b'); assert.equal(player.snapshot.playing, true);
  player.setTrackResolver(undefined); player.setQueue([]);
});
test('toggle during source resolution cancels the actual request and rejects its late result', async () => {
  let job;
  player.setTrackResolver((song, _failed, _report, signal) => new Promise(resolve => { job = { song, signal, resolve }; }));
  player.setQueue([track('pending-toggle', { audioUrl: '' })]); const pending = player.play(); await Promise.resolve();
  player.toggle(); assert.equal(job.signal.aborted, true);
  job.resolve({ ...job.song, audioUrl: 'https://example.com/late' }); await pending;
  assert.equal(player.snapshot.playing, false); assert.equal(player.snapshot.track.audioUrl, '');
  player.setTrackResolver(undefined); player.setQueue([]);
});
test('fallback search resolves only a complete matching recording and rejects covers/versions/unknown timing', async () => {
  const { resolveCustomTrack } = require('../src/core/sourcePlayback.ts'), candidates = [
    track('cover', { artist: 'Artist & Guest', providerId: 'fallback' }),
    track('punctuation', { title: 'Fix-ture', providerId: 'fallback' }),
    track('timing', { duration: 95, providerId: 'fallback' }),
    track('unknown', { duration: 0, providerId: 'fallback' }),
    track('album', { album: 'Live', providerId: 'fallback' }),
    track('match', { album: 'Studio', providerId: 'fallback', duration: 92 })
  ]; const attempted = [];
  window.yzqxy = { sources: { cachedBest: async () => null, list: async () => [{ id: 'fallback', enabled: true, kind: 'zenix', manifest: { name: 'Fallback', qualities: ['high'], capabilities: ['search', 'resolvePlayback'] } }], search: async () => ({ items: candidates }), resolve: async song => { attempted.push(song.remoteId); return { audioUrl: 'https://example.com/match' }; } } };
  await resolveCustomTrack(track('original', { album: 'Studio' }), [], () => {}, new AbortController().signal);
  assert.deepEqual(attempted, ['match']);
});
test('a pending desktop provider survives elapsed time and advances only on explicit failure', async t => {
  const { resolveCustomTrack } = require('../src/core/sourcePlayback.ts');
  let now = 0; t.mock.method(performance, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cancelled = [], requests = [];let failFirst;
  window.yzqxy = { sources: {
    cachedBest: async () => null,
    list: async () => ['first','second','third'].map(id => ({ id, enabled: true, kind: 'zenix', manifest: { name: id, qualities: ['high'], capabilities: ['search', 'resolvePlayback'] } })),
    cancelRequest: async id => { cancelled.push(id); },
    search: async id => ({ items: [track('same', { providerId: id })] }),
    resolve: async (song, _quality, _id, _allow, requestId) => {
      requests.push({ provider: song.providerId, requestId });
      if (song.providerId === 'first') return new Promise((resolve,reject) => {failFirst=reject;});
      return { audioUrl: 'https://example.com/healthy' };
    }
  } };
  const result = resolveCustomTrack(track('original'), [], () => {}, new AbortController().signal);
  for (let i=0;i<30&&!requests.length;i++) await Promise.resolve();
  assert.equal(requests[0]?.provider, 'first');
  now=300000;t.mock.timers.tick(300000);await Promise.resolve();
  assert.equal(requests.length,1,'elapsed time cannot discard pending resolution');assert.equal(cancelled.length,0);
  failFirst(Error('ECONNRESET'));
  const value=await result;assert.equal(value.audioUrl,'https://example.com/healthy');
  assert.deepEqual(requests.map(row=>row.provider),['first','second']);
  assert.ok(cancelled.includes(requests[0].requestId),'explicitly failed request is released before fallback');
});
test('rapid selection cancels stale source results', async () => {
  const jobs = [];
  player.setTrackResolver((song, _failed, _report, signal) => new Promise(resolve => jobs.push({ song, signal, resolve })));
  player.setQueue([track('slow'), track('fast')]); const first = player.play(); await Promise.resolve(); const second = player.next(); await Promise.resolve();
  assert.equal(jobs.length, 2); assert(jobs[0].signal.aborted);
  jobs[1].resolve({ ...jobs[1].song, audioUrl: 'https://example.com/fast' }); await second;
  jobs[0].resolve({ ...jobs[0].song, audioUrl: 'https://example.com/slow' }); await first;
  assert.equal(player.snapshot.track.id, 'fast'); assert.equal(player.snapshot.track.audioUrl, 'https://example.com/fast');
  player.setTrackResolver(undefined); player.setQueue([]);
});
test('source resolution preserves installation order and falls back quality', async () => {
  const calls = [], sources = ['first', 'second'].map(id => ({ id, enabled: true, kind: 'zenix', manifest: { name: id, capabilities: ['resolvePlayback', 'search'], qualities: ['high', 'standard'] } }));
  window.yzqxy = { sources: { cachedBest: async () => null, list: async () => sources, search: async id => ({ items: [track('1', { providerId: id })] }), resolve: async (song, quality) => { calls.push(`${song.providerId}:${quality}`); if (song.providerId === 'first') throw Error('Unavailable audio'); return { audioUrl: 'https://example.com/audio', actualQuality: quality }; } } };
  localStorage.setItem('zenix.onlineQuality', 'high'); const { resolveCustomTrack } = require('../src/core/sourcePlayback.ts');
  const value = await resolveCustomTrack(track('1'), [], () => {}, new AbortController().signal); assert(value.audioUrl); assert.deepEqual(calls.slice(0, 2), ['first:high', 'first:standard']); assert(calls.indexOf('second:high') > 1);
  calls.length = 0;
  window.yzqxy.sources.diagnostics = async () => ({ smooth: true, sources: { second: { lastPlayedAt: Date.now() } } });
  await resolveCustomTrack(track('1'), [], () => {}, new AbortController().signal);
  assert.equal(calls[0], 'second:high', 'opt-in recent success changes source order without changing quality');
  calls.length = 0;
  await resolveCustomTrack(track('1', { preferredPlaybackProviderId: 'first' }), [], () => {}, new AbortController().signal);
  assert.equal(calls[0], 'first:high', 'explicit per-song source takes precedence over adaptive order');
});


test('queue edits preserve the playing decoder, selected identity and clock; stale undo cannot erase later additions',async()=>{
  const songs=['edit-a','edit-b','edit-c'].map(id=>track(id,{source:'local',audioUrl:'file://fixture.wav'}));player.setShuffle(false);player.setQueue(songs);await player.play();player.seek(23);
  const audio=player.audio,source=audio.src;let playEvents=0;const played=()=>playEvents++;audio.addEventListener('play',played);
  player.editQueue('move',{expected:songs.map(song=>song.id),from:2,to:0});assert.equal(player.snapshot.track.id,'edit-a');assert.equal(player.snapshot.queueIndex,1);assert.equal(player.snapshot.position,23);assert.equal(audio.src,source);assert.equal(playEvents,0);
  player.playNext(songs[2]);assert.deepEqual(player.snapshot.queue.map(song=>song.id),['edit-a','edit-c','edit-b']);assert.equal(player.snapshot.track.id,'edit-a');assert.equal(player.snapshot.position,23);
  const before=player.snapshot.queue;player.editQueue('remove',{ids:['edit-b'],expected:before.map(song=>song.id)});player.enqueue(track('later',{source:'local',audioUrl:'file://fixture.wav'}));
  assert.throws(()=>player.editQueue('restore',{tracks:before,expected:['edit-a','edit-c']}),/已变化/);assert.equal(player.snapshot.queue.at(-1).id,'later');assert.equal(playEvents,0);audio.removeEventListener('play',played);player.setQueue([]);
});

test('next-play on an idle queue selects and starts while enqueue alone stays idle',async()=>{
  player.setQueue([]);player.enqueue(track('queued-idle',{source:'local',audioUrl:'yzqxy://audio/queued-idle'}));
  assert.equal(player.snapshot.track,undefined);assert.equal(player.snapshot.playing,false);
  player.playNext(track('next-idle',{source:'local',audioUrl:'yzqxy://audio/next-idle'}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(player.snapshot.track?.id,'next-idle');assert.equal(player.snapshot.playing,true);
  assert.deepEqual(player.snapshot.queue.map(song=>song.id),['next-idle','queued-idle']);player.setQueue([]);
  player.playNext(track('first-idle',{source:'local',audioUrl:'yzqxy://audio/first-idle'}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(player.snapshot.track?.id,'first-idle');assert.equal(player.snapshot.playing,true);player.setQueue([]);
});

test('existing large desktop queues can move, shrink and undo without restarting playback',async()=>{
  const songs=Array.from({length:1500},(_,index)=>track('bulk-'+index,{source:'local',audioUrl:'yzqxy://audio/bulk-'+index}));
  player.setQueue(songs);await player.play();player.seek(23);const audio=player.audio,source=audio.src;let starts=0;const started=()=>starts++;audio.addEventListener('play',started);
  try{
    player.editQueue('move',{expected:songs.map(song=>song.id),from:1499,to:0});
    assert.equal(player.snapshot.queue.length,1500);assert.equal(player.snapshot.track.id,'bulk-0');assert.equal(player.snapshot.queueIndex,1);
    const before=player.snapshot.queue;player.editQueue('remove',{expected:before.map(song=>song.id),ids:['bulk-100']});
    assert.equal(player.snapshot.queue.length,1499);assert(!player.snapshot.queue.some(song=>song.id==='bulk-100'));
    const expected=player.snapshot.queue.map(song=>song.id);player.editQueue('restore',{expected,tracks:before});
    assert.deepEqual(player.snapshot.queue.map(song=>song.id),before.map(song=>song.id));
    assert.equal(player.snapshot.track.id,'bulk-0');assert.equal(player.snapshot.position,23);assert.equal(audio.src,source);assert.equal(starts,0);
    assert.throws(()=>player.editQueue('restore',{tracks:[...before,before[0]]}),/重复/);
    assert.throws(()=>player.editQueue('restore',{tracks:before,expected:songs.map(song=>song.id)}),/已变化/);
  }finally{audio.removeEventListener('play',started);player.setQueue([]);}
});


test('automatic replacement skips unavailable queue entries once and stops when the whole queue fails',async()=>{
 const calls=[];const songs=['auto-a','auto-b','auto-c'].map(id=>track(id,{source:'custom',audioUrl:'',playlistId:'fixture-list'}));
 player.setShuffle(false);player.setRepeat('all');
 player.setTrackResolver(async song=>{calls.push(song.id);if(song.id!=='auto-c')throw Object.assign(Error('3 candidates failed'),{code:'AUTOMATIC_REPLACEMENT_UNAVAILABLE'});return{...song,audioUrl:'file://fixture.wav'};});
 player.setQueue(songs);await player.play();for(let i=0;i<20&&!player.snapshot.playing;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['auto-a','auto-b','auto-c']);assert.equal(player.snapshot.track.id,'auto-c');assert.equal(player.snapshot.playing,true);
 player.pause();calls.length=0;player.setTrackResolver(async song=>{calls.push(song.id);throw Object.assign(Error('3 candidates failed'),{code:'AUTOMATIC_REPLACEMENT_UNAVAILABLE'});});
 player.setQueue(songs);await player.play();for(let i=0;i<20&&!player.snapshot.error;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['auto-a','auto-b','auto-c']);assert.equal(player.snapshot.playing,false);assert.match(player.snapshot.error,/没有可播放/);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,3,'repeat-all must not loop through failing songs forever');
 player.setTrackResolver(undefined);player.setQueue([]);
});


test('roaming replay window retains exactly three prior heard songs and preserves the forward sequence',()=>{
 const {RoamingHistory}=require('../src/core/roamingHistory.ts'),history=new RoamingHistory();assert.equal(history.previous(''),undefined);
 for(let i=1;i<=5;i++){history.record(track('heard-'+i));assert.equal(history.before('heard-'+i).length,Math.min(3,i-1));}
 assert.deepEqual(history.before('heard-5').map(song=>song.id),['heard-2','heard-3','heard-4']);
 for(let i=4;i>=2;i--){const previous=history.previous('heard-'+(i+1));assert.equal(previous.id,'heard-'+i);history.record(previous);}
 assert.equal(history.previous('heard-2'),undefined);assert.equal(history.has('heard-1'),false);
 for(let i=3;i<=5;i++){const next=history.next('heard-'+(i-1));assert.equal(next.id,'heard-'+i);history.record(next);}
 assert.equal(history.next('heard-5'),undefined);history.record(track('heard-6'));assert.deepEqual(history.before('heard-6').map(song=>song.id),['heard-3','heard-4','heard-5']);
 assert.equal(history.previous('pending-unheard').id,'heard-6');history.clear();assert.equal(history.previous(''),undefined);
});

test('production desktop roaming previous replays heard tracks without restarting recommendations or leaving roaming',async()=>{
 const vm=require('node:vm'),ts=require('typescript'),engine=require('../electron/roaming-engine.cjs'),{RoamingHistory}=require('../src/core/roamingHistory.ts');
 const candidates=Array.from({length:30},(_,i)=>track('roam-'+i,{title:'漫游歌曲 '+i,artist:'漫游歌手',duration:120})),lifecycle=new Set(),updates=new Set(),seen=new Set();
 let navigation,resumeHandler;const fake={snapshot:{repeat:'all',playing:false,position:0,duration:120,queue:[],queueIndex:-1},subscribeLifecycle(fn){lifecycle.add(fn);return()=>lifecycle.delete(fn);},subscribe(fn){updates.add(fn);return()=>updates.delete(fn);},setNavigationHandler(fn){navigation=fn;},setResumeHandler(fn){resumeHandler=fn;},setRepeat(value){this.snapshot.repeat=value;},pause(internal){this.snapshot.playing=false;for(const fn of lifecycle)fn({type:internal?'pause':'pause-request',track:this.snapshot.track});},retainCurrentTrack(){this.snapshot.queue=this.snapshot.track?[this.snapshot.track]:[];},syncRoamingQueue(upcoming,previous=[]){const current=this.snapshot.track,ids=new Set([...previous.map(s=>s.id),current?.id]);this.snapshot.queue=current?[...previous,current,...upcoming.filter(s=>!ids.has(s.id))]:upcoming;this.snapshot.queueIndex=previous.length;},async playTrack(song,queue,origin){assert.equal(origin,'roaming');this.snapshot={...this.snapshot,track:song,queue,playing:true,error:undefined};for(const fn of lifecycle)fn({type:'audible',track:song});for(const fn of updates)fn(this.snapshot);},async play(){this.snapshot.playing=true;},toggle(){this.snapshot.playing=!this.snapshot.playing;}};
 class Ledger {async load(){return engine.createState();}async save(state){Object.keys(state.seen).forEach(id=>seen.add(id));}async unseen(rows){return rows.filter(s=>!seen.has(engine.identity(s)));}}
 const module={exports:{}},file=path.resolve(__dirname,'../src/core/roaming.ts'),compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let searchPages=0;const sources={list:async()=>[{id:'fixture',enabled:true,manifest:{capabilities:['search']}}],search:async()=>({items:candidates,nextCursor:searchPages++===0?'page2':null})};
 vm.runInNewContext(compiled,{module,exports:module.exports,require:name=>{if(name==='./player')return{player:fake};if(name==='./roamingHistory')return{RoamingHistory};if(name==='./roamingStore')return{RoamingStore:Ledger};if(name==='./roamingEngine')return engine;if(name==='./sourceDeadline')return{sourceDeadline:async op=>op(),sourceRequest:async(op,signal)=>{signal.throwIfAborted();return op('fixture');}};throw Error(name);},window:{yzqxy:{sources}},performance,AbortController,Set,Map,console},{filename:file});
 const roaming=module.exports.roaming,disconnect=roaming.connect();
 try{roaming.setPersonal({liked:[track('seed',{title:'种子',artist:'漫游歌手'})],favorites:[],history:[],playlists:[]});await roaming.start();await new Promise(resolve=>setImmediate(resolve));const heard=[fake.snapshot.track.id];
 for(let i=0;i<4;i++){await navigation('next');await new Promise(resolve=>setImmediate(resolve));heard.push(fake.snapshot.track.id);}assert.equal(new Set(heard).size,5);assert.deepEqual(fake.snapshot.queue.slice(0,fake.snapshot.queueIndex).map(s=>s.id),heard.slice(1,4));const discovered=roaming.snapshot.discovered;
 for(let i=3;i>=1;i--){await navigation('previous');assert.equal(fake.snapshot.track.id,heard[i]);assert.equal(roaming.snapshot.active,true);}
 await navigation('previous');assert.equal(fake.snapshot.track.id,heard[1],'first retained song stays playing');
 for(let i=2;i<5;i++){await navigation('next');assert.equal(fake.snapshot.track.id,heard[i]);}assert.equal(roaming.snapshot.discovered,discovered,'replays are not new recommendations');assert.equal(fake.snapshot.repeat,'all','replay does not change the ordinary repeat preference');
 const beforeFailure=fake.snapshot.track.id,playTrack=fake.playTrack.bind(fake);let failedId='';
 fake.playTrack=async(song,queue,origin)=>{if(!failedId){failedId=song.id;fake.snapshot={...fake.snapshot,track:song,queue,playing:false,error:'explicit source failure'};for(const fn of lifecycle)fn({type:'failure',track:song});return;}return playTrack(song,queue,origin);};
 await navigation('next');for(let i=0;i<20&&!fake.snapshot.playing;i++)await new Promise(resolve=>setImmediate(resolve));assert.notEqual(fake.snapshot.track.id,failedId);const replayContext={heard,beforeFailure,failedId,current:fake.snapshot.track.id,queue:fake.snapshot.queue.map(s=>s.id),index:fake.snapshot.queueIndex,phase:roaming.snapshot.phase};await navigation('previous');assert.equal(fake.snapshot.track.id,beforeFailure,'a song that failed before audible playback never occupies the replay window: '+JSON.stringify(replayContext));

 }finally{disconnect();}
});
