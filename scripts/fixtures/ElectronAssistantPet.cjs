const{app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict'),path=require('node:path');
const{Assistant}=require('../../electron/runtime/assistant.cjs');
if(!process.env.ZENIX_PET_TEST_PROFILE)throw Error('isolated test profile required');
app.setPath('userData',process.env.ZENIX_PET_TEST_PROFILE);app.commandLine.appendSwitch('disable-gpu');
class HiddenPetWindow extends BrowserWindow{constructor(options){super({...options,show:false,webPreferences:{...options.webPreferences,offscreen:true}});}showInactive(){}show(){}}
app.whenReady().then(async()=>{
  const commands=[],pet=new Assistant({folder:app.getPath('userData'),dialog:{},getWindow:()=>null,BrowserWindow:HiddenPetWindow,ipcMain,execute:async action=>commands.push(action)});await pet.load();await pet.invoke({action:'pet',enabled:true,music:true});const page=pet.window.webContents;
  await page.executeJavaScript('Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});document.dispatchEvent(new Event("visibilitychange"))');
  const wait=async code=>{for(let attempt=0;attempt<100;attempt++){if(await page.executeJavaScript(code))return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('pet state timeout '+code);};
  assert.equal(await page.executeJavaScript('document.querySelectorAll("#character svg .pet-body").length'),1,'default is the original drawn character');
  pet.update({playing:true});await wait('document.body.dataset.musical==="true"');pet.update({playing:false});await wait('document.body.dataset.musical==="false"');
  await pet.invoke({action:'configure',motion:'reduced'});await wait('document.body.dataset.animated==="false"');pet.update({playing:true});await wait('document.body.dataset.musical==="false"');
  await pet.invoke({action:'configure',motion:'full',locked:true});await wait('document.body.dataset.animated==="true"');assert.equal(await page.executeJavaScript('document.getElementById("grip").style.webkitAppRegion'),'no-drag');
  await page.executeJavaScript('document.querySelector("[data-action=next]").click()');await wait('document.body.dataset.state==="success"');assert.deepEqual(commands,['next']);
  await page.executeJavaScript('Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"))');await wait('document.body.dataset.animated==="false"');
  pet.close();assert(!pet.window);process.stdout.write('ASSISTANT_PET_PASS\n');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
