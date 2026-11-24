const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
app.setPath('userData',process.env.ZENIX_TEST_USER_DATA);app.disableHardwareAcceleration();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
 const errors=[];win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
 const run=code=>win.webContents.executeJavaScript(code,true).catch(error=>{console.error('Failing onboarding evaluation:',code);throw error;});
 const wait=async code=>{for(let index=0;index<180;index++){if(await run(code))return;await sleep(30);}throw Error('UI wait: '+code);};
 const screenshot=async name=>{await fs.mkdir(process.env.ZENIX_TEST_SCREENSHOTS,{recursive:true});const image=await win.webContents.capturePage();await fs.writeFile(path.join(process.env.ZENIX_TEST_SCREENSHOTS,name+'.png'),image.toPNG());};
 for(const platform of ['desktop','mobile']){
  win.setContentSize(platform==='desktop'?1440:390,platform==='desktop'?900:844);
  await win.loadURL(process.env.ZENIX_TEST_UI_URL+'?platform='+platform+'&reset=1');await wait('!!window.onboardingFixture');
  await wait('!!document.querySelector(".space-display-onboarding-dialog")');
  assert.deepEqual(await run('Array.from(document.querySelectorAll("[data-space-display-choice]")).map(option=>option.dataset.spaceDisplayChoice)'),['sticker','list']);
  assert.equal(await run('document.activeElement?.dataset.spaceDisplayChoice'),'sticker','first choice receives focus');
  assert.equal(await run('document.querySelector(".space-display-onboarding-dialog").contains(document.activeElement)'),true);
  await screenshot(platform+'-onboarding');
  for(const width of [320,390,platform==='desktop'?1440:844]){
   win.setContentSize(width,platform==='desktop'?900:844);await sleep(80);
   const bounds=await run('(()=>{const dialog=document.querySelector(".space-display-onboarding-dialog").getBoundingClientRect();return {scroll:document.documentElement.scrollWidth,inner:innerWidth,height:innerHeight,left:dialog.left,right:dialog.right,top:dialog.top,bottom:dialog.bottom}})()');
   assert(bounds.scroll<=bounds.inner,`${platform} page has no horizontal overflow at ${width}`);assert(bounds.left>=0&&bounds.right<=bounds.inner&&bounds.top>=0&&bounds.bottom<=bounds.height,`${platform} dialog fits at ${width}`);
  }
  await run('(()=>{const buttons=Array.from(document.querySelectorAll(".space-display-onboarding-dialog button"));buttons.at(-1).focus();buttons.at(-1).dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",bubbles:true,cancelable:true}));})()');
  assert.equal(await run('document.activeElement?.classList.contains("space-display-onboarding-close")'),true,'Tab wraps to first focus target');
  await run('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",shiftKey:true,bubbles:true,cancelable:true}))');
  assert.equal(await run('document.activeElement?.dataset.spaceDisplayChoice'),'list','Shift+Tab wraps to last focus target');
  if(platform==='desktop'){
   await run(`(()=>{const write=Storage.prototype.setItem;window.restoreOnboardingWrite=()=>{Storage.prototype.setItem=write;};Storage.prototype.setItem=function(key,value){if(key==='zenix.space.presentation.v2')throw new DOMException('fixture quota','QuotaExceededError');return write.call(this,key,value);};})()`);
   await run('document.querySelector(".space-display-onboarding-close").click()');
   await wait('!document.querySelector(".space-display-onboarding-dialog")');
   await run('window.restoreOnboardingWrite()');
   await run('document.querySelector(".yz-pure-lyrics-toggle").click()');
   await wait('!!document.querySelector(".yz-lattice.is-immersive")');
   await run('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');
   await wait('!document.querySelector(".yz-lattice.is-immersive")');
   await wait('!!document.querySelector(".space-display-onboarding-dialog")');
   assert.equal(await run('document.activeElement?.dataset.spaceDisplayChoice'),'sticker','reopening the controlled onboarding resets its dismissed state');
   await run('document.querySelector("[data-space-display-choice=list]").click()');await wait('!document.querySelector(".space-display-onboarding-dialog")');await wait('!!document.querySelector(".space-song-list")');
   assert.deepEqual(await run('JSON.parse(localStorage.getItem("zenix.space.presentation.v2"))'),{schema:2,mode:'list',cardScale:1});
  }else{
   await run('document.querySelector("[data-space-display-choice=list]").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');await wait('!document.querySelector(".space-display-onboarding-dialog")');
   assert.equal(await run('JSON.parse(localStorage.getItem("zenix.space.presentation.v2")).mode'),'sticker');
  }
  assert.equal(await run('localStorage.getItem("zenix.space.presentation.fixture-preserved")'),JSON.stringify({playlists:['我的歌单'],liked:['song-2']}));
  await win.loadURL(process.env.ZENIX_TEST_UI_URL+'?platform='+platform);await wait('!!window.onboardingFixture');await sleep(100);
  assert.equal(await run('!!document.querySelector(".space-display-onboarding-dialog")'),false,'onboarding does not repeat after persistence');
 }
 win.setContentSize(1440,900);await win.loadURL(process.env.ZENIX_TEST_UI_URL+'?platform=desktop&reset=1&corrupt=1');await wait('!!window.onboardingFixture');await wait('!!document.querySelector("[role=alert]")');
 assert.equal(await run('!!document.querySelector(".space-display-onboarding-dialog")'),false,'damaged storage must not trigger onboarding');
 assert.equal(await run('localStorage.getItem("zenix.space.presentation.v2")'),'{broken','damaged storage remains intact');
 await run('document.querySelector("button[aria-label=关闭展示偏好错误]").click()');await wait('!document.querySelector("[role=alert]")');
 await win.loadURL(process.env.ZENIX_TEST_UI_URL+'?platform=desktop&reset=1');
 await wait('!!document.querySelector(".space-display-onboarding-dialog")');
 await run(`(()=>{const write=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='zenix.space.presentation.v2')throw new DOMException('fixture quota','QuotaExceededError');return write.call(this,key,value);};})()`);
 await run('document.querySelector("[data-space-display-choice=list]").click()');
 await wait('!!document.querySelector(".space-display-onboarding-dialog [role=alert]")');
 await run('document.querySelector(".space-display-onboarding-close").click()');
 await wait('!document.querySelector(".space-display-onboarding-dialog")');
 assert.equal(await run('localStorage.getItem("zenix.space.presentation.v2")'),null,'dismissal does not claim a failed write');
 assert.deepEqual(errors.filter(error=>!error.includes('404')),[],'renderer errors');process.stdout.write('SPACE_DISPLAY_ONBOARDING_UI_PASS\n');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
