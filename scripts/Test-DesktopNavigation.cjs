const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
test('desktop sidebar destinations reuse the window, player and real feature panels',{skip:process.platform!=='win32'},async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-desktop-navigation-'));
  const {createServer}=await import('vite');
  const vite=await createServer({cacheDir:path.join(folder,'vite'),optimizeDeps:{entries:['scripts/fixtures/desktop-navigation.html']},server:{middlewareMode:true,hmr:false},logLevel:'error'});
  const http=require('node:http').createServer(vite.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{const output=path.resolve(__dirname,'../release/regression');await fs.mkdir(output,{recursive:true});for(const file of await fs.readdir(folder))if(file.startsWith('desktop-')&&file.endsWith('.png'))await fs.copyFile(path.join(folder,file),path.join(output,file));await vite.close();await new Promise(resolve=>http.close(resolve));await fs.rm(folder,{recursive:true,force:true});});
  const env={...process.env,ZENIX_TEST_USER_DATA:folder,ZENIX_TEST_UI_URL:`http://127.0.0.1:${http.address().port}/scripts/fixtures/desktop-navigation.html`};delete env.ELECTRON_RUN_AS_NODE;
  const {stdout,stderr}=await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/ElectronDesktopNavigation.cjs')],{env,windowsHide:true,timeout:120000}).catch(error=>{throw Error(`${error.message}\n${error.stdout||''}\n${error.stderr||''}`);});
  assert.match(stdout,/DESKTOP_NAVIGATION_UI_PASS/,stderr);
  const output=path.resolve(__dirname,'../release/regression');await fs.mkdir(output,{recursive:true});
  for(const file of await fs.readdir(folder))if(file.startsWith('desktop-')&&file.endsWith('.png'))await fs.copyFile(path.join(folder,file),path.join(output,file));
});
