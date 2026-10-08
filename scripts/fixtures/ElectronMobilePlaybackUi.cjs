const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
if(!process.env.ZENIX_TEST_USER_DATA||!process.env.ZENIX_TEST_UI_URL)throw Error('Isolated fixture required');
app.setPath('userData',process.env.ZENIX_TEST_USER_DATA);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:390,height:820,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  window.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message);});
  const evaluate=code=>window.webContents.executeJavaScript(code,true);
  const wait=async code=>{for(let i=0;i<160;i++){if(await evaluate(code))return;await sleep(50);}console.error(await evaluate('JSON.stringify({queue:window.fixture?.state.playback.queue.map(t=>t.id),calls:window.fixture?.calls.slice(-8),events:window.fixture?.events?.slice(-16),rows:[...document.querySelectorAll(".swipe-track-row")].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON(),style:e.getAttribute("style")}))})'));throw Error('UI timeout: '+code);};
  const click=async selector=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await sleep(100);};
  const bounds=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  const pointer=async(selector,dx=0,dy=0,hold=0)=>{const point=await bounds(selector);window.webContents.sendInputEvent({type:'mouseMove',...point});window.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});if(hold)await sleep(hold);if(dx||dy){for(let step=1;step<=5;step++){window.webContents.sendInputEvent({type:'mouseMove',x:point.x+Math.round(dx*step/5),y:point.y+Math.round(dy*step/5),modifiers:['leftButtonDown']});await sleep(20);}}window.webContents.sendInputEvent({type:'mouseUp',x:point.x+dx,y:point.y+dy,button:'left',clickCount:1});await sleep(100);};
  const screenshot=async name=>{await sleep(200);await fs.writeFile(path.join(app.getPath('userData'),name),(await window.webContents.capturePage()).toPNG());};
  await window.loadURL(process.env.ZENIX_TEST_UI_URL);window.showInactive();
  await wait('window.fixture&&document.querySelector(".mobile-mini")&&!document.querySelector(".mobile-boot")');
  assert.equal(await evaluate('!!document.querySelector(".mobile-mini [aria-label=暂停]")'),true,'loading intent must show pause, not play');
  assert.match(await evaluate('document.querySelector(".cache-playback-badge").textContent'),/完整缓存/);await evaluate('window.fixture.events=[];["pointerdown","pointermove","pointerup","pointercancel"].forEach(type=>document.addEventListener(type,e=>{window.fixture.events.push({type,x:e.clientX,y:e.clientY,button:e.button,buttons:e.buttons,target:e.target.className});},true));');
  await pointer('.mini-info',0,0,550);await wait('!!document.querySelector(".song-quick-actions")');
  assert.equal(await evaluate('window.fixture.calls.filter(value=>value.action==="toggle"||value.action==="play").length'),0,'long press did not toggle loading playback');
  await screenshot('mobile-quick-save.png');
  await click('.song-quick-actions .pill');await wait('!!document.querySelector(".song-save-feedback")');await screenshot('mobile-save-animation.png');
  assert.equal(await evaluate('window.fixture.state.personal.liked.length'),1);assert.equal(await evaluate('window.fixture.state.personal.favorites.length'),1);
  await sleep(1100);await pointer('.mini-info',0,0,550);await wait('!!document.querySelector(".song-quick-actions")');await click('.song-quick-actions .pill');
  assert.equal(await evaluate('window.fixture.state.personal.liked.length'),1,'repeat quick-save must not toggle off');
  await wait('!document.querySelector(".song-save-feedback")');await pointer('.mini-info');await pointer('.mini-info');await wait('!!document.querySelector(".mobile-full-player")');await sleep(300);await pointer('.full-song',0,0,550);await wait('!!document.querySelector(".song-quick-actions")');await click('.sheet-close');await click('[aria-label="收起"]');await sleep(400);await click('[aria-label="当前播放列表"]');await wait('document.querySelectorAll(".swipe-track-row").length===5');
  for(const width of [320,360,390,430]){window.setContentSize(width,820);await sleep(100);assert.equal(await evaluate('[...document.querySelectorAll(".mobile-sheet,.swipe-track-row")].every(el=>el.scrollWidth<=el.clientWidth+2)'),true,'playlist geometry '+width);}
  window.setContentSize(390,820);await sleep(100);await screenshot('mobile-swipe-playlist.png');
  // Non-current rows: swiping queue must not touch the saved playlist or pause current resolution.
  await pointer('.swipe-track-shell:nth-of-type(2) .swipe-track-row>button:first-child',-100);await wait('window.fixture.state.playback.queue.length===4');
  await sleep(300);await pointer('.swipe-track-shell:nth-of-type(2) .swipe-track-row>button:first-child',100);await wait('window.fixture.state.playback.queue.length===3');
  assert.equal(await evaluate('window.fixture.state.personal.playlists[0].tracks.length'),5);
  assert.equal(await evaluate('window.fixture.calls.filter(value=>value.action==="toggle"||value.action==="play").length'),0,'swipe must not trigger row play');
  // Cancelled horizontal gesture and a vertical scroll never remove a row.
  await evaluate(`(()=>{const e=document.querySelector('.swipe-track-row');const fire=(type,x,y)=>e.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:77,isPrimary:true,button:0,clientX:x,clientY:y}));fire('pointerdown',100,100);fire('pointermove',100,140);fire('pointercancel',100,140);})()`);await sleep(500);
  assert.equal(await evaluate('window.fixture.state.playback.queue.length'),3);
  await click('.sheet-close');await click('.home-collections button:nth-child(4)');await wait('!!document.querySelector(".mobile-sheet")');await evaluate('[...document.querySelectorAll(".mobile-sheet .list-row button")].find(el=>el.textContent.includes("测试歌单")).click()');
  await wait('!!document.querySelector("[aria-label=管理歌单歌曲]")');await click('[aria-label="管理歌单歌曲"]');await wait('document.querySelectorAll(".swipe-track-row").length===5');
  await pointer('.swipe-track-shell:nth-of-type(2) .swipe-track-row>button:first-child',-100);await wait('window.fixture.state.personal.playlists[0].tracks.length===4');
  assert.equal(await evaluate('window.fixture.state.playback.queue.length'),3,'saved playlist removal must not alter active queue');
  await wait('document.querySelectorAll(".swipe-track-row").length===4');await click('[aria-label="播放 Fixture 2"]');await sleep(400);assert.equal(await evaluate('!!document.querySelector(".zenix-mobile")&&!!document.querySelector(".space-viewport")'),true,'partial native play response must preserve sources and personal state');assert.equal(await evaluate('window.fixture.state.playback.track.id'),'fixture-2');
  await click('[aria-label="设置"]');await wait('!!document.querySelector(".settings-card")');
  await evaluate('[...document.querySelectorAll(".settings-card button")].find(el=>el.textContent.includes("管理音乐源")).click()');await wait('!!document.querySelector(".source-priority")');
  await click('[aria-label="上移 Source B"]');assert.equal(await evaluate('window.fixture.state.sources[0].id'),'Source B');
  await click('.zenix-bundle-export button');await wait('document.querySelector(".zenix-bundle-export [role=status]")?.textContent.includes("2 份")');
  assert.equal(await evaluate('window.fixture.calls.filter(c=>c.action==="exportSourceBundle").length'),1);
  await evaluate('window.fixture.exportResult={saved:false,count:0}');await click('.zenix-bundle-export button');
  assert.equal(await evaluate('!!document.querySelector(".zenix-bundle-export [role=status]")'),false,'cancelled save does not claim success');
  // Destructive actions use the glass top-layer dialog; cancel and Android Back are inert.
  await click('.source-delete');await wait('!!document.querySelector(".zenix-glass-dialog[open]")');
  assert.equal(await evaluate('window.fixture.calls.filter(c=>c.action==="sourceRemove").length'),0);
  assert.equal(await evaluate('document.activeElement.hasAttribute("data-cancel")'),true);
  await screenshot('mobile-glass-confirm.png');await evaluate('document.dispatchEvent(new Event("zenix-back"))');await wait('!document.querySelector(".zenix-glass-dialog")');
  assert.equal(await evaluate('window.fixture.calls.filter(c=>c.action==="sourceRemove").length'),0);
  await click('.source-delete');await wait('!!document.querySelector(".zenix-glass-dialog[open]")');await click('.zenix-glass-dialog .is-danger');
  assert.equal(await evaluate('window.fixture.calls.filter(c=>c.action==="sourceRemove").length'),1);
  // Open the current queue wall. Poster selection preserves every poster size and playback.
  await pointer('.mini-info');await sleep(400);await wait('!!document.querySelector(".space-sticker")');await sleep(1000);
  const dimensions=await evaluate('Object.fromEntries([...document.querySelectorAll(".space-sticker")].map(e=>[e.dataset.songId,{w:e.style.width,h:e.style.height}]))');
  const controlsBefore=await evaluate('window.fixture.calls.filter(c=>["play","toggle","roamingPlay"].includes(c.action)).length');
  await evaluate('[...document.querySelectorAll(".space-sticker")].find(e=>!e.classList.contains("is-current")).querySelector(".space-poster").click()');await sleep(500);
  assert.equal(await evaluate('window.fixture.calls.filter(c=>["play","toggle","roamingPlay"].includes(c.action)).length'),controlsBefore);
  const afterDimensions=await evaluate('Object.fromEntries([...document.querySelectorAll(".space-sticker")].map(e=>[e.dataset.songId,{w:e.style.width,h:e.style.height}]))');
  for(const [id,size] of Object.entries(dimensions))if(afterDimensions[id])assert.deepEqual(afterDimensions[id],size,'focusing does not resize '+id);
  await pointer('.is-focused .space-poster');await pointer('.is-focused .space-poster');await sleep(350);
  assert.equal(await evaluate('!!document.querySelector(".is-expanded")||!!document.querySelector(".mobile-full-player")'),false,'double tap does not enlarge');
  await pointer('.is-focused .space-poster',0,0,550);await wait('!!document.querySelector(".song-quick-actions")');await click('.sheet-close');await sleep(300);
  assert.equal(await evaluate('window.fixture.calls.filter(c=>["play","toggle","roamingPlay"].includes(c.action)).length'),controlsBefore);
  await click('.is-focused [aria-label^="放大贴纸"]');await sleep(500);assert.equal(await evaluate('!!document.querySelector(".is-expanded")'),true);
  await screenshot('mobile-sticker-explicit-expand.png');await click('.is-focused [aria-label^="播放 "]');await sleep(300);
  assert.equal(await evaluate('window.fixture.calls.filter(c=>["play","toggle","roamingPlay"].includes(c.action)).length'),controlsBefore+1,'only explicit play switches');
  await click('.is-focused [aria-label="打开完整播放器"]');await wait('!!document.querySelector(".mobile-full-player")');await click('[aria-label="收起"]');await sleep(350);
  // Search form and result list support small screens, long titles and a resized IME viewport.
  await click('[aria-label="搜索歌曲"]');await wait('!!document.querySelector(".mobile-search")');
  await evaluate('(()=>{const el=document.querySelector(".mobile-search input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"很长的歌曲标题测试");el.dispatchEvent(new Event("input",{bubbles:true}));})()');
  for(const width of [320,360,390,430]){window.setContentSize(width,820);await sleep(90);assert.equal(await evaluate('(()=>{const el=document.querySelector(".mobile-search");return el.scrollWidth<=el.clientWidth+1&&[...el.querySelectorAll("form>*")].every(e=>e.getBoundingClientRect().right<=innerWidth-10);})()'),true,'search form width '+width);}
  window.setContentSize(320,820);await evaluate('document.querySelector(".mobile-search input").focus();window.dispatchEvent(new CustomEvent("zenix-keyboard",{detail:{open:true,height:300}}))');await sleep(120);
  assert.equal(await evaluate('document.querySelector(".mobile-search").getBoundingClientRect().bottom<=300'),true,'search stays above IME');
  await screenshot('mobile-search-keyboard.png');await click('.mobile-search button[type="submit"]');await wait('document.querySelectorAll(".mobile-search-result").length===5');
  await evaluate('window.dispatchEvent(new CustomEvent("zenix-keyboard",{detail:{open:false,height:820}}))');await sleep(350);
  for(const width of [320,360,390,430]){window.setContentSize(width,820);await sleep(90);assert.equal(await evaluate('[...document.querySelectorAll(".mobile-search-result")].every(e=>e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().right<=innerWidth)'),true,'search result width '+width);}
  window.setContentSize(390,820);await screenshot('mobile-search-results.png');
  const beforeSearchPlay=await evaluate('window.fixture.calls.filter(c=>c.action==="play").length');await click('.search-result-info');await wait('!!document.querySelector(".song-quick-actions")');assert.equal(await evaluate('window.fixture.calls.filter(c=>c.action==="play").length'),beforeSearchPlay);await click('.sheet-close');await sleep(300);await click('.mobile-search-result [aria-label="播放 Fixture 2"]');assert.equal(await evaluate('window.fixture.state.playback.track.id'),'fixture-2');
  await click('[aria-label="设置"]');await sleep(400);await click('[aria-label="搜索歌曲"]');await wait('!!document.querySelector(".mobile-search")');await click('[aria-label="关闭搜索"]');await click('.brand');await sleep(400);
  assert.equal(await evaluate('window.fixture.state.playback.track.id'),'fixture-2','navigation does not restart or clear native playback');
  // The first result must be usable while another provider is pending; paginate the
  // submitted query even if the user edits and dismisses the search form later.
  await evaluate(`(()=>{const source=window.fixture.state.sources[0];const sources=[{...source,id:'fast'},{...source,id:'slow'},{...source,id:'lyrics',manifest:{...source.manifest,capabilities:['lyrics']}}];window.fixture.pending=[];window.fixture.search=payload=>new Promise((resolve,reject)=>window.fixture.pending.push({payload,resolve,reject}));window.fixture.setSnapshot({sources,localTracks:[{...window.fixture.state.playback.track,id:'local-match',title:'First query local'}]});})()`);
  const submit=async word=>{await click('[aria-label="搜索歌曲"]');await evaluate(`(()=>{const el=document.querySelector('.mobile-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(word)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(50);await click('.mobile-search button[type="submit"]');};
  await submit('First query');await wait('window.fixture.pending.length===2');
  assert.equal(await evaluate('document.querySelectorAll(".mobile-search-result").length'),1,'local results appear before native providers finish');
  await evaluate(`window.fixture.pending[0].resolve({items:[{...window.fixture.state.playback.track,id:'fast-result',title:'Fast result'}],nextCursor:'page-2'})`);
  await wait('document.querySelectorAll(".mobile-search-result").length===2');
  assert.equal(await evaluate('!!document.querySelector(".space-more")'),false,'pagination waits for pending source cursors');
  await evaluate(`window.fixture.pending[1].resolve({items:[],nextCursor:'slow-2'})`);await wait('!!document.querySelector(".space-more")');
  await click('[aria-label="搜索歌曲"]');await evaluate(`(()=>{const el=document.querySelector('.mobile-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Edited but not submitted');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('[aria-label="关闭搜索"]');await click('.space-more');
  await wait('window.fixture.pending.length===4');
  assert.deepEqual(await evaluate('window.fixture.pending.slice(2).map(item=>item.payload.keyword)'),['First query','First query']);
  assert.deepEqual(await evaluate('window.fixture.pending.slice(2).map(item=>item.payload.cursor)'),['page-2','slow-2']);
  await evaluate(`window.fixture.pending[2].resolve({items:[],nextCursor:''});window.fixture.pending[3].reject(Error('Synthetic temporary failure'))`);await wait('!!document.querySelector(".space-more")');
  await click('.space-more');await wait('window.fixture.pending.length===5');
  assert.equal(await evaluate('window.fixture.pending[4].payload.id'),'slow','failed cursor is retained for retry');
  await submit('Second query');await wait('window.fixture.pending.length===7');
  await evaluate(`window.fixture.pending[4].resolve({items:[{...window.fixture.state.playback.track,id:'stale-result'}],nextCursor:''});window.fixture.pending[5].resolve({items:[{...window.fixture.state.playback.track,id:'fresh-result'}],nextCursor:''});window.fixture.pending[6].resolve({items:[],nextCursor:''})`);
  await wait('document.querySelectorAll(".mobile-search-result").length===1');
  assert.equal(await evaluate('!!document.querySelector("[aria-label=\\"更多 Fixture 2\\"]")'),true);
  assert.equal(await evaluate('window.fixture.calls.filter(item=>item.action==="search"&&item.payload.id==="lyrics").length'),0,'non-search providers are not queried');
  process.stdout.write('MOBILE_PLAYBACK_UI_PASS\n');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
