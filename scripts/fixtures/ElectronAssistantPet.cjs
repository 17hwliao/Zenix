const{app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict'),path=require('node:path');
const{Assistant}=require('../../electron/runtime/assistant.cjs');
if(!process.env.ZENIX_PET_TEST_PROFILE)throw Error('isolated test profile required');
app.setPath('userData',process.env.ZENIX_PET_TEST_PROFILE);app.commandLine.appendSwitch('disable-gpu');
class HiddenPetWindow extends BrowserWindow{constructor(options){super({...options,show:false,webPreferences:{...options.webPreferences,offscreen:true}});}showInactive(){}show(){}}
app.whenReady().then(async()=>{
  let cursor={x:400,y:400};const dragScreen={getCursorScreenPoint:()=>cursor,getDisplayNearestPoint:()=>({workArea:{x:0,y:0,width:1400,height:1000}})};
  const commands=[],pet=new Assistant({screen:dragScreen,folder:app.getPath('userData'),dialog:{},getWindow:()=>null,BrowserWindow:HiddenPetWindow,ipcMain,execute:async action=>commands.push(action)});await pet.load();await pet.invoke({action:'pet',enabled:true,music:true});const page=pet.window.webContents;
  await page.executeJavaScript('Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});document.dispatchEvent(new Event("visibilitychange"))');
  const wait=async code=>{for(let attempt=0;attempt<100;attempt++){if(await page.executeJavaScript(code))return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('pet state timeout '+code);};
  await wait('Array.from(document.querySelectorAll("#character .pet-portrait img")).every(img=>img.complete&&img.naturalWidth===1086)');assert.equal(await page.executeJavaScript('document.querySelectorAll("#character .pet-portrait img").length'),5,'original Zenix portrait and blink load under the production CSP');
  const visible=await page.executeJavaScript('(()=>{const image=document.querySelector("#character img"),canvas=document.createElement("canvas");canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const c=canvas.getContext("2d");c.drawImage(image,0,0);return {corner:c.getImageData(0,0,1,1).data[3],center:c.getImageData(543,724,1,1).data[3]};})()');assert.equal(visible.corner,0);assert(visible.center>0);
  pet.window.setPosition(200,200);const initial=pet.window.getBounds();const point=await page.executeJavaScript('(()=>{const b=document.getElementById("character").getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)};})()');
  page.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});await new Promise(resolve=>setTimeout(resolve,40));cursor={x:440,y:420};page.sendInputEvent({type:'mouseMove',x:point.x+40,y:point.y+20});await wait('document.body.dataset.dragging==="true"');page.sendInputEvent({type:'mouseUp',x:point.x+40,y:point.y+20,button:'left',clickCount:1});await wait('document.body.dataset.dragging==="false"');assert.equal(pet.window.getBounds().x,initial.x+40);assert.equal(pet.window.getBounds().y,initial.y+20);assert.deepEqual(commands,[],'dragging the character cannot invoke playback or show');
  pet.update({playing:true});await wait('document.body.dataset.musical==="true"');pet.update({playing:false});await wait('document.body.dataset.musical==="false"');
  await pet.invoke({action:'configure',motion:'reduced'});await wait('document.body.dataset.animated==="false"');pet.update({playing:true});await wait('document.body.dataset.musical==="false"');
  await pet.invoke({action:'configure',motion:'full',locked:true});await wait('document.body.dataset.animated==="true"');assert.equal(await page.executeJavaScript('document.body.dataset.locked'),'true');
  const lockedBounds=pet.window.getBounds();page.sendInputEvent({type:'mouseDown',x:80,y:100,button:'left',clickCount:1});cursor={x:490,y:470};page.sendInputEvent({type:'mouseMove',x:120,y:140});page.sendInputEvent({type:'mouseUp',x:120,y:140,button:'left',clickCount:1});await new Promise(resolve=>setTimeout(resolve,50));assert.deepEqual(pet.window.getBounds(),lockedBounds);assert.deepEqual(commands,[],'attempted locked drag is not a click');
  await page.executeJavaScript('document.querySelector("[data-action=next]").click()');await wait('document.body.dataset.state==="success"');assert.deepEqual(commands,['next']);
  await page.executeJavaScript('Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"))');await wait('document.body.dataset.animated==="false"');
  pet.close();assert(!pet.window);process.stdout.write('ASSISTANT_PET_PASS\n');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
