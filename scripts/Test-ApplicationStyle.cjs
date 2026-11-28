const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const model=()=>import('../public/ui/appearance.js');
test('appearance settings whitelist values and preserve corrupt or failed storage',async()=>{
  const {defaults,parseAppearance,readAppearance,saveAppearance,appearanceKey}=await model();
  const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  assert.equal(readAppearance(storage).value.style,'neon');
  assert.equal(readAppearance(storage).value.mode,'dark');
  for(const bad of [{version:2},{...defaults,style:'css-injection'},{...defaults,height:Infinity},{...defaults,radius:-1},{...defaults,frame:'true'}])assert.throws(()=>parseAppearance(bad));
  assert.equal(parseAppearance({...defaults,unknown:'ignored'}).unknown,undefined);
  saveAppearance({...defaults,style:'glass',radius:22},{storage});assert.equal(readAppearance(storage).value.radius,22);
  storage.setItem(appearanceKey,'{damaged');assert.match(readAppearance(storage).error,/默认/);
  assert.throws(()=>saveAppearance({...defaults,style:'paper'},{storage}));assert.equal(storage.getItem(appearanceKey),'{damaged');
  saveAppearance({...defaults},{storage,reset:true});assert.equal(readAppearance(storage).error,'');
  const prior=storage.getItem(appearanceKey);assert.throws(()=>saveAppearance({...defaults,style:'sharp'},{storage:{...storage,setItem(){throw Error('quota');}}}));assert.equal(storage.getItem(appearanceKey),prior);
  assert(readAppearance({getItem(){throw Error('denied');}}).error);
});
test('actual React Style controls, cross-window settings, page palettes and contained character',{skip:process.platform!=='win32'},async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-style-')),{createServer}=await import('vite');
  const vite=await createServer({cacheDir:path.join(folder,'vite'),optimizeDeps:{entries:['scripts/fixtures/desktop-navigation.html']},server:{middlewareMode:true,hmr:false,ws:false},logLevel:'error'}),http=require('node:http').createServer(vite.middlewares);
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await vite.close();await new Promise(resolve=>http.close(resolve));await fs.rm(folder,{recursive:true,force:true});});
  const env={...process.env,ZENIX_TEST_USER_DATA:folder,ZENIX_TEST_UI_URL:`http://127.0.0.1:${http.address().port}/scripts/fixtures/desktop-navigation.html`};delete env.ELECTRON_RUN_AS_NODE;
  const {stdout,stderr}=await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/ElectronApplicationStyle.cjs')],{env,windowsHide:true,timeout:120000}).catch(e=>{throw Error(`${e.message}\n${e.stdout||''}\n${e.stderr||''}`);});assert.match(stdout,/APPLICATION_STYLE_PASS/,stderr);
});
