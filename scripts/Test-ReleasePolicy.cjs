const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { createHash } = require('node:crypto'), { execFile } = require('node:child_process'), { promisify } = require('node:util');
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
async function directory(t) { const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'zenix-release-policy-')); t.after(() => fsp.rm(folder, { recursive: true, force: true })); return folder; }
async function publisher(t, collision = false) {
  const folder = await directory(t), names = ['Zenix-Setup-1.0.0-r99-x64.exe', 'Zenix-Android-1.0.0-r99.apk', 'SHA256SUMS-1.0.0-r99.txt', 'stable.json'];
  await fsp.writeFile(path.join(folder, 'notes.md'), 'Synthetic release');
  for (const name of names) await fsp.writeFile(path.join(folder, name), 'fixture ' + name);
  const assets = [{ id: 1, name: 'Zenix-Android-1.0.0-r19.apk', size: 10, state: 'uploaded', digest: 'old' }, { id: 2, name: 'stable.json', size: 3, state: 'uploaded', digest: 'old-feed' }];
  if (collision) assets.push({ id: 3, name: names[0], size: 2, state: 'uploaded', digest: 'different' });
  const calls = []; let sequence = 10;
  const release = () => ({ id: 5, draft: false, prerelease: false, html_url: 'https://github.com/17hwliao/Zenix/releases/tag/v1.0.0', upload_url: 'https://uploads.github.com/repos/17hwliao/Zenix/releases/5/assets{?name}', assets });
  const fetch = async (address, options = {}) => {
    const url = new URL(address), method = options.method || 'GET'; calls.push({ method, path: url.pathname }); let value;
    if (url.hostname === 'uploads.github.com') {
      const chunks = []; for await (const chunk of options.body) chunks.push(chunk); const bytes = Buffer.concat(chunks);
      value = { id: sequence++, name: url.searchParams.get('name'), size: bytes.length, digest: hash(bytes), state: 'uploaded' }; assets.push(value);
    } else if (/\/git\/commits\//.test(url.pathname)) value = { sha: 'fixture' };
    else if (/\/releases\/tags\//.test(url.pathname)) value = release();
    else if (url.pathname.endsWith('/releases/5/assets')) value = assets;
    else if (/\/releases\/assets\//.test(url.pathname)) {
      const id = Number(url.pathname.split('/').pop()), at = assets.findIndex(item => item.id === id);
      if (method === 'DELETE') { assert.equal(assets[at].name, 'stable.json', 'only mutable feed pointer may be replaced'); assets.splice(at, 1); return { ok: true, status: 204 }; }
      assert.equal(method, 'PATCH'); Object.assign(assets[at], JSON.parse(options.body)); value = assets[at];
    } else if (url.pathname.endsWith('/releases/5')) value = release();
    else throw Error('Unexpected API ' + address);
    return { ok: true, status: 200, json: async () => structuredClone(value) };
  };
  const git = (_command, args) => args[0] === 'rev-parse' ? 'fixture\n' : args[0] === 'ls-remote' ? 'fixture\trefs/tags/v1.0.0\n' : 'password=synthetic\n';
  const argv = ['node', 'publisher', '--tag', 'v1.0.0', '--notes', path.join(folder, 'notes.md'), '--title', 'Fixture', '--replace-stable', '--retire-ios', ...names.flatMap(name => ['--asset', path.join(folder, name)])];
  let source = await fsp.readFile(path.resolve(__dirname, 'Publish-Release.mjs'), 'utf8');
  source = source.replace(/^import .*;\r?\n/gm, '').replace(/publish\(\)\.catch[\s\S]*$/, 'return publish();');
  await vm.runInNewContext('(async()=>{' + source + '})()', { process: { argv }, execFileSync: git, fs, fsp, path, createHash, fetch, AbortSignal, URL, console: { log() {} } });
  return { assets, calls, names };
}
test('production publisher retains cached old downloads by default and switches only verified mutable feed', async t => {
  const result = await publisher(t); assert.ok(result.assets.some(item => item.id === 1));
  for (const name of result.names) assert.ok(result.assets.some(item => item.name === name && item.digest === hash('fixture ' + name)));
  assert.equal(result.calls.filter(call => call.method === 'DELETE').length, 1);
});
test('production publisher rejects same-name installer replacement', async t => { await assert.rejects(publisher(t, true), /Immutable asset differs/); });
test('missing manifest signing key never generates a replacement when a release public key exists', async t => {
  const folder = await directory(t);
  await assert.rejects(promisify(execFile)(process.execPath, [path.resolve(__dirname, 'Init-Signing.mjs')], { env: { ...process.env, ZENIX_SIGNING_DIR: folder }, windowsHide: true }), /禁止重新生成/);
  assert.equal(fs.existsSync(path.join(folder, 'release-key.pem')), false);
});
