const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
app.setPath('userData',process.env.ZENIX_TEST_USER_DATA);app.disableHardwareAcceleration();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
 const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
 const run=code=>win.webContents.executeJavaScript(code,true),wait=async code=>{for(let i=0;i<150;i++){if(await run(code))return;await sleep(30);}throw Error('UI wait: '+code);};
 const choose=async label=>{
  await run('window.spaceHost.openSettings()');await wait('!!document.querySelector("[data-setting=space-presentation]")');
  await run('document.querySelector("button[aria-label=歌曲展示方式]").click()');await wait('!!document.querySelector("[role=listbox] [role=option]")');
  await run(`Array.from(document.querySelectorAll('[role=option]')).find(button=>button.textContent.trim()===${JSON.stringify(label)}).click()`);
  await run('window.spaceHost.closeSettings()');await wait('!document.querySelector("[data-setting=space-presentation]")');
 };
 const screenshot=async name=>{await wait('!document.querySelector(".orbit-flight")');await sleep(160);const image=await win.webContents.capturePage();await fs.writeFile(path.join(process.env.ZENIX_TEST_SCREENSHOTS,name+'.png'),image.toPNG());};
 await fs.mkdir(process.env.ZENIX_TEST_SCREENSHOTS,{recursive:true});
 for(const platform of ['desktop','mobile']){
  win.setContentSize(platform==='desktop'?1440:390,platform==='desktop'?900:844);
  await win.loadURL(process.env.ZENIX_TEST_UI_URL+'?platform='+platform);await wait('!!window.spaceHost');
  await wait(platform==='desktop'?'!!document.querySelector(".yz-sticker")':'!!document.querySelector(".space-sticker")');
  if(platform==='mobile'){
   assert.equal(await run('JSON.parse(localStorage.getItem("zenix.space.presentation.v1")).mode'),'orbit','mobile falls back without rewriting a saved orbit preference');
   assert.equal(await run('!!document.querySelector(".orbit-stage")'),false,'mobile never mounts the desktop orbit');
  }
  assert.equal(await run('!!document.querySelector("button[aria-label=歌曲展示方式]")'),false,'space contains no settings selector');
  await run('window.spaceHost.openSettings()');await wait('!!document.querySelector("[data-setting=space-presentation]")');
  await run(`(()=>{const input=document.querySelector('input[aria-label="搜索设置"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(platform==='desktop'?'星轨':'贴纸')});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(`Array.from(document.querySelectorAll('.yz-settings-result-list button')).some(button=>button.textContent.includes('音乐空间展示'))`);
  await run(`Array.from(document.querySelectorAll('.yz-settings-result-list button')).find(button=>button.textContent.includes('音乐空间展示')).click()`);
  await wait('!!document.querySelector("button[aria-label=歌曲展示方式]")');await screenshot(platform+'-settings');
  if(platform==='mobile'){
   await run('document.querySelector("button[aria-label=歌曲展示方式]").click()');
   await wait('!!document.querySelector("[role=listbox] [role=option]")');
   assert.deepEqual(await run('Array.from(document.querySelectorAll("[role=option]"),option=>option.textContent.trim())'),['贴纸拼贴','简约列表']);
   assert.equal(await run('!!document.querySelector("[aria-label=环绕卡片大小]")'),false);
  }
  await run('window.spaceHost.closeSettings()');await wait('!document.querySelector("[data-setting=space-presentation]")');
  const preserved=await run('localStorage.getItem("zenix.host-test.preserved")');
  await run('window.spaceHost.captureSpace().then(value=>window.savedSpace={...value,id:"saved",name:"测试书签"})');await wait('!!window.savedSpace');
  await screenshot(platform+'-sticker');
  await choose('简约列表');await wait('!!document.querySelector(".space-song-list")');
  await run('document.querySelectorAll(".space-song-title")[1].click()');
  assert.deepEqual(await run('window.spaceHost.calls.played'),[],'focus must not play');
  await run('document.querySelectorAll(".space-song-play")[1].click()');assert.deepEqual(await run('window.spaceHost.calls.played'),['song-1']);assert.equal(await run('window.spaceHost.calls.sameObject'),true,'callbacks receive original track');
  assert.equal(await run('document.querySelectorAll(".yz-sticker,.space-sticker").length'),0,'hidden mosaic unmounted');
  assert.equal(await run('window.spaceHost.captureSpace().then(()=>false,error=>error.message.includes("贴纸拼贴"))'),true,'unsupported bookmark rejected');
  await run('document.querySelector(".space-song-list-scroll").scrollTop=200;window.spaceHost.append()');await sleep(80);
  assert.equal(await run('document.querySelector(".space-song-list-scroll").scrollTop'),200,'append preserves list scroll');
  await run('document.querySelector(".space-song-title").click()');await wait('!!document.querySelector(".space-song-list-actions button[aria-label^=放大]")');
  await run('document.querySelector(".space-song-list-actions button[aria-label^=放大]").click()');
  if(platform==='desktop'){
   await wait('!!document.querySelector(".yz-lattice.is-immersive")');assert.equal(await run('!!document.querySelector(".space-song-list,.orbit-song-space")'),false,'new modes do not cover full player');
   await run('document.querySelector("button[aria-label=还原歌曲贴纸]").click()');await wait('!!document.querySelector(".space-song-list")');
  }else assert.equal(await run('window.spaceHost.calls.expanded'),1,'mobile explicit expand calls existing player');
  await screenshot(platform+'-list');
  if(platform==='desktop'){
  await choose('多轨环绕');await wait('!!document.querySelector(".orbit-stage")');await sleep(120);
  assert.equal(await run('!!document.querySelector(".orbit-branches")'),false,'orbit no longer renders the track control bar');
  const orbitSize=await run(`(()=>{const stage=document.querySelector('.orbit-stage'),parent=stage.closest('.yz-space-presentation-stage'),card=stage.querySelector('.orbit-focus-card');return {stage:stage.clientHeight,parent:parent.clientHeight,card:card.clientHeight}})()`);
  assert(orbitSize.stage>=orbitSize.parent-64&&orbitSize.card>286,'stage and center card use the additional room');
  await run('window.spaceHost.setMotion("reduced")');await wait('document.querySelector(".orbit-song-space").dataset.motion==="reduced"');
  await run('window.spaceHost.setMotion("light")');await wait('["light","reduced"].includes(document.querySelector(".orbit-song-space").dataset.motion)');
  await run('window.spaceHost.setMotion("full")');await wait('["full","reduced"].includes(document.querySelector(".orbit-song-space").dataset.motion)');
  const oldCount=await run('window.spaceHost.calls.played.length');await run('Array.from(document.querySelectorAll(".orbit-card-focus")).find(node=>{const r=node.getBoundingClientRect();return getComputedStyle(node.closest(".orbit-card")).visibility!=="hidden"&&node.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}).click()');assert.equal(await run('window.spaceHost.calls.played.length'),oldCount,'orbit focus does not play');
  await screenshot(platform+'-orbit');
  }
  for(const width of [320,390,1440]){
   win.setContentSize(width,844);await sleep(150);
   assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false,platform+' page overflow '+width);
   const bounds=await run('(()=>{const shell=document.querySelector(".yz-space-presentation-shell,.mobile-space-presentation-shell").getBoundingClientRect(),toolbar=document.querySelector(".yz-space-presentation-toolbar,.mobile-space-presentation-toolbar").getBoundingClientRect(),stage=document.querySelector(".orbit-stage,.space-song-list").getBoundingClientRect();return {left:shell.left,right:shell.right,toolbarBottom:toolbar.bottom,stageTop:stage.top}})()');
   assert(bounds.left>=0&&bounds.right<=width,platform+' shell fits '+width);assert(bounds.stageTop>=bounds.toolbarBottom,platform+' toolbar does not overlap stage '+width);
   const collisions=await run(`(()=>{const stage=document.querySelector('.yz-space-presentation-stage,.mobile-space-presentation-stage').getBoundingClientRect(),overlaps=(a,b)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;return Array.from(document.querySelectorAll('.yz-roaming-strip,.mobile-roaming,.assistant-voice-dock,.mobile-mini,.yz-lattice-mini,.space-more')).filter(el=>el.getClientRects().length&&overlaps(stage,el.getBoundingClientRect())).map(el=>el.className)})()`);
   assert.deepEqual(collisions,[],platform+' presentation is clear of floating controls '+width);
   if(platform==='desktop'){
   const orbitLayout=await run('(()=>{const clip=document.querySelector(".yz-space-presentation-stage").getBoundingClientRect(),play=document.querySelector(".orbit-focus-buttons button").getBoundingClientRect(),cards=Array.from(document.querySelectorAll(".orbit-card,.orbit-focus-card")).map(element=>element.getBoundingClientRect());return {playVisible:play.top>=clip.top&&play.bottom<=clip.bottom,count:cards.length-1,playClickable:document.querySelector(".orbit-focus-buttons button").contains(document.elementFromPoint(play.left+play.width/2,play.top+play.height/2))}})()');
   assert.equal(orbitLayout.playVisible,true,platform+' center play visible '+width);assert.equal(orbitLayout.playClickable,true,platform+' depth layers do not block center controls '+width);assert(orbitLayout.count<=32,'stable card buffer is bounded');
   if(width===1440)assert(orbitLayout.count>=4,'desktop default shows four satellites');
   await choose('简约列表');await wait('!!document.querySelector(".space-song-list")');
   }
   assert.equal(await run('document.querySelector(".space-song-list").scrollWidth>document.querySelector(".space-song-list").clientWidth'),false,platform+' list fits '+width);
   await screenshot(platform+'-list-'+width);
   if(platform==='desktop'){
    await choose('多轨环绕');await wait('!!document.querySelector(".orbit-stage")');
    await screenshot(platform+'-orbit-'+width);
   }
  }
  win.setContentSize(platform==='desktop'?1440:390,844);await choose('简约列表');await wait('!!document.querySelector(".space-song-list")');
  await run('document.querySelector(".space-song-list-more").click();document.querySelector(".space-song-list-more").click()');await wait('document.querySelectorAll(".space-song-title").length>=101');
  await run('document.querySelectorAll(".space-song-title")[100].click()');
  assert.equal(await run('window.spaceHost.captureSpace("selection").then(value=>value.selectedId)'), 'song-100','new display exposes actual selected song');
  await choose('贴纸拼贴');await sleep(800);
  const focusedVisible=await run(`(()=>{const viewport=document.querySelector(${JSON.stringify(platform==='desktop'?'.yz-sticker-viewport':'.space-viewport')}).getBoundingClientRect(),card=document.querySelector(${JSON.stringify(platform==='desktop'?'.yz-sticker.is-expanded':'.space-sticker.is-focused')}).getBoundingClientRect();return card.left<viewport.right&&card.right>viewport.left&&card.top<viewport.bottom&&card.bottom>viewport.top})()`);
  assert.equal(focusedVisible,true,platform+' new display selection is visible when returning to mosaic');
  const beforePan=await run('window.spaceHost.captureSpace().then(value=>value.camera)');
  win.webContents.sendInputEvent({type:'mouseMove',x:25,y:440});win.webContents.sendInputEvent({type:'mouseDown',x:25,y:440,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:80,y:475});win.webContents.sendInputEvent({type:'mouseUp',x:80,y:475,button:'left',clickCount:1});await sleep(200);
  const panned=await run('window.spaceHost.captureSpace().then(value=>value.camera)');assert.notDeepEqual(panned,beforePan,'native pointer actually pans mosaic');
  await choose(platform==='desktop'?'多轨环绕':'简约列表');
  await wait(platform==='desktop'?'!!document.querySelector(".orbit-stage")':'!!document.querySelector(".space-song-list")');
  await choose('贴纸拼贴');await sleep(100);
  assert.deepEqual(await run('window.spaceHost.captureSpace().then(value=>value.camera)'),panned,'style toggle without selection preserves panned camera');
  await choose('简约列表');await wait('!!document.querySelector(".space-song-list")');await run('window.spaceHost.openPanel()');await wait('!!document.querySelector(".space-features-panel")&&Array.from(document.querySelectorAll(".space-features-panel button")).some(button=>button.textContent==="加入聚焦歌曲")');
  await run('Array.from(document.querySelectorAll(".space-features-panel button")).find(button=>button.textContent==="加入聚焦歌曲").click()');await wait('window.spaceHost.settings().zones[0].trackIds.includes("song-100")');
  await run('Array.from(document.querySelectorAll(".space-features-panel button")).find(button=>button.textContent==="恢复位置").click()');await wait('JSON.parse(localStorage.getItem("zenix.space.presentation.v1"))?.mode==="sticker"');
  assert.equal(await run('document.querySelector(".space-feature-message").textContent.includes("已恢复")'),true,'real settings panel restores old bookmark from list');
  await run('window.spaceHost.closePanel()');
  await run('window.spaceHost.restoreSpace(window.savedSpace)');await wait('JSON.parse(localStorage.getItem("zenix.space.presentation.v1"))?.mode==="sticker"');
  await wait(platform==='desktop'?'!!document.querySelector(".yz-sticker")':'!!document.querySelector(".space-sticker")');
  assert.equal(await run('localStorage.getItem("zenix.host-test.preserved")'),preserved,'unrelated user resources untouched');
  assert.equal(await run('document.querySelector(".yz-sticker-viewport,.space-viewport").getBoundingClientRect().width>0'),true,'restored viewport retains dimensions');
 }
 assert.deepEqual(errors.filter(error=>!error.includes('404')),[],'renderer errors');process.stdout.write('SPACE_HOST_PASS\n');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
