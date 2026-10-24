const test=require('node:test'),assert=require('node:assert/strict');
const {PetDrag}=require('../electron/runtime/pet-drag.cjs');
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
