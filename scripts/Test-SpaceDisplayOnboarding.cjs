const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),ts=require('typescript'),{promisify}=require('node:util'),{execFile}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function loadDisplayPreference(){
 const source=fs.readFileSync(path.join(root,'src/features/space/displayPreference.ts'),'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const moduleValue={exports:{}};
 vm.runInNewContext(output,{module:moduleValue,exports:moduleValue.exports,require,console,Date,Math,JSON,Object});
 return moduleValue.exports;
}
class MemoryStorage{
 constructor(entries={}){this.values=new Map(Object.entries(entries));this.failWrite=false;}
 getItem(key){return this.values.has(key)?this.values.get(key):null;}
 setItem(key,value){if(this.failWrite)throw Error('quota');this.values.set(key,String(value));}
}
const preference=loadDisplayPreference();
test('versioned preference migrates once and keeps legacy, damaged, and unfamiliar data intact',()=>{
 const fresh=new MemoryStorage(),first=preference.readDisplayPreference(fresh);
 assert.equal(first.status,'missing');assert.equal(first.needsOnboarding,true);assert.equal(first.value.mode,'sticker');
 const selected=preference.writeDisplayPreference({mode:'list'},first.value,fresh);
 assert.equal(selected.status,'ready');assert.equal(selected.needsOnboarding,false);
 assert.deepEqual(JSON.parse(fresh.getItem(preference.presentationKey)),{schema:2,mode:'list',cardScale:1});
 assert.equal(preference.readDisplayPreference(fresh).needsOnboarding,false);

 const legacyRaw=JSON.stringify({mode:'orbit',cardScale:1.15}),legacy=new MemoryStorage({[preference.legacyPresentationKey]:legacyRaw});
 const migrated=preference.readDisplayPreference(legacy);
 assert.equal(migrated.status,'migrated');assert.equal(migrated.needsOnboarding,false);assert.equal(migrated.value.mode,'sticker');
 assert.equal(legacy.getItem(preference.legacyPresentationKey),legacyRaw,'legacy bytes remain available after migration');
 assert.deepEqual(JSON.parse(legacy.getItem(preference.presentationKey)),{schema:2,mode:'sticker',cardScale:1.15});
 assert.equal(preference.readDisplayPreference(legacy).status,'ready','migration is idempotent');

 const corruptRaw='{"schema":2,"mode":"future","cardScale":1}',corrupt=new MemoryStorage({[preference.presentationKey]:corruptRaw});
 const damaged=preference.readDisplayPreference(corrupt);
 assert.equal(damaged.status,'error');assert.equal(damaged.needsOnboarding,false);assert.equal(damaged.value.mode,'sticker');assert.equal(corrupt.getItem(preference.presentationKey),corruptRaw);
 preference.writeDisplayPreference({mode:'list'},damaged.value,corrupt);
 const preserved=[...corrupt.values].filter(([key])=>key.startsWith(preference.corruptPresentationPrefix));
 assert.equal(preserved.length,1);assert.equal(JSON.parse(preserved[0][1]).raw,corruptRaw);

 const oldCorruptRaw='{"mode":"unknown","cardScale":1}',oldCorrupt=new MemoryStorage({[preference.legacyPresentationKey]:oldCorruptRaw});
 const oldDamaged=preference.readDisplayPreference(oldCorrupt);
 assert.equal(oldDamaged.status,'error');assert.equal(oldDamaged.needsOnboarding,false);assert.equal(oldCorrupt.getItem(preference.legacyPresentationKey),oldCorruptRaw);

 const migrationFailure=new MemoryStorage({[preference.legacyPresentationKey]:JSON.stringify({mode:'orbit',cardScale:1})});migrationFailure.failWrite=true;
 const deferred=preference.readDisplayPreference(migrationFailure);
 assert.equal(deferred.status,'error');assert.equal(deferred.needsOnboarding,false);assert.equal(deferred.value.mode,'sticker');assert.equal(migrationFailure.getItem(preference.presentationKey),null);
 migrationFailure.failWrite=false;assert.equal(preference.readDisplayPreference(migrationFailure).status,'migrated','failed migration retries without prompting');

 const failed=new MemoryStorage();failed.failWrite=true;
 assert.throws(()=>preference.writeDisplayPreference({mode:'list'},first.value,failed));
});

test('space source has only sticker and list presentation entry points',()=>{
 const controls=fs.readFileSync(path.join(root,'src/features/space/PresentationControls.tsx'),'utf8');
 const desktop=fs.readFileSync(path.join(root,'src/ui/LatticePlayer.tsx'),'utf8');
 const mobile=fs.readFileSync(path.join(root,'src/mobile/StickerSpace.tsx'),'utf8');
 assert.match(controls,/\{value:'sticker',label:'贴纸拼贴'\},\{value:'list',label:'简约列表'\}/);
 assert.doesNotMatch(controls,/orbit|多轨环绕|环绕卡片大小/);
 assert.doesNotMatch(desktop,/OrbitSongSpace|presentation\.mode==='orbit'/);
 assert.match(desktop,/presentation\.mode==='list'/);
 assert.doesNotMatch(mobile,/OrbitSongSpace|presentation\.mode==='orbit'/);
 for(const deleted of ['src/features/space/OrbitSongSpace.tsx','src/features/space/orbitGeometry.ts','src/features/space/orbitSongSpace.css'])assert.equal(fs.existsSync(path.join(root,deleted)),false,deleted);
 assert.match(fs.readFileSync(path.join(root,'src/ui/PersonalHome.tsx'),'utf8'),/zenix-orbit-ring/,'the separate personal-home card ring remains intact');
 assert.match(fs.readFileSync(path.join(root,'src/features/space/spacePresentation.css'),'utf8'),/@media\(prefers-reduced-motion:reduce\)/);
});

test('PC and mobile onboarding fit, trap focus, persist selection, and never repeat for corrupt data',{skip:process.platform!=='win32'},async t=>{
 const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'zenix-onboarding-ui-'));t.after(()=>fsp.rm(folder,{recursive:true,force:true}));
 const{createServer}=await import('vite'),http=require('node:http').createServer(),server=await createServer({cacheDir:path.join(folder,'vite'),optimizeDeps:{entries:['scripts/fixtures/space-display-onboarding.html']},server:{middlewareMode:true,hmr:false},logLevel:'error'});
 http.on('request',server.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));t.after(async()=>{await server.close();await new Promise(resolve=>http.close(resolve));});
 const env={...process.env,ZENIX_TEST_USER_DATA:folder,ZENIX_TEST_UI_URL:`http://127.0.0.1:${http.address().port}/scripts/fixtures/space-display-onboarding.html`,ZENIX_TEST_SCREENSHOTS:path.resolve('release/regression/space-display-onboarding')};delete env.ELECTRON_RUN_AS_NODE;
 const{stdout,stderr}=await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/ElectronSpaceDisplayOnboarding.cjs')],{env,timeout:120000,windowsHide:true});
 assert.match(stdout,/SPACE_DISPLAY_ONBOARDING_UI_PASS/,stderr);
});
