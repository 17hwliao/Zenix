const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
function isolated(relative, overrides = {}, globals = {}) {
  const file = path.join(root, relative), localRequire = createRequire(file), module = { exports: {} };
  const context = { module, exports: module.exports, require: id => Object.hasOwn(overrides, id) ? overrides[id] : localRequire(id), __dirname: path.dirname(file), __filename: file,
    Buffer, URL, Headers, AbortController, setTimeout, clearTimeout, console, fetch, ...globals };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return module.exports;
}
async function temporary(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'zenix-security-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true })); return directory;
}
// This provider exercises authenticated envelope/migration behavior. It is not
// evidence about OS key custody; the real Windows test is separate.
function provider() {
  const key = randomBytes(32);
  return { isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async text => { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decryptStringAsync: async bytes => { const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return { result: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'), shouldReEncrypt: false }; } };
}
const protectedModule = require('../electron/runtime/protected-json.cjs');
function protectedWith(key) { return { encodeProtected: value => protectedModule.encodeProtected(value, key), decodeProtected: text => protectedModule.decodeProtected(text, key) }; }
function manager(key, folder) {
  const { SourceManager } = isolated('electron/sources.cjs', {
    electron: { ipcMain: { on() {}, handle() {} }, dialog: {} },
    './runtime/source-runner.cjs': { SourceRunner: class {} },
    './runtime/protected-json.cjs': protectedWith(key),
  });
  return new SourceManager(folder, () => {});
}
test('protected envelope: round trip, legacy, rotation, unavailable key and corruption', async () => {
  const key = provider(), helpers = protectedWith(key), value = { token: 'fixture-token', records: [] };
  const text = await helpers.encodeProtected(value); assert(!text.includes('fixture-token'));
  assert.deepEqual((await helpers.decodeProtected(text)).value, value);
  assert.equal((await helpers.decodeProtected(JSON.stringify(value))).legacy, true);
  assert.equal((await protectedModule.decodeProtected(text, { ...key, decryptStringAsync: async bytes => ({ ...await key.decryptStringAsync(bytes), shouldReEncrypt: true }) })).rotate, true);
  const unavailable = { isAsyncEncryptionAvailable: async () => false };
  await assert.rejects(protectedModule.encodeProtected(value, unavailable), /未写入明文/);
  await assert.rejects(protectedModule.decodeProtected(text, unavailable), /保留原配置/);
  const envelope = JSON.parse(text), bytes = Buffer.from(envelope.ciphertext, 'base64'); bytes[bytes.length - 1] ^= 1;
  await assert.rejects(helpers.decodeProtected(JSON.stringify({ ...envelope, ciphertext: bytes.toString('base64') })));
  for (const bad of ['[]', 'null', '{"protection":"other","ciphertext":"AA=="}', '{"protection":"zenix.safeStorage.v1","ciphertext":"?!"}']) await assert.rejects(helpers.decodeProtected(bad));
});
test('source index migrates plaintext atomically and reloads encrypted settings', async t => {
  const folder = await temporary(t), key = provider(), first = manager(key, folder);
  await fsp.mkdir(first.folder, { recursive: true });
  await fsp.writeFile(first.indexFile, JSON.stringify({ records: [], settings: { fixture: { token: 'fixture-private-key' } } }));
  await first.load(); first.assertWritable();
  const encrypted = await fsp.readFile(first.indexFile, 'utf8'); assert(!encrypted.includes('fixture-private-key')); assert.equal(JSON.parse(encrypted).protection, 'zenix.safeStorage.v1');
  const second = manager(key, folder); await second.load(); assert.equal(second.settings.fixture.token, 'fixture-private-key');
  assert.equal((await fsp.readdir(first.folder)).some(name => name.endsWith('.tmp')), false);
});
test('failed migration, corrupt index and missing key preserve original files and reject writes', async t => {
  const folder = await temporary(t), key = provider(), first = manager(key, folder); await fsp.mkdir(first.folder, { recursive: true });
  const legacy = JSON.stringify({ records: [], settings: { fixture: { token: 'keep-me' } } });
  await fsp.writeFile(first.indexFile, legacy);
  const unavailable = { isAsyncEncryptionAvailable: async () => false }, migration = manager(unavailable, folder);
  await migration.load(); assert.throws(() => migration.assertWritable(), /保留原文件/); await assert.rejects(migration.save()); assert.equal(await fsp.readFile(first.indexFile, 'utf8'), legacy);
  for (const text of ['not-json', '{"records":[{"id":"wrong"}],"settings":{}}', await protectedWith(key).encodeProtected({ records: [], settings: {} })]) {
    await fsp.writeFile(first.indexFile, text); const broken = manager(provider(), folder); await broken.load(); await assert.rejects(broken.save()); assert.equal(await fsp.readFile(first.indexFile, 'utf8'), text);
  }
});
const { sourcePolicy } = require('../electron/runtime/source-policy.cjs');
test('source permissions default HTTPS, preserve explicit migration and validate domains', () => {
  assert.deepEqual(sourcePolicy(undefined), { allowHttp: false, hosts: null });
  assert.equal(sourcePolicy(undefined, { allowHttp: true, hosts: null }).allowHttp, true);
  assert.deepEqual(sourcePolicy({ hosts: ['EXAMPLE.COM', 'example.com', '*.cdn.example.com'] }).hosts, ['example.com', '*.cdn.example.com']);
  for (const value of [[], null, { allowHttp: 'true' }, { hosts: ['https://example.com'] }, { hosts: ['a..b'] }, { hosts: Array(31).fill('example.com') }]) assert.throws(() => sourcePolicy(value));
});
test('script decompression rejects bombs, input overflow and parallel work, then releases budgets', async t => {
  const instance = manager(provider(), await temporary(t)); instance.lxRunner = () => ({ record: { id: 'fixture-source' } });
  const bomb = [...zlib.deflateSync(Buffer.alloc(5 * 1024 * 1024))];
  await assert.rejects(instance.lxZlib(0, { action: 'inflate', bytes: bomb })); assert.equal(instance.zlibActive, 0); assert.equal(instance.zlibBySource.size, 0);
  await assert.rejects(instance.lxZlib(0, { action: 'inflate', bytes: Array(2 * 1024 * 1024 + 1).fill(0) }), /输入无效/);
  const compressed = [...zlib.deflateSync(Buffer.from('fixture'))], first = instance.lxZlib(0, { action: 'inflate', bytes: compressed });
  await assert.rejects(instance.lxZlib(0, { action: 'inflate', bytes: compressed }), /并发过多/); assert.equal(Buffer.from(await first).toString(), 'fixture');
  instance.zlibActive = 2; await assert.rejects(instance.lxZlib(0, { action: 'inflate', bytes: compressed }), /并发过多/);
});
test('runner cancellation aborts only its own eight bounded network tasks and ignores late results', async () => {
  const { SourceRunner } = isolated('electron/runtime/source-runner.cjs', { electron: {} });
  const registry = { runners: new Map() }, first = new SourceRunner(registry, { id: 'fixture' }, 'first'), second = new SourceRunner(registry, { id: 'fixture' }, 'second');
  registry.runners.set('first', first); registry.runners.set('second', second);
  const work = signal => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }));
  const tasks = Array.from({ length: 8 }, () => first.network(work).catch(error => error));
  await assert.rejects(first.network(work), /并发过多/);
  let otherSignal; const other = second.network(signal => { otherSignal = signal; return new Promise(resolve => setImmediate(() => resolve('other-result'))); });
  first.destroy(); for (const error of await Promise.all(tasks)) assert.equal(error.message, 'cancelled');
  assert.equal(first.networkRequests.size, 0); assert.equal(otherSignal.aborted, false); assert.equal(await other, 'other-result'); assert.equal(registry.runners.has('first'), false); assert.equal(registry.runners.get('second'), second);
  await assert.rejects(first.network(work), /已取消/); first.receive({ id: 'late', ok: true, result: 'stale' }); second.destroy();
});
function network({ lookup = async () => [{ address: '8.8.8.8', family: 4 }], fetcher = async () => new Response('ok'), timers = {} } = {}) {
  return isolated('electron/runtime/source-network.cjs', { 'node:dns/promises': { lookup }, undici: { Agent: class { constructor(options) { this.options = options; } close() { return Promise.resolve(); } destroy() { return Promise.resolve(); } } } }, { fetch: fetcher, ...timers });
}
test('public request pins validated DNS, revalidates changes and strips policy options', async () => {
  let address = '8.8.8.8', calls = 0;
  const api = network({ lookup: async () => [{ address, family: 4 }], fetcher: async (_, options) => {
    calls++; assert.equal(options.allowHttp, undefined); assert.equal(options.allowedHosts, undefined);
    options.dispatcher.options.connect.lookup('example.com', {}, (_, ip) => assert.equal(ip, '8.8.8.8')); return new Response('ok');
  } });
  await api.fetchAllowed('https://example.com', null); address = '127.0.0.1';
  await assert.rejects(api.fetchAllowed('https://example.com', null), /私有网络/); assert.equal(calls, 1); api.closeNetwork();
});
test('private, special IPv6 and mixed DNS results never reach transport', async () => {
  let calls = 0; const api = network({ fetcher: async () => { calls++; return new Response('wrong'); } });
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '100.64.0.1', '169.254.169.254', '198.18.0.1', '203.0.113.1', '[::1]', '[fc00::1]', '[fe80::1]', '[64:ff9b::a00:1]', '[2002:a00:1::1]', '[2001:db8::1]']) await assert.rejects(api.fetchAllowed(`https://${address}/`, null), /私有网络/);
  const mixed = network({ lookup: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }], fetcher: async () => { calls++; } });
  await assert.rejects(mixed.fetchAllowed('https://example.com', null)); assert.equal(calls, 0);
  await assert.rejects(api.fetchAllowed('https://127.0.0.1', ['127.0.0.1']), /私有网络/);
  await assert.rejects(api.fetchAllowed('http://localhost', ['localhost']), /HTTPS/);
});
test('HTTP requires explicit source permission and domain limits apply before DNS', async () => {
  let calls = 0; const api = network({ lookup: async () => { calls++; return [{ address: '8.8.8.8', family: 4 }]; } });
  await assert.rejects(api.fetchAllowed('http://example.com', null), /HTTP/); assert.equal(calls, 0);
  await api.fetchAllowed('http://example.com', null, { allowHttp: true, allowedHosts: ['example.com'] });
  await assert.rejects(api.fetchAllowed('https://other.example.com', null, { allowedHosts: ['example.com'] }), /授权域名/);
  await assert.rejects(api.fetchAllowed('https://example.com', null, { allowedHosts: [] }), /授权域名/);
  await api.fetchAllowed('https://cdn.example.com', null, { allowedHosts: ['*.example.com'] });
  await assert.rejects(api.fetchAllowed('https://example.com', null, { allowedHosts: ['*.example.com'] }), /授权域名/); api.closeNetwork();
});
test('redirects recheck domains, deny downgrade/private targets, remove cross-origin credentials', async () => {
  let calls = 0;
  const api = network({ fetcher: async (_, options) => { calls++; if (calls === 1) return new Response(null, { status: 303, headers: { location: 'https://other.example.com/final' } });
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined); assert.equal(options.headers.get('authorization'), null); assert.equal(options.headers.get('x-api-key'), null); assert.equal(options.headers.get('cookie'), null); assert.equal(options.headers.get('content-type'), null); return new Response('ok'); } });
  await api.fetchAllowed('https://example.com', null, { method: 'POST', body: 'secret', headers: { Authorization: 'secret', 'X-API-Key': 'secret', Cookie: 'secret', 'Content-Type': 'text/plain' } }); assert.equal(calls, 2); api.closeNetwork();
  for (const location of ['http://example.com', 'https://127.0.0.1', 'https://not-authorized.test']) {
    let count = 0; const blocked = network({ fetcher: async () => { count++; return new Response(null, { status: 302, headers: { location } }); } });
    await assert.rejects(blocked.fetchAllowed('https://example.com', null, { allowHttp: true, allowedHosts: ['example.com', '127.0.0.1'] })); assert.equal(count, 1); blocked.closeNetwork();
  }
  let count = 0; const head = network({ fetcher: async (_, opts) => { assert.equal(opts.method, 'HEAD'); return ++count === 1 ? new Response(null, { status: 303, headers: { location: '/next' } }) : new Response(null); } }); await head.fetchAllowed('https://example.com', null, { method: 'HEAD' }); head.closeNetwork();
});
test('DNS work stays bounded after caller timeouts and concurrent same-host checks share lookup', async () => {
  const pending = [], timers = []; let lookups = 0;
  const api = network({ lookup: () => { lookups++; return new Promise(resolve => pending.push(resolve)); }, timers: { setTimeout: callback => { timers.push(callback); return callback; }, clearTimeout() {} } });
  const requests = Array.from({ length: 64 }, (_, i) => api.checkLxUrl(`https://dns${i}.example.com`).catch(error => error));
  assert.equal(lookups, 64); timers.splice(0).forEach(callback => callback());
  for (const error of await Promise.all(requests)) assert.match(error.message, /超时/);
  await assert.rejects(api.checkLxUrl('https://extra.example.com'), /并发过多/); assert.equal(lookups, 64);
  pending.forEach(resolve => resolve([{ address: '8.8.8.8', family: 4 }])); await new Promise(resolve => setImmediate(resolve));
  const one = api.checkLxUrl('https://same.example.com'), two = api.checkLxUrl('https://same.example.com'); assert.equal(lookups, 65);
  pending[pending.length - 1]([{ address: '8.8.8.8', family: 4 }]); await Promise.all([one, two]);
});
test('bounded network reads cancel advertised or streaming overflow and release reader', async () => {
  const api = network(); let cancelled = 0, released = 0;
  await assert.rejects(api.readLimited({ headers: new Headers({ 'content-length': '100' }), body: { cancel: async () => cancelled++ } }, 5), /过大/);
  await assert.rejects(api.readLimited({ headers: new Headers(), body: { getReader: () => ({ read: async () => ({ done: false, value: Buffer.alloc(6) }), cancel: async () => cancelled++, releaseLock: () => released++ }) } }, 5), /过大/);
  assert.equal(cancelled, 2); assert.equal(released, 1);
});
test('bounded local reads reject post-stat growth and always close handles', async () => {
  let closed = false, budget = 0;
  const { readBoundedFile } = isolated('electron/runtime/bounded-file.cjs', { 'node:fs/promises': { open: async () => ({ stat: async () => ({ isFile: () => true, size: 0 }), read: async (_, __, length) => { budget += length; return { bytesRead: length }; }, close: async () => { closed = true; } }) } });
  await assert.rejects(readBoundedFile('fixture', 10), /大小限制/); assert.equal(budget, 11); assert.equal(closed, true);
});
test('metadata disk-full state survives cleanup and resumes only after a successful write probe', async t => {
  const folder = await temporary(t); let full = true;
  const { MetadataCache } = isolated('electron/runtime/metadata-cache.cjs', { 'node:fs/promises': { ...fsp, writeFile: (...args) => full ? Promise.reject(Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' })) : fsp.writeFile(...args) } });
  const cache = new MetadataCache(folder); cache.failWrite(); await cache.prune({ bestEffort: true }); assert.equal(cache.writeEnabled, false); assert((await cache.stats()).metadataError);
  await assert.rejects(cache.clear()); assert.equal(cache.writeEnabled, false); full = false; await cache.prune(); assert.equal(cache.writeEnabled, true); assert.equal((await cache.stats()).metadataError, '');
  for (const group of ['covers', 'lyrics']) assert.equal((await fsp.readdir(path.join(folder, group))).length, 0);
});
test('Android production address policy: compile and execute 18 IP boundary fixtures on JVM', async t => {
  const folder = await temporary(t), windowsJbr = 'C:/Program Files/Android/Android Studio/jbr', home = process.env.JAVA_HOME || (fs.existsSync(windowsJbr) ? windowsJbr : '');
  const binary = name => home ? path.join(home, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
  execFileSync(binary('javac'), ['-d', folder, path.join(root, 'android/app/src/main/java/com/zenix/musicplayer/SourceAddressPolicy.java'), path.join(__dirname, 'fixtures/SourceAddressPolicyCheck.java')], { timeout: 30000, stdio: 'pipe' });
  const output = execFileSync(binary('java'), ['-cp', folder, 'com.zenix.musicplayer.SourceAddressPolicyCheck'], { timeout: 30000, encoding: 'utf8' }); assert.match(output, /18 cases passed/);
});
