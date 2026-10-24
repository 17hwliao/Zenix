const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const ts=require('typescript'),Module=require('node:module');
function loadIntent(){return require('./fixtures/load-assistant-ts.cjs')(path.resolve(__dirname,'../src/features/assistant/intent.ts')).understand;}

test('spoken music intents preserve names, refuse negation/compound requests and confirm uncertain recognition',()=>{
 const understand=loadIntent();
 for(const text of ['下一首','换一首','星音，请换一首吧','下一手'])assert.equal(understand(text).action,'next',text);
 assert.equal(understand('请帮我搜索一下像风一样').args.query,'像风一样');
 assert.equal(understand('我想听周杰伦的晴天').args.query,'周杰伦 晴天');
 assert.equal(understand('不要暂停').kind,'unknown');assert.equal(understand('下一首然后暂停').kind,'unknown');assert.equal(understand('删除全部歌单').kind,'unknown');
 assert.equal(understand('下一首',.3).kind,'confirm');assert.equal(understand('你好可爱').emotion,'shy');assert.equal(understand('你好').kind,'reply');
});
test('PCM waveform uses bounded mono16k format and speech IPC rejects non-audio without starting a helper',async()=>{
 const {wavBase64}=require('../src/features/assistant/hold-recording.cjs'),{AssistantSpeech}=require('../electron/runtime/assistant-speech.cjs');const wav=wavBase64(new Float32Array(48000).fill(.5),48000),bytes=Buffer.from(wav,'base64');assert.equal(bytes.length,32044);assert.equal(bytes.readUInt32LE(24),16000);assert.equal(bytes.readUInt32LE(40),32000);assert.equal(bytes.readInt16LE(44),16384);
 let spawns=0;const service=new AssistantSpeech({platform:'win32',spawnProcess:()=>{spawns++;throw Error('unexpected spawn');}});await assert.rejects(service.request({token:require('node:crypto').randomUUID(),wav:'not audio'}),/格式无效/);await assert.rejects(service.request({token:'bad',wav}),/会话无效/);assert.equal(spawns,0);
});
test('Windows speech capabilities use the installed offline recognizer without microphone access',{skip:process.platform!=='win32'},async t=>{
 const {AssistantSpeech}=require('../electron/runtime/assistant-speech.cjs'),service=new AssistantSpeech();try{const result=await service.request({action:'speechCapabilities',token:require('node:crypto').randomUUID()});assert.equal(result.offline,true);assert.equal(result.language,'zh-CN');const {wavBase64}=require('../src/features/assistant/hold-recording.cjs');const silence=await service.request({action:'speechRecognize',token:require('node:crypto').randomUUID(),wav:wavBase64(new Float32Array(16000),16000)});assert.equal(silence.transcript,'');assert.equal(service.sessions.size,0);}catch(error){if(String(error).includes('未安装 Windows 中文'))t.skip('本机未安装可选中文识别组件');else throw error;}finally{service.close();}
});
test('closing the desktop pet cancels its unfinished utterance without cancelling main-window voice',async()=>{
 const {EventEmitter}=require('node:events'),{Assistant}=require('../electron/runtime/assistant.cjs'),handlers=new Map(),commands=[],cancelled=[];
 class PetWindow extends EventEmitter {constructor(){super();this.webContents={send(){},setWindowOpenHandler(){},on(){}};}isDestroyed(){return !!this.destroyed;}async loadFile(){}showInactive(){}close(){this.destroyed=true;this.emit('closed');}}
 const assistant=new Assistant({folder:os.tmpdir(),getWindow:()=>null,BrowserWindow:PetWindow,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},execute:async action=>commands.push(action)});
 let reject;assistant.speech={request:()=>new Promise((_resolve,fail)=>{reject=fail;}),cancel:token=>{cancelled.push(token);reject(Error('已取消语音识别'));},close:()=>assert.fail('pet closure must not close the main-window speech service')};
 await assistant.open({size:150});const token=require('node:crypto').randomUUID(),pending=handlers.get('assistant:pet-speech')({sender:assistant.window.webContents},{action:'speechRecognize',token,wav:'test'}),rejected=assert.rejects(pending,/取消/);assistant.closePet();await rejected;assert.deepEqual(cancelled,[token]);assert.deepEqual(commands,[]);assert.equal(assistant.petSpeechTokens.size,0);
});
test('actual conversation UI handles hold/release, repeated keys, early release, cancellation and character reactions',{skip:process.platform!=='win32'},async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'zenix-voice-ui-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));const {createServer}=await import('vite'),http=require('node:http').createServer();const server=await createServer({cacheDir:path.join(folder,'vite'),optimizeDeps:{entries:['scripts/fixtures/assistant-conversation.html']},server:{middlewareMode:true,hmr:{server:http},watch:{ignored:['**/release/**','**/android/**']}},logLevel:'error'});http.on('request',server.middlewares);await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));t.after(async()=>{await server.close();await new Promise(resolve=>http.close(resolve));});const env={...process.env,ZENIX_TEST_USER_DATA:folder,ZENIX_TEST_UI_URL:`http://127.0.0.1:${http.address().port}/scripts/fixtures/assistant-conversation.html`};delete env.ELECTRON_RUN_AS_NODE;const {stdout,stderr}=await require('node:util').promisify(require('node:child_process').execFile)(require('electron'),[path.join(__dirname,'fixtures/ElectronAssistantVoice.cjs')],{env,timeout:90000,windowsHide:true});assert.match(stdout,/ASSISTANT_VOICE_UI_PASS/,stderr);
});
