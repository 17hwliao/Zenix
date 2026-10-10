const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
if(!process.env.ZENIX_TEST_USER_DATA||!process.env.ZENIX_TEST_UI_URL)throw Error('Isolated fixture required');
app.setPath('userData',process.env.ZENIX_TEST_USER_DATA);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:390,height:820,useContentSize:true,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  // Hosted Windows runners can request reduced motion. These assertions exercise
  // the full animation path, so establish that preference before React mounts.
  await window.loadURL('about:blank');
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  window.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message);});
  const evaluate=async code=>{try{return await window.webContents.executeJavaScript(code,true);}catch(error){console.error('Fixture expression failed:',code);throw error;}};
  const wait=async code=>{for(let i=0;i<160;i++){if(await evaluate(code))return;await sleep(50);}console.error(await evaluate('JSON.stringify({queue:window.fixture?.state.playback.queue.map(t=>t.id),calls:window.fixture?.calls.slice(-8),events:window.fixture?.events?.slice(-16),rows:[...document.querySelectorAll(".swipe-track-row")].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON(),style:e.getAttribute("style")}))})'));throw Error('UI timeout: '+code);};
  const click=async selector=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await sleep(100);};
  const bounds=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  const pointer=async(selector,dx=0,dy=0,hold=0)=>{const point=await bounds(selector);window.webContents.sendInputEvent({type:'mouseMove',...point});window.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});if(hold)await sleep(hold);if(dx||dy){for(let step=1;step<=5;step++){window.webContents.sendInputEvent({type:'mouseMove',x:point.x+Math.round(dx*step/5),y:point.y+Math.round(dy*step/5),modifiers:['leftButtonDown']});await sleep(20);}}window.webContents.sendInputEvent({type:'mouseUp',x:point.x+dx,y:point.y+dy,button:'left',clickCount:1});await sleep(100);};
  const screenshot=async name=>{await sleep(200);await fs.writeFile(path.join(app.getPath('userData'),name),(await window.webContents.capturePage()).toPNG());};
  await window.loadURL(process.env.ZENIX_TEST_UI_URL);
  assert.equal(await evaluate('matchMedia("(prefers-reduced-motion: reduce)").matches'),false,'animation fixture must run with motion enabled');
  await wait('window.fixture&&document.querySelector(".mobile-mini")&&!document.querySelector(".mobile-boot")');
  const initialPlayback=await evaluate('window.fixture.state.playback');
  await evaluate(`window.fixture.setSnapshot({playback:{...window.fixture.state.playback,sourceActivity:{phase:'resolving',startedAt:Date.now()-5000,message:'正在获取标准品质音频 · Source B（2/7）'}}})`);
  await wait('document.querySelector(".source-status-copy small")?.textContent.includes("5 秒")');
  const beforeStop=await evaluate('window.fixture.calls.filter(c=>c.action==="toggle").length');
  await click('.mobile-source-status button');
  assert.equal(await evaluate('window.fixture.calls.filter(c=>c.action==="toggle").length'),beforeStop+1,'stop cancels loading through the playback command');
  assert.equal(await evaluate('window.fixture.state.playback.playWhenReady'),false);
  await evaluate(`window.fixture.setSnapshot({playback:{...window.fixture.state.playback,sourceActivity:{phase:'failed',startedAt:Date.now(),message:'资源暂不可用',detail:'Source B: HTTP not permitted https://fixture.invalid/audio?token=synthetic-secret'}}})`);
  await wait('!!document.querySelector(".mobile-source-status details")');await click('.mobile-source-status summary');
  assert.match(await evaluate('document.querySelector(".mobile-source-status details").textContent'),/HTTP not permitted/);
  assert.equal(await evaluate('document.querySelector(".mobile-source-status details").textContent.includes("synthetic-secret")'),false,'resource URLs are not displayed in diagnostics');
  await evaluate(`window.fixture.setSnapshot({playback:${JSON.stringify(initialPlayback)}});window.fixture.calls.length=0`);
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
  // Native personal updates must reach tools while the memoized settings page stays open.
  const settingsPersonal=await evaluate('window.fixture.state.personal');
  await evaluate(`window.fixture.setSnapshot({personal:{...window.fixture.state.personal,playlists:[...window.fixture.state.personal.playlists,{id:'fresh-settings-list',name:'新收到的歌单',tracks:[]}]}})`);
  await click('.tool-actions .zenix-tools-launch');
  await wait('document.querySelector(".tool-playlists")?.textContent.includes("新收到的歌单")');
  await click('[aria-label="关闭音乐工具"]');
  await evaluate(`window.fixture.setSnapshot({personal:${JSON.stringify(settingsPersonal)}})`);
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
  // PC-style focus expands inside the mosaic; audio and full-screen stay separate.
  await pointer('.mini-info');await sleep(400);await wait('!!document.querySelector(".space-sticker")');await sleep(1000);
  const dimensions=await evaluate('Object.fromEntries([...document.querySelectorAll(".space-sticker")].map(e=>[e.dataset.songId,{w:e.style.width,h:e.style.height}]))');
  const controlsBefore=await evaluate('window.fixture.calls.filter(c=>["play","toggle","roamingPlay"].includes(c.action)).length');
  await evaluate('[...document.querySelectorAll(".space-sticker")].find(e=>!e.classList.contains("is-current")).querySelector(".space-poster").click()');await sleep(500);
  assert.equal(await evaluate('window.fixture.calls.filter(c=>["play","toggle","roamingPlay"].includes(c.action)).length'),controlsBefore);
  const afterDimensions=await evaluate('Object.fromEntries([...document.querySelectorAll(".space-sticker")].map(e=>[e.dataset.songId,{w:e.style.width,h:e.style.height}]))');
  assert.ok(Object.keys(dimensions).some(id=>afterDimensions[id]&&afterDimensions[id].w!==dimensions[id].w),'poster focus rearranges the mosaic');
  await pointer('.is-focused .space-poster');await pointer('.is-focused .space-poster');await sleep(350);
  assert.equal(await evaluate('!!document.querySelector(".mobile-full-player")'),false,'double tap does not open full-screen');
  await pointer('.is-focused .space-poster',0,0,550);await wait('!!document.querySelector(".song-quick-actions")');await click('.sheet-close');await sleep(300);
  assert.equal(await evaluate('window.fixture.calls.filter(c=>["play","toggle","roamingPlay"].includes(c.action)).length'),controlsBefore);
  assert.equal(await evaluate('document.querySelectorAll(".space-sticker.is-expanded").length'),1);
  await screenshot('mobile-sticker-focus-expand.png');await click('.is-focused [aria-label^="播放 "]');await sleep(300);
  assert.equal(await evaluate('window.fixture.calls.filter(c=>["play","toggle","roamingPlay"].includes(c.action)).length'),controlsBefore+1,'only explicit play switches');
  // Measure the real panel geometry under playback ticks and a full lyric document.
  // Opening/closing never restarts playback or loses the sticker focus/camera.
  const detailControls=await evaluate('window.fixture.calls.filter(c=>["play","toggle","roamingPlay"].includes(c.action)).length');
  const detailCamera=await evaluate('document.querySelector(".space-plane").style.transform');
  const detailFocus=await evaluate('document.querySelector(".space-sticker.is-focused").dataset.songId');
  const detailHeight=await evaluate('document.querySelector(".space-viewport").clientHeight');
  await evaluate(`window.fixture.lyrics={text:Array.from({length:240},(_,i)=>'['+Math.floor(i/60).toString().padStart(2,'0')+':'+(i%60).toString().padStart(2,'0')+']Stress lyric '+i).join(String.fromCharCode(10)),format:'lrc',source:'custom'};window.fixture.lyricReads=[];window.fixture.playbackTicks=setInterval(()=>window.fixture.setSnapshot({playback:{...window.fixture.state.playback,position:window.fixture.state.playback.position+.04}}),40)`);
  const opening=await evaluate(`new Promise((resolve,reject)=>{const start=performance.now(),samples=[];document.querySelector('.is-focused [aria-label="打开完整播放器"]').click();const frame=()=>{const el=document.querySelector('.mobile-full-player'),top=el?.getBoundingClientRect().top;samples.push({ms:performance.now()-start,top});if(el&&top<=1&&el.querySelector('.full-player-art .mobile-art'))return resolve({ms:performance.now()-start,samples,reads:window.fixture.lyricReads});if(performance.now()-start>1000)return reject(Error('Player entrance did not settle'));requestAnimationFrame(frame);};requestAnimationFrame(frame);})`);
  assert.ok(opening.ms<400,'player entrance settles promptly: '+opening.ms);
  assert.ok(opening.samples.some(s=>s.top>20&&s.top<700),'entrance still slides upwards');
  assert.ok(opening.reads.length>0&&opening.reads.every(r=>r.panelTop<=1),'full lyrics are fetched after the slide, not during it');
  await wait('document.querySelectorAll(".mobile-full-player [data-line]").length===240');
  assert.equal(await evaluate('document.querySelector(".space-viewport").clientHeight'),detailHeight,'opening never resizes/reflows the sticker viewport');
  assert.equal(await evaluate('document.querySelector(".mobile-space").classList.contains("is-suspended")'),true);
  const closing=await evaluate(`new Promise((resolve,reject)=>{const start=performance.now(),samples=[];document.querySelector('.mobile-full-player [aria-label="收起"]').click();const frame=()=>{const el=document.querySelector('.mobile-full-player');if(!el)return resolve({ms:performance.now()-start,samples});samples.push({ms:performance.now()-start,top:el.getBoundingClientRect().top,suspended:document.querySelector('.mobile-space').classList.contains('is-suspended')});if(performance.now()-start>1000)return reject(Error('Player exit did not finish'));requestAnimationFrame(frame);};requestAnimationFrame(frame);})`);
  assert.ok(closing.ms<350,'player exit settles promptly: '+closing.ms);
  assert.ok(closing.samples.some(s=>s.top>20&&s.top<700),'exit still slides downwards');
  assert.ok(closing.samples.every(s=>s.suspended),'background stays paused until the last exit frame');
  await wait('!document.querySelector(".mobile-space.is-suspended")');
  assert.equal(await evaluate('document.querySelector(".space-plane").style.transform'),detailCamera,'return preserves the browsing camera');
  assert.equal(await evaluate('document.querySelector(".space-sticker.is-focused").dataset.songId'),detailFocus,'return preserves sticker focus');
  // Reverse an exit before it completes: the old completion must not resume the
  // background underneath the reopened panel or leave a duplicate/blocking layer.
  await click('.is-focused [aria-label="打开完整播放器"]');await sleep(180);
  await evaluate(`document.querySelector('.mobile-full-player [aria-label="收起"]').click()`);await sleep(60);
  await evaluate(`document.querySelector('.is-focused [aria-label="打开完整播放器"]').click()`);await sleep(350);
  assert.equal(await evaluate('document.querySelectorAll(".mobile-full-player").length'),1);
  assert.equal(await evaluate('document.querySelector(".mobile-space").classList.contains("is-suspended")'),true);
  assert.ok(await evaluate('document.querySelector(".mobile-full-player").getBoundingClientRect().top<=1'));
  await click('[aria-label="收起"]');await wait('!document.querySelector(".mobile-full-player")&&!document.querySelector(".mobile-space.is-suspended")');
  await evaluate('clearInterval(window.fixture.playbackTicks);window.fixture.lyrics=null');
  assert.equal(await evaluate('window.fixture.calls.filter(c=>["play","toggle","roamingPlay"].includes(c.action)).length'),detailControls);
  process.stdout.write('DETAIL_TRANSITION '+JSON.stringify({openMs:opening.ms,closeMs:closing.ms,lyricLines:240,playbackTickMs:40})+'\n');
  // Search stays in the poster space; lists belong to queue/playlist management.
  await click('[aria-label="搜索歌曲"]');await wait('!!document.querySelector(".mobile-search")');
  await evaluate('(()=>{const el=document.querySelector(".mobile-search input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"很长的歌曲标题测试");el.dispatchEvent(new Event("input",{bubbles:true}));})()');
  for(const width of [320,360,390,430]){window.setContentSize(width,820);await sleep(90);assert.equal(await evaluate('(()=>{const el=document.querySelector(".mobile-search");return el.scrollWidth<=el.clientWidth+1&&[...el.querySelectorAll("form>*")].every(e=>e.getBoundingClientRect().right<=innerWidth-10);})()'),true,'search form width '+width);}
  window.setContentSize(320,820);await evaluate('document.querySelector(".mobile-search input").focus();window.dispatchEvent(new CustomEvent("zenix-keyboard",{detail:{open:true,height:300}}))');await sleep(120);
  assert.equal(await evaluate('document.querySelector(".mobile-search").getBoundingClientRect().bottom<=300'),true,'search stays above IME');
  await screenshot('mobile-search-keyboard.png');await click('.mobile-search button[type="submit"]');await wait('document.querySelectorAll(".space-sticker").length===5');
  await evaluate('window.dispatchEvent(new CustomEvent("zenix-keyboard",{detail:{open:false,height:820}}))');await sleep(350);
  for(const width of [320,360,390,430]){window.setContentSize(width,820);await sleep(90);assert.equal(await evaluate('(()=>{const v=document.querySelector(".space-viewport"),r=v.getBoundingClientRect();return getComputedStyle(v).touchAction==="none"&&r.width>0&&r.left>=0&&r.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth+1&&!document.querySelector(".mobile-search-results");})()'),true,'search retains the pannable sticker viewport '+width);}
  window.setContentSize(390,820);await screenshot('mobile-search-results.png');
  const beforeSearchPlay=await evaluate('window.fixture.calls.filter(c=>["play","toggle"].includes(c.action)).length');await click('.space-sticker[data-song-id="fixture-3"] .space-poster');await sleep(600);assert.equal(await evaluate('document.querySelector(".space-sticker.is-focused.is-expanded").dataset.songId'),'fixture-3');assert.equal(await evaluate('window.fixture.calls.filter(c=>["play","toggle"].includes(c.action)).length'),beforeSearchPlay,'search poster focus never controls audio');assert.equal(await evaluate('!!document.querySelector(".mobile-full-player")'),false,'poster click does not open full-screen');await click('.sticker-toolbar [aria-label="播放 Fixture 3"]');assert.equal(await evaluate('window.fixture.state.playback.track.id'),'fixture-3');
  await click('[aria-label="设置"]');await sleep(400);await click('[aria-label="搜索歌曲"]');await wait('!!document.querySelector(".mobile-search")');await click('[aria-label="关闭搜索"]');await click('.brand');await sleep(400);
  assert.equal(await evaluate('window.fixture.state.playback.track.id'),'fixture-3','navigation does not restart or clear native playback');
  // The first result must be usable while another provider is pending; paginate the
  // submitted query even if the user edits and dismisses the search form later.
  await evaluate(`(()=>{const source=window.fixture.state.sources[0];const sources=[{...source,id:'fast'},{...source,id:'slow'},{...source,id:'lyrics',manifest:{...source.manifest,capabilities:['lyrics']}}];window.fixture.pending=[];window.fixture.search=payload=>new Promise((resolve,reject)=>window.fixture.pending.push({payload,resolve,reject}));window.fixture.setSnapshot({sources,localTracks:[{...window.fixture.state.playback.track,id:'local-match',title:'First query local'}]});})()`);
  const submit=async word=>{await click('[aria-label="搜索歌曲"]');await evaluate(`(()=>{const el=document.querySelector('.mobile-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(word)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(50);await click('.mobile-search button[type="submit"]');};
  await submit('First query');await wait('window.fixture.pending.length===2');
  assert.equal(await evaluate('document.querySelectorAll(".space-sticker").length'),1,'local results appear before native providers finish');
  await sleep(1000);const progressiveCamera=await evaluate('document.querySelector(".space-plane").style.transform');
  await evaluate(`window.fixture.pending[0].resolve({items:[{...window.fixture.state.playback.track,id:'fast-result',title:'Fast result'}],nextCursor:'page-2'})`);
  await wait('document.querySelectorAll(".space-sticker").length===2');
  assert.equal(await evaluate('document.querySelector(".space-sticker.is-expanded").dataset.songId'),'local-match','source replies preserve focused poster');assert.equal(await evaluate('document.querySelector(".space-plane").style.transform'),progressiveCamera,'source replies preserve browsing camera');
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
  await wait('document.querySelectorAll(".space-sticker").length===1');
  assert.equal(await evaluate('document.querySelector(".space-sticker").dataset.songId'),'fresh-result');
  assert.equal(await evaluate('window.fixture.calls.filter(item=>item.action==="search"&&item.payload.id==="lyrics").length'),0,'non-search providers are not queried');
  // Sample actual animated geometry, not just the presence of a CSS class.
  await evaluate(`void(window.fixture.search=async()=>({items:Array.from({length:24},(_,index)=>({...window.fixture.state.playback.track,id:'poster-'+index,title:'Poster '+index})),nextCursor:''}))`);
  await submit('Poster animation');await wait('document.querySelector(".space-sticker[data-song-id=poster-0]")');await sleep(1000);
  const posterGeometry=()=>evaluate('(()=>{const plane=document.querySelector(".space-plane").getBoundingClientRect();return Object.fromEntries([...document.querySelectorAll(".space-sticker")].map(e=>{const r=e.getBoundingClientRect();return[e.dataset.songId,{x:r.left-plane.left,y:r.top-plane.top,w:r.width,h:r.height}];}));})()');
  const originalPosters=await posterGeometry(), originalCamera=await evaluate('document.querySelector(".space-plane").style.transform');
  const beforeAnimationPlay=await evaluate('window.fixture.calls.filter(c=>["play","toggle","roamingPlay"].includes(c.action)).length');
  await screenshot('mobile-sticker-restored-style.png');
  await evaluate('document.querySelector(".space-sticker[data-song-id=poster-1] .space-poster").click()');await sleep(70);
  const duringExpansion=await posterGeometry();await sleep(1000);const enlargedPosters=await posterGeometry();
  assert.ok(enlargedPosters['poster-1'].w>originalPosters['poster-1'].w+100,'clicking a poster expands it inside the mosaic, as on PC');
  assert.ok(duringExpansion['poster-1'].w>originalPosters['poster-1'].w&&duringExpansion['poster-1'].w<enlargedPosters['poster-1'].w,'poster width interpolates through the PC easing transition');
  assert.ok(enlargedPosters['poster-0'].w<originalPosters['poster-0'].w,'previous focus contracts while the next poster expands');
  assert.notEqual(await evaluate('document.querySelector(".space-plane").style.transform'),originalCamera,'camera follows the growing poster');
  const movedNeighbor=Object.keys(originalPosters).find(id=>id!=='poster-0'&&enlargedPosters[id]&&['x','y','w','h'].some(key=>Math.abs(originalPosters[id][key]-enlargedPosters[id][key])>1));
  assert.ok(movedNeighbor,'surrounding posters move to make room');await screenshot('mobile-sticker-restored-expanded.png');
  await evaluate('document.querySelector(".space-sticker[data-song-id=poster-0] .space-poster").click()');await sleep(1000);const restoredPosters=await posterGeometry();
  for(const id of ['poster-0',movedNeighbor])for(const key of ['x','y','w','h'])assert.ok(Math.abs(restoredPosters[id][key]-originalPosters[id][key])<.5,'shrinking restores mosaic geometry '+id+' '+key);
  const focusCamera=await evaluate('document.querySelector(".space-plane").style.transform');
  await evaluate('document.querySelector(".space-sticker[data-song-id=poster-1] .space-poster").click()');await sleep(70);const duringFocus=await evaluate('document.querySelector(".space-plane").style.transform');await sleep(1000);const settledFocus=await evaluate('document.querySelector(".space-plane").style.transform');
  assert.notEqual(duringFocus,focusCamera,'poster click starts camera motion');assert.notEqual(duringFocus,settledFocus,'focus settles smoothly instead of jumping');
  assert.equal(await evaluate('document.querySelector(".space-sticker.is-expanded").dataset.songId'),'poster-1','selected poster remains expanded in the mosaic');
  assert.equal(await evaluate('!!document.querySelector(".mobile-full-player")'),false,'mosaic focus never opens the full-screen player');
  assert.equal(await evaluate('(()=>{const e=document.querySelector(".space-sticker.is-focused"),title=e.querySelector(".space-song").getBoundingClientRect(),index=e.querySelector(".sticker-index").getBoundingClientRect(),toolbar=e.querySelector(".sticker-toolbar").getBoundingClientRect();return title.top>=index.bottom&&title.bottom<=toolbar.top;})()'),true,'compact poster title fits between its index and controls');
  assert.equal(await evaluate('window.fixture.calls.filter(c=>["play","toggle","roamingPlay"].includes(c.action)).length'),beforeAnimationPlay,'focus and enlargement never control audio');
  await screenshot('mobile-sticker-restored-focus.png');
  // Reduced-motion preferences still allow immediate opening and closing.
  if(!window.webContents.debugger.isAttached())window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await wait('matchMedia("(prefers-reduced-motion: reduce)").matches');await sleep(100);
  await pointer('.mini-info');await pointer('.mini-info');await wait('!!document.querySelector(".mobile-full-player")');
  assert.ok(await evaluate('document.querySelector(".mobile-full-player").getBoundingClientRect().top<=1'));
  await click('[aria-label="收起"]');await wait('!document.querySelector(".mobile-full-player")&&!document.querySelector(".mobile-space.is-suspended")');
  window.webContents.debugger.detach();
  process.stdout.write('MOBILE_PLAYBACK_UI_PASS\n');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
