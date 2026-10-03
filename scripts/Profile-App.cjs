// Runs production Zenix with generated media and a separate application directory.
// No existing user profile, source script or music file is read or changed.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const label = process.argv[2] || 'baseline';
if (!/^[a-z0-9-]+$/i.test(label)) throw Error('Invalid measurement label');
const root = path.resolve(__dirname, '..');
const folder = path.join(root, 'release', 'profiles', label);
const userData = path.join(folder, 'user-data');
for (const name of ['covers', 'appearance', 'media']) fs.mkdirSync(path.join(userData, name), { recursive: true });
app.setPath('appData', folder); app.setPath('userData', userData);
const picked = [];
dialog.showOpenDialog = async () => ({ canceled: !picked.length, filePaths: picked.splice(0) });
require('../electron/main.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const reports = [], checks = [], errors = [];
const log = value => fs.appendFileSync(path.join(folder,'run.log'),JSON.stringify(value)+'\n');
async function measure(win, name) {
  await sleep(2500);
  const processes = app.getAppMetrics().map(value => ({ pid: value.pid, type: value.type, memory: value.memory }));
  const dom = await win.webContents.executeJavaScript(`({stickers:document.querySelectorAll('.yz-sticker').length, images:document.images.length, decoded:[...document.images].filter(i=>i.complete&&i.naturalWidth).length, heap:performance.memory?performance.memory.usedJSHeapSize:null, elements:document.querySelectorAll('*').length})`);
  const os = JSON.parse(require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/Profile-Memory.ps1'),'-AsJson'],{encoding:'utf8',windowsHide:true}));
  const report = { os, name, at: new Date().toISOString(), workingMiB: processes.reduce((sum, p) => sum + p.memory.workingSetSize / 1024, 0), privateMiB: processes.reduce((sum, p) => sum + (p.memory.privateBytes || 0) / 1024, 0), processes, dom };
  reports.push(report); fs.writeFileSync(path.join(folder, 'measurement.json'), JSON.stringify({ reports, checks, errors }, null, 2));
  log({ phase: name, workingMiB: +report.workingMiB.toFixed(1), privateMiB: +report.privateMiB.toFixed(1), ...dom });
}
async function click(win, expression) { await win.webContents.executeJavaScript(`(()=>{const node=${expression};if(!node)throw Error('Missing target: '+${JSON.stringify(expression)});node.click();})()`); await sleep(600); }
async function check(name, operation) { try { await operation(); checks.push({ name, passed: true }); } catch (error) { checks.push({ name, passed: false, error: error.message }); } }
app.whenReady().then(async () => {
  let win; for (let i = 0; i < 100; i++) { win = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Zenix'); if (win && !win.webContents.isLoading() && win.webContents.getURL()) break; await sleep(200); }
  assert(win); win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  win.webContents.on('render-process-gone', (_event, details) => errors.push(JSON.stringify(details)));
  await sleep(3500); await measure(win, 'home');
  await click(win, `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('进入音乐空间'))`);
  await measure(win, 'wall-120');
  await check('120 songs retained with bounded viewport posters', async () => { const result=await win.webContents.executeJavaScript(`(async()=>({count:(await window.yzqxy.personal.load()).history.length,mounted:document.querySelectorAll('.yz-sticker').length}))()`); assert.equal(result.count,120); assert(result.mounted>0&&result.mounted<=120); });
  await click(win, `document.querySelector('.yz-sticker.is-expanded .yz-sticker-focus-controls button')`);
  await sleep(2000); await measure(win, 'playing');
  await check('native media element is playing and clock advances', async () => assert(await win.webContents.executeJavaScript(`Number(document.querySelector('.yz-lattice-mini-progress')?.value)>0`)));
  await click(win, `document.querySelector('[aria-label="打开桌面歌词"]')`);
  await measure(win, 'desktop-lyrics');
  await check('LRC window opens on top', async () => { const windows = BrowserWindow.getAllWindows().filter(w => w !== win && w.isVisible()); assert(windows.some(w => w.isAlwaysOnTop())); });
  await click(win, `document.querySelector('[aria-label="关闭桌面歌词"]')`);
  await measure(win, 'lyrics-closed');
  await check('playlist create, duplicate add, rename, persist, remove', async () => {
    const result = await win.webContents.executeJavaScript(`(async()=>{const b=window.yzqxy.personal,t=(await window.yzqxy.library.load()).tracks[0];const created=await b.createPlaylist('Regression',t);const id=created.playlists.find(l=>l.name==='Regression').id;await b.addToPlaylist(id,t);await b.renamePlaylist(id,'Renamed');const saved=await b.load();const count=saved.playlists.find(l=>l.id===id).tracks.length;await b.deletePlaylist(id);return count;})()`); assert.equal(result, 1);
  });
  await check('repeat history is deduplicated', async () => { const count = await win.webContents.executeJavaScript(`(async()=>{const b=window.yzqxy.personal,t=(await window.yzqxy.library.load()).tracks[0];await b.record(t);await b.record(t);return(await b.load()).history.filter(v=>v.track.id===t.id).length;})()`); assert.equal(count, 1); });
  // Exercise source lifecycle with a generated trusted fixture, no Internet requests.
  const source = path.join(folder, 'fixture.zenixsource');
  fs.writeFileSync(source, JSON.stringify({ manifest: { schemaVersion: 1, id: 'zenix.regression', name: 'Generated Regression', version: '1', capabilities: ['search', 'resolvePlayback', 'lyrics'], qualities: ['high'], network: { apiHosts: ['example.com'], mediaHosts: ['example.com'], artworkHosts: ['example.com'] } }, script: `zenix.register({search:()=>({items:[{remoteId:'1',title:'Generated source',artist:'Fixture',duration:90}]}),resolvePlayback:()=>({url:'https://example.com/fixture.wav'}),lyrics:()=>('[00:00.00]Fixture lyric')});` }));
  await check('source install/search and runner retirement', async () => { picked.push(source); const value = await win.webContents.executeJavaScript(`(async()=>{const b=window.yzqxy.sources,p=await b.importFile();await b.confirmImport(p.token);return await b.search('zenix.regression','Fixture');})()`); assert(value.items?.length === 1); });
  await measure(win, 'source-warm'); await sleep(22000); await measure(win, 'source-idle');
  await check('idle source renderer released', async () => assert(!BrowserWindow.getAllWindows().some(w => w !== win && !w.isVisible() && w.getBounds().width === 1)));
  for (let i = 0; i < 8; i++) { await click(win, `document.querySelector('[aria-label="个人主页"]')`); await click(win, `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('进入音乐空间'))`); }
  await measure(win, 'wall-after-8-roundtrips');
  win.minimize(); await sleep(1500); await measure(win, 'minimized-playing'); win.restore();
  await measure(win, 'restored');
  await check('seek slider changes the playing media clock', async () => {
    await win.webContents.executeJavaScript(`(()=>{const input=document.querySelector('.yz-lattice-mini-progress');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'25');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await sleep(600); assert(await win.webContents.executeJavaScript(`Number(document.querySelector('.yz-lattice-mini-progress').value)>=25`));
  });
  await check('expanded sticker fills the window and Escape restores it', async () => {
    await click(win, `document.querySelector('.yz-sticker-focus-controls button:nth-child(2)')`);
    assert(await win.webContents.executeJavaScript(`!!document.querySelector('.yz-lattice.is-immersive')`));
    await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
    await sleep(500); assert(await win.webContents.executeJavaScript(`!document.querySelector('.yz-lattice.is-immersive')`));
  });
  await check('LRC layout, lyric preview timeout, lock and window cleanup', async () => {
    await click(win, `document.querySelector('[aria-label="打开桌面歌词"]')`);
    const overlay = BrowserWindow.getAllWindows().find(w => w !== win && w.isVisible()); assert(overlay);
    await overlay.webContents.executeJavaScript(`document.querySelector('#orientation').click();document.querySelector('#lines').dispatchEvent(new WheelEvent('wheel',{deltaY:100,bubbles:true,cancelable:true}));`);
    await sleep(500); assert(await overlay.webContents.executeJavaScript(`document.querySelector('#lines').classList.contains('is-browsing')`));
    await sleep(3400); assert(await overlay.webContents.executeJavaScript(`!document.querySelector('#lines').classList.contains('is-browsing')`));
    await overlay.webContents.executeJavaScript(`document.querySelector('#lock').click()`); await sleep(400);
    assert(await overlay.webContents.executeJavaScript(`document.body.classList.contains('is-locked')`));
    await click(win, `document.querySelector('[aria-label="关闭桌面歌词"]')`); assert(overlay.isDestroyed());
  });
  await check('home wheel region and downward management button do not trap scrolling', async () => {
    await click(win, `document.querySelector('[aria-label="个人主页"]')`);
    const prevented = await win.webContents.executeJavaScript(`(()=>{const stage=document.querySelector('.zenix-space-stage'),r=stage.getBoundingClientRect(),event=new WheelEvent('wheel',{deltaY:100,clientX:r.left+5,clientY:r.bottom-5,bubbles:true,cancelable:true});stage.dispatchEvent(event);return event.defaultPrevented;})()`); assert(!prevented);
    await click(win, `document.querySelector('[aria-label="下滑到歌曲管理"]')`);
    assert(await win.webContents.executeJavaScript(`document.querySelector('.zenix-home-scroll').scrollTop>0`));
  });
  await check('submitting home search enters exactly its result posters', async () => {
    await win.webContents.executeJavaScript(`(()=>{const input=document.querySelector('.yz-home-search-dock input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Generated source');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await sleep(600); await win.webContents.executeJavaScript(`document.querySelector('.yz-home-search-dock form').requestSubmit()`);
    await sleep(2400);
    assert(await win.webContents.executeJavaScript(`!!document.querySelector('.yz-shell--player')`));
    assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.yz-sticker').length`), 1);
    assert(await win.webContents.executeJavaScript(`document.querySelector('.yz-sticker-focus-meta h1').textContent.includes('Generated source')`));
    assert(!await win.webContents.executeJavaScript(`!!document.querySelector('[aria-label*="下载"]')`));
  });
  const image = await win.webContents.capturePage(); fs.writeFileSync(path.join(folder, 'window.png'), image.toPNG());
  fs.writeFileSync(path.join(folder, 'measurement.json'), JSON.stringify({ reports, checks, errors }, null, 2));
  log({ finished: true, checks, errors, folder });
  if (process.argv.includes('--hold')) await sleep(60000);
  if (checks.some(check => !check.passed) || errors.length) app.exit(1);
  else app.quit();
}).catch(error => { log({fatal:error.stack}); app.exit(1); });
