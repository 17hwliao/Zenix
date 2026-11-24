const{app,BrowserWindow}=require('electron'),assert=require('node:assert/strict');
app.setPath('userData',process.env.ZENIX_TEST_USER_DATA);app.disableHardwareAcceleration();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1000,height:850,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}}),page=win.webContents;
 const evaluate=async code=>{try{return await page.executeJavaScript(code,true);}catch(error){console.error("Failing UI evaluation:",code);console.error(await page.executeJavaScript("JSON.stringify(window.workbenchErrors)"));throw error;}},wait=async code=>{for(let n=0;n<200;n++){if(await evaluate(code))return;await sleep(30);}throw Error('workbench UI wait '+code+' state '+JSON.stringify(await evaluate('({width:innerWidth,height:innerHeight})'))+' bounds '+JSON.stringify(win.getContentBounds()));};
 const tabs=[['私人资料','.zenix-personal-features'],['播放与版本','.playback-features'],['K歌','.zenix-karaoke-modes'],['缓存与任务','.zenix-offline-tasks'],['空间与漫游','.space-features-panel'],['设备协作','.zenix-connections'],['音乐助手','.zenix-assistant-panel']];
 const open=async()=>{await evaluate('document.querySelector(".zenix-tools-launch").focus();document.querySelector(".zenix-tools-launch").click()');await wait('!!document.querySelector(".zenix-feature-workbench")');};
 const close=async()=>{await evaluate('document.querySelector("[aria-label=关闭音乐工作台]").click()');await wait('!document.querySelector(".zenix-feature-workbench")');};
 const openSongSearch=async()=>{
  await evaluate('document.querySelector(".zenix-karaoke-song-controls>button").click()');
  await wait('document.activeElement===document.querySelector(".zenix-karaoke-song-search input")');
 };
 const searchFor=async word=>{
  await evaluate(`(()=>{const input=document.querySelector('.zenix-karaoke-song-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(word)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait('document.querySelector(".zenix-karaoke-song-search [type=submit]")?.disabled===false');
  await evaluate('document.querySelector(".zenix-karaoke-song-search [type=submit]").click()');
 };
 const chooseSong=async title=>{
  const result=`[...document.querySelectorAll('.zenix-karaoke-song-search li button')].find(button=>button.querySelector('strong').textContent===${JSON.stringify(title)})`;
  await wait(`!!(${result})`);
  await evaluate(`(${result}).click()`);
  await wait(`document.querySelector('.zenix-karaoke-solo-picker select')?.selectedOptions[0]?.textContent.includes(${JSON.stringify(title)})&&!document.querySelector('.zenix-karaoke-song-search')`);
 };
 for(const mode of ['desktop','mobile']){
  await win.loadURL(process.env.ZENIX_TEST_UI_URL+'?mode='+mode);await wait('!!document.querySelector(".zenix-tools-launch")');
  assert.equal(await evaluate('!!document.querySelector(".zenix-feature-workbench")'),false);
  assert.equal(await evaluate('performance.getEntriesByType("resource").some(value=>value.name.includes("/src/features/FeatureWorkbench.tsx"))'),false,'workbench code stays lazy until opened');
  assert.equal(await evaluate('window.workbenchAudioCount'),0,'closed workbench creates no audio player');
  await open();if(mode==='desktop')await evaluate('window.workbenchFixture.initialisePlayer()');
  await wait('document.querySelector(".zenix-personal-features")?.textContent.includes("片段书签")');
  assert.equal(await evaluate('window.workbenchFixture.calls.some(value=>value.operation==="offlineTasks")'),false,'unselected tasks are not mounted or polled');
  // External assistant commands must also work while the workbench is already
  // mounted, including returning to the same tab as the original open request.
  await evaluate('[...document.querySelectorAll(".zenix-feature-workbench>nav button")].find(button=>button.textContent==="音乐助手").click()');
  await wait('!!document.querySelector(".zenix-assistant-panel")');
  for(const [tab,selector]of [['personal','.zenix-personal-features'],['tasks','.zenix-offline-tasks'],['connections','.zenix-connections']]){
   await evaluate(`window.dispatchEvent(new CustomEvent('zenix-open-workbench',{detail:{tab:${JSON.stringify(tab)}}}))`);
   await wait(`!!document.querySelector(${JSON.stringify(selector)})`);
  }
  await evaluate('[...document.querySelectorAll(".zenix-feature-workbench>nav button")].find(button=>button.textContent==="音乐助手").click()');await wait('!!document.querySelector(".zenix-assistant-panel")');
  await evaluate('window.dispatchEvent(new CustomEvent("zenix-open-workbench",{detail:{tab:"connections"}}))');await wait('!!document.querySelector(".zenix-connections")');
  for(const width of [1000,390,320]){
   win.setContentSize(width,850);await wait(`Math.abs(innerWidth-${width})<=1`);
   for(const[label,selector]of tabs){
    await evaluate(`(()=>{const button=[...document.querySelectorAll('.zenix-feature-workbench>nav button')].find(value=>value.textContent===${JSON.stringify(label)});button.scrollIntoView({block:'nearest',inline:'nearest'});button.click();})()`);
    await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await sleep(70);
    if(label==='K歌'){
     await wait(`!!document.querySelector('[data-karaoke-adapter="${mode}"]')`);
     assert.equal(await evaluate('document.querySelector(".zenix-karaoke-mode-buttons [aria-pressed=true]")?.textContent'),'个人练唱');
     assert.equal(await evaluate('!!document.querySelector(".zenix-karaoke-lan-setup")'),false);
     await evaluate('document.querySelector(".zenix-karaoke-mode-buttons button:nth-child(2)").click()');
     await wait(mode==='desktop'?'!!document.querySelector(".zenix-karaoke-lan-setup")':'!!document.querySelector(".zenix-karaoke-mobile-join")');
     const labels=await evaluate('[...document.querySelectorAll(".zenix-karaoke-page button")].map(button=>button.textContent.trim())');
     assert(labels.includes(mode==='desktop'?'创建房间':'申请加入'),'LAN mode opens the platform-specific room setup');
     await evaluate('document.querySelector(".zenix-karaoke-mode-buttons button:first-child").click()');
     await wait(`!!document.querySelector('[data-karaoke-adapter="${mode}"]')`);
     if(width===320){
      await openSongSearch();
      await searchFor('像风一样 测试歌手');
      await wait('document.querySelector(".zenix-karaoke-song-search li")?.textContent.includes("像风一样")');
     }
    }
    if(label==='音乐助手'&&width===1000){
     await wait('document.querySelector(".assistant-character .pet-portrait img")?.naturalWidth===1086');
     await evaluate('document.querySelector(".assistant-stage").scrollIntoView({block:"center"})');
     const hit=await evaluate('(()=>{const r=document.querySelector(".assistant-hit").getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()');
     page.sendInputEvent({type:'mouseDown',...hit,button:'left',clickCount:1});page.sendInputEvent({type:'mouseMove',x:hit.x+100,y:hit.y+30});page.sendInputEvent({type:'mouseUp',x:hit.x+100,y:hit.y+30,button:'left',clickCount:1});
     await wait('new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".assistant-position")).transform).m41>80');
     assert.equal(await evaluate('document.activeElement===document.querySelector(".zenix-assistant-panel input[aria-label=\'音乐指令\']")'),false,'drag cannot become an assistant click');
     const moved=await evaluate('(()=>{const r=document.querySelector(".assistant-hit").getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()');
     page.sendInputEvent({type:'mouseDown',...moved,button:'left',clickCount:1});page.sendInputEvent({type:'mouseUp',...moved,button:'left',clickCount:1});
     await wait('document.activeElement===document.querySelector(".zenix-assistant-panel input[aria-label=\'音乐指令\']")');
    }
    const geometry=await evaluate(`(()=>{const panel=document.querySelector('.zenix-feature-workbench'),body=panel.querySelector('.zenix-feature-content'),close=panel.querySelector('[aria-label="关闭音乐工作台"]'),r=panel.getBoundingClientRect(),b=close.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scroll:body.scrollWidth,width:body.clientWidth,document:document.documentElement.scrollWidth,viewport:innerWidth,close:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('button')===close};})()`);
    assert(geometry.left>=0&&geometry.right<=width+1&&geometry.top>=0&&geometry.bottom<=850,mode+' dialog stays in viewport '+label+' '+width+' '+JSON.stringify(geometry));
    assert(geometry.scroll<=geometry.width+1,mode+' panel does not horizontally overflow '+label+' '+width+' '+JSON.stringify(geometry));assert(geometry.document<=width+1,'document width '+JSON.stringify(geometry));assert(geometry.close,'close remains hittable '+label);
    if(label==='K歌'&&width===320)await chooseSong('像风一样');
    for(const[,other]of tabs)if(other!==selector)assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(other)})`),false,'only selected tab mounts');
   }
  }
  await evaluate('[...document.querySelectorAll(".zenix-feature-workbench>nav button")].find(button=>button.textContent==="音乐助手").click()');await wait('document.querySelectorAll(".assistant-costumes button").length===8');
   // PNG decode/encoding is asynchronous work, not a six-second UI transition.
   // Keep the real implementation and add test-only phase timing. One controlled
   // slow decode proves completion remains observable beyond the generic UI wait.
   await evaluate(`(()=>{const decode=HTMLImageElement.prototype.decode,toBlob=HTMLCanvasElement.prototype.toBlob;window.costumeTrace=[];let first=${mode==='desktop'};const mark=(phase,value)=>window.costumeTrace.push({phase,at:performance.now(),...value});HTMLImageElement.prototype.decode=function(){const src=this.currentSrc||this.src,slow=first;first=false;mark('decode-start',{src,slow});return decode.call(this).then(async value=>{if(slow)await new Promise(resolve=>setTimeout(resolve,6500));mark('decode-end',{src,slow});return value;},error=>{mark('decode-error',{src,error:String(error)});throw error;});};HTMLCanvasElement.prototype.toBlob=function(callback,type,quality){const dimensions={width:this.width,height:this.height};mark('encode-start',dimensions);return toBlob.call(this,blob=>{mark('encode-end',{...dimensions,bytes:blob?.size});callback(blob);},type,quality);};window.restoreCostumeInstrumentation=()=>{HTMLImageElement.prototype.decode=decode;HTMLCanvasElement.prototype.toBlob=toBlob;};})()`);
   const costumeTimings=[];
   for(let costume=0;costume<8;costume++){
    const name=await evaluate(`document.querySelectorAll('.assistant-costumes button')[${costume}].textContent.trim()`);
    const started=Date.now(),traceStart=await evaluate('window.costumeTrace.length');
    await evaluate(`document.querySelectorAll('.assistant-costumes button')[${costume}].click()`);
    // The generic success message can still belong to the previous preview while
    // React is committing this click. Bind completion to this costume's identity.
    try{const deadline=Date.now()+30000;let finished=false;while(Date.now()<deadline){const state=await evaluate(`({message:document.querySelector('.assistant-message')?.textContent||'',skin:document.querySelector('.assistant-character>img')?.alt,disabled:document.querySelectorAll('.assistant-costumes button')[${costume}]?.disabled})`);if(state.skin==='Zenix 星音 · '+name&&state.message.includes('皮肤已载入预览')&&state.disabled===false){finished=true;break;}if(state.disabled===false&&state.message&&!state.message.includes('皮肤已载入预览'))throw Error('Preview rejected: '+state.message);await sleep(30);}if(!finished)throw Error('PNG preview infrastructure deadline (30s)');}
    catch(error){const state=await evaluate(`({message:document.querySelector('.assistant-message')?.textContent,skin:document.querySelector('.assistant-character>img')?.alt,disabled:document.querySelectorAll('.assistant-costumes button')[${costume}]?.disabled,trace:window.costumeTrace.slice(${traceStart}),resources:performance.getEntriesByType('resource').filter(row=>row.name.includes('/assets/assistant/')).map(row=>({name:row.name,duration:row.duration,transferSize:row.transferSize}))})`);throw Error(`${mode} costume ${costume+1}/8 (${name}) preview did not finish: ${JSON.stringify(state)}; ${error.message}`,{cause:error});}
    const trace=await evaluate(`window.costumeTrace.slice(${traceStart})`);assert.equal(trace.filter(item=>item.phase==='decode-end').length,1,'real atlas decode completes');assert.equal(trace.filter(item=>item.phase==='encode-end'&&item.bytes>0).length,4,'all four real PNG frames encoded');if(mode==='desktop'&&costume===0){const start=trace.find(item=>item.phase==='decode-start'),end=trace.find(item=>item.phase==='decode-end');assert(end.at-start.at>=6500,'controlled slow decode exceeds the old generic six-second wait');}costumeTimings.push({name,elapsedMs:Date.now()-started,decodeMs:trace.find(item=>item.phase==='decode-end').at-trace.find(item=>item.phase==='decode-start').at,encodeMs:trace.filter(item=>item.phase==='encode-end').at(-1).at-trace.find(item=>item.phase==='encode-start').at});
    await evaluate('document.querySelector(".assistant-message button").click()');const config=await evaluate('window.workbenchFixture.calls.filter(call=>call.action==="skinSave").length');assert.equal(config,0,'preview does not silently save skin');
   }
   await evaluate('window.restoreCostumeInstrumentation()');console.log('COSTUME_PREVIEW_TIMINGS',mode,JSON.stringify(costumeTimings));
  await evaluate('[...document.querySelectorAll(".zenix-assistant-panel button")].find(button=>button.textContent==="保存当前皮肤").click()');await wait('window.workbenchFixture.calls.some(call=>call.action==="skinSave")');const saved=await evaluate('(()=>{const call=window.workbenchFixture.calls.find(call=>call.action==="skinSave");return {name:call.config.name,frames:call.config.frames.length,animations:Object.keys(call.config.animations),archive:call.base64.length};})()');assert.match(saved.name,/Zenix/);assert.equal(saved.frames,4);assert(saved.animations.includes('greeting'));assert(saved.archive<12*1024*1024);
  await evaluate('[...document.querySelectorAll(".zenix-assistant-panel button")].find(button=>button.textContent==="打开按住说话").click()');await wait('!!document.querySelector(".assistant-chat [data-skin]")');assert.match(await evaluate('document.querySelector(".assistant-chat [data-skin]").dataset.skin'),/海蓝女仆/);await evaluate('document.querySelector("[aria-label=关闭语音助手]").click()');await evaluate('[...document.querySelectorAll(".zenix-assistant-panel button")].find(button=>button.textContent==="恢复默认").click()');await wait('window.workbenchFixture.calls.some(call=>call.action==="skinReset")');
  if(mode==='mobile'){
   const tab=async label=>{await evaluate(`(()=>{[...document.querySelectorAll('.zenix-feature-workbench>nav button')].find(value=>value.textContent===${JSON.stringify(label)}).click();})()`);await sleep(100);};
   const click=async label=>{try{await wait(`(()=>{const button=[...document.querySelectorAll('.zenix-feature-content button')].find(value=>value.textContent===${JSON.stringify(label)});return !!button&&!button.disabled;})()`);}catch(error){throw Error(error.message+' controls '+JSON.stringify(await evaluate('({buttons:[...document.querySelectorAll(".zenix-feature-content button")].map(button=>({text:button.textContent,disabled:button.disabled})),selected:document.querySelector(".zenix-feature-workbench>nav [aria-pressed=true]")?.textContent,calls:window.workbenchFixture.calls.slice(-12)})')));}await evaluate(`(()=>{const button=[...document.querySelectorAll('.zenix-feature-content button')].find(value=>value.textContent===${JSON.stringify(label)});if(!button||button.disabled)throw Error('Unavailable fixture button '+${JSON.stringify(label)});button.click();})()`);};
   const recording={id:'actual-a',title:'实际录音',artist:'测试歌手',source:'custom',providerId:'actual-source',remoteId:'actual-a',duration:90,path:'',audioUrl:''};
   await tab('K歌');
   await wait('!!document.querySelector("[data-karaoke-adapter=mobile]")');
   await openSongSearch();
   await searchFor('搜索错误');
   await wait('document.querySelector(".zenix-karaoke-search-status")?.textContent.includes("请重试")');
   await searchFor('旧查询');
   await wait('window.workbenchFixture.calls.some(call=>call.operation==="searchSongs"&&call.keyword==="旧查询")');
   await searchFor('目标歌曲');
   await wait('document.querySelector(".zenix-karaoke-song-search li")?.textContent.includes("目标歌曲")');
   await evaluate('window.workbenchFixture.finishSearch()');
   await chooseSong('目标歌曲');
   assert.equal(await evaluate('window.workbenchFixture.snapshot.playback.track.id'),'fixture-song','search selection leaves the ordinary player alone');
   await click('试听原声');
   await wait('document.querySelector("[aria-label=暂停演唱]")!=null');
   assert.match(await evaluate('document.querySelector(".karaoke-adapter [role=alert]")?.textContent'),/仍可跟唱/);
   const round=await evaluate('window.workbenchFixture.calls.find(call=>call.native==="karaokeAudio"&&call.operation==="play")?.round');
   assert.match(round,/^solo:/);
   assert.equal(await evaluate('window.workbenchFixture.calls.find(call=>call.native==="karaokeAudio"&&call.operation==="play")?.track.id'),'no-lyrics');
   assert.equal(await evaluate('window.workbenchFixture.calls.find(call=>call.native==="karaokeAudio"&&call.operation==="play")?.syncElapsed'),false);
   await click('暂停');await click('继续');
   await evaluate(`window.workbenchFixture.finishSolo(${JSON.stringify(round)})`);
   await wait('document.querySelector("[aria-label=试听原声]")!=null');
   assert.equal(await evaluate('!!document.querySelector(".zenix-karaoke-complete-inline")'),false,'denied microphone cannot create a score');
   await wait('[...window.workbenchFixture.subscriptions.values()].every(listener=>listener.eventName!=="karaokeAudioStatus")');
   assert.equal(await evaluate(`window.workbenchFixture.calls.filter(call=>call.native==="karaokeAudio"&&call.operation==="stop"&&call.round===${JSON.stringify(round)}).length`),1);
   await tab('私人资料');await evaluate(`window.workbenchFixture.publishTrack(${JSON.stringify(recording)})`);await sleep(50);await click('标记当前片段');await wait('window.workbenchFixture.calls.some(value=>value.action==="bookmarkAdd")');assert.equal(await evaluate('window.workbenchFixture.calls.find(value=>value.action==="bookmarkAdd").track.remoteId'),'actual-a','bookmark stores the played recording rather than playlist alias');
   await evaluate('window.workbenchFixture.setDeferredLyrics(true)');await click('收录当前歌词');await wait('window.workbenchFixture.calls.some(value=>value.native==="lyrics")');await evaluate(`window.workbenchFixture.publishTrack(${JSON.stringify({...recording,id:'actual-b',remoteId:'actual-b'})})`);await sleep(30);await evaluate('window.workbenchFixture.finishLyrics()');await wait('window.workbenchFixture.calls.some(value=>value.action==="lyricsSave")');assert.equal(await evaluate('window.workbenchFixture.calls.find(value=>value.action==="lyricsSave").track.remoteId'),'actual-a','a delayed lyrics response remains bound to its original recording');
   await tab('播放与版本');await click('读取当前歌词');await sleep(40);await evaluate(`window.workbenchFixture.publishTrack(${JSON.stringify({...recording,id:'actual-b',remoteId:'actual-b',providerId:'different-source'})})`);await sleep(30);await evaluate('window.workbenchFixture.finishLyrics()');await sleep(50);assert.equal(await evaluate('[...document.querySelectorAll(".zenix-feature-content button")].some(value=>value.textContent==="循环所选歌词")'),false,'changing recording provider rejects a late lyric selection even when remoteId is unchanged');
   await evaluate('window.workbenchFixture.setDeferredLyrics(false)');await click('读取当前歌词');await wait('[...document.querySelectorAll(".zenix-feature-content button")].some(value=>value.textContent==="循环所选歌词")');await click('循环所选歌词');await wait('window.workbenchFixture.calls.some(value=>value.operation==="practice")');assert.equal(await evaluate('window.workbenchFixture.calls.find(value=>value.operation==="practice").expected.recordingIdentity'),'custom\0different-source\0actual-b');
   await tab('缓存与任务');await evaluate('window.workbenchFixture.setImportFailure(true);window.workbenchFixture.importTask()');await wait('document.querySelector("[aria-label=后台歌单解析预览]")?.textContent.includes("结果歌单")');await click('确认导入解析结果');await wait('[...document.querySelectorAll(".zenix-feature-content button")].some(value=>value.textContent==="重试确认导入")');await tab('私人资料');await tab('缓存与任务');await evaluate('window.workbenchFixture.setImportFailure(false)');await click('重试确认导入');await wait('!document.querySelector("[aria-label=后台歌单解析预览]")');assert.equal(await evaluate('window.workbenchFixture.calls.filter(value=>value.operation==="playlistPreview"&&!value.native).length'),1,'remount and retry reuse the failed confirmation preview');
   assert.equal(await evaluate('window.workbenchAudioCount'),0,'mobile never instantiates desktop HTMLAudio');
  }
  else {
   const original=await evaluate('window.workbenchFixture.player()');
   await evaluate(`(()=>{
    const {sources}=window.yzqxy;
    const attempts=window.soloAttempts=[], outcomes=window.soloOutcomes=[];
    const bad=()=>URL.createObjectURL(new Blob(['invalid audio'],{type:'audio/wav'}));
    const wav=new ArrayBuffer(44+16000*10), view=new DataView(wav);
    const write=(offset,name)=>[...name].forEach((ch,index)=>view.setUint8(offset+index,ch.charCodeAt(0)));
    write(0,'RIFF');view.setUint32(4,wav.byteLength-8,true);write(8,'WAVE');write(12,'fmt ');
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
    write(36,'data');view.setUint32(40,wav.byteLength-44,true);
    const good=URL.createObjectURL(new Blob([wav],{type:'audio/wav'}));
    const streamToken='52069e66-df28-44fe-ac06-fcfccfec77e1';
    const stream='yzqxy://stream/'+streamToken;
    const candidate=window.workbenchFixture.snapshot.playback.track;
    const manifest={name:'坏音频源',capabilities:['resolvePlayback'],qualities:['high','standard']};
    sources.list=async()=>[{id:'backup',enabled:true,manifest:{name:'备用源',capabilities:['resolvePlayback','search'],qualities:['high']}},{id:'fixture',enabled:true,manifest}];
    sources.cachedBest=async()=>({audioUrl:window.soloRecover?good:bad(),playbackProviderId:'cache'});
    let notifyStream;
    sources.onStreamFailure=callback=>{notifyStream=callback;return()=>{notifyStream=undefined;};};
    sources.search=async id=>({items:id==='backup'?[{...candidate,id:'backup-song',providerId:'backup',remoteId:'backup-song'}]:[],nextCursor:null});
    sources.resolve=async (row,tier)=>{
     const id=row.providerId+':'+tier;attempts.push(id);
     return {audioUrl:row.providerId==='backup'?stream:bad(),playbackProviderId:row.providerId,diagnosticAttemptId:id};
    };
    sources.outcome=async (id,played,reason)=>{outcomes.push({id,played,reason});};
    navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{window.resolveSoloMic=resolve;});
    const Audio=window.Audio;window.Audio=function(...args){
     const audio=new Audio(...args), src=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');
     const nativePlay=audio.play.bind(audio);
     let online=false;
     Object.defineProperty(audio,'src',{get(){return src.get.call(audio);},set(value){online=value===stream;src.set.call(audio,online?good:value);}});
     audio.play=()=>{
      if(!online||!window.soloRecover)return nativePlay();
      Object.defineProperty(audio,'readyState',{get:()=>0});
      queueMicrotask(()=>notifyStream?.({token:streamToken,status:504}));
      return Promise.resolve();
     };
     audio.muted=true;window.soloAudio=audio;return audio;
    };
    window.dispatchEvent(new CustomEvent('zenix-open-workbench',{detail:{tab:'karaoke'}}));
   })()`);
   await wait('[...document.querySelectorAll(".karaoke-adapter-controls button")].some(x=>x.textContent.trim()==="试听原声"&&!x.disabled)');
   await evaluate('[...document.querySelectorAll(".karaoke-adapter-controls button")].find(x=>x.textContent.trim()==="试听原声").click()');
   await wait('!!window.resolveSoloMic&&window.soloAudio?.currentTime>0.2&&!!document.querySelector(\'[aria-label="五句歌词窗口"]\')');
   assert.deepEqual(await evaluate('window.soloAttempts'),['fixture:high','fixture:standard','backup:high']);
   assert.deepEqual(await evaluate('window.soloOutcomes.map(({id,played})=>[id,played])'),[['fixture:high',false],['fixture:standard',false],['backup:high',true]]);
   await evaluate('[...document.querySelectorAll(".karaoke-adapter-controls button")].find(x=>x.textContent.trim()==="暂停").click()');
   await wait('[...document.querySelectorAll(".karaoke-adapter-controls button")].some(x=>x.textContent.trim()==="继续")');
   const checkpoint=await evaluate('window.soloAudio.currentTime');
   await evaluate('window.staleSoloAudio=window.soloAudio;window.soloRecover=true;[...document.querySelectorAll(".karaoke-adapter-controls button")].find(x=>x.textContent.trim()==="继续").click()');
   await wait(`window.soloAudio!==window.staleSoloAudio&&window.soloAudio?.currentTime>${checkpoint + 0.15}&&[...document.querySelectorAll('.karaoke-adapter-controls button')].some(x=>x.textContent.trim()==='暂停'&&!x.disabled)`);
   assert.equal(await evaluate('window.staleSoloAudio.hasAttribute("src")'),false,'stale stream is released after its resume HTTP error');
   assert.deepEqual(await evaluate('window.soloAttempts'),['fixture:high','fixture:standard','backup:high'],'recovery uses the completed cache before making another source request');
   assert.match(await evaluate('window.soloOutcomes.at(-1).reason'),/HTTP 504/);
   await evaluate('[...document.querySelectorAll(".karaoke-adapter-controls button")].find(x=>x.textContent.trim()==="结束演唱").click()');
   assert.equal(await evaluate('window.soloAudio.hasAttribute("src")'),false,'ending releases the standalone audio');
   await evaluate('window.resolveSoloMic({getTracks:()=>[{stop:()=>{window.lateSoloMicStopped=true;}}]})');
   await wait('window.lateSoloMicStopped===true');
   await evaluate(`(()=>{
    const {sources}=window.yzqxy;
    const next={...window.workbenchFixture.snapshot.playback.track,id:'next-solo',remoteId:'next-solo',title:'下一首练唱'};
    sources.search=async()=>({items:[next],nextCursor:null});
    window.previousSoloAudio=window.soloAudio;
   })()`);
   await openSongSearch();await searchFor('下一首练唱');await chooseSong('下一首练唱');
   await evaluate('[...document.querySelectorAll(".karaoke-adapter-controls button")].find(x=>x.textContent.trim()==="试听原声").click()');
   await wait('window.soloAudio!==window.previousSoloAudio&&window.soloAudio.currentTime>0.15');
   await evaluate('[...document.querySelectorAll(".karaoke-adapter-controls button")].find(x=>x.textContent.trim()==="暂停").click()');
   await wait('[...document.querySelectorAll(".karaoke-adapter-controls button")].some(x=>x.textContent.trim()==="继续")');
   const nextCheckpoint=await evaluate('window.soloAudio.currentTime');
   await evaluate('[...document.querySelectorAll(".karaoke-adapter-controls button")].find(x=>x.textContent.trim()==="继续").click()');
   await wait(`window.soloAudio.currentTime>${nextCheckpoint+0.15}&&[...document.querySelectorAll('.karaoke-adapter-controls button')].some(x=>x.textContent.trim()==='暂停'&&!x.disabled)`);
   await evaluate('[...document.querySelectorAll(".karaoke-adapter-controls button")].find(x=>x.textContent.trim()==="结束演唱").click()');
   assert.deepEqual(await evaluate('window.workbenchFixture.player()'),original,'standalone practice leaves ordinary playback state intact');
  }
  await close();await evaluate('document.querySelector("#main-action").click()');assert.equal(await evaluate('document.querySelector("#main-result").textContent'),'1','main remains interactive after closing');
  await open();await evaluate('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');await wait('!document.querySelector(".zenix-feature-workbench")');
  await evaluate('window.dispatchEvent(new CustomEvent("zenix-open-workbench",{detail:{tab:"assistant"}}))');await wait('!!document.querySelector(".zenix-assistant-panel")');
  assert.equal(await evaluate('(()=>{const root=document.querySelector(".zenix-feature-workbench"),nodes=root.querySelectorAll("button:not(:disabled),input:not(:disabled),textarea,select:not(:disabled),[tabindex=\\"0\\"]");nodes[0].focus();window.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",shiftKey:true,bubbles:true,cancelable:true}));return document.activeElement===nodes[nodes.length-1];})()'),true,'Shift+Tab wraps from first to last control');
  assert.equal(await evaluate('(()=>{const root=document.querySelector(".zenix-feature-workbench"),nodes=root.querySelectorAll("button:not(:disabled),input:not(:disabled),textarea,select:not(:disabled),[tabindex=\\"0\\"]");window.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true}));return document.activeElement===nodes[0];})()'),true,'Tab wraps from last to first control');await close();
  await evaluate('window.workbenchFixture.setFailedRead(true)');await open();await wait('document.querySelector(".zenix-feature-content [role=alert]")?.textContent.includes("隔离资料读取失败")');await close();
  await evaluate('document.querySelector("#main-action").click()');assert.equal(await evaluate('document.querySelector("#main-result").textContent'),'2','read failure cannot black out host');
  assert.deepEqual(await evaluate('window.workbenchErrors'),[],mode+' has no uncaught runtime errors');
 }
 await evaluate('fetch("/__fixture_fail_workbench").then(response=>response.text())');await win.loadURL(process.env.ZENIX_TEST_UI_URL+'?mode=desktop&moduleFailure=1');await wait('!!document.querySelector(".zenix-tools-launch")');await evaluate('document.querySelector(".zenix-tools-launch").click()');await wait('document.querySelector(".zenix-feature-loading[role=alert]")?.textContent.includes("暂时无法打开")');
 const failureClose=await evaluate('(()=>{const b=document.querySelector(".zenix-feature-loading button"),r=b.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,parent:b.parentElement.getBoundingClientRect().toJSON(),position:getComputedStyle(b.parentElement).position,over:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML?.slice(0,200),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b};})()');assert(failureClose.top>=0&&failureClose.bottom<=850&&failureClose.hit,'lazy-load failure remains visibly closable '+JSON.stringify(failureClose));
 await evaluate('(()=>{const dialog=document.createElement("section");dialog.id="other-dialog";dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true");dialog.innerHTML="<button>另一个对话框</button>";document.body.append(dialog);dialog.querySelector("button").focus();window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));})()');assert.equal(await evaluate('!!document.querySelector(".zenix-feature-loading")'),true,'fallback must not close underneath another active modal');await evaluate('document.querySelector("#other-dialog").remove()');
 await evaluate('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');assert.equal(await evaluate('!!document.querySelector(".zenix-feature-loading")'),false,'Escape closes the failed lazy-module fallback');
 await evaluate('document.querySelector(".zenix-tools-launch").click()');await wait('!!document.querySelector(".zenix-feature-loading[role=alert]")');
 await evaluate('document.querySelector(".zenix-feature-loading button").click()');await wait('!document.querySelector(".zenix-feature-loading")');await evaluate('document.querySelector("#main-action").click()');assert.equal(await evaluate('document.querySelector("#main-result").textContent'),'1','failed lazy module cannot black out main application');
 assert.equal(await evaluate('(()=>{let reached=0;const listener=()=>reached++;window.addEventListener("keydown",listener);window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));window.removeEventListener("keydown",listener);return reached;})()'),1,'closed host cannot swallow another screen Escape');
 process.stdout.write('FEATURE_WORKBENCH_UI_PASS\n');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
