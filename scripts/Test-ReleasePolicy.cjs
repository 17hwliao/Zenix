const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { createHash, createPublicKey, generateKeyPairSync, sign } = require('node:crypto'), { execFile } = require('node:child_process'), { promisify } = require('node:util');
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
async function directory(t) { const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'zenix-release-policy-')); t.after(() => fsp.rm(folder, { recursive: true, force: true })); return folder; }
async function publisher(t, collision = false) {
  const folder = await directory(t), names = ['Zenix-Setup-1.0.0-r99-x64.exe', 'Zenix-Android-1.0.0-r99.apk', 'SHA256SUMS-1.0.0-r99.txt', 'stable.json'];
  await fsp.writeFile(path.join(folder, 'notes.md'), 'Synthetic release');
  for (const name of names) await fsp.writeFile(path.join(folder, name), 'fixture ' + name);
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const artifacts=Object.fromEntries(['windows','android'].map((platform,i)=>[platform,{version:'1.0.0',build:99,url:`https://github.com/17hwliao/Zenix/releases/download/v1.0.0/${names[i]}`,sha256:hash('fixture '+names[i]).slice(7),size:Buffer.byteLength('fixture '+names[i])}]));
  const envelope=channel=>{const payload=Buffer.from(JSON.stringify({schemaVersion:1,channel,artifacts}));return JSON.stringify({format:'zenix-signed-release',payload:payload.toString('base64'),signature:sign('RSA-SHA256',payload,privateKey).toString('base64')});};
  await fsp.writeFile(path.join(folder,'stable.json'),envelope('stable'));
  const expected=Object.fromEntries(await Promise.all(names.map(async name=>[name,hash(await fsp.readFile(path.join(folder,name)))])));
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
  const git = (_command, args) => args[0] === 'rev-parse' ? 'fixture\n' : args[0] === 'ls-remote' ? 'fixture\trefs/tags/v1.0.0\n' : args[0]==='show'?envelope(args[1].includes('preview')?'preview':'stable'):args[0]==='fetch'?'':'password=synthetic\n';
  const argv = ['node', 'publisher', '--tag', 'v1.0.0', '--notes', path.join(folder, 'notes.md'), '--title', 'Fixture', '--replace-stable', '--retire-ios', ...names.flatMap(name => ['--asset', path.join(folder, name)])];
  let source = await fsp.readFile(path.resolve(__dirname, 'Publish-Release.mjs'), 'utf8');
  source = source.replace(/^import .*;\r?\n/gm, '').replaceAll('import.meta.url',JSON.stringify('file:///synthetic/scripts/Publish-Release.mjs')).replace(/publish\(\)\.catch[\s\S]*$/, 'return publish();');
  const fixtureFs={...fsp,readFile:(file,...args)=>file instanceof URL?Promise.resolve(JSON.stringify({publicKeySpki:publicKey.export({type:'spki',format:'der'}).toString('base64')})):fsp.readFile(file,...args)};
  await vm.runInNewContext('(async()=>{' + source + '})()', { contract:require('./release-contract.cjs'),Buffer,createPublicKey,process: { argv }, execFileSync: git, fs, fsp:fixtureFs, path, createHash, fetch, AbortSignal, URL, console: { log() {} } });
  return { assets, calls, names, expected };
}
test('production publisher retains cached old downloads by default and switches only verified mutable feed', async t => {
  const result = await publisher(t); assert.ok(result.assets.some(item => item.id === 1));
  for (const name of result.names) assert.ok(result.assets.some(item => item.name === name && item.digest === result.expected[name]));
  assert.equal(result.calls.filter(call => call.method === 'DELETE').length, 1);
});
test('production publisher rejects same-name installer replacement', async t => { await assert.rejects(publisher(t, true), /Immutable asset differs/); });
test('missing manifest signing key never generates a replacement when a release public key exists', async t => {
  const folder = await directory(t);
  await assert.rejects(promisify(execFile)(process.execPath, [path.resolve(__dirname, 'Init-Signing.mjs')], { env: { ...process.env, ZENIX_SIGNING_DIR: folder }, windowsHide: true }), /禁止重新生成/);
  assert.equal(fs.existsSync(path.join(folder, 'release-key.pem')), false);
});

