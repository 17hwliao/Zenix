const test = require('node:test'), assert = require('node:assert/strict');
const { assertForward, assertSource, assertAndroidIdentity, assertDistribution, assertWindowsIdentity, verifyRelease } = require('./release-contract.cjs');
const { generateKeyPairSync, sign } = require('node:crypto');
const artifact = (platform, build) => ({ version: '1.0.0', build, url: `https://github.com/17hwliao/Zenix/releases/download/v1.0.0/package-r${build}.${platform === 'windows' ? 'exe' : 'apk'}`, size: 100, sha256: 'a'.repeat(64) });
const baseline = { schemaVersion: 1, channel: 'stable', artifacts: { windows: artifact('windows', 28), android: artifact('android', 33) } };
const next = () => ({ ...baseline, artifacts: { windows: baseline.artifacts.windows, android: artifact('android', 35) } });
test('current dual-platform baseline supports same-public-version r35 and subsequent r36 without changing the retained platform', () => {
  const candidate = next(); assert.doesNotThrow(() => assertForward(candidate, [baseline]));
  assert.doesNotThrow(() => assertForward({ ...candidate, artifacts: { ...candidate.artifacts, android: artifact('android', 36) } }, [candidate]));
  assert.doesNotThrow(() => assertForward({ ...baseline, artifacts: { ...baseline.artifacts, windows: artifact('windows', 35) } }, [baseline]));
  for (const platform of ['android', 'windows']) {
    for (const field of ['version', 'url', 'size', 'sha256']) {
      const broken = structuredClone(baseline); broken.artifacts[platform][field] = field === 'version' ? '1.0.1' : field === 'url' ? artifact(platform, 99).url : field === 'size' ? 101 : 'b'.repeat(64);
      assert.throws(() => assertForward(broken, [baseline]), /同构建号/);
    }
    const omitted = next(); delete omitted.artifacts[platform]; assert.throws(() => assertForward(omitted, [baseline]), /必须保留/);
  }
  const reused = next(); reused.artifacts.android = artifact('android', 34); assert.throws(() => assertForward(reused, [baseline]), /至少为 r35/);
  assert.throws(() => assertForward(next(), [{ ...baseline, artifacts: { ...baseline.artifacts, android: artifact('android', 36) } }]), /回退/);
  const ahead = { ...baseline, channel: 'preview', artifacts: { ...baseline.artifacts, windows: artifact('windows', 36) } };
  assert.doesNotThrow(() => assertForward(next(), [baseline, ahead]), 'unchanged stable Windows remains valid when preview is ahead');
  const publicRollback = next(); publicRollback.artifacts.android.version = '0.9.9';
  assert.throws(() => assertForward(publicRollback, [baseline]), /公开版本/);
});
test('manifest authentication, source metadata and actual APK identity all remain required', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }), payload = Buffer.from(JSON.stringify(next()));
  const envelope = { format: 'zenix-signed-release', payload: payload.toString('base64'), signature: sign('RSA-SHA256', payload, privateKey).toString('base64') };
  assert.equal(verifyRelease(envelope, publicKey, 'stable').artifacts.android.build, 35);
  assert.throws(() => verifyRelease(envelope, publicKey, 'preview'), /通道/);
  assert.throws(() => verifyRelease({ ...envelope, payload: Buffer.from('{}').toString('base64') }, publicKey, 'stable'), /签名/);
  assert.throws(() => verifyRelease({ ...envelope, notes: 'x'.repeat(256 * 1024) }, publicKey, 'stable'), /大小限制/);
  const item = artifact('android', 35), application = { version: '1.0.0', zenixBuild: 35 }, gradle = 'versionCode 35\nversionName "1.0.0"';
  assertSource('android', item, application, gradle);
  assert.throws(() => assertSource('android', { ...item, build: 36 }, application, gradle), /打包源码/);
  assert.throws(() => assertSource('android', item, application, gradle.replace('35', '34')), /原生源码/);
  const badging = "package: name='com.zenix.musicplayer' versionCode='35' versionName='1.0.0' platformBuildVersionName='16'";
  const certificate = 'Signer #1 certificate SHA-256 digest: b40080130e2186eba857ea2778350b88fe896c33cc9e0116493022e5adb8514a';
  assertAndroidIdentity(badging, certificate, item);
  assertAndroidIdentity(badging, certificate.replace('Signer #1', 'V2 Signer:'), item);
  assert.throws(() => assertAndroidIdentity(badging, certificate + '\n' + certificate.replace('Signer #1', 'Signer #2').replace('b400', 'a400'), item), /发行证书/);
  assert.throws(() => assertAndroidIdentity(badging.replace('35', '34'), certificate, item), /实际 APK 包名或版本/);
  assert.throws(() => assertAndroidIdentity(badging.replace('com.zenix.musicplayer', 'other.package'), certificate, item), /实际 APK 包名或版本/);
  assert.throws(() => assertAndroidIdentity(badging, certificate.replace('b400', 'a400'), item), /发行证书/);
  const config = { publicKeySpki: 'original-public-key', feeds: { stable: 'https://raw.githubusercontent.com/17hwliao/Zenix/main/updates/stable.json', preview: 'https://raw.githubusercontent.com/17hwliao/Zenix/main/updates/preview.json' } };
  assertDistribution(structuredClone(config), config);
  assert.throws(() => assertDistribution({ ...config, publicKeySpki: 'replacement' }, config), /内置更新/);
  assert.throws(() => assertDistribution({ ...config, feeds: { ...config.feeds, stable: 'https://example.com/new.json' } }, config), /内置更新/);
  const applicationInInstaller = { name: 'zenix-music-player', version: '1.0.0', zenixBuild: 35 };
  assertWindowsIdentity(applicationInInstaller, artifact('windows', 35));
  assert.throws(() => assertWindowsIdentity(applicationInInstaller, artifact('windows', 36)), /实际 Windows/);
});

