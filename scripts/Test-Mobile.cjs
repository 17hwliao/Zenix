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
const { StickerCameraGesture,MIN_STICKER_SCALE,MAX_STICKER_SCALE } = require('../src/mobile/stickerCamera.ts');

test('sticker pinch keeps the touched world point under its midpoint and clamps zoom',()=>{
  const gesture=new StickerCameraGesture(),camera={x:-120,y:-180,scale:1},bounds={left:-1000,top:-1000,right:1000,bottom:1000},size={width:390,height:700};
  gesture.down(1,{x:100,y:100},camera);gesture.down(2,{x:200,y:100},camera);
  const enlarged=gesture.move(2,{x:300,y:100},bounds,size);
  assert.equal(enlarged.scale,2);assert.equal((200-enlarged.x)/enlarged.scale,(150-camera.x)/camera.scale);assert.equal((100-enlarged.y)/enlarged.scale,(100-camera.y)/camera.scale);
  assert.equal(gesture.move(2,{x:1000,y:100},bounds,size).scale,MAX_STICKER_SCALE);
  assert.equal(gesture.move(2,{x:105,y:100},bounds,size).scale,MIN_STICKER_SCALE);
  assert.equal(gesture.down(3,{x:180,y:100},enlarged),false);assert.equal(gesture.count,2,'third finger cannot rebase an active pinch');
});

test('lifting one pinch finger rebases dragging without a jump; cancellation clears active pointers',()=>{
  const gesture=new StickerCameraGesture(),bounds={left:-1000,top:-1000,right:1000,bottom:1000},size={width:390,height:700};
  gesture.down(1,{x:100,y:100},{x:0,y:0,scale:1});gesture.down(2,{x:200,y:100},{x:0,y:0,scale:1});
  const enlarged=gesture.move(2,{x:250,y:100},bounds,size);gesture.up(2,enlarged);
  const dragged=gesture.move(1,{x:111,y:106},bounds,size);assert.equal(dragged.x,enlarged.x+11);assert.equal(dragged.y,enlarged.y+6);assert.equal(dragged.scale,enlarged.scale);
  gesture.cancel();assert.equal(gesture.count,0);assert.equal(gesture.move(1,{x:400,y:400},bounds,size),undefined);
  gesture.down(4,{x:100,y:100},dragged);assert.equal(gesture.move(4,{x:105,y:102},bounds,size),undefined,'fresh taps keep their drag threshold');
});

test('an edge poster centered by focus can begin panning back into bounds continuously',()=>{
  const gesture=new StickerCameraGesture();gesture.down(1,{x:100,y:100},{x:0,y:0,scale:1});
  const moved=gesture.move(1,{x:109,y:110},{left:0,top:0,right:100,bottom:100},{width:390,height:700});
  assert.equal(moved.x,9);assert.equal(moved.y,10,'first pan frame must not jump to the overall mosaic center');
});

test('Android real source host supports Buffer checks on JSON responses and encoded buffers', async () => {
  const vm = require('node:vm'), results=[];
  const host=vm.createContext({TextEncoder,TextDecoder,atob,btoa,NativeHost:{ready(){},result(raw){results.push(JSON.parse(raw));}},__scriptInfo:{}});
  vm.runInContext(fs.readFileSync(require('node:path').resolve(__dirname,'../android/app/src/main/assets/zenix/host.js'),'utf8'),host);
  vm.runInContext(`lx.on(lx.EVENT_NAMES.request,()=>{const json={code:200,data:{url:'https://audio.example.test/track.mp3'}};if(Buffer.isBuffer(json))throw Error('JSON classified as binary');return json.data.url;});lx.send(lx.EVENT_NAMES.inited,{});`,host);
  await vm.runInContext(`__invoke(1,'lx',{},{});`,host);
  assert.equal(results[0].error,undefined);assert.equal(results[0].value,'https://audio.example.test/track.mp3');
  assert.equal(vm.runInContext(`Buffer.isBuffer(Buffer.from('歌曲')) && !Buffer.isBuffer(new Uint8Array([1,2])) && Buffer.from('歌曲').toString()==='歌曲'`,host),true);
});

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
