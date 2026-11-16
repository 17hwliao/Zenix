const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises'),os=require('node:os');
const {EventEmitter}=require('node:events'),{randomUUID}=require('node:crypto');
const {AssistantVoice,proxyAddress}=require('../electron/runtime/assistant-voice.cjs');
const load=require('./fixtures/load-assistant-ts.cjs');
const {speakReply}=load(path.resolve(__dirname,'../src/features/assistant/replyVoice.ts'));
const tick=()=>new Promise(setImmediate);
class Thread extends EventEmitter{terminated=0;async terminate(){this.terminated++;}}
const request=text=>({operation:'assistant',action:'speechSynthesize',requestId:randomUUID(),text});
const packet={voice:'zh-CN-XiaoyiNeural',mimeType:'audio/mpeg',audioBase64:Buffer.alloc(200,255).toString('base64')};

test('PC uses the selected fixed Xiaoyi voice and bounds each native request without accepting arbitrary paths or voices',async()=>{
 const threads=[],data=[];const service=new AssistantVoice({resolveProxy:async()=>'PROXY 127.0.0.1:7890',worker:value=>{data.push(value);const thread=new Thread();threads.push(thread);return thread;}});
 try{
  const pending=service.synthesize(request('你好，星音'));await tick();threads[0].emit('message',{audio:new Uint8Array(200)});const result=await pending;
  assert.equal(result.voice,packet.voice);assert.equal(data[0].proxy,'http://127.0.0.1:7890');assert.equal(threads[0].terminated,1);assert.equal(service.active.size,0);
  assert.throws(()=>service.synthesize({...request('text'),voice:'anything'}),/无效/);assert.throws(()=>service.synthesize(request('a'.repeat(301))),/超过/);
  assert.throws(()=>proxyAddress('SOCKS5 host:1080'),/不支持/);
 }finally{service.close();}
});
test('cancellation or a deadline during proxy resolution prevents a late worker from opening a network connection',async()=>{
 let resolveProxy,workers=0;const service=new AssistantVoice({resolveProxy:()=>new Promise(resolve=>{resolveProxy=resolve;}),worker:()=>{workers++;return new Thread();},timeoutMs:1000});
 try{const args=request('取消'),pending=service.synthesize(args);const rejected=assert.rejects(pending,/取消/);service.cancel({requestId:args.requestId});await rejected;resolveProxy('DIRECT');await tick();assert.equal(workers,0);await assert.rejects(service.synthesize(args),/取消/);}finally{service.close();}
 const timeout=new AssistantVoice({resolveProxy:()=>new Promise(()=>{}),timeoutMs:15});try{await assert.rejects(timeout.synthesize(request('timeout')),/超时/);assert.equal(timeout.active.size,0);}finally{timeout.close();}
});
test('native cancellation terminates the worker; invalid audio and late completion cannot turn into success',async()=>{
 const threads=[];const service=new AssistantVoice({resolveProxy:async()=>'DIRECT',worker:()=>{const thread=new Thread();threads.push(thread);return thread;}});
 try{const args=request('取消'),pending=service.synthesize(args);await tick();const rejected=assert.rejects(pending,/取消/);service.cancel({requestId:args.requestId});threads[0].emit('message',{audio:new Uint8Array(200)});await rejected;assert.equal(threads[0].terminated,1);
  const bad=service.synthesize(request('坏数据'));await tick();threads[1].emit('message',{audio:new Uint8Array(0)});await assert.rejects(bad,/无效/);
 }finally{service.close();}
});
function browser(t){
 const original=Object.fromEntries(['Audio','speechSynthesis','SpeechSynthesisUtterance'].map(key=>[key,globalThis[key]]));
 const audio=[],spoken=[];
 globalThis.Audio=class{constructor(url){this.src=url;audio.push(this);}play(){return Promise.resolve();}pause(){this.paused=true;}removeAttribute(){this.src='';}load(){}};
 globalThis.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
 globalThis.speechSynthesis={getVoices:()=>[{name:'系统中文',lang:'zh-CN'}],speak:utterance=>spoken.push(utterance),cancel(){}};
 t.after(()=>{for(const[key,value]of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 return {audio,spoken};
}
test('renderer plays generated audio, releases Blob ownership and uses system speech only on a real online failure',async t=>{
 const f=browser(t),controller=new AbortController();let fallback=0;
 const pending=speakReply('你好',async()=>packet,controller.signal,{online:true,onFallback:()=>fallback++});await tick();assert.equal(f.audio.length,1);f.audio[0].onended();await pending;assert(f.audio[0].paused);assert.equal(f.audio[0].src,'');assert.equal(f.spoken.length,0);assert.equal(fallback,0);
 const failed=speakReply('网络不可用',async()=>{throw Error('network');},new AbortController().signal,{online:true,onFallback:()=>fallback++});await tick();assert.equal(f.spoken.length,1);f.spoken[0].onend();await failed;assert.equal(fallback,1);
});
test('cancel during online synthesis or playback never starts fallback or plays a late reply',async t=>{
 const f=browser(t),controller=new AbortController(),calls=[];let finish,fallback=0;
 const pending=speakReply('取消',async args=>{calls.push(args);if(args.action==='speechSynthesisCancel')return true;return new Promise(resolve=>{finish=resolve;});},controller.signal,{online:true,onFallback:()=>fallback++});
 controller.abort();finish(packet);await assert.rejects(pending);assert.equal(f.audio.length,0);assert.equal(f.spoken.length,0);assert.equal(fallback,0);assert.equal(calls[0].requestId,calls[1].requestId);
 const next=new AbortController(),playing=speakReply('停止',async()=>packet,next.signal,{online:true});await tick();next.abort();await assert.rejects(playing);assert(f.audio[0].paused);assert.equal(f.spoken.length,0);
});
test('production Android voice protocol matches upstream time tokens and rejects malformed, cancelled, oversized or empty streams',async t=>{
 const {execFile}=require('node:child_process'),{promisify}=require('node:util'),run=promisify(execFile);
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-voice-jvm-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const home=process.env.JAVA_HOME||(process.platform==='win32'?'C:/Program Files/Android/Android Studio/jbr':null),bin=name=>home?path.join(home,'bin',name+(process.platform==='win32'?'.exe':'')):name;
 const dependencies=[['com.squareup.okhttp3','okhttp','4.12.0'],['com.squareup.okio','okio-jvm','3.6.0'],['org.jetbrains.kotlin','kotlin-stdlib','2.2.10']];
 const jars=await Promise.all(dependencies.map(async([group,name,version])=>{const cache=path.join(os.homedir(),'.gradle/caches/modules-2/files-2.1',group,name,version);try{for(const sub of await fs.readdir(cache)){const file=path.join(cache,sub,`${name}-${version}.jar`);try{await fs.access(file);return file;}catch{}}}catch{}const file=path.join(folder,name+'.jar'),response=await fetch(`https://repo.maven.apache.org/maven2/${group.replaceAll('.','/')}/${name}/${version}/${name}-${version}.jar`);if(!response.ok)throw Error('JVM dependency unavailable');await fs.writeFile(file,Buffer.from(await response.arrayBuffer()));return file;}));
 const root=path.resolve(__dirname,'../android/app/src/main/java/com/zenix/musicplayer'),classpath=jars.join(path.delimiter);
 await run(bin('javac'),['-cp',classpath,'-d',folder,path.join(root,'EdgeVoiceToken.java'),path.join(root,'AssistantOnlineVoice.java'),path.join(__dirname,'fixtures/AssistantVoiceCheck.java')],{timeout:30000,windowsHide:true});
 const javaClasspath=folder+path.delimiter+classpath;
 const {stdout}=await run(bin('java'),['-cp',javaClasspath,'com.zenix.musicplayer.AssistantVoiceCheck'],{timeout:10000,windowsHide:true});assert.match(stdout,/ASSISTANT_VOICE_NATIVE_PASS/);
 const times=[0,1700000000000,1793930400000,1793930699000,1793930700000];
 const {stdout:tokens}=await run(bin('java'),['-cp',javaClasspath,'com.zenix.musicplayer.AssistantVoiceCheck',...times.map(String)],{timeout:10000,windowsHide:true});
 const {generateSecMsGecToken_V2}=require('node-edge-tts/dist/drm.js');assert.deepEqual(tokens.trim().split(/\r?\n/),times.map(at=>generateSecMsGecToken_V2(at/1000)));
});

test('actual Android speech lifecycle keeps the newest fallback through TTS initialization, handles failures and rejects cancelled players',async t=>{
 const {execFile}=require('node:child_process'),run=require('node:util').promisify(execFile);
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-speech-lifecycle-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const home=process.env.JAVA_HOME||(process.platform==='win32'?'C:/Program Files/Android/Android Studio/jbr':null),bin=name=>home?path.join(home,'bin',name+(process.platform==='win32'?'.exe':'')):name;
 const stubs=require('./fixtures/android-assistant-speech-stubs.cjs'),files=[];
 for(const[name,code]of Object.entries(stubs)){const file=path.join(folder,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,code);files.push(file);}
 await run(bin('javac'),['-d',folder,...files,path.resolve('android/app/src/main/java/com/zenix/musicplayer/AssistantSpeech.java'),path.join(__dirname,'fixtures/AssistantSpeechLifecycleCheck.java')],{timeout:30000,windowsHide:true});
 const {stdout}=await run(bin('java'),['-cp',folder,'com.zenix.musicplayer.AssistantSpeechLifecycleCheck'],{timeout:10000,windowsHide:true});assert.match(stdout,/ASSISTANT_SPEECH_LIFECYCLE_PASS/);
});
