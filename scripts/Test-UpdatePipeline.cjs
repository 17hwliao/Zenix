const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { createRequire } = require('node:module'), { generateKeyPairSync, sign, createHash } = require('node:crypto');
const ts = require('typescript');
const { updateUrl, fetchUpdate } = require('../electron/runtime/update-network.cjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const apkUrl = 'https://github.com/17hwliao/Zenix/releases/download/v1.0.0/fixture.exe';

test('official update transport validates every redirect and uses the Electron system network without source DNS classification', async () => {
  for (const bad of ['http://github.com/file', 'https://github.com:444/file', 'https://user@github.com/file', 'https://github.com/file#fragment', 'https://github.com.evil.test/file', 'https://127.0.0.1/file']) assert.throws(() => updateUrl(bad));
  let calls = 0;
  const result = await fetchUpdate(apkUrl, {}, async (url, opts) => {
    calls++; assert.equal(opts.redirect, 'manual'); assert.equal(opts.credentials, 'omit'); assert.equal(opts.bypassCustomProtocolHandlers, true);
    return calls === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/file' } }) : new Response('payload');
  });
  assert.equal(await result.text(), 'payload'); assert.equal(calls, 2);
  for (const location of ['http://github.com/file', 'https://127.0.0.1/file', 'https://evil.test/file']) {
    let attempted = 0; await assert.rejects(fetchUpdate(apkUrl, {}, async () => { attempted++; return new Response(null, { status: 302, headers: { location } }); })); assert.equal(attempted, 1);
  }
  let hops = 0; await assert.rejects(fetchUpdate(apkUrl, {}, async () => { hops++; return new Response(null, { status: 302, headers: { location: '/again' } }); }), /重定向/); assert.equal(hops, 6);
  const abort = new AbortController(); abort.abort(); await assert.rejects(fetchUpdate(apkUrl, { signal: abort.signal }, async () => { throw Error('must not connect'); }), { name: 'AbortError' });
});

async function updater(t, mutate = value => value) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'zenix-update-pipeline-')); t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const bytes = Buffer.from('synthetic-installer-fixture');
  const item = mutate({ version: '1.0.0', build: 20, url: apkUrl, size: bytes.length, sha256: digest(bytes) });
  const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, channel: 'stable', notes: 'fixture', artifacts: { windows: item } }));
  const envelope = { format: 'zenix-signed-release', payload: payload.toString('base64'), signature: sign('RSA-SHA256', payload, privateKey).toString('base64') };
  const source = path.resolve(__dirname, '../electron/runtime/updates.cjs'), realRequire = createRequire(source), module = { exports: {} };
  let corrupt = false, contacts = 0;
  const official = async url => { contacts++; return new Response(url.includes('feed.json') ? JSON.stringify(envelope) : corrupt ? 'corrupt' : bytes); };
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), { module, exports: module.exports, Buffer, URL, AbortController, AbortSignal, setTimeout, clearTimeout, process,
    require(id) { if (id === '../../package.json') return { zenixBuild: 19 }; if (id === '../../config/distribution.json') return { feeds: { stable: 'https://raw.githubusercontent.com/feed.json' }, publicKeySpki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), windowsUpdateTrust: 'signed-manifest' };
      if (id === './update-network.cjs') return { updateUrl, fetchUpdate: (url, opts) => fetchUpdate(url, opts, official) }; return realRequire(id); },
  }, { filename: source });
  const app = { getVersion: () => '1.0.0', getPath: () => directory, isPackaged: false };
  return { update: new module.exports.Updates(app), bytes, item, corrupt: () => { corrupt = true; }, contacts: () => contacts, envelope };
}
test('production Windows updater: signed same-version build upgrade, streamed hash verification, cache reuse and tamper rejection', async t => {
  const fixture = await updater(t), u = fixture.update;
  assert.equal((await u.check('stable')).status, 'available'); assert.equal(u.state.build, 20);
  assert.equal((await u.download()).status, 'ready'); assert.equal(digest(await fsp.readFile(u.file)), fixture.item.sha256);
  const contacts = fixture.contacts(); assert.equal((await u.download()).status, 'ready'); assert.equal(fixture.contacts(), contacts);
  await fsp.writeFile(u.file, 'changed'); await assert.rejects(u.install(), /开发模式/);
  fixture.corrupt(); assert.equal((await u.download()).status, 'error'); assert.match(u.state.message, /校验/);
  assert.equal(fs.existsSync(path.join(u.directory, fixture.item.sha256 + '.exe.part')), false);
});
test('production Windows updater rejects signed rollback and corrupted manifest signature before contacting installer', async t => {
  const rollback = await updater(t, a => ({ ...a, version: '2.0.0', build: 18 })); assert.equal((await rollback.update.check('stable')).status, 'current'); assert.equal(rollback.contacts(), 1);
  const tamper = await updater(t); tamper.envelope.payload = Buffer.from('{}').toString('base64'); assert.equal((await tamper.update.check('stable')).status, 'error'); assert.match(tamper.update.state.message, /签名/); assert.equal(tamper.contacts(), 1);
});

