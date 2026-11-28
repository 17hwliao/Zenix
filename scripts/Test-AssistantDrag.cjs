const test=require('node:test'),assert=require('node:assert/strict');
const {PetDrag}=require('../electron/runtime/pet-drag.cjs');
const {PetMotion}=require('../electron/runtime/pet-motion.cjs');

test('bottom motion turns at display edges, pauses for chat and pointer, and lands a released throw',()=>{
 let bounds={x:750,y:100,width:180,height:240},now=0,paused=false,reduced=false,walking=true;
 const frames=[];
 const win={isDestroyed:()=>false,getBounds:()=>({...bounds}),setPosition(x,y){bounds={...bounds,x,y};}};
 const motion=new PetMotion({getWindow:()=>win,screen:{getDisplayMatching:()=>({workArea:{x:-300,y:0,width:1300,height:800}})},canWalk:()=>walking,isPaused:()=>paused,reduced:()=>reduced,changed:value=>frames.push(value),now:()=>now});
 const step=(count=1)=>{for(let index=0;index<count;index++){now+=32;motion.tick();}};
 motion.start();motion.stop();assert.equal(bounds.y,560);
 step(100);assert.equal(motion.direction,-1);assert(bounds.x<=820);assert.equal(bounds.y,560);
 paused=true;const frozen=bounds.x;step(20);assert.equal(bounds.x,frozen);
 motion.dragStart();bounds={...bounds,x:0,y:100};step(10);assert.equal(bounds.y,100);
 motion.dragEnd({x:400,y:-100});step(100);assert.equal(bounds.y,560);assert(bounds.x>0);assert(frames.some(frame=>frame.mode==='landed'));
 paused=false;walking=false;step(100);assert.equal(motion.mode,'idle');
 motion.dragStart();bounds={...bounds,y:20};reduced=true;motion.dragEnd({x:9999,y:-9999});step();assert.equal(bounds.y,560);
 motion.interact('sleep');step(20);assert.equal(motion.mode,'sleep');motion.interact('stand');step(100);assert.equal(motion.mode,'idle');
});

test('native pointer release velocity uses recent trusted cursor samples and stale tokens cannot resume physics',()=>{
 let cursor={x:100,y:100},now=0,bounds={x:0,y:0,width:100,height:100};
 const window={isDestroyed:()=>false,getBounds:()=>bounds,setPosition(x,y){bounds={...bounds,x,y};}};
 const drag=new PetDrag({getWindow:()=>window,screen:{getCursorScreenPoint:()=>cursor,getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1000,height:800}})},isLocked:()=>false,now:()=>now});
 drag.handle({phase:'start',token:'active'});now=40;cursor={x:130,y:90};drag.handle({phase:'move',token:'active'});now=80;cursor={x:160,y:80};
 const result=drag.handle({phase:'end',token:'active'});assert.equal(result.moved,true);assert.equal(result.velocity.x,750);assert.equal(result.velocity.y,-250);
 assert.equal(drag.handle({phase:'end',token:'active'}).stale,true);
});

test('default and migrated figure settings select Zenbot while an explicit whale choice persists',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{Assistant}=require('../electron/runtime/assistant.cjs');
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-figure-migration-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
 const create=()=>new Assistant({folder,getWindow:()=>null,execute:async()=>{}});
 const defaults=create();await defaults.loadFigure();assert.equal(defaults.figure.id,'zenbot');assert.equal(defaults.figure.wandering,true);
 await fs.writeFile(path.join(folder,'assistant-figure.v1.json'),JSON.stringify({id:'xingyin',scale:.7,wandering:false}));
 const migrated=create();await migrated.loadFigure();assert.equal(migrated.figure.id,'zenbot');assert.equal(migrated.figure.wandering,true);
 await migrated.invoke({action:'figure',figure:'whale',scale:.8,wandering:false});
 const reopened=create();await reopened.loadFigure();assert.equal(reopened.figure.id,'whale');assert.equal(reopened.figure.wandering,false);
 await assert.rejects(reopened.invoke({action:'figure',figure:'xingyin',scale:.7}),/无效/);
});
test('pet dragging uses trusted DIP cursor deltas, clamps to displays and respects cancellation/lock',()=>{
 let cursor={x:-400,y:200},locked=false,bounds={x:-500,y:100,width:200,height:300},moves=0;
 const win={isDestroyed:()=>false,getBounds:()=>({...bounds}),setPosition(x,y){bounds={...bounds,x,y};moves++;}};
 const drag=new PetDrag({getWindow:()=>win,isLocked:()=>locked,screen:{getCursorScreenPoint:()=>cursor,getDisplayNearestPoint:()=>({workArea:{x:-1000,y:0,width:1000,height:800}})}});
 drag.handle({token:'gesture',phase:'start',x:999999});cursor={x:-398,y:201};assert.equal(drag.handle({token:'gesture',phase:'move'}).moved,false);assert.equal(moves,0);
 cursor={x:-350,y:230};assert.equal(drag.handle({token:'gesture',phase:'move'}).moved,true);assert.equal(bounds.x,-450);assert.equal(bounds.y,130);
 cursor={x:10000,y:10000};drag.handle({token:'gesture',phase:'end'});assert.equal(bounds.x,-200);assert.equal(bounds.y,500);assert.equal(drag.session,null);
 drag.handle({token:'gesture',phase:'start'});locked=true;cursor={x:0,y:0};assert.equal(drag.handle({token:'gesture',phase:'move'}).locked,true);assert.equal(drag.session,null);assert.equal(bounds.x,-200);
 locked=false;drag.handle({token:'gesture',phase:'start'});drag.handle({token:'gesture',phase:'cancel'});cursor={x:-900,y:0};drag.handle({token:'gesture',phase:'move'});assert.equal(bounds.x,-200);
 drag.handle({phase:'start',token:'new-gesture'});assert.equal(drag.handle({phase:'end',token:'old-gesture'}).stale,true);assert.equal(drag.session.token,'new-gesture');drag.cancel();
 assert.throws(()=>drag.handle({phase:'resize-main-window'}),/无效/);
});
