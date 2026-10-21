// Read-only verification of an already uploaded installer. No signing or feed changes.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{promisify}=require('node:util'),{execFile}=require('node:child_process');
const contract=require('./release-contract.cjs'),application=require('../package.json'),config=require('../config/distribution.json');
async function verify(){
  assert.equal(process.env.GITHUB_REPOSITORY,'17hwliao/Zenix');
  assert.equal(process.env.REVISION,String(application.zenixBuild));
  const tag='v'+application.version,name=`Zenix-Setup-${application.version}-r${application.zenixBuild}-x64.exe`;
  const headers={Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json'};
  const response=await fetch(`https://api.github.com/repos/17hwliao/Zenix/releases/tags/${tag}`,{headers,signal:AbortSignal.timeout(30000)});assert(response.ok);
  const release=await response.json(),asset=release.assets.find(a=>a.name===name);assert(!release.draft&&!release.prerelease);assert(asset?.state==='uploaded');assert(/^sha256:[a-f0-9]{64}$/.test(asset.digest));assert(asset.size>0&&asset.size<512*1024*1024);
  const url=new URL(asset.browser_download_url);assert.equal(url.origin,'https://github.com');assert.equal(url.pathname,`/17hwliao/Zenix/releases/download/${tag}/${name}`);
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-staged-verify-')),file=path.join(folder,name);
  try{
    const download=await fetch(url,{signal:AbortSignal.timeout(300000)});assert(download.ok);const handle=await fs.open(file,'w');let size=0;const hash=createHash('sha256');
    try{for await(const chunk of download.body){size+=chunk.length;assert(size<=asset.size);hash.update(chunk);await handle.writeFile(chunk);}}finally{await handle.close();}
    const digest='sha256:'+hash.digest('hex');assert.equal(size,asset.size);assert.equal(digest,asset.digest);
    await contract.verifyWindowsFile(file,{version:application.version,build:application.zenixBuild},config);
    const {getPath7za}=require('app-builder-lib/out/toolsets/7zip.js'),asar=require('@electron/asar');
    await promisify(execFile)(await getPath7za(),['e',file,'resources/app.asar','-y','-o'+folder],{windowsHide:true});
    const archive=path.join(folder,'app.asar'),core={};
    for(const entry of ['electron/main.cjs','electron/sources.cjs','electron/lx-catalog.cjs','electron/runtime/source-artwork.cjs','electron/runtime/metadata-cache.cjs','electron/runtime/media-protocol.cjs','electron/runtime/updates.cjs','electron/runtime/source-policy.cjs','electron/runtime/source-network.cjs']){
      const actual=asar.extractFile(archive,path.normalize(entry)).toString('utf8').replace(/\r\n/g,'\n'),expected=(await fs.readFile(entry,'utf8')).replace(/\r\n/g,'\n');assert.equal(actual,expected,entry);core[entry]=createHash('sha256').update(actual).digest('hex');
    }
    const receipt={schemaVersion:1,repository:process.env.GITHUB_REPOSITORY,verificationSource:process.env.GITHUB_SHA,run:Number(process.env.GITHUB_RUN_ID),artifact:{version:application.version,build:application.zenixBuild,name,url:url.href,size,sha256:digest.slice(7)},productionIdentityGatePassed:true,packagedCoreSources:core,distributionConfigSha256:createHash('sha256').update(JSON.stringify(config)).digest('hex'),checkedAt:new Date().toISOString(),systemInstallationPerformed:false};
    await fs.mkdir('release',{recursive:true});await fs.writeFile('release/staged-windows-identity.json',JSON.stringify(receipt,null,2));console.log('STAGED_WINDOWS_ACTUAL_IDENTITY_VERIFIED '+digest);
  }finally{assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));assert(path.basename(folder).startsWith('zenix-staged-verify-'));await fs.rm(folder,{recursive:true,force:true});}
}
verify().catch(error=>{console.error(error.message);process.exitCode=1;});
