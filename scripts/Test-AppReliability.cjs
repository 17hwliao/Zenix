const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { execFile } = require('node:child_process'), { promisify } = require('node:util');
const { encode, decode } = require('../electron/runtime/backup-format.cjs');
const { cleanPayload, mergePersonal, mergeStats, restoreTrack } = require('../src/core/backupFormat.cjs');
const { mergeSearchGroups, queueForSelection } = require('../src/core/searchGroups.cjs');
const { redact } = require('../src/core/sourceDiagnostics.cjs');
const { SourceDiagnostics } = require('../electron/runtime/source-diagnostics.cjs');
const { PersonalStore } = require('../electron/personal.cjs');
const { ListeningStore } = require('../electron/runtime/listening-store.cjs');
const { BackupManager } = require('../electron/runtime/backup-manager.cjs');
const song = { id: 'source:a:1', providerId: 'a', remoteId: '1', title: '银河', artist: '测试歌手', album: '专辑', duration: 120, source: 'custom', audioUrl: 'https://private.example/audio?token=private-secret', path: 'C:/private/song.mp3', headers: { Authorization: 'private-secret' } };
const personal = () => ({ liked: [], favorites: [], history: [], playlists: [] });
const stats = () => ({ startedAt: 10, tracks: { aaaaaaaaaaaaaaaaaaaaaaaa: { title: song.title, artist: song.artist } }, days: { '2026-10-11': { date: '2026-10-11', seconds: 60, plays: 1, tracks: { aaaaaaaaaaaaaaaaaaaaaaaa: { seconds: 60, plays: 1 } } } } });
async function temporary(t) { const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zenix-reliability-')); t.after(() => fs.rm(folder, { recursive: true, force: true })); return folder; }

test('actual-use diagnostics separate address resolution from audible playback; bounded and redacted', async t => {
  const folder = await temporary(t), diagnostics = new SourceDiagnostics(folder); await diagnostics.load();
  const id = diagnostics.record('a', Date.now() - 30); assert.equal(diagnostics.state().sources.a.resolved, 1); assert.equal(diagnostics.state().sources.a.played, 0);
  diagnostics.outcome(id, true); diagnostics.outcome(id, true); assert.equal(diagnostics.state().sources.a.played, 1);
  diagnostics.record('a', Date.now(), Error('Timeout https://private.example?token=private-secret')); diagnostics.record('a', Date.now(), Error('Aborted'));
  assert.equal(diagnostics.state().sources.a.attempts, 2); assert.equal(diagnostics.state().sources.a.lastFailure, '连接超时');
  for (let i = 0; i < 90; i++) diagnostics.record('constructor', Date.now()); await diagnostics.pending;
  assert.equal(diagnostics.state().sources.constructor.attempts, 80); assert.ok(!(await fs.readFile(diagnostics.file, 'utf8')).includes('private-secret'));
  diagnostics.configure(true); await diagnostics.pending; const reopened = new SourceDiagnostics(folder); await reopened.load(); assert.equal(reopened.state().smooth, true);
  assert.ok(!redact('https://private.example?token=private-secret cookie=private-secret C:\\private\\song.mp3').includes('private-secret'));
  assert.ok(!redact('Authorization: Bearer private-secret\nCookie: sid=private-secret; token=private-secret').includes('private-secret'));
});

test('search grouping is conservative, incremental and ephemeral; explicit version queue retains every song', () => {
  const b = { ...song, providerId: 'b', id: 'source:b:1' }, other = { ...song, title: '另一首', id: 'other' };
  const first = mergeSearchGroups([], [song, other]), merged = mergeSearchGroups(first, [b]);
  assert.deepEqual(merged.map(row => row.id), first.map(row => row.id)); assert.equal(merged[0].searchAlternatives.length, 2); assert.equal(first[0].searchAlternatives, undefined);
  for (const patch of [{ title: '银河 (Live)' }, { title: '银河 (伴奏)' }, { title: '银河 (Remastered)' }, { artist: '翻唱歌手' }, { duration: 0 }, { duration: 124 }, { album: '现场专辑' }]) assert.equal(mergeSearchGroups(first, [{ ...b, ...patch }]).length, 3);
  assert.equal(mergeSearchGroups(merged, [b]).length, 2);
  const queue = queueForSelection(merged, { ...b, preferredPlaybackProviderId: 'b' }); assert.deepEqual(queue.map(row => row.id), [b.id, other.id]); assert.equal(queue[0].preferredPlaybackProviderId, 'b'); assert.equal(queue[0].searchAlternatives, undefined);
  assert.equal(song.id, 'source:a:1');
});

test('portable backup integrity, future-schema rejection and exclusion of playback addresses/private paths', () => {
  const payload = { personal: { liked: [song, { ...song, source: 'local', id: 'C:/private/song.mp3' }], favorites: [], playlists: [{ name: '歌单', tracks: [song] }] }, profile: { name: '测试', email: 'fixture@example.test', token: 'private-secret' } };
  const text = encode(payload); assert.ok(!text.includes('private-secret')); assert.ok(!text.includes('C:/private')); assert.ok(!text.includes('private.example'));
  const result = decode(text); assert.equal(result.personal.liked[0].id, song.id); assert.equal(result.profile.token, undefined);
  const envelope = JSON.parse(text); envelope.payload = envelope.payload.replace('银河', '篡改'); assert.throws(() => decode(JSON.stringify(envelope)), /完整性/);
  envelope.schemaVersion = 2; assert.throws(() => decode(JSON.stringify(envelope)), /更新/);
  assert.throws(() => decode('{}')); assert.throws(() => cleanPayload({ personal: { liked: [{}] } }));
});

test('backup merge is repeatable; conflicting playlists stay independent; missing local recordings retained', () => {
  const local = { ...song, source: 'local', id: 'old-local' }, payload = cleanPayload({ personal: { liked: [song, local], favorites: [song], playlists: [{ name: '歌单', tracks: [song, local] }] } });
  const current = personal(); current.playlists.push({ id: 'original', name: '歌单', tracks: [] });
  const selected = ['liked', 'favorites', 'playlists']; let serial = 0;
  const first = mergePersonal(current, payload.personal, selected, [], () => String(++serial)); assert.equal(first.personal.liked[1].availability, 'unavailable'); assert.equal(first.personal.playlists[0].id, 'original'); assert.match(first.personal.playlists[1].name, /导入/);
  const twice = mergePersonal(first.personal, payload.personal, selected, [], () => String(++serial)); assert.deepEqual(twice.personal, first.personal); assert.equal(twice.result.added, 0, 'repeat restore reports no added records');
  const available = { ...local, id: 'local-new', duration: 122, path: 'fixture.mp3', audioUrl: 'yzqxy://audio/fixture' };
  assert.equal(restoreTrack(payload.personal.liked[1], [available, { ...available, id: 'ambiguous' }]).availability, 'unavailable');
  const linked = mergePersonal(first.personal, payload.personal, selected, [available], () => String(++serial)); assert.equal(linked.personal.liked.length, 2); assert.equal(linked.personal.liked[1].id, 'local-new'); assert.equal(linked.personal.playlists.length, 2);
  assert.deepEqual(mergePersonal(current, payload.personal, [], [], () => 'unused').personal, current);
});

test('stats restoration uses per-day per-song maxima rather than repeatedly adding listening time', () => {
  const first = mergeStats(stats(), stats()); assert.equal(first.days['2026-10-11'].seconds, 60); assert.deepEqual(mergeStats(first, stats()), first);
});

// An injected test provider exercises the real protected-envelope paths without
// requiring the user's Windows encryption profile. Production uses safeStorage.
const protection = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async text => Buffer.from(text), decryptStringAsync: async bytes => ({ result: bytes.toString(), shouldReEncrypt: false }) };
async function manager(t) {
  const folder = await temporary(t), personalStore = new PersonalStore(folder); await personalStore.load();
  const listening = new ListeningStore(folder); await listening.load();
  const appearance = { folder: path.join(folder, 'appearance'), settings: { completed: true, background: null }, async save(value) { this.settings = structuredClone(value); return this.snapshot(); }, async snapshot() { return this.settings; } };
  const backup = new BackupManager({ folder, personal: personalStore, library: { snapshot: () => ({ tracks: [] }) }, appearance, stats: listening, dialog: {}, getWindow: () => null, broadcast: () => {}, protection });
  return { backup, store: personalStore, listening, appearance, folder };
}

