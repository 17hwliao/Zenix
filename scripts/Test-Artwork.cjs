const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), { createRequire } = require('node:module');
const { MetadataCache } = require('../electron/runtime/metadata-cache.cjs');
function isolated(file, stubs) {
  const filename = path.resolve(__dirname, '..', file), module = { exports: {} }, requireFrom = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: id => stubs[id] || requireFrom(id), Error, Buffer, Response, Headers, URL, URLSearchParams, AbortSignal, AbortController, setTimeout, clearTimeout, console });
  return module.exports;
}
async function folder(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'zenix-artwork-')); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}
for (const native of [false, true]) test(`${native ? 'portable' : 'desktop'} catalogue: new and old Kugou covers never call the broken TLS endpoint or resolve audio`, async () => {
  const calls = [];
  const transport = async url => {
    calls.push(String(url));
    if (String(url).includes('song_search_v2')) return new Response(JSON.stringify({ error_code: 0, data: { total: 1, lists: [{ Audioid: 12, MixSongID: 98, FileHash: 'HASH', OriSongName: 'Waiting for Love', Image: 'http://imge.kugou.com/stdmusic/{size}/album.jpg' }] } }));
    assert.match(String(url), /^https:\/\/m\.kugou\.com\/app\/i\/getSongInfo\.php\?cmd=playInfo&hash=HASH$/);
    return new Response(JSON.stringify({ status: 0, error: '需要付费', album_img: 'http://imge.kugou.com/stdmusic/{size}/album.jpg', imgUrl: 'http://singerimg.kugou.com/singer.jpg', url: 'https://must-not-play.test/audio' }));
  };
  let api;
  if (native) {
    const context = { Buffer, URL, URLSearchParams, AbortSignal, fetch: transport };
    vm.runInNewContext((await import('./Portable-Catalog.mjs')).portableCatalog(), context); api = context.zenixCatalog;
  } else api = isolated('electron/lx-catalog.cjs', { './runtime/source-network.cjs': { fetchAllowed: transport, readLimited: async r => Buffer.from(await r.arrayBuffer()) } });
  const page = await api.search('kg', 'Waiting for Love', 1, 25), track = page.items[0];
  assert.equal(track.coverUrl, 'https://imge.kugou.com/stdmusic/480/album.jpg');
  assert.equal(api.readInfo(track.remoteId).img, null, 'cover hints cannot change saved song IDs'); assert.equal(calls.length, 1);
  assert.equal(await api.artwork({ source: 'kg', hash: 'HASH', songmid: 12 }), track.coverUrl); assert.equal(calls.length, 2);
  assert.equal(await api.artwork({ source: 'wy', img: 'http://p1.music.126.net/album.jpg' }), 'https://p1.music.126.net/album.jpg');
});
async function service(t, fetcher, resolve) {
  const root = await folder(t), metadataCache = new MetadataCache(root); await metadataCache.probeWritable();
  const { SourceArtwork } = isolated('electron/runtime/source-artwork.cjs', { './source-network.cjs': { fetchAllowed: (url, _patterns, options) => fetcher(url, options), readLimited: async r => Buffer.from(await r.arrayBuffer()) } });
  const artwork = new SourceArtwork({ folder: path.join(root, 'covers'), metadataCache, resolve: resolve || (async () => ({ url: 'https://images.example.test/cover', patterns: ['images.example.test'], options: {} })) });
  t.after(() => { artwork.close(); clearTimeout(metadataCache.timer); }); return { artwork, metadataCache, root };
}
const image = () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { headers: { 'Content-Type': 'image/jpeg' } });
test('production artwork failure is not cached; same URL recovers and successful bytes persist independently', async t => {
  let calls = 0;
  const { artwork } = await service(t, async () => ++calls === 1 ? new Response(null, { status: 503 }) : image());
  const bad = await artwork.cover(null, 'source', 'song'); assert.equal(bad.status, 503); assert.equal(bad.headers.get('cache-control'), 'no-store');
  const good = await artwork.cover(null, 'source', 'song'); assert.equal(good.status, 200); assert.equal((await good.arrayBuffer()).byteLength, 4); assert.equal(calls, 2);
  artwork.clearMemory(); assert.equal((await artwork.cover(null, 'source', 'song')).status, 200); assert.equal(calls, 2, 'disk cache does not need the playback source');
});
test('artwork deduplicates consumers, bounds concurrency, and closes only its own requests', async t => {
  let active = 0, peak = 0, calls = 0; const releases = [];
  const { artwork } = await service(t, async (_url, options) => {
    calls++; active++; peak = Math.max(peak, active);
    return new Promise((resolve, reject) => {
      releases.push(() => { active--; resolve(image()); });
      options.signal.addEventListener('abort', () => { active--; reject(Error('artwork cancelled')); }, { once: true });
    });
  });
  const first = artwork.get('source', '1'); assert.equal(artwork.get('source', '1'), first);
  const others = [artwork.get('source', '2'), artwork.get('source', '3')];
  for (let n = 0; n < 100 && calls < 2; n++) await new Promise(r => setTimeout(r, 5));
  assert.equal(calls, 2); assert.equal(peak, 2);
  releases[0]();
  for (let n = 0; n < 100 && calls < 3; n++) await new Promise(r => setTimeout(r, 5)); assert.equal(calls, 3);
  const unrelated = new AbortController(); artwork.close();
  const results = await Promise.all([first, ...others]);
  assert.equal(results.filter(value => value.data).length, 1); assert.equal(results.filter(value => value.status === 404).length, 2);
  assert.equal(unrelated.signal.aborted, false); assert.equal(artwork.pending.size, 0); assert.equal(artwork.active, 0);
});
test('cache disk failures and non-image responses never become playback failures or cached images', async t => {
  let valid = false, writes = 0;
  const { artwork, metadataCache } = await service(t, async () => valid ? image() : new Response('<html>error</html>', { headers: { 'Content-Type': 'text/html' } }));
  assert.equal((await artwork.cover(null, 'source', '1')).status, 502); assert.equal(artwork.cache.size, 0);
  metadataCache.writeEnabled = false; const original = metadataCache.write.bind(metadataCache); metadataCache.write = (...args) => { writes++; return original(...args); };
  valid = true; assert.equal((await artwork.cover(null, 'source', '1')).status, 200); assert.equal(writes, 1);
  assert.equal(metadataCache.writeEnabled, false); assert.equal((await fsp.readdir(artwork.folder)).length, 0);
});
test('metadata clear rejects late old writes and retains new-epoch cover and lyric data', async t => {
  const root = await folder(t), cache = new MetadataCache(root); await cache.probeWritable();
  const cover = path.join(root, 'covers', 'a'.repeat(64) + '.bin'), lyric = path.join(root, 'lyrics', 'b'.repeat(64) + '.json');
  const old = cache.epoch, clearing = cache.clear();
  await Promise.all([clearing, cache.write([[cover, 'stale']], old), cache.write([[cover, 'new'], [lyric, 'lyrics']], cache.epoch)]);
  assert.equal(await fsp.readFile(cover, 'utf8'), 'new'); assert.equal(await fsp.readFile(lyric, 'utf8'), 'lyrics');
});
test('artwork and lyric invocation cannot set or erase playback health; playback still reports actual errors', async () => {
  const { SourceManager } = isolated('electron/sources.cjs', { electron: { ipcMain: {} } });
  let fail = true, broadcasts = 0;
  const runner = { window: {}, startTask: Promise.resolve(), acquire() {}, release() {}, async invoke() { if (fail) throw Error('fixture failure'); return { url: 'cover' }; } };
  const manager = { record: () => ({ manifest: { capabilities: ['artwork', 'lyrics', 'resolvePlayback'] } }), runner: () => runner, settings: {}, errors: new Map([['source', 'existing playback failure']]), runners: new Map(), broadcast() { broadcasts++; }, list: () => [] };
  for (const method of ['artwork', 'lyrics']) {
    await assert.rejects(SourceManager.prototype.call.call(manager, 'source', method, {}), /fixture failure/);
    fail = false; await SourceManager.prototype.call.call(manager, 'source', method, {}); fail = true;
    assert.equal(manager.errors.get('source'), 'existing playback failure'); assert.equal(broadcasts, 0);
  }
  await assert.rejects(SourceManager.prototype.call.call(manager, 'source', 'resolvePlayback', {})); assert.equal(manager.errors.get('source'), 'fixture failure'); assert.equal(broadcasts, 1);
});
test('saved songs without explicit coverUrl render consistently; old negative cache is bypassed without changing track data', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/core/trackCover.ts'), 'utf8');
  const code = require('typescript').transpileModule(source, { compilerOptions: { module: require('typescript').ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} }; vm.runInNewContext(code, { module, exports: module.exports, URL });
  const { trackCoverUrl, coverRequestUrl } = module.exports;
  const track = { id: 'saved', source: 'custom', providerId: 'lx.fixture', remoteId: 'saved-song' }, before = JSON.stringify(track);
  assert.equal(trackCoverUrl(track), 'yzqxy://source-cover/lx.fixture/saved-song?artwork=2');
  assert.equal(JSON.stringify(track), before);
  assert.equal(coverRequestUrl('https://cdn.example.test/signed?token=private'), 'https://cdn.example.test/signed?token=private', 'never append parameters to externally signed URLs');
  assert.equal(coverRequestUrl(trackCoverUrl(track), 2), 'yzqxy://source-cover/lx.fixture/saved-song?artwork=2&retry=2');
});
test('real Electron artwork UI: automatic retry, stale-image isolation and media protocol decoding', { skip: process.platform !== 'win32' }, async t => {
  const { createServer } = await import('vite'), root = await folder(t);
  const server = await createServer({ cacheDir: path.join(root, 'vite'), optimizeDeps: { entries: ['scripts/fixtures/artwork.html'] }, server: { host: '127.0.0.1', port: 0, strictPort: false }, logLevel: 'error' });
  t.after(() => server.close()); await server.listen();
  const env = { ...process.env, ZENIX_TEST_USER_DATA: root, ZENIX_TEST_UI_URL: `http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/artwork.html` }; delete env.ELECTRON_RUN_AS_NODE;
  const { stdout, stderr } = await require('node:util').promisify(require('node:child_process').execFile)(require('electron'), [path.join(__dirname, 'fixtures/ElectronArtworkUi.cjs')], { env, windowsHide: true, timeout: 45000 });
  assert.match(stdout, /ARTWORK_UI_PASS/, stderr);
});
