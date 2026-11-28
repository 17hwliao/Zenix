const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
if(!process.env.ZENIX_TEST_USER_DATA||!process.env.ZENIX_TEST_UI_URL)throw Error('Isolated fixture required');
app.setPath('userData',process.env.ZENIX_TEST_USER_DATA);app.disableHardwareAcceleration();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1440,height:1000,useContentSize:true,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  const peer=new BrowserWindow({show:false,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false}});
  win.webContents.setAudioMuted(true);peer.webContents.setAudioMuted(true);
  const js=code=>win.webContents.executeJavaScript(code,true).catch(error=>{throw Error(code+'\n'+error.message);}),other=code=>peer.webContents.executeJavaScript(code,true);
  const wait=async code=>{for(let n=0;n<180;n++){if(await js(code))return;await sleep(35);}throw Error('Style wait: '+code);};
  const click=async selector=>{await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.focus();e.click();})()`);await sleep(70);};
  const output=path.resolve('release/style-migration');await fs.mkdir(output,{recursive:true});
  const capture=async name=>{await sleep(450);await fs.writeFile(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  await win.loadURL(process.env.ZENIX_TEST_UI_URL);await wait('!!document.querySelector(".zx-home-hero canvas")');
  assert.equal(await js('document.documentElement.dataset.bentoStyle'),'neon');assert.equal(await js('document.documentElement.dataset.theme'),'dark');
  await peer.loadURL(new URL('application-style-peer.html',process.env.ZENIX_TEST_UI_URL).href);
  for(const width of [1440,900,640]){
    win.setContentSize(width,1000);await sleep(100);
    const geometry=await js(`(()=>{const r=s=>document.querySelector(s).getBoundingClientRect();const hero=r('.zx-home-hero'),character=r('.zx-home-character'),copy=r('.zx-home-copy');return{viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,contained:character.left>=hero.left+10&&character.right<=hero.right-10&&character.bottom<=hero.bottom-10,separate:copy.right<=character.left+1};})()`);
    assert.equal(geometry.overflow,false,JSON.stringify(geometry));assert(geometry.contained&&geometry.separate,JSON.stringify(geometry));await capture('home-'+width);
  }
  win.setContentSize(1440,1000);await click('.zx-home-heading .zx-style-trigger');await wait('document.querySelector("dialog.zx-style-dialog")?.open');
  for(const style of ['default','glass','neon','paper','sharp']){
    await click(`[data-style-option=${style}]`);await wait(`document.documentElement.dataset.bentoStyle==='${style}'`);
    assert.equal(await other('document.documentElement.dataset.bentoStyle'),style,'same-origin peer updates');
    const expected={default:'rgb(23, 24, 28)',glass:'rgba(13, 22, 42, 0.48)',neon:'rgb(7, 12, 21)',paper:'rgb(34, 32, 28)',sharp:'rgb(18, 18, 20)'}[style];
    await wait(`getComputedStyle(document.querySelector('.zx-home-hero')).backgroundColor===${JSON.stringify(expected)}`);
    assert.equal(await js('getComputedStyle(document.querySelector(".zx-home-hero")).backgroundColor'),expected);
  }
  await click('[data-style-option=glass]');await click('.zx-style-dialog [aria-label="Zenbot 冰青"]');
  assert.equal(await other('document.documentElement.dataset.bentoAccent'),'cyan');
  await js(`(()=>{const el=document.querySelector('.zx-style-dialog input[aria-label="圆角 / 切角"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'22');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait('getComputedStyle(document.querySelector(".zx-button-sample")).borderRadius==="22px"');
  await js(`window.savedSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('test quota')};void 0`);
  await click('[data-style-option=paper]');assert.equal(await js('document.documentElement.dataset.bentoStyle'),'glass');assert(await js('document.querySelector(".zenix-style-settings [role=alert]").textContent.includes("test quota")'));
  await js('Storage.prototype.setItem=window.savedSet;void 0');
  await click('.zx-style-reset');await capture('style-dialog');
  await click('.zx-style-dialog>header>button');assert.equal(await js('document.activeElement.classList.contains("zx-style-trigger")'),true);
  await click('[data-destination=liked]');await wait('!!document.querySelector("[data-workspace=\\"collection:liked\\"]")');
  await js(`(async()=>{window.styleApi=await import('/ui/appearance.js');return window.styleApi.saveAppearance({...window.styleApi.defaults,style:'paper',mode:'light',button:'outline'});})()`);
  await wait('document.documentElement.dataset.theme==="light"');await sleep(220);await capture('collection-paper');
  assert.equal(await js('getComputedStyle(document.querySelector(".zenix-workspace-body")).backgroundColor'),'rgb(255, 253, 248)');
  await click('[data-destination=home]');await wait('!!document.querySelector(".zx-home-hero")');
  assert.equal(await js('document.documentElement.dataset.bentoStyle'),'paper');
  await js(`localStorage.setItem('zenix.ui-appearance.v1','{broken');window.dispatchEvent(new Event('zenix:appearance-changed'))`);
  await wait('document.documentElement.dataset.bentoStyle==="neon"');await click('.zx-home-heading .zx-style-trigger');
  assert(await js('!!document.querySelector(".zenix-style-settings [role=alert]")'));
  await click('[data-style-option=glass]');assert.equal(await js('localStorage.getItem("zenix.ui-appearance.v1")'),'{broken');await click('.zx-style-reset');
  await click('.zx-style-dialog>header>button');await js(`window.styleApi.saveAppearance({...window.styleApi.defaults,motion:false})`);
  await click('[data-destination=tasks]');await wait('!!document.querySelector(".zenix-offline-tasks")');assert.equal(await js('getComputedStyle(document.querySelector(".zx-route-transition")).display'),'none');
  await click('[data-destination=connections]');await click('[data-destination=home]');await wait('!!document.querySelector(".zx-home-hero")');
  await js('window.styleApi.saveAppearance({...window.styleApi.defaults})');await sleep(1400);assert.equal(await js('document.querySelector(".zx-route-transition").style.opacity'),'0');
  await other(`localStorage.setItem('zenix.ui-sounds.v1',JSON.stringify({enabled:true,volume:.4,enter:1,cancel:1,slide:1}))`);
  await click('[data-destination=settings]');await wait('!!document.querySelector(".yz-settings-redesign")');
  assert.equal(await js('document.querySelector("[aria-label=界面音效]").getAttribute("aria-checked")'),'true');
  await other(`localStorage.setItem('zenix.ui-sounds.v1',JSON.stringify({enabled:false,volume:.2,enter:1,cancel:1,slide:1}))`);
  await wait('document.querySelector("[aria-label=界面音效]").getAttribute("aria-checked")==="false"');
  await click('[aria-label=减少动效]');
  assert.equal(await js('document.querySelector("[aria-label=减少动效]").getAttribute("aria-checked")'),'true');
  await click('[aria-label=关闭设置]');await wait('!document.querySelector(".yz-settings-redesign")');
  await click('[data-destination=tasks]');await wait('!!document.querySelector(".zenix-offline-tasks")');
  assert.equal(await js('getComputedStyle(document.querySelector(".zx-route-transition")).display'),'none','application reduce-motion switch suppresses the grid wave');
  await click('[data-destination=home]');await wait('!!document.querySelector(".zx-home-hero")');
  await click('.zx-home-heading .zx-style-trigger');
  await js('window.styleApi.saveAppearance({...window.styleApi.defaults,buttonFrame:true})');await sleep(50);
  assert.match(await js('getComputedStyle(document.querySelector(".zx-button-sample")).webkitMaskBoxImage'),/data:image\/svg/);
  // Emulate the nearest opposite condition by removing only mask-supported
  // blocks. Unsupported engines must keep readable standard buttons.
  const removed=await js(`(()=>{let count=0;const strip=sheet=>{for(let i=sheet.cssRules.length-1;i>=0;i--){const r=sheet.cssRules[i];if(r.type===CSSRule.SUPPORTS_RULE&&r.conditionText.includes('mask-box-image')){sheet.deleteRule(i);count++;}else if(r.styleSheet)strip(r.styleSheet);}};for(const s of document.styleSheets)strip(s);return count;})()`);
  assert(removed>0);assert.equal(await js('getComputedStyle(document.querySelector(".zx-button-sample"),"::after").content'),'none');
  assert(Number.parseFloat(await js('getComputedStyle(document.querySelector(".zx-button-sample")).borderWidth'))>0,'unsupported masks retain the standard button border');
  console.log('APPLICATION_STYLE_PASS');peer.destroy();win.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
