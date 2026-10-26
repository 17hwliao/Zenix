const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{promisify}=require('node:util'),{execFile}=require('node:child_process');
test('production PC/mobile space hosts preserve objects and bookmarks while switching display',{skip:process.platform!=='win32'},async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-space-host-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const{createServer}=await import('vite'),http=require('node:http').createServer(),server=await createServer({cacheDir:path.join(folder,'vite'),optimizeDeps:{entries:['scripts/fixtures/space-presentation-host.html']},server:{middlewareMode:true,hmr:false},logLevel:'error'});
 http.on('request',server.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));t.after(async()=>{await server.close();await new Promise(resolve=>http.close(resolve));});
 const env={...process.env,ZENIX_TEST_USER_DATA:folder,ZENIX_TEST_UI_URL:`http://127.0.0.1:${http.address().port}/scripts/fixtures/space-presentation-host.html`,ZENIX_TEST_SCREENSHOTS:path.resolve('release/regression/space-presentation-host')};delete env.ELECTRON_RUN_AS_NODE;
 const {stdout,stderr}=await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/ElectronSpacePresentationHost.cjs')],{env,windowsHide:true,timeout:120000});assert.match(stdout,/SPACE_HOST_PASS/,stderr);
});