test('production backup transaction persists merged data, undo snapshot survives reopening, and never overwrites new edits', async t => {
  const { backup, store, listening, appearance, folder } = await manager(t); await store.toggle('favorites', song);
  backup.pending = { token: 'fixture', payload: cleanPayload({ personal: { liked: [song] }, profile: { name: 'imported' } }) };
  const before = JSON.parse(JSON.stringify(store.snapshot())), browser = { profile: { name: 'original' }, transparency: 0 };
  const result = await backup.invoke({ operation: 'backupApply', token: 'fixture', sections: ['liked', 'profile'], browser });
  assert.equal((await new PersonalStore(folder).load()).liked.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(store.snapshot().favorites)), before.favorites); assert.equal(result.browser.profile.name, 'imported'); await backup.invoke({ operation: 'backupAcknowledge', browser: result.browser });
  const reopened = new BackupManager({ folder, personal: store, stats: listening, appearance, library: { snapshot: () => ({ tracks: [] }) }, broadcast: () => {}, protection });
  await reopened.load(); const undo = await reopened.invoke({ operation: 'backupUndo', browser: result.browser }); assert.equal(undo.browser.profile.name, 'original'); await reopened.invoke({ operation: 'backupAcknowledge', browser: undo.browser }); assert.deepEqual(store.snapshot(), before);
  backup.pending = { token: 'second', payload: cleanPayload({ personal: { liked: [song] } }) }; await backup.invoke({ operation: 'backupApply', token: 'second', sections: ['liked'], browser }); await store.toggle('favorites', { ...song, id: 'another', remoteId: '2' });
  await assert.rejects(backup.invoke({ operation: 'backupUndo', browser }), /新资料/); assert.equal(store.snapshot().favorites.length, 2);
});

