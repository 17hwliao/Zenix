// Run by the regression harness with a fresh, disposable userData directory.
const { app, safeStorage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { encodeProtected, decodeProtected } = require('../../electron/runtime/protected-json.cjs');
if (!process.env.ZENIX_TEST_USER_DATA) throw Error('Isolated userData is required');
app.setPath('userData', process.env.ZENIX_TEST_USER_DATA);
app.whenReady().then(async () => {
  assert.equal(await safeStorage.isAsyncEncryptionAvailable(), true);
  const value = { token: 'isolated-regression-secret', records: [], settings: {} };
  const envelope = await encodeProtected(value); assert(!envelope.includes(value.token)); assert.deepEqual((await decodeProtected(envelope)).value, value);
  const { SourceManager } = require('../../electron/sources.cjs');
  const manager = new SourceManager(app.getPath('userData'), () => {}); await fs.mkdir(manager.folder, { recursive: true });
  await fs.writeFile(manager.indexFile, JSON.stringify({ records: [], settings: { fixture: { token: value.token } } }));
  await manager.load(); manager.assertWritable();
  const persisted = await fs.readFile(manager.indexFile, 'utf8'); assert(!persisted.includes(value.token)); assert.equal(JSON.parse(persisted).protection, 'zenix.safeStorage.v1');
  assert.equal((await decodeProtected(persisted)).value.settings.fixture.token, value.token);
  assert.equal((await fs.readdir(path.dirname(manager.indexFile))).some(name => name.endsWith('.tmp')), false);
  process.stdout.write('WINDOWS_OS_PROTECTION_PASS\n'); app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
