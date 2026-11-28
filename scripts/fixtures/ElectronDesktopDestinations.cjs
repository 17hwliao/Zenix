const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
app.setPath('userData',process.env.ZENIX_TEST_USER_DATA);
app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1440,height:960,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
  const page=win.webContents,run=code=>page.executeJavaScript(code,true),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async code=>{for(let n=0;n<240;n++){if(await run(code))return;await pause(30);}throw Error('Desktop destination wait '+code+' '+JSON.stringify(await run('({page:document.querySelector("[data-workspace]")?.dataset.workspace,text:document.querySelector(".zenix-workspace-body")?.textContent?.slice(0,250)})')));};
  const capture=async name=>{await wait(`[...document.querySelectorAll('.zenix-workspace-title,.zenix-workspace-body,.zenix-feature-content>div>section')].every(node=>getComputedStyle(node).opacity==='1')`);await fs.mkdir(path.resolve('release/native-destinations'),{recursive:true});await fs.writeFile(path.resolve('release/native-destinations/'+name+'.png'),(await page.capturePage()).toPNG());};
  await win.loadURL(process.env.ZENIX_TEST_UI_URL+'&shell=1');
  await wait('!!document.querySelector("[data-destination=liked]")');
  const destinations=[['liked','collection:liked','.zenix-manager'],['playlists','collection:playlists','.zenix-manager-grid'],['history','collection:history','.zenix-manager'],['library','library:library','.zenix-local-library'],['tasks','tool:tasks','.zenix-offline-tasks'],['connections','tool:connections','.zenix-connections'],['assistant','tool:assistant','.zenix-assistant-panel'],['karaoke','tool:karaoke','.zenix-karaoke-modes']];
  const visit=async(id,identity,selector)=>{
    console.log('NATIVE_VISIT',id,await run('innerWidth'));
    await run(`(()=>{const button=document.querySelector('[data-destination=${id}]');button.scrollIntoView({block:'nearest'});button.click();})()`);
    await wait(`document.querySelector('[data-workspace="${identity}"]')&&!!document.querySelector('${selector}')`);
    await wait('getComputedStyle(document.querySelector(".zenix-workspace-title")).opacity==="1"');
    await pause(100);
    await run(`document.querySelector('[data-destination=${id}]').scrollIntoView({block:'nearest'})`);
    assert.equal(await run(`document.querySelector('[data-destination=${id}]').getAttribute('aria-current')`),'page');
    assert.equal(await run('document.querySelectorAll(".zenix-feature-backdrop").length'),0,'sidebar never opens the old workbench modal');
    assert.equal(await run('!!document.querySelector(".zenix-manager[aria-modal=true]")'),false);
    assert.equal(await run('document.querySelectorAll(".zenix-feature-workbench").length') ,id==='tasks'||id==='connections'||id==='assistant'||id==='karaoke'?1:0,'one feature executor');
    const layout=await run(`(()=>{const body=document.querySelector('.zenix-workspace-body'),dock=document.querySelector('.zenix-desktop-dock'),r=body.getBoundingClientRect(),d=dock.getBoundingClientRect(),nav=document.querySelector('[data-destination=${id}]'),n=nav.getBoundingClientRect();return {scroll:body.scrollWidth,width:body.clientWidth,bottom:r.bottom,dockTop:d.top,nav:document.elementFromPoint(n.x+n.width/2,n.y+n.height/2)?.closest('button')===nav,document:document.documentElement.scrollWidth,viewport:innerWidth};})()`);
    assert(layout.scroll<=layout.width+1,`${id} body overflows ${JSON.stringify(layout)}`);
    assert(layout.bottom<=layout.dockTop+1,`${id} is not covered by playback dock`);
    if(!layout.nav){await capture('blocked-navigation');throw Error(`${id} sidebar remains interactive ${JSON.stringify(await run(`(()=>{const button=document.querySelector('[data-destination=${id}]'),r=button.getBoundingClientRect(),scroll=document.querySelector('.zenix-desktop-nav-scroll');return {width:innerWidth,height:innerHeight,rect:r.toJSON(),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML?.slice(0,250),scroll:scroll?.getBoundingClientRect().toJSON(),scrollTop:scroll?.scrollTop};})()`))}`);}
    assert(layout.document<=layout.viewport+1);
  };
  for(const width of [1440,900,640]){
    win.setContentSize(width,960);await wait(`Math.abs(innerWidth-${width})<=1`);
    for(const [id,identity,selector]of destinations){await visit(id,identity,selector);if(width===1440||width===640)await capture(id+'-'+width);}
  }
  await visit('liked','collection:liked','.zenix-manager');
  await run('document.querySelector(".zenix-collection-summary button").click()');
  await wait('window.workbenchFixture.calls.some(row=>row.action==="fixturePlay")');
  await visit('playlists','collection:playlists','.zenix-manager-grid');
  await run('document.querySelector(".zenix-manager-overview-head button").click()');
  await run(`(()=>{const input=document.getElementById('zenix-playlist-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'本地原生页面测试');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait('document.querySelector(".zenix-manager-editor [type=submit]").disabled===false');
  await run('document.querySelector(".zenix-manager-editor").requestSubmit()');
  await wait('document.querySelector(".zenix-manager main h2")?.textContent==="本地原生页面测试"');
  await run('document.querySelector(".zenix-collection-tabs button").click()');
  await wait('document.querySelector(".zenix-manager-grid").textContent.includes("本地原生页面测试")');
  await visit('library','library:library','.zenix-local-library');
  await run('document.querySelector(".zenix-library-import-actions button").click()');
  assert(await run('window.workbenchFixture.calls.some(row=>row.action==="fixtureImport")'));
  const mutations=await run('window.workbenchFixture.calls.filter(row=>row.operation==="offlineTasks"&&row.action!=="state"||row.operation==="collaboration"&&!/status|^state$/i.test(String(row.action))).length');
  assert.equal(mutations,0,'navigation never starts downloads, pairings or permissions');
  await run(`window.dispatchEvent(new CustomEvent('zenix-open-workbench',{detail:{tab:'tasks'}}))`);
  await wait('document.querySelector("[data-workspace=\\"tool:tasks\\"]")');
  assert.equal(await run('document.querySelectorAll(".zenix-feature-workbench").length'),1,'external tools share native route');
  await page.debugger.attach('1.3');
  await page.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await run('getComputedStyle(document.querySelector(".zenix-workspace-title")).animationName'),'none');
  await page.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});page.debugger.detach();
  win.setContentSize(1440,960);page.setZoomFactor(2);
  await visit('tasks','tool:tasks','.zenix-offline-tasks');await capture('tasks-zoom-200');
  page.setZoomFactor(1);
  await run('document.querySelector(".zenix-workspace-breadcrumb button").click()');
  await wait('!!document.querySelector(".zenix-desktop-home")');
  assert.equal(await run('!!document.querySelector(".zenix-desktop-dock .yz-playerbar")'),true);
  console.log('DESKTOP_DESTINATIONS_PASS');win.destroy();app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