test('production CI publisher rejects invalid candidates before remote access and never creates a release after authentication failure', async t => {
  const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
  const { createHash, createPublicKey } = require('node:crypto');
  const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'zenix-ci-preflight-'));
  t.after(() => fsp.rm(folder, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const config = { publicKeySpki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') };
  const envelope = document => {
    const bytes = Buffer.from(JSON.stringify(document));
    return JSON.stringify({ format: 'zenix-signed-release', payload: bytes.toString('base64'), signature: sign('RSA-SHA256', bytes, privateKey).toString('base64') });
  };
  const candidates = {};
  for (const platform of ['windows', 'android']) {
    const item = artifact(platform, 35), file = path.join(folder, path.basename(item.url)), bytes = Buffer.from('Synthetic ' + platform);
    await fsp.writeFile(file, bytes);
    candidates[platform] = { ...item, file, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  let source = await fsp.readFile(path.join(__dirname, 'Publish-CI-Release.mjs'), 'utf8');
  source = source.replace(/^import .*;\r?\n/gm, '').replaceAll('import.meta.url', JSON.stringify('file:///synthetic/scripts/Publish-CI-Release.mjs'));
  async function run(change) {
    const description = { channel: 'stable', artifacts: structuredClone(candidates) };
    const document = { schemaVersion: 1, channel: 'stable', artifacts: structuredClone(candidates) };
    for (const item of Object.values(document.artifacts)) delete item.file;
    change(document, description);
    const calls = [];
    const reads = file => file instanceof URL ? JSON.stringify(config) : file === 'release-assets/description.json' ? JSON.stringify(description) : Buffer.from(envelope(document));
    const exec = (command, args) => {
      if (command === 'git') return args[0] === 'show' ? envelope({ ...baseline, channel: args[1].includes('preview') ? 'preview' : 'stable' }) : 'fixture';
      calls.push(args);
      const error = Error('fixture authentication failure'); error.stderr = 'gh: Bad credentials (HTTP 401)'; throw error;
    };
    let error;
    try {
      await vm.runInNewContext('(async()=>{' + source + '})()', {
        contract: require('./release-contract.cjs'), readFileSync: reads, execFileSync: exec,
        createReadStream: fs.createReadStream, createHash, createPublicKey, Buffer, URL, path,
        process: { env: { RELEASE_TAG: 'v1.0.0', GITHUB_REPOSITORY: '17hwliao/Zenix' } },
      });
    } catch (caught) { error = caught; }
    assert.ok(error, 'candidate must stop');
    return { error, calls };
  }
  for (const [change, message] of [
    [document => { delete document.artifacts.android; }, /必须保留/],
    [document => { document.artifacts.android.build = 32; }, /回退/],
    [document => { document.artifacts.android.sha256 = 'f'.repeat(64); }, /摘要/],
    [document => { document.artifacts.windows.url = artifact('windows', 36).url; }, /下载地址/],
  ]) {
    const result = await run(change); assert.match(result.error.message, message); assert.equal(result.calls.length, 0);
  }
  const authentication = await run(() => {});
  assert.match(authentication.error.message, /authentication/);
  assert.equal(authentication.calls.length, 1);
  assert.equal(authentication.calls[0][0], 'api', 'authentication failure must not trigger release create or upload');
});
