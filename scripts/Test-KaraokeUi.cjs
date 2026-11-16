const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {promisify} = require('node:util');
const {execFile} = require('node:child_process');

test('karaoke UI helpers and synthetic state props render without business or network dependencies', async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zenix-karaoke-ui-'));
  t.after(() => fs.rm(folder, {recursive: true, force: true}));
  const {createServer} = await import('vite');
  const server = await createServer({
    root: path.resolve(__dirname, '..'),
    cacheDir: path.join(folder, 'vite'),
    configFile: false,
    optimizeDeps: {entries: ['scripts/fixtures/karaoke-ui.html']},
    server: {middlewareMode: true, hmr: false},
    logLevel: 'error',
  });
  t.after(() => server.close());

  const ui = await server.ssrLoadModule('/src/features/karaoke/ui/index.ts');
  const fixture = await server.ssrLoadModule('/scripts/fixtures/KaraokeUiFixture.tsx');
  const React = await import('react');
  const {renderToStaticMarkup} = await import('react-dom/server');
  const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

  const windowAtStart = ui.getFiveLineLyricWindow(fixture.mobileSoloProps.lyrics, 0);
  assert.deepEqual(windowAtStart.map((slot) => slot.depth), [-2, -1, 0, 1, 2]);
  assert.equal(windowAtStart[0].line, null);
  assert.equal(windowAtStart[1].line, null);
  assert.equal(windowAtStart[2].line.text, '第一句歌词从远处轻轻靠近');
  assert.equal(windowAtStart[4].line.text, '当前这一句应该最清晰最醒目');
  const windowAtEnd = ui.getFiveLineLyricWindow(fixture.mobileSoloProps.lyrics, 5);
  assert.equal(windowAtEnd[2].line.text, '窗口外还有第六句');
  assert.equal(windowAtEnd[4].line, null);
  assert.equal(ui.formatKaraokeTime(212_000), '3:32');
  assert.equal(ui.feedbackRows(fixture.desktopCompleteProps.result, fixture.desktopCompleteProps.lyrics).length, 5);

  const phases = ['loading', 'ready', 'empty', 'waiting', 'approved', 'rejected', 'disconnected', 'reconnecting', 'host-stopped', 'failed', 'complete'];
  for (const phase of phases) {
    const copy = ui.karaokePhaseCopy(phase);
    const html = render(ui.DesktopKaraokePage, {
      ...fixture.desktopHostProps,
      phase,
      error: phase === 'failed' ? {code: 'ROOM_SYNC', message: '隔离的房间同步失败', recoverable: true} : null,
      result: phase === 'complete' ? fixture.desktopCompleteProps.result : null,
    });
    assert.match(html, new RegExp(`data-karaoke-phase="${phase}"`), `${phase} page state`);
    assert(html.includes(copy.title), `${phase} title`);
  }

  const desktop = render(ui.DesktopKaraokePage, fixture.desktopHostProps);
  assert.match(desktop, /aria-label="房间码 4 8 2 9 1 5"/);
  assert.match(desktop, /aria-pressed="true"/);
  assert.match(desktop, /aria-label="取消准备"/);
  assert.equal((desktop.match(/data-karaoke-lyric-slot=/g) || []).length, 5);
  assert.match(desktop, /<li[^>]*data-karaoke-lyric-slot="0"[^>]*aria-current="true"/);
  assert.match(desktop, /等待中的朋友/);
  assert.match(desktop, />批准</);
  assert.match(desktop, />拒绝</);
  assert.match(desktop, /type="submit"[^>]*>加入队列/);

  const complete = render(ui.DesktopKaraokePage, fixture.desktopCompleteProps);
  assert.match(complete, /role="dialog"/);
  assert.match(complete, /aria-modal="true"/);
  assert.match(complete, /aria-label="关闭演唱结果"/);
  assert.match(complete, /本轮总分 88/);
  assert.match(complete, /逐句点评/);
  assert.match(complete, /副歌进入很自然/);

  const failed = render(ui.DesktopKaraokePage, {
    ...fixture.desktopHostProps,
    phase: 'failed',
    error: {code: 'ROOM_SYNC', message: '隔离的房间同步失败', recoverable: true},
    onDismissError: () => undefined,
  });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /aria-label="关闭错误提示"/);

  const solo = render(ui.MobileKaraokeSoloPage, fixture.mobileSoloProps);
  assert.equal((solo.match(/data-karaoke-lyric-slot=/g) || []).length, 5);
  assert.match(solo, /class="zenix-karaoke-mobile-controls"/);
  assert.match(solo, /aria-label="暂停演唱"/);

  const mobileRoom = render(ui.MobileKaraokeRoom, fixture.mobileRoomProps);
  assert.equal((mobileRoom.match(/data-karaoke-lyric-slot=/g) || []).length, 5);
  assert.match(mobileRoom, /data-karaoke-phase="disconnected"/);
  assert.match(mobileRoom, /aria-pressed="true"/);

  const css = await fs.readFile(path.resolve(__dirname, '../src/features/karaoke/ui/karaoke-ui.css'), 'utf8');
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /@media \(max-width: 330px\)/);

  const listener = http.createServer();
  listener.on('request', (request, response) => server.middlewares(request, response));
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => listener.close(resolve)));

  if (process.platform === 'win32') {
    const env = {
      ...process.env,
      ZENIX_TEST_USER_DATA: folder,
      ZENIX_TEST_UI_URL: `http://127.0.0.1:${listener.address().port}/scripts/fixtures/karaoke-ui.html`,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const {stdout, stderr} = await promisify(execFile)(
      require('electron'),
      [path.join(__dirname, 'fixtures/ElectronKaraokeUi.cjs')],
      {env, windowsHide: true, timeout: 90000},
    ).catch((error) => {
      throw Error(`${error.message}\n${error.stdout || ''}\n${error.stderr || ''}`, {cause: error});
    });
    assert.match(stdout, /KARAOKE_UI_PASS/, stderr);
  }
});
