const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { createRequire } = require('node:module'), { createHash } = require('node:crypto'), { execFile } = require('node:child_process'), { promisify } = require('node:util');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { parseSourceBundle, readSourceBundleFile, verifySourceEntry } = require('../src/core/sourceBundle.ts');
const { sourceShare } = require('../electron/runtime/source-share.cjs');
const digest = text => createHash('sha256').update(text).digest('hex');
const manifest = id => ({ id, name: 'Fixture ' + id, version: '1', schemaVersion: 1, capabilities: ['search', 'resolvePlayback'], qualities: ['high'], settings: [], network: { apiHosts: ['example.com'], mediaHosts: ['example.com'], artworkHosts: [] } });
const records = ['fixture-lx', 'fixture-zenix'].map((id, i) => ({ id, kind: i ? 'zenix' : 'lx', enabled: !i, manifest: manifest(id), origin: { label: 'https://example.com/private?token=MUST_NOT_SHARE' }, networkPolicy: { hosts: ['MUST_NOT_SHARE'] }, settings: { token: 'MUST_NOT_SHARE' } }));
const packs = { 'fixture-lx': { script: '/**\n * @name Fixture\n */\nglobalThis.lx;', secret: 'MUST_NOT_SHARE' }, 'fixture-zenix': { manifest: manifest('fixture-zenix'), script: 'zenix.register({});', token: 'MUST_NOT_SHARE' } };
async function folder(t) { const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'zenix-source-share-')); t.after(() => fsp.rm(directory, { recursive: true, force: true })); return directory; }
async function inspect(text) {
  const result = await readSourceBundleFile(new TextEncoder().encode(text)); assert.equal(result.sources.length, 2); assert.ok(result.sources.every(item => item.local));
  for (const item of result.sources) await verifySourceEntry(item, async text => digest(text));
  assert.equal(result.sources[0].script, packs['fixture-lx'].script); assert.equal(JSON.parse(result.sources[1].script).script, packs['fixture-zenix'].script);
  assert.ok(!text.includes('MUST_NOT_SHARE')); return result;
}
test('production PC source manager exports all installed original files without settings, private origins or runtime execution', async t => {
  const directory = await folder(t), file = path.resolve(__dirname, '../electron/sources.cjs'), localRequire = createRequire(file), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, Buffer, URL, setTimeout, clearTimeout, AbortController, AbortSignal, require: id => id === 'electron' ? { ipcMain: { on() {}, handle() {} } } : localRequire(id) }, { filename: file });
  const manager = new module.exports.SourceManager(directory, () => {}); manager.records = records; manager.settings = { 'fixture-lx': { token: 'MUST_NOT_SHARE' } };
  for (const source of records) { const target = path.join(manager.folder, source.id, source.manifest.version); await fsp.mkdir(target, { recursive: true }); await fsp.writeFile(path.join(target, 'index.js'), packs[source.id].script); }
  const result = await manager.shareBundle(); assert.equal(result.count, 2); await inspect(result.text);
  const structured = manager.previewPackage(JSON.stringify({ manifest: records[1].manifest, script: '/* globalThis.lx compatibility note */ zenix.register({});' }), { kind: 'file', label: 'Fixture.zenixsource' });
  assert.equal(structured.manifest.id, records[1].id, 'complete packages take precedence over compatibility-script heuristics');
  await fsp.rm(path.join(manager.folder, records[1].id, '1', 'index.js')); await assert.rejects(manager.shareBundle());
});
test('production Android exporter produces a portable bundle accepted and verified by the shared PC/mobile importer', async t => {
  const directory = await folder(t), javaHome = process.env.JAVA_HOME || 'C:/Program Files/Android/Android Studio/jbr', bin = name => path.join(javaHome, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
  const cached = path.join(os.homedir(), '.gradle/caches/modules-2/files-2.1/org.json/json/20250517'); let jar;
  if (fs.existsSync(cached)) for (const child of fs.readdirSync(cached)) { const candidate = path.join(cached, child, 'json-20250517.jar'); if (fs.existsSync(candidate)) { jar = candidate; break; } }
  if (!jar) { jar = path.join(directory, 'json.jar'); const response = await fetch('https://repo.maven.apache.org/maven2/org/json/json/20250517/json-20250517.jar'); if (!response.ok) throw Error('JSON test runtime unavailable'); await fsp.writeFile(jar, Buffer.from(await response.arrayBuffer())); }
  const root = path.resolve(__dirname, '../android/app/src/main/java/com/zenix/musicplayer'), input = path.join(directory, 'fixture.json'), output = path.join(directory, 'export.zenixsources');
  await fsp.writeFile(input, JSON.stringify({ records, packs }));
  await promisify(execFile)(bin('javac'), ['-cp', jar, '-d', directory, path.join(root, 'Json.java'), path.join(root, 'SourceShare.java'), path.join(__dirname, 'fixtures/SourceShareCheck.java')], { windowsHide: true, timeout: 30000 });
  const { stdout } = await promisify(execFile)(bin('java'), ['-cp', directory + path.delimiter + jar, 'com.zenix.musicplayer.SourceShareCheck', input, output], { windowsHide: true, timeout: 15000 });
  assert.match(stdout, /SOURCE_SHARE_CONTRACT_PASS/); await inspect(await fsp.readFile(output, 'utf8'));
});
test('shared importer rejects missing or mismatched local contents and detects a modified embedded script', async () => {
  const result = await sourceShare(records, async record => packs[record.id]), parsed = JSON.parse(result.text);
  const changed = structuredClone(parsed); changed.sources[0].script += 'tampered';
  const entry = parseSourceBundle(JSON.stringify(changed)).sources[0]; await assert.rejects(verifySourceEntry(entry, async text => digest(text)), /校验失败/);
  delete parsed.sources[0].script; assert.throws(() => parseSourceBundle(JSON.stringify(parsed)), /完整脚本/);
  await assert.rejects(sourceShare([], async () => null)); await assert.rejects(sourceShare(records, async () => ({ script: 'x'.repeat(524289) })), /大小限制/);
  const remote = { format: 'zenix-source-bundle', schemaVersion: 1, sources: [{ name: 'Existing links bundle', url: 'https://example.com/source.js' }] };
  assert.equal(parseSourceBundle(JSON.stringify(remote)).sources[0].url, remote.sources[0].url);
});
