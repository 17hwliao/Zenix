const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),vm=require('node:vm'),path=require('node:path'),os=require('node:os'),{createRequire}=require('node:module');
test('reimport keeps both explicit and implicit old platform choices and restricted network permissions',async t=>{
 const file=path.resolve(__dirname,'../electron/sources.cjs'),module={exports:{}},requireFrom=createRequire(file);
 const initialized={sources:Object.fromEntries(['wy','tx','kg'].map(key=>[key,{type:'music',actions:['musicUrl'],qualitys:['320k']}]))};
 class Runner{async start(){this.lxInfo=initialized;}destroy(){}}
 vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports.lxManifest=lxManifest;',{module,require:name=>name==='electron'?{ipcMain:{}}:name==='./runtime/source-runner.cjs'?{SourceRunner:Runner}:requireFrom(name),Buffer,URL,AbortSignal,console});
 const {SourceManager,lxManifest}=module.exports,origin={kind:'url',label:'https://example.test/fixture.js'},script='/**\n * @name Fixture\n * @version 1\n */';
 const folder=await fsp.mkdtemp(path.join(os.tmpdir(),'zenix-platform-preserve-'));t.after(()=>fsp.rm(folder,{recursive:true,force:true}));
 for(const previous of [undefined,'kg']){
  const manifest=lxManifest(origin,script,initialized);manifest.settings[0].default='wy';
  const networkPolicy={allowHttp:false,hosts:['audio.example.test']},old={id:manifest.id,manifest,networkPolicy,installedAt:1};
  const manager={folder,records:[old],settings:{[old.id]:previous?{lxCatalog:previous,other:'retained'}:{other:'retained'}},retireSource(){},async save(){},list(){return this.records;}};
  await SourceManager.prototype.installLx.call(manager,script,origin);
  assert.equal(manager.settings[old.id].lxCatalog,previous||'wy');assert.equal(manager.settings[old.id].other,'retained');
  assert.deepEqual({...manager.records[0].networkPolicy},{...networkPolicy});assert.equal(manager.records[0].installedAt,1);
 }
});
test('production source manifest selects supported QQ first; descriptors retain explicit previous choices',()=>{
 const file=path.resolve(__dirname,'../electron/sources.cjs'),module={exports:{}};
 const requireFrom=createRequire(file);
 vm.runInNewContext(fs.readFileSync(file,'utf8')+'\nmodule.exports.lxManifest=lxManifest;',{module,require:name=>name==='electron'?{ipcMain:{}}:requireFrom(name),Buffer,URL,AbortSignal,console});
 const {lxManifest,SourceManager}=module.exports;
 for(const keys of [['wy','tx','kg'],['kg','kw'],['wy']]){
  const sources=Object.fromEntries(keys.map(key=>[key,{type:'music',actions:['musicUrl'],qualitys:['320k']}]));
  const manifest=lxManifest({label:'https://example.test/source.js'},'/**\n * @name Fixture\n * @version 1\n */',{sources});
  assert.equal(manifest.settings[0].default,keys.includes('tx')?'tx':keys.includes('kw')?'kw':'wy');
  const existing={id:manifest.id,kind:'lx',manifest,enabled:true};
  const view=SourceManager.prototype.list.call({records:[existing],settings:{[manifest.id]:{lxCatalog:keys[0],credential:'private'}},errors:new Map(),runners:new Map()});
  assert.equal(view[0].catalog,keys[0]);assert.equal(view[0].settings,undefined,'private settings never included in descriptor');
 }
});
test('first-use production React settings preserve configuration, require import confirmation, and expose non-playing search recovery',{skip:process.platform!=='win32'},async t=>{
 const {createServer}=await import('vite'),folder=await fsp.mkdtemp(path.join(os.tmpdir(),'zenix-source-setup-'));
 const server=await createServer({cacheDir:path.join(folder,'vite'),optimizeDeps:{entries:['scripts/fixtures/source-setup.html']},server:{middlewareMode:true,hmr:false},logLevel:'error'});const http=require('node:http').createServer(server.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));t.after(async()=>{await server.close();await new Promise(resolve=>http.close(resolve));await fsp.rm(folder,{recursive:true,force:true});});
 const env={...process.env,ZENIX_TEST_USER_DATA:folder,ZENIX_TEST_UI_URL:`http://127.0.0.1:${http.address().port}/scripts/fixtures/source-setup.html`};delete env.ELECTRON_RUN_AS_NODE;
 const {stdout,stderr}=await require('node:util').promisify(require('node:child_process').execFile)(require('electron'),[path.join(__dirname,'fixtures/ElectronSourceSetupUi.cjs')],{env,windowsHide:true,timeout:45000});assert.match(stdout,/SOURCE_SETUP_UI_PASS/,stderr);
});
