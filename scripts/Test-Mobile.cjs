const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const Module = require('node:module');
// Styles are processed by Vite in the real UI fixture; this suite checks SSR structure.
require.extensions['.css'] = () => {};
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
const { projectStickerLayout } = require('../src/mobile/stickerMotion.ts');

test('sticker interruption batches reads before writes and releases completed projections', t => {
  const previousMatrix=globalThis.DOMMatrixReadOnly,previousStyle=globalThis.getComputedStyle;
  t.after(()=>{if(previousMatrix===undefined)delete globalThis.DOMMatrixReadOnly;else globalThis.DOMMatrixReadOnly=previousMatrix;if(previousStyle===undefined)delete globalThis.getComputedStyle;else globalThis.getComputedStyle=previousStyle;});
  globalThis.DOMMatrixReadOnly=class { constructor(value){Object.assign(this,value?JSON.parse(value):{m41:0,m42:0,m11:1,m22:1});} };
  const events=[],frames=new Map();
  globalThis.getComputedStyle=element=>{events.push('read:'+element.id);return {transform:JSON.stringify({m41:8,m42:6,m11:.8,m22:.9})};};
  const active=id=>({playState:'running',cancel(){events.push('cancel:'+id);},onfinish:null,oncancel:null});
  const elements=new Map(['a','b'].map(id=>[id,{id,animate(keyframes,options){events.push('animate:'+id);frames.set(id,{keyframes,options});return active(id);}}]));
  const animations=new Map(['a','b'].map(id=>[id,active(id)]));
  const before=new Map(['a','b'].map(id=>[id,{left:10,top:20,width:100,height:80}]));
  const after=new Map(['a','b'].map(id=>[id,{left:30,top:40,width:200,height:160}]));
  projectStickerLayout(elements,before,after,animations,true);
  assert.deepEqual(events.slice(0,2),['read:a','read:b'],'no animation write between style reads');
  assert.equal(frames.get('a').keyframes[0].transform,'translate(-12px,-14px) scale(0.4,0.45)','interrupted position/size is continuous');
  assert.equal(frames.get('a').options.duration,580,'preserves original poster duration');
  const old=animations.get('a');
  projectStickerLayout(elements,after,before,animations,true);
  const replacement=animations.get('a');old.onfinish();assert.equal(animations.get('a'),replacement,'late finish cannot release a newer flight');
  replacement.onfinish();assert.equal(animations.has('a'),false,'completed animation releases its handle');
  animations.get('b').playState='finished';events.length=0;
  projectStickerLayout(elements,before,after,animations,true);
  assert.equal(events.some(value=>value.startsWith('read:')),false,'no style reads for finished flights');
  projectStickerLayout(elements,after,before,animations,false);assert.equal(animations.size,0,'suspension cancels all flights');
});
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
