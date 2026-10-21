const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict');
if(!process.env.ZENIX_TEST_USER_DATA||!process.env.ZENIX_TEST_UI_URL)throw Error('isolated fixture required');app.setPath('userData',process.env.ZENIX_TEST_USER_DATA);app.disableHardwareAcceleration();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,width:1000,height:850,webPreferences:{offscreen:true,contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false}});
 const run=code=>window.webContents.executeJavaScript(code,true),wait=async code=>{for(let n=0;n<120;n++){if(await run(code))return;await sleep(40);}throw Error('UI wait '+code);};
 await window.loadURL(process.env.ZENIX_TEST_UI_URL);await wait('!!document.querySelector(".source-setup-guide")');
 assert.match(await run('document.querySelector(".source-setup-guide").textContent'),/先在下方添加/);
 await run('sourceFixture.setRows()');await wait('!!document.querySelector("[aria-label=首次使用搜索平台]")');
 assert.equal(await run('document.querySelector("[aria-label=首次使用搜索平台]").value'),'wy','existing user choice preserved');
 assert.equal(await run('sourceFixture.writes.length'),0,'opening settings never writes defaults');
 await run(`(()=>{const s=document.querySelector('[aria-label=首次使用搜索平台]');s.value='tx';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await run(`document.querySelector('.source-setup-platform button').click()`);await wait("sourceFixture.values.lxCatalog==='tx'");
 assert.equal(await run('sourceFixture.values.credential'),'retained');assert.equal(await run('sourceFixture.values.__allowHttp'),'false');assert.equal(await run('sourceFixture.values.__allowedHosts'),'audio.example.test');
 await wait('!document.querySelector(".source-setup-guide form button").disabled');await run(`document.querySelector('.source-setup-guide form button').click()`);await wait('sourceFixture.searches.length===1');
 assert.deepEqual(await run('sourceFixture.searches[0]'),{keyword:'你不知道的事',id:'lx.fixture'});
 assert.match(await run('document.querySelector(".diagnostic-row").textContent'),/尚未验证播放/);
 await run(`document.querySelector('.zenix-source-preset button').click()`);await wait('!!document.querySelector(".zenix-source-preview")');
 assert.equal(await run('sourceFixture.confirms.length'),0,'preset only previews, never grants silently');
 assert.equal(await run('document.querySelector(".zenix-source-preview input[type=checkbox]").checked'),false,'reimport retains HTTPS-only');
 assert.equal(await run('document.querySelector(".zenix-source-preview input[aria-label=授权域名]").value'),'audio.example.test');
 await run(`document.querySelector('.zenix-source-preview button').click()`);await wait('!document.querySelector(".zenix-source-preview")');assert.equal(await run('sourceFixture.confirms.length'),0);
 for(const width of [1000,430,320]){window.setContentSize(width,850);await sleep(80);assert.equal(await run('document.documentElement.scrollWidth<=innerWidth+1'),true,'no overflow at '+width);}
 await run('sourceFixture.showSearch()');await wait('document.querySelector("#search-state")?.textContent.includes("405")');
 assert.equal(await run('sourceFixture.searchCalls'),1);await run('document.querySelector("#retry-search").click()');await wait('sourceFixture.searchCalls===2&&document.querySelector("#search-state").textContent==="empty"');
 console.log('SOURCE_SETUP_UI_PASS');app.exit(0);
}).catch(e=>{console.error(e);app.exit(1);});
