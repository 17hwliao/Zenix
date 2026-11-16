const {app, BrowserWindow} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

app.setPath('userData', `${process.env.ZENIX_TEST_USER_DATA}-electron`);
app.disableHardwareAcceleration();

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 390,
    height: 844,
    frame: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      sandbox: true,
    },
  });
  const errors = [];
  window.webContents.on('console-message', (_event, level, message) => {
    if (typeof level === 'object' && level?.level === 'error') errors.push(level.message);
    else if (typeof level === 'number' && level >= 3) errors.push(message);
  });
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    errors.push(`${code} ${description} ${url}`);
  });

  const inspect = () => window.webContents.executeJavaScript(`(() => {
    const visibleButtons = [...document.querySelectorAll('.karaoke-ui button')]
      .filter(button => button.getClientRects().length > 0)
      .map(button => ({label: button.getAttribute('aria-label') || button.textContent, height: button.getBoundingClientRect().height}));
    const lyricRows = [...document.querySelectorAll('[data-karaoke-lyric-slot]')];
    return {
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      pageRight: document.querySelector('.zenix-karaoke-page').getBoundingClientRect().right,
      lyricCount: lyricRows.length,
      lyricSizes: lyricRows.map(row => parseFloat(getComputedStyle(row).fontSize)),
      lyricTransforms: lyricRows.map(row => getComputedStyle(row).transform),
      lyricOpacities: lyricRows.map(row => Number(getComputedStyle(row).opacity)),
      shortButtons: visibleButtons.filter(button => button.height < 43.5),
      hasCurrent: Boolean(document.querySelector('[data-karaoke-lyric-slot="0"][aria-current="true"]')),
    };
  })()`, true);

  const waitForReady = async (mode) => {
    let ready = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      ready = await window.webContents.executeJavaScript(`(() => {
        return {
          page: Boolean(document.querySelector('.zenix-karaoke-page')),
          text: document.body.innerText.slice(0, 500),
        };
      })()`, true);
      if (ready.page) return;
      await sleep(100);
    }
    assert(ready.page, `${mode} did not render. Body: ${ready.text}. Console: ${errors.join(' | ')}`);
  };

  window.setContentSize(900, 900);
  await window.loadURL(`${process.env.ZENIX_TEST_UI_URL}?mode=desktop-complete`);
  await waitForReady('desktop-complete');
  await sleep(80);
  assert.equal(await window.webContents.executeJavaScript(`Boolean(document.querySelector('[role="dialog"]'))`, true), true);
  await window.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}))`, true);
  await sleep(80);
  assert.equal(await window.webContents.executeJavaScript(`Boolean(document.querySelector('[role="dialog"]'))`, true), false);
  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => candidate.textContent.includes('查看详细评分'));
    button.focus();
    button.click();
  })()`, true);
  await sleep(80);
  assert.equal(await window.webContents.executeJavaScript(`Boolean(document.querySelector('[role="dialog"]'))`, true), true);
  await window.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}))`, true);
  await sleep(80);
  assert.deepEqual(await window.webContents.executeJavaScript(`(() => ({
    open: Boolean(document.querySelector('[role="dialog"]')),
    restored: document.activeElement?.textContent?.includes('查看详细评分') === true,
  }))()`, true), {open: false, restored: true});

  for (const {mode, widths, mobile} of [
    {mode: 'desktop', widths: [1200], mobile: false},
    {mode: 'mobile-solo', widths: [390, 320], mobile: true},
    {mode: 'mobile-room', widths: [390, 320], mobile: true},
  ]) {
    for (const width of widths) {
      window.setContentSize(width, 844);
      await window.loadURL(`${process.env.ZENIX_TEST_UI_URL}?mode=${mode}`);
      await waitForReady(mode);
      await sleep(80);
      const result = await inspect().catch((error) => {
        throw Error(`${mode} inspection failed: ${error.message}. Console: ${errors.join(' | ')}`, {cause: error});
      });
      assert(Math.abs(result.viewport - width) <= 2, `${mode} viewport: ${result.viewport}`);
      assert(result.scrollWidth <= result.viewport + 1, `${mode} overflowed at ${width}: ${result.scrollWidth} > ${result.viewport}`);
      assert(result.pageRight <= result.viewport + 1, `${mode} page exceeded ${width}`);
      assert.equal(result.lyricCount, 5, `${mode} should render exactly five lyric slots`);
      assert(result.hasCurrent, `${mode} should mark the current lyric`);
      if (mobile) {
        assert.equal(result.shortButtons.length, 0, `${mode} has sub-44px buttons: ${JSON.stringify(result.shortButtons)}`);
      }
      assert(result.lyricSizes[0] < result.lyricSizes[1] && result.lyricSizes[1] < result.lyricSizes[2], `${mode} lyric sizes should increase toward current`);
      assert(result.lyricSizes[4] < result.lyricSizes[3] && result.lyricSizes[3] < result.lyricSizes[2], `${mode} lyric sizes should decrease after current`);
      assert(result.lyricOpacities[0] < result.lyricOpacities[1] && result.lyricOpacities[1] < result.lyricOpacities[2], `${mode} lyric opacity should increase toward current`);
      assert.notEqual(result.lyricTransforms[2], 'none', `${mode} current lyric should use the designed scale`);
      if (process.env.ZENIX_TEST_SCREENSHOT_DIR) {
        await fs.mkdir(process.env.ZENIX_TEST_SCREENSHOT_DIR, {recursive: true});
        const image = await window.webContents.capturePage();
        await fs.writeFile(path.join(process.env.ZENIX_TEST_SCREENSHOT_DIR, `${mode}-${width}.png`), image.toPNG());
      }
    }
  }

  const appErrors = errors.filter((message) => !(
    message.includes('[vite] failed to connect to websocket') ||
    message.includes('WebSocket closed without opened')
  ));
  assert.deepEqual(appErrors, []);
  window.destroy();
  console.log('KARAOKE_UI_PASS');
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
