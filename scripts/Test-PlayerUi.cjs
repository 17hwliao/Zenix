const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
test('real Electron React UI: transport, home double click, queue collections and remount', { skip: process.platform !== 'win32' ? 'Electron DOM fixture runs on Windows CI' : false }, async t => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true }, logLevel: 'error' }); await server.listen(); t.after(() => server.close());
  const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'zenix-ui-regression-')); t.after(() => fsp.rm(folder, { recursive: true, force: true }));
  const env = { ...process.env, ZENIX_TEST_USER_DATA: folder, ZENIX_TEST_UI_URL: `http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/player-ui.html` }; delete env.ELECTRON_RUN_AS_NODE;
  const { stdout, stderr } = await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/ElectronPlayerUi.cjs')], { env, timeout: 45000, windowsHide: true });
  assert.match(stdout, /PLAYER_UI_INTEGRATION_PASS/, stderr);
  // Keep only the synthetic screenshot for review, never the disposable profile.
  const output = path.resolve(__dirname, '../release/regression'); await fsp.mkdir(output, { recursive: true }); await fsp.copyFile(path.join(folder, 'expanded-song.png'), path.join(output, 'expanded-song.png'));
});
test('real Electron React UI: persistent update dismissal, next release and mobile search geometry', { skip: process.platform !== 'win32' ? 'Electron DOM fixture runs on Windows CI' : false }, async t => {
  const { createServer } = await import('vite');
  const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true }, logLevel: 'error' }); await server.listen(); t.after(() => server.close());
  const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'zenix-update-regression-')); t.after(() => fsp.rm(folder, { recursive: true, force: true }));
  const env = { ...process.env, ZENIX_TEST_USER_DATA: folder, ZENIX_TEST_UI_URL: `http://127.0.0.1:${server.httpServer.address().port}/scripts/fixtures/updates-ui.html` }; delete env.ELECTRON_RUN_AS_NODE;
  const { stdout, stderr } = await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/ElectronUpdatesUi.cjs')], { env, timeout: 45000, windowsHide: true });
  assert.match(stdout, /UPDATES_SEARCH_UI_PASS/, stderr);
  const output = path.resolve(__dirname, '../release/regression'); await fsp.mkdir(output, { recursive: true }); await fsp.copyFile(path.join(folder, 'mobile-search.png'), path.join(output, 'mobile-search.png'));
});