test('transaction failure restores disk and memory; queued personal writes resume safely; pending journal recovers', async t => {
  const { backup, store, listening, appearance, folder } = await manager(t); await store.toggle('favorites', song); const before = store.snapshot();
  backup.pending = { token: 'fixture', payload: cleanPayload({ personal: { liked: [song] }, appearance: { transparency: 40 } }) };
  const save = appearance.save.bind(appearance); let once = true; appearance.save = async value => { if (once) { once = false; throw Error('synthetic disk failure'); } return save(value); };
  await assert.rejects(backup.invoke({ operation: 'backupApply', token: 'fixture', sections: ['liked', 'appearance'], browser: {} }), /disk failure/); assert.deepEqual(store.snapshot(), before); assert.deepEqual(await new PersonalStore(folder).load(), before);
  let entered; const gate = new Promise(resolve => { entered = resolve; }); let release; const hold = new Promise(resolve => { release = resolve; }); const transaction = backup.exclusive(async () => { entered(); await hold; }); await gate; const pending = store.toggle('liked', song); assert.equal(store.snapshot().liked.length, 0); release(); await Promise.all([transaction, pending]); assert.equal(store.snapshot().liked.length, 1);
  const old = backup.capture({}), corrupted = structuredClone(old); corrupted.personal.liked = []; await backup.writeJournal({ pending: true, before: old, after: corrupted, sections: ['liked'] }); store.data = corrupted.personal; await store.save();
  const restarted = new BackupManager({ folder, personal: store, stats: listening, appearance, broadcast: () => {}, protection }); await restarted.load(); assert.equal(store.snapshot().liked.length, 1); assert.equal(await restarted.readJournal(), null);
});

test('interrupted desktop profile receipt preserves later edits and completes only the pending browser sync', async t => {
  const { backup, store, listening, appearance, folder } = await manager(t);
  const browser = { profile: { name: 'before' }, transparency: 0 };
  backup.pending = { token: 'interrupted', payload: cleanPayload({ personal: { liked: [song] }, profile: { name: 'after' } }) };
  await backup.invoke({ operation: 'backupApply', token: 'interrupted', sections: ['liked', 'profile'], browser });
  assert.equal(store.snapshot().liked.length, 1);
  const reopened = new BackupManager({ folder, personal: store, stats: listening, appearance, library: { snapshot: () => ({ tracks: [] }) }, broadcast: () => {}, protection });
  await store.toggle('favorites', { ...song, id: 'later-edit', remoteId: 'later-edit' }); const latest = JSON.parse(JSON.stringify(store.snapshot()));
  await reopened.load(); assert.deepEqual(JSON.parse(JSON.stringify(store.snapshot())), latest); assert.deepEqual(JSON.parse(JSON.stringify(await new PersonalStore(folder).load())), latest);
  const info = await reopened.invoke({ operation: 'backupInfo' });
  assert.equal(info.recovery.browser.profile.name, 'after'); assert.equal(info.undoAvailable, false); assert.equal(info.recovery.undoAvailable, true);
  await assert.rejects(reopened.invoke({ operation: 'backupAcknowledge', browser: { profile: { name: 'not-written' } } }), /尚未完成/);
  await reopened.invoke({ operation: 'backupAcknowledge', browser: info.recovery.browser });
  assert.equal((await reopened.readJournal()).recovered, false);
  await assert.rejects(reopened.invoke({ operation: 'backupUndo', browser: info.recovery.browser }), /新资料/);
});