const schedulerFile = path.resolve(__dirname, '../src/core/updateScheduler.ts'), schedulerModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(schedulerFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: schedulerModule, exports: schedulerModule.exports, Map, Number, Math });
const { automaticUpdateScheduler } = schedulerModule.exports;
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function clockFixture(extra = {}) {
  let time = 100000, id = 0, allowed = true, checks = 0, downloads = 0;
  const timers = new Map(), checked = new Map(), prefs = { automatic: true, autoDownload: false, channel: 'stable' };
  const scheduler = automaticUpdateScheduler({ now: () => time, allowed: () => allowed, busy: () => false, preferences: () => prefs, lastCheck: c => checked.get(c) || 0,
    check: async c => { checks++; checked.set(c, time); return { status: 'available', channel: c }; }, state: async () => ({ status: 'available', channel: 'stable' }), download: async () => { downloads++; }, canDownload: () => true,
    setTimer: (cb, delay) => { timers.set(++id, { cb, at: time + delay }); return id; }, clearTimer: key => timers.delete(key), ...extra });
  return { scheduler, prefs, checked, timers, checks: () => checks, downloads: () => downloads, allowed: value => { allowed = value; }, async advance(ms) { time += ms; for (const [key, value] of [...timers]) if (value.at <= time) { timers.delete(key); value.cb(); } await flush(); } };
}
test('automatic updater rechecks after twelve hours without foreground events; disabling and resuming leaves one timer', async () => {
  const f = clockFixture(); await f.advance(15000); assert.equal(f.checks(), 1); assert.equal(f.timers.size, 1);
  await f.advance(12 * 60 * 60 * 1000); assert.equal(f.checks(), 2); assert.equal(f.timers.size, 1);
  f.allowed(false); f.scheduler.wake(); await flush(); assert.equal(f.timers.size, 0);
  await f.advance(12 * 60 * 60 * 1000); assert.equal(f.checks(), 2); f.allowed(true); f.scheduler.wake(); await flush(); assert.equal(f.checks(), 3);
  f.prefs.automatic = false; f.scheduler.preferencesChanged(); await flush(); assert.equal(f.timers.size, 0);
  f.scheduler.stop(); assert.equal(f.timers.size, 0);
});
test('automatic updater applies auto-download to an already available update, separates channels and rejects future timestamps', async () => {
  const f = clockFixture(); await f.advance(15000); f.prefs.autoDownload = true; f.scheduler.preferencesChanged(); await flush(); assert.equal(f.downloads(), 1);
  f.prefs.channel = 'preview'; f.scheduler.preferencesChanged(); await flush(); assert.equal(f.checks(), 2); assert.equal(f.downloads(), 2);
  f.scheduler.stop(); const future = clockFixture(); future.checked.set('stable', Number.MAX_SAFE_INTEGER); await future.advance(15000); assert.equal(future.checks(), 1); future.scheduler.stop();
});
test('automatic updater bounds failure retries and stops timers on disposal', async () => {
  let calls = 0; const f = clockFixture({ check: async () => { calls++; throw Error('offline'); } });
  await f.advance(15000); assert.equal(calls, 1); f.scheduler.wake(); await flush(); assert.equal(calls, 1);
  await f.advance(15 * 60 * 1000); assert.equal(calls, 2); f.scheduler.stop(); await f.advance(24 * 60 * 60 * 1000); assert.equal(calls, 2);
});
