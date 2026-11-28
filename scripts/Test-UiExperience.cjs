const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{promisify}=require('node:util'),{execFile}=require('node:child_process');
test('shared application surfaces and click/touch/keyboard sounds preserve mute, semantics and ownership',{skip:process.platform!=='win32'},async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-ui-experience-')),{createServer}=await import('vite');
 const http=require('node:http').createServer();
 const vite=await createServer({cacheDir:path.join(folder,'vite'),optimizeDeps:{entries:['scripts/fixtures/ui-experience.html']},server:{middlewareMode:true,hmr:{server:http}},logLevel:'error'});http.on('request',vite.middlewares);
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));t.after(async()=>{await vite.close();await new Promise(resolve=>http.close(resolve));await fs.rm(folder,{recursive:true,force:true});});
 const env={...process.env,ZENIX_TEST_USER_DATA:folder,ZENIX_TEST_UI_URL:`http://127.0.0.1:${http.address().port}/scripts/fixtures/ui-experience.html`};delete env.ELECTRON_RUN_AS_NODE;
 const {stdout,stderr}=await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/ElectronUiExperience.cjs')],{env,timeout:60000,windowsHide:true}).catch(error=>{throw Error(`${error.message}\n${error.stdout||''}\n${error.stderr||''}`);});assert.match(stdout,/UI_EXPERIENCE_PASS/,stderr);
});
