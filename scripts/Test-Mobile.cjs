const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, file);
// These are shared React rendering checks; the native bridge is deliberately a
// stub. They are not Android/iOS device playback or memory measurements.
const load = Module._load;
Module._load = function (id, parent) {
  if (id === './native' && parent?.filename.includes('mobile')) return { isNativeMobile: false, readLyrics: async () => null };
  return load.apply(this, arguments);
};
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const StickerSpace = require('../src/mobile/StickerSpace.tsx').default;
for (const count of [0, 1, 25, 120, 500]) test(`mobile wall retains ${count} items but bounds mounted motion nodes`, () => {
  const songs = Array.from({ length: count }, (_, i) => ({ id: String(i), title: 'Fixture', artist: 'Artist', source: 'local', duration: 90, path: '', audioUrl: '' }));
  const html = renderToStaticMarkup(React.createElement(StickerSpace, {
    songs, state: { playback: { track: songs[0], playing: false, position: 0 } }, label: 'Fixture', play: () => {}, full: () => {}, actions: () => null, seek: () => {}, focusRequest: 0,
  }));
  const mounted = (html.match(/class="space-sticker /g) || []).length;
  assert(mounted <= 30); assert(mounted <= count);
  if (count) assert(html.includes('播放并聚焦 Fixture')); else assert.equal(mounted, 0);
  if (count === 500) assert.equal(mounted, 23);
});
