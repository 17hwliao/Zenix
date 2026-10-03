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
const { stickerSlotsForCount, expandedStickerLayout } = require('../src/ui/stickerMosaic.ts');
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
});