test('partial backend transaction rolls back while retaining the interrupted browser snapshot', async t => {
  const { backup, store, listening, appearance, folder } = await manager(t);
  const before = backup.capture({ profile: { name: 'original' } }), after = structuredClone(before);
  after.personal.liked = [song]; after.browser.profile.name = 'interrupted';
  await backup.writeJournal({ pending: true, before, after, sections: ['liked', 'profile'] });
  store.data = after.personal; await store.save();
  const reopened = new BackupManager({ folder, personal: store, stats: listening, appearance, library: { snapshot: () => ({ tracks: [] }) }, broadcast: () => {}, protection });
  await reopened.load(); assert.equal(store.snapshot().liked.length, 0);
  const info = await reopened.invoke({ operation: 'backupInfo' }); assert.equal(info.recovery.browser.profile.name, 'original');
  await reopened.invoke({ operation: 'backupAcknowledge', browser: info.recovery.browser }); assert.equal(await reopened.readJournal(), null);
});

test('local history relinking updates the history identity together with its track', async t => {
  const { backup, store } = await manager(t);
  const local = { ...song, source: 'local', id: 'recipient-local', audioUrl: 'file:///recipient/song.mp3' };
  const portable = cleanPayload({ personal: { history: [{ track: local, playedAt: 123 }] } }).personal.history[0];
  portable.track.availability = 'unavailable'; store.data.history = [portable]; await store.save();
  backup.library = { snapshot: () => ({ tracks: [local] }) };
  const result = await backup.invoke({ operation: 'backupRelink' }); assert.equal(result.linked, 1);
  const history = (await new PersonalStore(backup.folder).load()).history[0];
  assert.equal(history.id, 'recipient-local'); assert.equal(history.track.id, history.id);
});

test('Android production backup contract reads desktop files and emits desktop-readable backups on JVM', async t => {
  const folder = await temporary(t), javaHome = process.env.JAVA_HOME || 'C:/Program Files/Android/Android Studio/jbr', bin = name => path.join(javaHome, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
  const cache = process.env.ZENIX_TEST_JSON_CACHE_ROOT || path.join(os.homedir(), '.gradle/caches/modules-2/files-2.1/org.json/json/20250517'); let jar;
  for (const child of await fs.readdir(cache).catch(() => [])) { const candidate = path.join(cache, child, 'json-20250517.jar'); if (await fs.stat(candidate).catch(() => null)) { jar = candidate; break; } }
  if (!jar) {
    jar = path.join(folder, 'json-20250517.jar');
    const response = await fetch('https://repo.maven.apache.org/maven2/org/json/json/20250517/json-20250517.jar', { signal: AbortSignal.timeout(20000) });
    assert.ok(response.ok, 'pinned JVM JSON test dependency available');
    await fs.writeFile(jar, Buffer.from(await response.arrayBuffer()));
  }
  const specialLocal = { ...song, source: 'local', id: 'local-special', title: "歌曲!~'()*" };
  const input = path.join(folder, 'input.zenixbackup'), output = path.join(folder, 'output.zenixbackup'); await fs.writeFile(input, encode({ personal: { liked: [song], favorites: [specialLocal], history: [], playlists: [{ name: '歌单', tracks: [song] }] }, profile: { name: 'Fixture', email: 'fixture@example.test' }, stats: stats() }));
  const root = path.resolve(__dirname, '../android/app/src/main/java/com/zenix/musicplayer'); await promisify(execFile)(bin('javac'), ['-cp', jar, '-d', folder, path.join(root, 'Json.java'), path.join(root, 'BackupFormat.java'), path.join(__dirname, 'fixtures/BackupContractCheck.java')], { timeout: 30000, windowsHide: true });
  const { stdout } = await promisify(execFile)(bin('java'), ['-cp', folder + path.delimiter + jar, 'com.zenix.musicplayer.BackupContractCheck', input, output], { timeout: 15000, windowsHide: true }); assert.match(stdout, /BACKUP_CONTRACT_PASS/); const decoded = decode(await fs.readFile(output, 'utf8')); assert.equal(decoded.personal.liked[0].id, song.id); assert.equal(decoded.profile.email, 'fixture@example.test'); assert.equal(decoded.stats.days['2026-10-11'].seconds, 60); assert.equal(JSON.parse(JSON.parse(await fs.readFile(output, 'utf8')).payload).personal.favorites[0].id, cleanPayload({ personal: { favorites: [specialLocal] } }).personal.favorites[0].id, 'Java and JavaScript emit identical portable local IDs');
});
