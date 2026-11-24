const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('Android build normalizes Capacitor after sync so a junction cannot write the source checkout path', async t => {
  const root = path.resolve(__dirname, '..');
  const {repairAndroidSync} = await import('../scripts/Repair-Android-Sync.mjs');
  const actual = await repairAndroidSync(root);
  assert.equal(actual.changed, false, 'the checked-in generated file should already be canonical');
  assert.match(
    await fs.readFile(path.join(root, 'android', 'capacitor.settings.gradle'), 'utf8'),
    /new File\('\.\.\/node_modules\/@capacitor\/android\/capacitor'\)/,
  );

  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zenix-android-sync-'));
  t.after(() => fs.rm(folder, {recursive:true, force:true}));
  const android = path.join(folder, 'android');
  await fs.mkdir(android);
  const settings = path.join(android, 'capacitor.settings.gradle');
  await fs.writeFile(settings, [
    '// generated fixture',
    "include ':capacitor-android'",
    "project(':capacitor-android').projectDir = new File('../../../Music/node_modules/@capacitor/android/capacitor')",
    '',
  ].join('\r\n'));
  const repaired = await repairAndroidSync(folder);
  assert.equal(repaired.changed, true);
  const text = await fs.readFile(settings, 'utf8');
  assert.match(text, /new File\('\.\.\/node_modules\/@capacitor\/android\/capacitor'\)/);
  assert.doesNotMatch(text, /\.\.\/Music\/node_modules/);
  assert.equal((await repairAndroidSync(folder)).changed, false, 'repair is idempotent');
});

test('Android build runs the normalization only after cap sync', () => {
  const pkg = require('../package.json');
  const build = String(pkg.scripts?.['android:build'] || '');
  const sync = build.indexOf('cap sync android');
  const repair = build.indexOf('scripts/Repair-Android-Sync.mjs');
  assert.ok(sync >= 0, 'Android build must run cap sync');
  assert.ok(repair > sync, 'Android build must normalize the generated paths after cap sync');
});
