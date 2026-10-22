const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict');
app.setPath('userData',process.env.ZENIX_TEST_USER_DATA);app.disableHardwareAcceleration();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}}),evaluate=code=>window.webContents.executeJavaScript(code,true),wait=async code=>{for(let n=0;n<150;n++){if(await evaluate(code))return;await sleep(40);}throw Error('UI wait '+code);};
for(const mode of ['desktop','mobile']){await window.loadURL(process.env.ZENIX_TEST_UI_URL+'?mode='+mode);await wait('!!window.spaceFixture');await wait(mode==='desktop'?'!!document.querySelector(".yz-sticker")':'!!document.querySelector(".space-sticker")');await sleep(800);
 const before=await evaluate('window.spaceFixture.captureSpace()');assert.equal(before.tracks.length,20);
 await evaluate(`window.spaceFixture.writeSpace({motion:'reduced',zones:[{id:'zone',name:'通勤',trackIds:['song-2']}]})`);await wait('!!document.querySelector("[data-space-zone=zone]")');await evaluate('document.querySelector("[data-space-zone=zone]").click()');await sleep(100);
 assert.equal((await evaluate('window.spaceFixture.captureSpace()')).tracks.length,1,'zone selects real stickers on '+mode);assert.equal(await evaluate('window.spaceFixture.calls.play'),0,'zone cannot play');
 await evaluate(`window.spaceFixture.restoreSpace(${JSON.stringify({...before,id:'bookmark',name:'原空间',camera:{x:-150,y:-120,scale:1.2}})})`);await sleep(800);const restored=await evaluate('window.spaceFixture.captureSpace()');assert.equal(restored.tracks.length,20,'bookmark restores finite wall');assert.equal(restored.camera.x,-150,'camera x restored '+mode);assert.equal(restored.camera.y,-120,'camera y restored '+mode);assert.equal(restored.camera.scale,1.2);assert.equal(await evaluate('window.spaceFixture.calls.play'),0,'restoration cannot switch playback');
 await evaluate("window.spaceFixture.setMode('none')");await sleep(50);assert.match(await evaluate("window.spaceFixture.captureSpace().then(()=>'',e=>e.message)"),/先打开音乐空间/,'missing canvas is explicit');}
 process.stdout.write('SPACE_FEATURES_UI_PASS\n');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
