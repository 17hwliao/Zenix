const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
test('real Windows Electron system encryption and plaintext migration (isolated userData)', { skip: process.platform !== 'win32' ? 'Windows OS protection runs on Windows CI; Android Keystore requires device validation' : false }, async t => {
  const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'zenix-os-protection-')); t.after(() => fsp.rm(folder, { recursive: true, force: true }));
  const env = { ...process.env, ZENIX_TEST_USER_DATA: folder }; delete env.ELECTRON_RUN_AS_NODE;
  const { stdout, stderr } = await promisify(execFile)(require('electron'), [path.join(__dirname, 'fixtures/ElectronProtection.cjs')], { env, timeout: 30000, windowsHide: true });
  assert.match(stdout, /WINDOWS_OS_PROTECTION_PASS/, stderr);
});
