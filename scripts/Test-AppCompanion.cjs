const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const load=require('./fixtures/load-assistant-ts.cjs');
test('application companion physics stays in client coordinates, pauses, turns and settles without changing size',()=>{
 const {stepAppCompanion,companionChatRight}=load(path.resolve('src/features/assistant/app-companion.ts'));
 const bounds={width:700,height:500,bodyWidth:112,bodyHeight:149};let state={x:585,y:351,vx:0,vy:0,mode:'idle',direction:1,restUntil:0};
 for(let n=0;n<200;n++)state=stepAppCompanion(state,bounds,.032,n*32,{walk:true,paused:false,reduced:false});
 assert(state.x>=0&&state.x<=588);assert.equal(state.y,351);assert.equal(state.direction,-1);
 const frozen=stepAppCompanion(state,bounds,.032,10000,{walk:true,paused:true,reduced:false});assert.equal(frozen.x,state.x);
 state={...state,y:50,vx:700,vy:-400,mode:'falling'};
 for(let n=0;n<150;n++)state=stepAppCompanion(state,bounds,.032,10000+n*32,{walk:false,paused:false,reduced:false});
 assert.equal(state.y,351);assert.equal(state.mode,'idle');assert(state.x<=588);
 const resized=stepAppCompanion({...state,x:999,y:999},{width:200,height:230,bodyWidth:112,bodyHeight:149},.032,20000,{walk:false,paused:false,reduced:true});assert.equal(resized.x,88);assert.equal(resized.y,81);
 assert.equal(companionChatRight({left:1146,width:112,viewportWidth:1280}),146);
 assert.equal(companionChatRight({left:24,width:112,viewportWidth:1280}),766);
 assert.equal(companionChatRight({left:190,width:112,viewportWidth:320}),12);
 assert.equal(companionChatRight(null),22);
});
test('actual in-app renderer keeps size through repeated drags, normal wheels, explicit sizing and window changes',{skip:process.platform!=='win32'},async t=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-app-companion-')),{createServer}=await import('vite');
 const vite=await createServer({cacheDir:path.join(folder,'vite'),optimizeDeps:{entries:['scripts/fixtures/app-companion.html']},server:{middlewareMode:true,hmr:false,ws:false},logLevel:'error'}),http=require('node:http').createServer(vite.middlewares);await new Promise(r=>http.listen(0,'127.0.0.1',r));
 t.after(async()=>{await vite.close();await new Promise(r=>http.close(r));await fs.rm(folder,{recursive:true,force:true});});
 const env={...process.env,ZENIX_TEST_USER_DATA:folder,ZENIX_TEST_UI_URL:`http://127.0.0.1:${http.address().port}/scripts/fixtures/app-companion.html`};delete env.ELECTRON_RUN_AS_NODE;
 const{stdout,stderr}=await promisify(execFile)(require('electron'),[path.join(__dirname,'fixtures/ElectronAppCompanion.cjs')],{env,windowsHide:true,timeout:60000}).catch(e=>{throw Error(`${e.message}\n${e.stdout||''}\n${e.stderr||''}`);});assert.match(stdout,/APP_COMPANION_PASS/,stderr);
});
