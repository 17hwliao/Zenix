const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('default test manifest only registers existing local test files', () => {
  const root = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const command = String(pkg.scripts?.test || '');
  const files = [...command.matchAll(/\bscripts\/[^\s"'`]+?\.cjs\b/g)].map((match) => match[0]);

  assert.ok(files.length > 0, 'npm test must register local test files');
  assert.equal(new Set(files).size, files.length, 'npm test must not register the same file twice');
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} is referenced by npm test but does not exist`);
  }
});
