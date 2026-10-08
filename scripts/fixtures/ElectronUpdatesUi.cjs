const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
if (!process.env.ZENIX_TEST_USER_DATA || !process.env.ZENIX_TEST_UI_URL) throw Error('Isolated UI fixture is required');
app.setPath('userData', process.env.ZENIX_TEST_USER_DATA);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 390, height: 780, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const evaluate = script => window.webContents.executeJavaScript(script, true);
  const wait = async script => { for (let i = 0; i < 100; i++) { if (await evaluate(script)) return; await sleep(50); } throw Error('UI assertion timeout: ' + script); };
  await window.loadURL(process.env.ZENIX_TEST_UI_URL); await wait('!!document.querySelector("dialog[open]")');
  assert.match(await evaluate('document.querySelector(".zenix-update-notes").textContent'), /搜索交互改进/);
  await evaluate('document.querySelector("[aria-label=关闭更新提醒]").click()'); await wait('!document.querySelector("dialog")');
  assert.equal(await evaluate('!!document.querySelector(".zenix-update-notice")'), false);
  for (const status of ['downloading', 'ready', 'available']) { await evaluate(`window.updateFixture.set({status:${JSON.stringify(status)},build:21});window.updateFixture.remount()`); await sleep(180); assert.equal(await evaluate('!!document.querySelector("dialog")'), false); }
  await evaluate('window.updateFixture.set({version:"1.2.0",status:"available",notes:"Fixture 1.2 新版本亮点"})'); await wait('!!document.querySelector("dialog[open]")');
  assert.match(await evaluate('document.querySelector("#zenix-update-title").textContent'), /1.2.0/);
  await evaluate('document.querySelector("dialog").dispatchEvent(new Event("cancel",{cancelable:true}))'); await wait('!document.querySelector("dialog")');
  await evaluate('window.updateFixture.set({version:"1.3.0",status:"ready",notes:"安装确认验证"})');await wait('!!document.querySelector(".zenix-update-dialog[open]")');
  await evaluate('[...document.querySelectorAll(".zenix-update-dialog button")].find(e=>e.textContent==="安装并重启").click()');await wait('!!document.querySelector(".zenix-glass-dialog[open]")');
  assert.equal(await evaluate('window.installed||0'),0);await evaluate('document.querySelector(".zenix-glass-dialog [data-cancel]").click()');await wait('!document.querySelector(".zenix-glass-dialog")');assert.equal(await evaluate('window.installed||0'),0);
  await evaluate('[...document.querySelectorAll(".zenix-update-dialog button")].find(e=>e.textContent==="安装并重启").click()');await wait('!!document.querySelector(".zenix-glass-dialog[open]")');await evaluate('document.querySelector(".zenix-glass-dialog .is-primary").click()');await wait('window.installed===1');await evaluate('document.querySelector("[aria-label=关闭更新提醒]").click()');await wait('!document.querySelector("dialog")');
  for (const width of [320, 360, 390, 430]) {
    window.setContentSize(width, 780); await sleep(90);
    const rects = await evaluate('(()=>{const form=document.querySelector(".mobile-search form");return [...form.children].map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}})})()');
    assert.equal(rects.length, 4); for (let i = 1; i < rects.length; i++) assert(rects[i - 1].right + 5 <= rects[i].left, `Search overlap at width ${width}`);
    assert(rects[1].width > 80); assert(rects[0].left >= 0); assert(rects[3].right <= width);
  }
  window.setContentSize(390,780); window.showInactive(); await sleep(400);
  await fs.writeFile(path.join(app.getPath('userData'),'mobile-search.png'), (await window.webContents.capturePage()).toPNG());
  window.hide(); process.stdout.write('UPDATES_SEARCH_UI_PASS\n'); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
