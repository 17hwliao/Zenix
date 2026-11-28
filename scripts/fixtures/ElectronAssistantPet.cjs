const{app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict'),path=require('node:path');
const{Assistant}=require('../../electron/runtime/assistant.cjs');
if(!process.env.ZENIX_PET_TEST_PROFILE)throw Error('isolated test profile required');
app.setPath('userData',process.env.ZENIX_PET_TEST_PROFILE);app.commandLine.appendSwitch('disable-gpu');
class HiddenPetWindow extends BrowserWindow{constructor(options){super({...options,show:false,webPreferences:{...options.webPreferences,offscreen:true}});}showInactive(){}show(){}}
app.whenReady().then(async()=>{
  let cursor={x:400,y:400};const dragScreen={getDisplayMatching:()=>({workArea:{x:0,y:0,width:1400,height:1000}}),getCursorScreenPoint:()=>cursor,getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1400,height:1000}})};
  const commands=[],pet=new Assistant({screen:dragScreen,folder:app.getPath('userData'),dialog:{},getWindow:()=>null,BrowserWindow:HiddenPetWindow,ipcMain,execute:async action=>commands.push(action)});await pet.load();await pet.invoke({action:'pet',enabled:true,music:true});const page=pet.window.webContents;
  await page.executeJavaScript('Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});document.dispatchEvent(new Event("visibilitychange"))');
  const wait=async code=>{for(let attempt=0;attempt<100;attempt++){if(await page.executeJavaScript(code))return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('pet state timeout '+code);};
  await wait('document.querySelector("#character canvas")?.dataset.renderer==="rig"');assert.equal(await page.executeJavaScript('document.querySelectorAll("#character canvas").length'),1,'Zenbot rig loads under the production CSP');
  const visible=await page.executeJavaScript('(()=>{const canvas=document.querySelector("#character canvas"),c=canvas.getContext("2d");return {corner:c.getImageData(0,0,1,1).data[3],pixels:Array.from(c.getImageData(0,0,canvas.width,canvas.height).data).filter((value,index)=>index%4===3&&value>0).length};})()');assert.equal(visible.corner,0);assert(visible.pixels>100);
  pet.motion.stop();pet.window.setPosition(200,200);const initial=pet.window.getBounds();const point=await page.executeJavaScript('(()=>{const b=document.getElementById("character").getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};})()');
  page.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});await new Promise(resolve=>setTimeout(resolve,40));cursor={x:440,y:420};page.sendInputEvent({type:'mouseMove',x:point.x+40,y:point.y+20});await wait('document.body.dataset.dragging==="true"');page.sendInputEvent({type:'mouseUp',x:point.x+40,y:point.y+20,button:'left',clickCount:1});await wait('document.body.dataset.dragging==="false"');assert.equal(pet.window.getBounds().x,initial.x+40);assert.equal(pet.window.getBounds().y,initial.y+20);assert.deepEqual(commands,[],'dragging the character cannot invoke playback or show');
  for(let index=0;index<100;index++){pet.motion.last-=32;pet.motion.tick();}
  assert.equal(pet.window.getBounds().y+pet.window.getBounds().height,1000,'released native drag settles at the work-area bottom');
  await page.executeJavaScript('document.getElementById("character").dispatchEvent(new PointerEvent("pointerenter",{bubbles:true}))');
  await wait('document.body.dataset.movement!=="walk"');
  await page.executeJavaScript('document.getElementById("character").dispatchEvent(new WheelEvent("wheel",{deltaY:-100,bubbles:true,cancelable:true}))');
  assert.equal(pet.figure.scale,.7,'ordinary scrolling never resizes a legacy pet');
  await page.executeJavaScript('document.getElementById("character").dispatchEvent(new WheelEvent("wheel",{deltaY:-100,ctrlKey:true,bubbles:true,cancelable:true}))');
  await wait('options.figure?.scale===.75&&document.querySelector("canvas")?.dataset.renderer==="rig"');
  assert.equal(pet.figure.scale,.75,'wheel adjusts the independent character scale');
  await page.executeJavaScript('document.getElementById("character").dispatchEvent(new PointerEvent("pointerleave",{bubbles:true}))');
  pet.update({playing:true});await wait('document.body.dataset.musical==="true"');pet.update({playing:false});await wait('document.body.dataset.musical==="false"');
  await pet.invoke({action:'configure',motion:'reduced'});await wait('document.body.dataset.animated==="false"');pet.update({playing:true});await wait('document.body.dataset.musical==="false"');
  await pet.invoke({action:'configure',motion:'full',locked:true});await wait('document.body.dataset.animated==="true"');assert.equal(await page.executeJavaScript('document.body.dataset.locked'),'true');
  const lockedBounds=pet.window.getBounds();page.sendInputEvent({type:'mouseDown',x:80,y:100,button:'left',clickCount:1});cursor={x:490,y:470};page.sendInputEvent({type:'mouseMove',x:120,y:140});page.sendInputEvent({type:'mouseUp',x:120,y:140,button:'left',clickCount:1});await new Promise(resolve=>setTimeout(resolve,50));assert.deepEqual(pet.window.getBounds(),lockedBounds);assert.deepEqual(commands,[],'attempted locked drag is not a click');
  await page.executeJavaScript('document.querySelector("[data-action=next]").click()');await wait('document.body.dataset.state==="success"');assert.deepEqual(commands,['next']);
  await page.executeJavaScript('Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"))');await wait('document.body.dataset.animated==="false"');
  pet.close();assert(!pet.window);process.stdout.write('ASSISTANT_PET_PASS\n');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