async function retainedWindowsFeed(t, change={}) {
  const {generateKeyPairSync,createPublicKey,sign,verify}=require('node:crypto');
  const folder=await directory(t),file=path.join(folder,'windows.exe'),bytes=Buffer.from('Synthetic retained Windows installer');
  await fsp.writeFile(file,change.file?Buffer.from('Different installer'):bytes);
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const previous={version:'1.0.0',build:28,url:'https://github.com/17hwliao/Zenix/releases/download/v1.0.0/Zenix-Setup-1.0.0-r28-x64.exe',sha256:hash(bytes).slice(7),size:bytes.length};
  const payload=Buffer.from(JSON.stringify({schemaVersion:1,channel:'stable',artifacts:{windows:previous}}));
  const envelope={format:'zenix-signed-release',payload:payload.toString('base64'),signature:sign('RSA-SHA256',payload,privateKey).toString('base64')};
  if(change.signature)envelope.signature=Buffer.from('invalid signature').toString('base64');
  const artifact={version:previous.version,build:change.build?27:28,url:change.url?previous.url.replace('r28','r27'):previous.url,file};
  const description={channel:'preview',artifacts:{windows:artifact,android:{version:'1.0.0',build:35,url:'https://github.com/17hwliao/Zenix/releases/download/v1.0.0/Zenix-Android-1.0.0-r35.apk',file}}};
  const previewPayload=Buffer.from(JSON.stringify({schemaVersion:1,channel:'preview',artifacts:{windows:previous}}));
  const previewEnvelope={format:'zenix-signed-release',payload:previewPayload.toString('base64'),signature:sign('RSA-SHA256',previewPayload,privateKey).toString('base64')};
  const reads=new Map([
    ['description.json',JSON.stringify(description)],
    ['/synthetic/config/distribution.json',JSON.stringify({publicKeySpki:publicKey.export({type:'spki',format:'der'}).toString('base64')})],
    ['/synthetic/package.json',JSON.stringify({version:'1.0.0',zenixBuild:35})],
    ['/synthetic/android/app/build.gradle','versionCode 35\nversionName "1.0.0"'],
    ['/synthetic/updates/stable.json',JSON.stringify(envelope)],
    ['/synthetic/updates/preview.json',JSON.stringify(previewEnvelope)],
    ['synthetic-key',privateKey.export({type:'pkcs8',format:'pem'})],
  ]),writes=[];
  const args=['node','signer','description.json',...(change.flag===false?[]:['--retain-windows'])];
  let source=await fsp.readFile(path.resolve(__dirname,'Sign-Release.mjs'),'utf8');
  source=source.replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify('file:///synthetic/scripts/Sign-Release.mjs'));
  const read=file=>{const key=file instanceof URL?file.pathname:String(file);if(!reads.has(key))throw Error('Unexpected test input: '+key);return reads.get(key);};
  const contract={...require('./release-contract.cjs'),verifyAndroidFile:async()=>{},verifyWindowsFile:async()=>{}}; // Synthetic installer bytes; actual packages are checked separately.
  await vm.runInNewContext('(async()=>{'+source+'})()',{contract,readFileSync:read,writeFileSync:(file,data)=>writes.push({file,data}),mkdirSync(){},createReadStream:fs.createReadStream,sign,verify,createPublicKey,createHash,homedir:()=>folder,path,process:{argv:args,env:{ZENIX_RELEASE_PRIVATE_KEY:'synthetic-key'}},Buffer,URL,console:{log(){}}});
  assert.equal(writes.length,1);
  const result=JSON.parse(writes[0].data),signed=Buffer.from(result.payload,'base64');
  assert.ok(verify('RSA-SHA256',signed,publicKey,Buffer.from(result.signature,'base64')));
  const manifest=JSON.parse(signed);assert.deepEqual(manifest.artifacts.windows,previous);assert.equal(manifest.artifacts.android.build,35);
}
test('Android-only signer retains exactly the existing authenticated Windows artifact',async t=>retainedWindowsFeed(t));
test('retained Windows mode rejects altered bytes, URL, build and invalid prior signature',async t=>{
  for(const change of [{file:true},{url:true},{build:true},{signature:true}])await assert.rejects(retainedWindowsFeed(t,change),/保留 windows|清单签名无效/);
});
test('normal signing still rejects a stale Windows build without explicit retention',async t=>{
  await assert.rejects(retainedWindowsFeed(t,{flag:false}),/当前打包源码一致/);
});
