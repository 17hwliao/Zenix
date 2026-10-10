const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
async function temporary(t){const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'zenix-mobile-playback-'));t.after(()=>fsp.rm(folder,{recursive:true,force:true}));return folder;}
test('Android production source lanes, resolver budgets, priority, cache decisions and idempotent saves on JVM',async t=>{
  const folder=await temporary(t),javaHome=process.env.JAVA_HOME||'C:/Program Files/Android/Android Studio/jbr',bin=name=>path.join(javaHome,'bin',name+(process.platform==='win32'?'.exe':''));
  const cached=path.join(os.homedir(),'.gradle/caches/modules-2/files-2.1/org.json/json/20250517');let jar;
  if(fs.existsSync(cached))for(const child of fs.readdirSync(cached)){const candidate=path.join(cached,child,'json-20250517.jar');if(fs.existsSync(candidate)){jar=candidate;break;}}
  if(!jar){jar=path.join(folder,'json.jar');const response=await fetch('https://repo.maven.apache.org/maven2/org/json/json/20250517/json-20250517.jar');if(!response.ok)throw Error('JSON test runtime unavailable');await fsp.writeFile(jar,Buffer.from(await response.arrayBuffer()));}
  const root=path.resolve(__dirname,'../android/app/src/main/java/com/zenix/musicplayer');
  const sources=['Json','SourceShare','SourceEngineLane','PlaybackSourcePlan','AudioCachePlan','PersonalCollections','MusicSources'].map(name=>path.join(root,name+'.java'));
  sources.push(path.join(__dirname,'fixtures/MobilePlaybackContractCheck.java'));
  for(const name of ['android/content/Context.java','android/os/SystemClock.java','android/util/Base64.java','android/util/AtomicFile.java'])sources.push(path.join(__dirname,'fixtures/mobile-playback-stubs',name));
  await promisify(execFile)(bin('javac'),['-cp',jar,'-d',folder,...sources],{timeout:30000,windowsHide:true});
  const {stdout}=await promisify(execFile)(bin('java'),['-cp',folder+path.delimiter+jar,'com.zenix.musicplayer.MobilePlaybackContractCheck',folder],{timeout:15000,windowsHide:true});assert.match(stdout,/MOBILE_PLAYBACK_CONTRACT_PASS/);
});
test('real React mobile UI: queue management, poster search and animated focus/enlargement, saves, sources and cache',{skip:process.platform!=='win32'},async t=>{
  const folder=await temporary(t);const {createServer}=await import('vite'),httpServer=require('node:http').createServer();
  const server=await createServer({cacheDir:path.join(folder,'vite-cache'),optimizeDeps:{entries:['scripts/fixtures/mobile-playback-ui.html']},plugins:[{name:'mobile-native-fixture',enforce:'pre',resolveId(source,importer){if(importer?.includes('/src/mobile/')&&source==='./native')return path.resolve(__dirname,'fixtures/MobileNative.ts');if(source.endsWith('/ZenixIntro'))return path.resolve(__dirname,'fixtures/MobileIntro.tsx');}}],server:{middlewareMode:true,hmr:{server:httpServer}},logLevel:'error'});
  httpServer.on('request',server.middlewares);await new Promise(resolve=>httpServer.listen(0,'127.0.0.1',resolve));t.after(async()=>{await server.close();await new Promise(resolve=>httpServer.close(resolve));});
  const env={...process.env,ZENIX_TEST_USER_DATA:folder,ZENIX_TEST_UI_URL:`http://127.0.0.1:${httpServer.address().port}/scripts/fixtures/mobile-playback-ui.html`};delete env.ELECTRON_RUN_AS_NODE;
  const {stdout,stderr}=await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/ElectronMobilePlaybackUi.cjs')],{env,timeout:90000,windowsHide:true});assert.match(stdout,/MOBILE_PLAYBACK_UI_PASS/,stderr);
  const transition=stdout.match(/DETAIL_TRANSITION (.+)/);if(transition)t.diagnostic('Chromium fixture detail transition: '+transition[1]);
  const output=path.resolve(__dirname,'../release/regression');await fsp.mkdir(output,{recursive:true});for(const name of ['mobile-swipe-playlist.png','mobile-quick-save.png','mobile-save-animation.png','mobile-glass-confirm.png','mobile-sticker-focus-expand.png','mobile-search-keyboard.png','mobile-search-results.png','mobile-sticker-restored-style.png','mobile-sticker-restored-expanded.png','mobile-sticker-restored-focus.png'])await fsp.copyFile(path.join(folder,name),path.join(output,name));
});
