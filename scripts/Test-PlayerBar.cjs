const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function harness() {
  let now = 0, refIndex = 0, cleanup, single = 0, expanded = 0; const refs = [], timers = new Map(); let sequence = 0;
  const module = { exports: {} }, file = path.resolve(__dirname, '../src/ui/usePlayerBarGesture.ts');
  const react = { useRef(value) { const index = refIndex++; return refs[index] ||= { current: value }; }, useEffect(effect) { cleanup ||= effect(); }, useCallback: fn => fn };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, require: () => react, performance: { now: () => now }, setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, at: now + delay }); return id; }, clearTimeout: id => timers.delete(id) }, { filename: file });
  function render(a = () => single++, b = () => expanded++) { refIndex = 0; return module.exports.usePlayerBarGesture(a, b); }
  return { render, advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } }, dispose() { cleanup(); }, get single() { return single; }, get expanded() { return expanded; }, get pending() { return timers.size; } };
}
test('music bar single click waits, double click at initial clock zero expands exactly once', () => {
  const h = harness(), click = h.render(); click(); assert.equal(h.single, 0); h.advance(100); click(); h.advance(500); assert.equal(h.single, 0); assert.equal(h.expanded, 1); assert.equal(h.pending, 0);
});
test('separate bar clicks navigate individually and a triple click never causes two expansions', () => {
  const h = harness(), click = h.render(); click(); h.advance(331); assert.equal(h.single, 1); click(); h.advance(331); assert.equal(h.single, 2);
  click(); h.advance(50); click(); h.advance(50); click(); h.advance(331); assert.equal(h.expanded, 1); assert.equal(h.single, 3);
});
test('bar unmount cancels navigation and pending gesture uses latest render callbacks', () => {
  const h = harness(); h.render()(); let updated = 0; h.render(() => updated++); h.advance(331); assert.equal(updated, 1); assert.equal(h.single, 0);
  h.render()(); h.dispose(); h.advance(500); assert.equal(h.single, 0); assert.equal(h.pending, 0);
});
test('rendered queue is read-only for deletion, retaining explicit play and collection actions', () => {
  for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, file);
  require.extensions['.css'] = () => {};
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), QueuePanel = require('../src/ui/QueuePanel.tsx').default;
  const track = { id: 'fixture', title: 'Fixture', artist: 'Artist', path: '', source: 'local', duration: 90, audioUrl: '' };
  const html = renderToStaticMarkup(React.createElement(QueuePanel, { personal: { liked: [], favorites: [], history: [], playlists: [] }, tracks: [track], playlists: [], queue: [track], currentTrack: track,
    onPlayTrack() {}, onRemove() { throw Error('Delete must not be reachable'); }, onToggleSaved() {}, onAddToPlaylist() {}, onCreatePlaylist: async () => null, onOpenManager() {}, onClose() {} }));
  assert(html.includes('Fixture')); for (const label of ['喜欢', '收藏', '添加到歌单']) assert(html.includes(`aria-label="${label}"`)); assert(!/aria-label="(?:删除|移除)/.test(html)); assert(html.includes('歌曲删除请前往歌曲管理'));
});
