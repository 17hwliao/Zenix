const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { UpdateReminders, updateReminderKey } = require('../src/core/updateReminders.ts');
function storage() { const data = new Map(); return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) }; }
const state = extra => ({ status: 'available', currentVersion: '1.0.0', version: '1.1.0', build: 20, progress: 0, message: 'Fixture', ...extra });
test('dismissed public version survives restart, download transitions and same-version rebuilds', () => {
  const disk = storage(), reminders = new UpdateReminders(disk); assert.equal(reminders.shouldShow(state(), 'stable'), true); reminders.dismiss(state(), 'stable');
  for (const status of ['available', 'downloading', 'ready']) assert.equal(new UpdateReminders(disk).shouldShow(state({ status, build: 21 }), 'stable'), false);
  assert.equal(new UpdateReminders(disk).shouldShow(state({ version: '1.2.0' }), 'stable'), true);
});
test('notification identity separates channels and never opens for checking, errors or missing version', () => {
  const reminders = new UpdateReminders(storage()); reminders.dismiss(state({ channel: 'stable' }), 'preview');
  assert.equal(reminders.shouldShow(state({ channel: 'stable' }), 'preview'), false);
  assert.equal(reminders.shouldShow(state({ channel: 'preview' }), 'stable'), true);
  assert.equal(updateReminderKey(state({ status: 'ready' }), 'stable'), updateReminderKey(state(), 'stable'));
  for (const status of ['idle', 'checking', 'unpublished', 'current', 'installing', 'error']) assert.equal(reminders.shouldShow(state({ status, version: '1.2.0' }), 'stable'), false);
  assert.equal(reminders.shouldShow(state({ version: undefined }), 'stable'), false);
});
test('corrupt or unavailable storage does not crash reminders and still suppresses within session', () => {
  for (const saved of ['not-json', '{}', '[null,4]']) { const reminders = new UpdateReminders({ getItem: () => saved, setItem() {} }); assert.equal(reminders.shouldShow(state(), 'stable'), true); }
  const reminders = new UpdateReminders({ getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); } }); reminders.dismiss(state(), 'stable'); assert.equal(reminders.shouldShow(state(), 'stable'), false);
});
