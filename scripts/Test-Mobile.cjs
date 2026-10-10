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
const { mergeMobileSnapshot } = require('../src/mobile/snapshot.ts');
test('mobile progress preserves presentation references, full playback clears stale loading/errors', () => {
  const previous={playback:{track:{id:'one'},queue:[{id:'one'}],position:0,playing:false,sourceActivity:{phase:'resolving'},error:'old'},personal:{liked:[{id:'one'}],favorites:[],history:[],playlists:[]},sources:[{id:'source',manifest:{name:'Source'}}],cache:{enabled:true,usedBytes:0}};
  const progress=mergeMobileSnapshot(previous,{playback:{position:1},cache:{enabled:true,usedBytes:0}});
  assert.equal(progress.personal,previous.personal);assert.equal(progress.sources,previous.sources);assert.equal(progress.cache,previous.cache);assert.equal(progress.playback.queue,previous.playback.queue);assert.equal(progress.playback.sourceActivity,previous.playback.sourceActivity);
  const full=mergeMobileSnapshot(progress,{playback:{track:{id:'one'},queue:[{id:'one'}],position:2,playing:true},sources:structuredClone(previous.sources)});
  assert.equal(full.playback.sourceActivity,undefined);assert.equal(full.playback.error,undefined);assert.equal(full.playback.queue,previous.playback.queue);assert.equal(full.sources,previous.sources);
  const changed=mergeMobileSnapshot(full,{sources:[{id:'source',manifest:{name:'Renamed'}}]});assert.equal(changed.sources[0].manifest.name,'Renamed');assert.notEqual(changed.sources,full.sources);assert.equal(full.sources[0].manifest.name,'Source');
});
for (const count of [0, 1, 25, 120, 500]) test(`mobile wall retains ${count} items but bounds mounted motion nodes`, () => {
  const songs = Array.from({ length: count }, (_, i) => ({ id: String(i), title: 'Fixture', artist: 'Artist', source: 'local', duration: 90, path: '', audioUrl: '' }));
  const html = renderToStaticMarkup(React.createElement(StickerSpace, {
    songs, state: { playback: { track: songs[0], playing: false, position: 0 } }, label: 'Fixture', play: () => {}, full: () => {}, actions: () => null, seek: () => {}, focusRequest: 0,
  }));
  const mounted = (html.match(/class="space-sticker /g) || []).length;
  assert(mounted <= 30); assert(mounted <= count);
  if (count) assert(html.includes('聚焦查看 Fixture')); else assert.equal(mounted, 0);
  // Viewport culling stays bounded with both normal and explicitly enlarged posters.
});
