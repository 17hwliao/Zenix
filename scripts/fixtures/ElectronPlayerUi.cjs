const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
if (!process.env.ZENIX_TEST_USER_DATA || !process.env.ZENIX_TEST_UI_URL) throw Error('Isolated UI fixture is required');
app.setPath('userData', process.env.ZENIX_TEST_USER_DATA);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1200, height: 800, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on('console-message', event => { if (event.level === 'error') console.error('Renderer:', event.message); });
  const evaluate = script => window.webContents.executeJavaScript(script, true).catch(error => { throw Error(script + '\n' + error.message); });
  const wait = async script => { for (let i = 0; i < 100; i++) { if (await evaluate(script)) return; await sleep(50); } throw Error('UI assertion timeout: ' + script); };
  await window.loadURL(process.env.ZENIX_TEST_UI_URL);
  await wait('!!document.querySelector(".yz-playerbar-track")');
  await evaluate('document.querySelector(".yz-playerbar [aria-label=播放]").click()'); await sleep(400);
  assert.equal(await evaluate('window.fixture.toggles'), 1); assert.equal(await evaluate('!!document.querySelector(".yz-shell--home")'), true);
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
  // Going home and singly entering must not replay an old expansion request.
  await evaluate('document.querySelector("[aria-label=个人主页]").click()'); await wait('!!document.querySelector(".yz-playerbar-track")');
  await evaluate('document.querySelector(".yz-playerbar-track").click()'); await wait('!!document.querySelector(".yz-lattice")'); await sleep(450);
  assert.equal(await evaluate('!!document.querySelector(".yz-lattice.is-immersive")'), false);
  await evaluate('document.querySelector(".yz-lattice-mini-focus").click()'); await sleep(70); await evaluate('document.querySelector(".yz-lattice-mini-focus").click()'); await wait('!!document.querySelector(".yz-lattice.is-immersive")');
  process.stdout.write('PLAYER_UI_INTEGRATION_PASS\n'); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
