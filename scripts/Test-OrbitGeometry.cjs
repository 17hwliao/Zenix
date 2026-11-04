const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const moduleValue={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../src/features/space/orbitGeometry.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:moduleValue,exports:moduleValue.exports});
const {orbitCapacity,orbitDragDelta,orbitLayout,orbitSlots,orbitProjection,overlaps,orbitHit,orbitPoint,orbitBrowseIndex}=moduleValue.exports;
const sizes=[[1440,720],[1440,420],[768,560],[390,530],[320,470],[320,320],[390,320],[768,300]];
test('projected music-space cards stay in bounds across both halves of every lane',()=>{
 for(const [w,h] of sizes)for(const scale of [.65,1,1.25])for(let phase=-2;phase<3;phase+=.125){
  const layout=orbitLayout(w,h,scale),phases=[phase,phase+.31,phase+.67,phase+.83],slots=orbitSlots(layout,[74,74,74,74],phases);
  assert(slots.length<=4*(orbitCapacity(layout)+2),'bounded stable buffer, independent of playlist length');
  for(const slot of slots){const p=orbitProjection(layout,slot.branch,slot.virtualIndex,phases[slot.branch],74);if(p.opacity<=.01)continue;assert(p.rect.x>=6&&p.rect.y>=6,JSON.stringify({w,h,p}));assert(p.rect.x+p.rect.width<=w-6&&p.rect.y+p.rect.height<=h-6,JSON.stringify({w,h,p}));assert(p.depth<0?p.zIndex<=10:p.zIndex>=10,'cover is between rear and front cards');}
 }
});
test('rear and front cards cross the central cover instead of disappearing on collision',()=>{
 const layout=orbitLayout(1440,720,1);let front=false,rear=false;
 for(let b=0;b<4;b++)for(let phase=0;phase<2;phase+=.025){for(let index=-1;index<7;index++){const p=orbitProjection(layout,b,index,phase,74);if(p.opacity>.2&&overlaps(p.rect,layout.focus,0)){if(p.depth>0)front=true;else rear=true;}}}
 assert(front&&rear,'both visible depth layers can overlap the central artwork');
});
test('lane identities survive phase boundaries and positions remain continuous',()=>{
 const layout=orbitLayout(1440,720,1);
 for(let b=0;b<4;b++)for(let boundary=-2;boundary<=3;boundary++){
  const before=orbitSlots(layout,[74,74,74,74],Array(4).fill(boundary-.00001)),after=orbitSlots(layout,[74,74,74,74],Array(4).fill(boundary+.00001));
  const shared=before.filter(slot=>after.some(next=>slot.key===next.key));assert(shared.length>=8);
  for(const slot of shared){const a=orbitProjection(layout,slot.branch,slot.virtualIndex,boundary-.00001,74),z=orbitProjection(layout,slot.branch,slot.virtualIndex,boundary+.00001,74);assert(Math.hypot(a.x-z.x,a.y-z.y)<.1);}
 }
});
test('each lane has distinct spacing and its endpoint selects that lane',()=>{
 const layout=orbitLayout(1440,720,1);assert.equal(orbitHit(layout,720,360),null);
 for(let b=0;b<4;b++){const p=orbitPoint(layout,b,0);assert.equal(orbitHit(layout,p.x,p.y),b);for(let other=b+1;other<4;other++){const q=orbitPoint(layout,other,0);assert(Math.hypot(p.x-q.x,p.y-q.y)>120,'outer lane ends have substantial separation');}}
 assert(new Set(layout.lanes.map(lane=>lane.ry.toFixed(3))).size===4);
});
test('branch browsing retains every song and appending preserves existing slots',()=>{
 for(const [w,h]of sizes){const l=orbitLayout(w,h,1);for(let branch=0;branch<4;branch++){const seen=new Set();for(let phase=-74;phase<74;phase++)seen.add(orbitBrowseIndex(phase,74));assert.equal(seen.size,74);}assert.equal(JSON.stringify(orbitSlots(l,[74,74,74,74],[3.1,2,5,8])),JSON.stringify(orbitSlots(l,[75,75,75,75],[3.1,2,5,8])));}
});
test('scale preference is observable and small queues retain stable unique identities',()=>{
 for(const [w,h]of sizes){const small=orbitLayout(w,h,.65),large=orbitLayout(w,h,1.25);assert(large.cardWidth>small.cardWidth*1.8);assert(large.cardHeight>small.cardHeight*1.8);assert(small.focus.height>=180);
  for(const count of [0,1,2,3])for(let phase=-1;phase<2;phase+=.125){const slots=orbitSlots(large,[count,0,0,0],[phase,0,0,0]);assert.equal(slots.length,count);assert.equal(new Set(slots.map(slot=>slot.index)).size,count);for(const slot of slots)assert(orbitProjection(large,0,slot.virtualIndex,phase,count).opacity>.2);}
 }
});

test('drag follows each ellipse tangent in both directions and across the wrap',()=>{
 const l=orbitLayout(1440,720,1);for(let branch=0;branch<4;branch++)for(const start of [-.4,0,1.7,3.10]){const a=orbitPoint(l,branch,start),b=orbitPoint(l,branch,start+.09);const f=orbitDragDelta(l,branch,a.x,a.y,b.x,b.y),r=orbitDragDelta(l,branch,b.x,b.y,a.x,a.y);assert(f<0&&r>0&&Math.abs(f+r)<1e-8);}
});
