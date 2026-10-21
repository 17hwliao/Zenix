// Explicit workflow_dispatch only. No signing keys, builds, source changes or
// deletion of installers. The user-signed feeds must already exist in this ref.
const fs=require('node:fs/promises'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const contract=require('./release-contract.cjs'),application=require('../package.json'),config=require('../config/distribution.json');
const key=crypto.createPublicKey({key:Buffer.from(config.publicKeySpki,'base64'),type:'spki',format:'der'}),hash=bytes=>'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex');
async function publish(){
  assert.equal(process.env.GITHUB_REPOSITORY,'17hwliao/Zenix');assert.equal(process.env.REVISION,String(application.zenixBuild));assert(process.env.GH_TOKEN);
  const base='https://api.github.com/repos/17hwliao/Zenix',headers={Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json'};
  const api=async(path,options={})=>{const response=await fetch(base+path,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(60000)});assert(response.ok,'GitHub HTTP '+response.status);return response.status===204?null:response.json();};
  const tag='v'+application.version,release=await api('/releases/tags/'+tag);assert(!release.draft&&!release.prerelease);
  const inventory=()=>api('/releases/'+release.id+'/assets?per_page=100');let assets=await inventory();
  const feeds={};for(const channel of ['stable','preview']){const bytes=await fs.readFile('updates/'+channel+'.json'),document=contract.verifyRelease(JSON.parse(bytes),key,channel);for(const platform of ['windows','android']){const artifact=document.artifacts[platform];assert(artifact);assert.equal(artifact.version,application.version);assert.equal(artifact.build,application.zenixBuild);assert(assets.some(a=>a.browser_download_url===artifact.url&&a.state==='uploaded'&&a.size===artifact.size&&a.digest==='sha256:'+artifact.sha256),'installer not verified '+platform);}feeds[channel]={bytes,document};}
  const upload=async(name,bytes)=>{const digest=hash(bytes),existing=(await inventory()).find(a=>a.name===name);if(existing){assert(existing.state==='uploaded'&&existing.size===bytes.length&&existing.digest===digest,'immutable metadata collision '+name);return existing;}const url=new URL(release.upload_url.replace(/\{.*$/,''));assert.equal(url.hostname,'uploads.github.com');assert.equal(url.protocol,'https:');url.searchParams.set('name',name);const response=await fetch(url,{method:'POST',headers:{...headers,'Content-Type':'application/json','Content-Length':String(bytes.length)},body:bytes,signal:AbortSignal.timeout(60000)});assert(response.ok,'upload HTTP '+response.status);const asset=await response.json();assert(asset.state==='uploaded'&&asset.size===bytes.length&&asset.digest===digest);return asset;};
  const checksum=Object.values(feeds.stable.document.artifacts).map(a=>a.sha256+'  '+decodeURIComponent(new URL(a.url).pathname.split('/').pop())).join('\n')+'\n';
  await upload(`SHA256SUMS-${application.version}-r${application.zenixBuild}.txt`,Buffer.from(checksum));
  const proof=await fs.readFile(`docs/releases/${tag}-r${application.zenixBuild}-identity.json`);const decoded=JSON.parse(proof);assert.equal(decoded.receipt.artifact.sha256,feeds.stable.document.artifacts.windows.sha256);assert(decoded.receipt.productionIdentityGatePassed);await upload(`staged-windows-identity-r${application.zenixBuild}.json`,proof);
  for(const channel of ['stable','preview']){
    const {bytes,document}=feeds[channel],name=channel+'.json';assets=await inventory();const pointer=assets.find(a=>a.name===name);if(pointer?.digest===hash(bytes))continue;
    assert(pointer&&pointer.state==='uploaded');const oldResponse=await fetch(pointer.browser_download_url,{signal:AbortSignal.timeout(30000)});assert(oldResponse.ok);const oldBytes=Buffer.from(await oldResponse.arrayBuffer());assert.equal(hash(oldBytes),pointer.digest);const old=contract.verifyRelease(JSON.parse(oldBytes),key,channel);contract.assertForward(document,[old]);
    await upload(`${channel}-r${old.artifacts.windows.build}.json`,oldBytes);
    const pending=await upload(name+'.pending-'+hash(bytes).slice(7,19),bytes);
    // Re-read immediately before replacing the mutable pointer; no installers
    // or checksums can reach this deletion path.
    const live=(await inventory()).find(a=>a.name===name);assert(live&&live.id===pointer.id&&live.digest===pointer.digest);
    await api('/releases/assets/'+pointer.id,{method:'DELETE'});await api('/releases/assets/'+pending.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});assert((await inventory()).some(a=>a.name===name&&a.digest===hash(bytes)&&a.state==='uploaded'));
  }
  await api('/releases/'+release.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:`Zenix v${application.version} · Android r${application.zenixBuild} / Windows r${application.zenixBuild}`,body:`音乐源配置维护修订：首次使用引导、默认搜索平台、错误识别、同词重试与配置保留。公开版本仍为 ${application.version}，内部修订 r${application.zenixBuild}。历史安装包保留。\n\n[发行与审查说明](https://github.com/17hwliao/Zenix/blob/main/docs/releases/${tag}.md)\n\n本轮自动测试与安装器身份核验通过，未进行真实设备覆盖安装。`,make_latest:'true'})});
  console.log('MAINTENANCE_METADATA_PUBLISHED '+tag+' r'+application.zenixBuild);
}
publish().catch(error=>{console.error(error.message);process.exitCode=1;});
