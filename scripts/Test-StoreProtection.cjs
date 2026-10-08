const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { PersonalStore } = require('../electron/personal.cjs'), { LocalLibrary } = require('../electron/library.cjs');
const song = { id: 'fixture', path: '', title: 'Fixture', artist: 'Artist', source: 'custom', remoteId: 'fixture', providerId: 'fixture', audioUrl: '', duration: 90 };
async function folder(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zenix-store-protection-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory; }
test('damaged personal library is reported and cannot be overwritten by record/toggle/import', async t => {
  for (const text of ['{broken', 'null', '{"liked":{}}', '{"playlists":[null]}']) {
    const directory = await folder(t), file = path.join(directory, 'personal-library.json'); await fs.writeFile(file, text);
    const store = new PersonalStore(directory); await assert.rejects(store.load(), /保留原文件/); assert.throws(() => store.snapshot(), /停止写入/);
    await assert.rejects(store.record(song), /停止写入/); await assert.rejects(store.toggle('liked', song), /停止写入/);
    await assert.rejects(store.importPlaylists([{ name: 'fixture', tracks: [song] }]), /停止写入/); assert.equal(await fs.readFile(file, 'utf8'), text);
  }
});
test('personal playlists and saved songs survive a fresh process/store after successful writes', async t => {
  const directory = await folder(t), first = new PersonalStore(directory); await first.load(); await first.toggle('liked', song); await first.createPlaylist('fixture', song);
  const next = new PersonalStore(directory), value = await next.load(); assert.equal(value.liked[0].id, song.id); assert.equal(value.playlists[0].tracks[0].id, song.id);
});
test('damaged local library never silently becomes an empty writable library', async t => {
  for (const text of ['{broken', '{"version":2}', '{"version":1,"roots":[],"looseFiles":[],"records":[],"playlists":[{}]}']) {
    const directory = await folder(t), file = path.join(directory, 'library.json'); await fs.writeFile(file, text);
    const library = new LocalLibrary(directory, () => {}); await assert.rejects(library.load(), /保留原文件/);
    await assert.rejects(library.createPlaylist('new'), /停止写入/); await assert.rejects(library.save(), /停止写入/); assert.equal(await fs.readFile(file, 'utf8'), text);
  }
});
test('local playlist schema persists and reloads without changing identity', async t => {
  const directory = await folder(t), first = new LocalLibrary(directory, () => {}); const saved = await first.createPlaylist('fixture');
  const next = new LocalLibrary(directory, () => {}), loaded = await next.load(); assert.equal(loaded.playlists[0].id, saved.playlists[0].id); assert.equal(loaded.playlists[0].name, 'fixture');
});

test('legacy optional local-library arrays retain compatibility', async t => {
  const directory = await folder(t); await fs.writeFile(path.join(directory, 'library.json'), '{"version":1,"records":[]}');
  const library = new LocalLibrary(directory, () => {}); assert.equal((await library.load()).tracks.length, 0); await library.createPlaylist('fixture');
  assert.equal((await new LocalLibrary(directory, () => {}).load()).playlists.length, 1);
});

test('production player survives damaged preferences and restores a usable paused queue', async () => {
  const vm = require('node:vm'), ts = require('typescript');
  const source = ts.transpileModule(await fs.readFile(path.resolve(__dirname, '../src/core/player.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  class Audio {
    set volume(value) { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw Error('Invalid Audio.volume'); this.value = value; }
    get volume() { return this.value; }
    addEventListener() {} removeAttribute() {} load() {} pause() {}
  }
  for (const volume of ['wrong', {}, null, -1, 5, .4]) {
    const saved = { 'yzqxy.volume': JSON.stringify(volume), 'yzqxy.muted': '"false"', 'yzqxy.shuffle': '{}', 'yzqxy.queue': JSON.stringify({ ids: ['fixture'], index: .5 }) }, exports = {};
    vm.runInNewContext(source, { exports, Audio, navigator: {}, window: {}, localStorage: { getItem: key => saved[key] ?? null, setItem: () => {} }, clearTimeout, setTimeout, AbortController });
    const player = exports.player; player.restoreQueue([song]);
    assert.equal(player.snapshot.track.id, song.id); assert.equal(player.snapshot.queueIndex, 0); assert.equal(player.snapshot.playing, false);
    assert.equal(player.snapshot.muted, false); assert.equal(player.snapshot.shuffle, false); assert.equal(player.snapshot.volume, typeof volume === 'number' ? Math.max(0, Math.min(1, volume)) : .75); player.dispose();
  }
});
