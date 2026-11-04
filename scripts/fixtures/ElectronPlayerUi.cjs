const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
if (!process.env.ZENIX_TEST_USER_DATA || !process.env.ZENIX_TEST_UI_URL) throw Error('Isolated UI fixture is required');
app.setPath('userData', process.env.ZENIX_TEST_USER_DATA);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const checkpoint = label => console.log(`PLAYER_UI_CHECKPOINT ${Date.now()} ${label}`);
  checkpoint('Electron ready');
  const window = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on('console-message', event => { if (event.level === 'error') console.error('Renderer:', event.message); });
  const evaluate = script => window.webContents.executeJavaScript(script, true).catch(error => { throw Error(script + '\n' + error.message); });
  const wait = async script => { for (let i = 0; i < 100; i++) { if (await evaluate(script)) return; await sleep(50); } throw Error('UI assertion timeout: ' + script); };
  await window.loadURL(process.env.ZENIX_TEST_UI_URL);
  checkpoint('fixture loaded');
  await wait('!!document.querySelector(".yz-playerbar-track")');
  const homeSizes=[];
  for(const [width,height]of [[960,640],[1200,800],[1920,1080],[2560,1600]]){
    window.setContentSize(width,height);await wait(`innerWidth===${width}&&innerHeight===${height}`);
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');await sleep(300);
    // Check the settled responsive layout, not an intermediate resize scale.
    // Keep the strict card/button non-overlap assertion below unchanged.
    await wait(`!document.querySelector('.zenix-card-center').getAnimations().some(animation=>animation.playState==='running'||animation.pending)`);
    const layout=await evaluate(`(()=>{const scroll=document.querySelector('.zenix-home-scroll'),stage=document.querySelector('.zenix-space-stage'),songs=document.querySelector('#zenix-home-songs');const rect=node=>{const r=node.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right};};scroll.scrollTop=500;return{width:innerWidth,height:innerHeight,stage:rect(stage),scroll:rect(scroll),scrollTop:scroll.scrollTop,hidden:songs.hidden,detailRects:songs.getClientRects().length,hint:rect(document.querySelector('.zenix-stage-scroll-hint button')),card:rect(document.querySelector('.zenix-card-center')),bar:rect(document.querySelector('.yz-playerbar'))};})()`);
    assert(layout.hidden&&layout.detailRects===0,'management content starts collapsed at every size');
    assert.equal(layout.scrollTop,0,'wheel/scroll cannot reveal unopened management content');
    assert(Math.abs(layout.stage.bottom-layout.scroll.bottom)<2,'stage fills available height after resize');
    assert(layout.card.bottom<layout.hint.top,'card and management button do not overlap: '+JSON.stringify(layout));
    assert(layout.hint.bottom<layout.bar.top,'management button stays above the playback bar');
    assert(layout.card.left>=layout.scroll.left&&layout.card.right<=layout.scroll.right,'identity card stays inside the viewport');
    homeSizes.push(layout);
  }
  await fs.writeFile(path.join(app.getPath('userData'),'home-maximized.png'),(await window.webContents.capturePage({stayHidden:true,stayAwake:true})).toPNG());
  window.setContentSize(1200,800);await sleep(200);
  const hint=await evaluate(`(()=>{const r=document.querySelector('.zenix-stage-scroll-hint button').getBoundingClientRect();return{x:Math.round(r.left+35),y:Math.round(r.top+r.height/2)};})()`);
  window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...hint});window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...hint});
  await wait(`document.querySelector('.zenix-stage-scroll-hint button').getAttribute('aria-expanded')==='true'&&document.querySelector('.zenix-home-scroll').scrollTop>100`);
  assert.equal(await evaluate(`document.querySelector('#zenix-home-songs').hidden`),false);
  assert.equal(await evaluate(`document.querySelector('.zenix-stage-scroll-hint button').getAttribute('aria-label')`),'上滑返回个人空间');
  assert(await evaluate(`(()=>{const b=document.querySelector('.zenix-stage-scroll-hint button'),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()`),'return button remains visible after revealing songs');
  await wait(`document.querySelector('.zenix-home-scroll').scrollTop>0`);
  // A real wheel gesture must return toward the cards without toggling the button.
  await sleep(450);
  const expandedTop=await evaluate(`document.querySelector('.zenix-home-scroll').scrollTop`);
  window.webContents.sendInputEvent({type:'mouseWheel',x:150,y:270,deltaY:Math.max(1,expandedTop-65),deltaX:0});
  await wait(`document.querySelector('.zenix-home-scroll').scrollTop<${expandedTop}`);
  window.showInactive();
  await window.webContents.capturePage({stayHidden:false,stayAwake:true});
  await evaluate(`document.querySelector('.zenix-home-scroll').scrollTo({top:55,behavior:'instant'})`);
  await wait(`Math.abs(document.querySelector('.zenix-home-scroll').scrollTop-55)<2`);
  const dragPoint=await evaluate(`(()=>{const stage=document.querySelector('.zenix-space-stage');window.homePointerTrace=[];for(const name of ['pointerdown','pointermove','pointercancel'])stage.addEventListener(name,e=>window.homePointerTrace.push([name,e.clientX,e.isPrimary,e.target.className]),true);const r=stage.getBoundingClientRect();return{x:Math.round(r.x+r.width/2-235),y:Math.round(r.y+r.height*.46)}})()`);
  window.webContents.sendInputEvent({type:'mouseMove',...dragPoint});
  window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...dragPoint});
  await wait(`window.homePointerTrace.some(event=>event[0]==='pointerdown')`);
  const held=await evaluate(`document.querySelector('.zenix-orbit-ring').style.transform`);
  window.webContents.sendInputEvent({type:'mouseMove',x:dragPoint.x+75,y:dragPoint.y});await sleep(100);
  const moved=await evaluate(`document.querySelector('.zenix-orbit-ring').style.transform`);
  assert(Math.abs(parseFloat(held.slice(8))-parseFloat(moved.slice(8)))>14,'grabbing the ring after scrolling visibly turns it: '+JSON.stringify({held,moved,dragPoint,trace:await evaluate('window.homePointerTrace')}));
  window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:dragPoint.x+75,y:dragPoint.y});window.hide();
  assert.equal(await evaluate(`document.querySelector('#zenix-home-songs').hidden`),false,'wheel and ring drag leave management unlocked');
  await evaluate(`document.querySelector('.zenix-stage-scroll-hint button').click()`);
  await wait(`document.querySelector('#zenix-home-songs').hidden&&document.querySelector('.zenix-home-scroll').scrollTop<=1`);
  assert.equal(await evaluate(`document.querySelector('.zenix-stage-scroll-hint button').getAttribute('aria-label')`),'下滑到歌曲管理');
  window.showInactive();window.webContents.sendInputEvent({type:'mouseMove',x:5,y:5});
  const ringBefore=await evaluate(`document.querySelector('.zenix-orbit-ring').style.transform`);await sleep(150);
  assert.notEqual(await evaluate(`document.querySelector('.zenix-orbit-ring').style.transform`),ringBefore,'homepage retains the original rotating 3D card ring');
  window.hide();
  await fs.writeFile(path.join(app.getPath('userData'),'home-layout.json'),JSON.stringify(homeSizes,null,2));
  checkpoint('home responsive layout and explicit management reveal');
  await evaluate('document.querySelector(".yz-playerbar [aria-label=播放]").click()'); await sleep(400);
  assert.equal(await evaluate('window.fixture.toggles'), 1); assert.equal(await evaluate('!!document.querySelector(".yz-shell--home")'), true);
  checkpoint('transport');
  // Actual React state and DOM: double-click survives the home/player mount.
  await evaluate('document.querySelector(".yz-playerbar-track").click()'); await sleep(70); await evaluate('document.querySelector(".yz-playerbar-track").click()');
  await wait('!!document.querySelector(".yz-lattice.is-immersive")'); await sleep(450);
  assert.equal(await evaluate('document.querySelectorAll(".yz-sticker.is-expanded").length'), 1);
  assert.match(await evaluate('document.querySelector(".yz-sticker.is-expanded h1").textContent'), /Fixture A/);
  // Queue is view-only; viewing another collection must not change playback.
  await evaluate('document.querySelector(".yz-lattice-mini [aria-label=播放队列]").click()'); await wait('!!document.querySelector(".zenix-queue")');
  assert.equal(await evaluate('document.querySelectorAll(".zenix-queue-row").length'), 2);
  assert.equal(await evaluate('!!document.querySelector(".zenix-queue-remove")'), false);
  await evaluate('document.querySelector(".zenix-queue-switch button").click()'); await wait('!!document.querySelector(".zenix-queue-menu")');
  await evaluate('[...document.querySelectorAll(".zenix-queue-menu button")].find(button=>button.textContent.includes("我的喜欢")).click()');
  await wait('document.querySelectorAll(".zenix-queue-row").length === 1'); assert.equal(await evaluate('window.fixture.plays.length'), 0);
  assert.match(await evaluate('document.querySelector(".zenix-queue-track").textContent'), /Fixture B/);
  await evaluate('document.querySelector(".zenix-queue-track").click()'); assert.equal(await evaluate('window.fixture.plays.join()'), 'B');
  await evaluate('document.querySelector(".zenix-queue-head button").click()'); await sleep(300);
  // A hidden window can retain an old compositor frame despite correct DOM.
  // Present the isolated fixture briefly before capturing the rendered result.
  window.showInactive(); await sleep(800);
  await fs.writeFile(path.join(app.getPath('userData'), 'expanded-song.png'), (await window.webContents.capturePage()).toPNG());
  window.hide();
  checkpoint('queue and capture');
  // Going home and singly entering must not replay an old expansion request.
  await evaluate('document.querySelector("[aria-label=个人主页]").click()'); await wait('!!document.querySelector(".yz-playerbar-track")');
  await evaluate('document.querySelector(".yz-playerbar-track").click()'); await wait('!!document.querySelector(".yz-lattice")'); await sleep(450);
  assert.equal(await evaluate('!!document.querySelector(".yz-lattice.is-immersive")'), false);
  await evaluate('document.querySelector(".yz-lattice-mini-focus").click()'); await sleep(70); await evaluate('document.querySelector(".yz-lattice-mini-focus").click()'); await wait('!!document.querySelector(".yz-lattice.is-immersive")');
  // Progressive search results extend the collage after the user pans it.
  process.stdout.write('PLAYER_UI_APPEND_BEGIN\n');
  await evaluate('window.fixture.renderWall(12)'); await wait('document.querySelectorAll(".yz-sticker").length===12'); await sleep(400);
  checkpoint('progressive wall');
  const originalCamera=await evaluate('document.querySelector(".yz-sticker-world").style.transform');
  await evaluate(`document.querySelector('.yz-sticker-viewport').dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:60,deltaY:40}))`);await sleep(400);
  const beforeAppend=await evaluate('document.querySelector(".yz-sticker-world").style.transform');
  const beforeSize=await evaluate('document.querySelector(".yz-sticker-world").style.width+":"+document.querySelector(".yz-sticker-world").style.height');
  process.stdout.write(`PLAYER_UI_APPEND_CAMERA ${beforeAppend} SIZE ${beforeSize}\n`);
  assert.notEqual(beforeAppend,originalCamera,'fixture actually pans before appending');
  await evaluate('window.fixture.renderWall(24)');await wait(`document.querySelector(".yz-sticker-world").style.width+":"+document.querySelector(".yz-sticker-world").style.height!==${JSON.stringify(beforeSize)}`);await sleep(400);
  assert.equal(await evaluate('document.querySelector(".yz-sticker-world").style.transform'),beforeAppend,'append preserves user camera');
  assert.match(await evaluate('document.querySelector(".yz-sticker.is-expanded h1").textContent'),/Fixture 0/);
  process.stdout.write('PLAYER_UI_INTEGRATION_PASS\n'); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
