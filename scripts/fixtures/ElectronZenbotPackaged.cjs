const {app, BrowserWindow} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

if (!process.env.ZENIX_TEST_PACKAGE || !process.env.ZENIX_TEST_USER_DATA) throw Error('Packaged smoke test requires isolated paths');
const profile = process.env.ZENIX_TEST_USER_DATA;
fs.mkdirSync(path.join(profile, 'client'), {recursive: true});
app.setPath('appData', profile);
app.setPath('userData', path.join(profile, 'client'));
app.setName('Zenix Zenbot Package Check');
const errors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.setAudioMuted(true);
  contents.on('render-process-gone', (_event, details) => errors.push(details.reason));
  contents.on('console-message', details => {if (details.level === 'error' && !/Failed to load resource|net::ERR/.test(details.message)) errors.push(details.message);});
});
require(path.join(process.env.ZENIX_TEST_PACKAGE, 'resources/app.asar/electron/main.cjs'));

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(check) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {const result = await check();if (result) return result;await pause(50);}
  throw Error('Packaged entry timed out\n' + errors.join('\n'));
}

app.whenReady().then(async () => {
  const host = await wait(() => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/dist/index.html')));
  await wait(() => host.webContents.executeJavaScript('!!window.yzqxy?.assistantChat'));
  host.setContentSize(1440,960);
  fs.mkdirSync(path.resolve('release/native-destinations'),{recursive:true});
  await wait(() => host.webContents.executeJavaScript('!!document.querySelector("[data-destination=tasks]")'));
  await wait(() => host.webContents.executeJavaScript('!document.querySelector(".zenix-intro")'));
  await host.webContents.executeJavaScript('document.querySelector(".zenix-onboarding-skip")?.click()');
  await wait(() => host.webContents.executeJavaScript('!document.querySelector(".zenix-onboarding")'));
  await host.webContents.executeJavaScript('document.querySelector("[data-destination=settings]").click()');
  await wait(() => host.webContents.executeJavaScript('!!document.querySelector(".yz-settings-redesign")'));
  assert.equal(await host.webContents.executeJavaScript('getComputedStyle(document.querySelector(".yz-settings-category-tabs")).backgroundColor'),'rgb(7, 12, 21)','settings sidebar uses the default Neon palette');
  await wait(() => host.webContents.executeJavaScript('getComputedStyle(document.querySelector(".yz-settings-layer")).opacity==="1"'));
  await pause(100);await host.webContents.capturePage().then(image=>fs.writeFileSync(path.resolve('release/native-destinations/ui-migration-settings.png'),image.toPNG()));
  await host.webContents.executeJavaScript('document.querySelector("[aria-label=关闭设置]").click()');
  await wait(() => host.webContents.executeJavaScript('!document.querySelector(".yz-settings-redesign")'));
  await host.webContents.executeJavaScript('window.dispatchEvent(new Event("zenix-open-search"))');
  await wait(() => host.webContents.executeJavaScript('!!document.querySelector(".yz-search-overlay")'));
  assert.equal(await host.webContents.executeJavaScript('getComputedStyle(document.querySelector(".yz-search-overlay")).backgroundColor'),'rgb(7, 12, 21)','search uses the default Neon palette');
  await pause(250);await host.webContents.capturePage().then(image=>fs.writeFileSync(path.resolve('release/native-destinations/ui-migration-search.png'),image.toPNG()));
  await host.webContents.executeJavaScript('document.querySelector(".yz-search-close").click()');
  await wait(() => host.webContents.executeJavaScript('!document.querySelector(".yz-search-overlay")'));
  for(const [destination,selector] of [['liked','.zenix-manager'],['playlists','.zenix-manager'],['history','.zenix-manager'],['library','.zenix-local-library'],['tasks','.zenix-offline-tasks'],['connections','.zenix-connections'],['assistant','.zenix-assistant-panel'],['karaoke','.zenix-karaoke-modes']]){
    await host.webContents.executeJavaScript(`(()=>{const button=document.querySelector('[data-destination=${destination}]');button.scrollIntoView({block:'nearest'});button.click();})()`);
    await wait(() => host.webContents.executeJavaScript(`!!document.querySelector('${selector}')`));
    assert.equal(await host.webContents.executeJavaScript('document.querySelectorAll(".zenix-feature-backdrop,.zenix-manager[aria-modal=true]").length'),0,'packaged desktop navigation keeps the native page shell');
    assert.equal(await host.webContents.executeJavaScript(`document.querySelector('[data-destination=${destination}]').getAttribute('aria-current')`),'page');
    const reach=await host.webContents.executeJavaScript(`(()=>{const button=document.querySelector('[data-destination=${destination}]'),r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {reachable:hit?.closest('button')===button,rect:r.toJSON(),hit:hit?.outerHTML?.slice(0,300)};})()`);
    if(!reach.reachable)await host.webContents.capturePage().then(image=>fs.writeFileSync(path.resolve('release/native-destinations/packaged-blocked.png'),image.toPNG()));
    assert.equal(reach.reachable,true,'packaged sidebar is actually reachable after startup '+destination+' '+JSON.stringify(reach));
    if(['tasks','connections','assistant'].includes(destination)){
      await wait(() => host.webContents.executeJavaScript('Array.from(document.querySelectorAll(".zenix-workspace-title,.zenix-workspace-body,.zenix-feature-content>div>section")).every(node=>getComputedStyle(node).opacity==="1")'));
      host.webContents.invalidate();await pause(120);
      await host.webContents.capturePage().then(image => fs.writeFileSync(path.resolve('release/native-destinations/packaged-'+destination+'.png'),image.toPNG()));
    }
  }
  await host.webContents.executeJavaScript('document.querySelector("[data-destination=home]").click()');
  await wait(() => host.webContents.executeJavaScript('!!document.querySelector(".zenix-desktop-home")'));
  await wait(() => host.webContents.executeJavaScript('window.yzqxy.assistantChat.invoke({action:"snapshot"}).then(value=>!!value.snapshot?.chat)'));
  const config = await host.webContents.executeJavaScript('window.yzqxy.assistantModel.invoke({action:"read"})');
  assert.equal(config.keyPresent, false);
  const defaultFigure = await host.webContents.executeJavaScript('window.yzqxy.companion.invoke({operation:"assistant",action:"state"})');
  assert.equal(defaultFigure.figure.id,'zenbot');
  await wait(() => host.webContents.executeJavaScript('document.querySelector(".assistant-corner-layer")?.dataset.scope==="application"&&document.querySelector(".assistant-corner-character canvas")?.dataset.renderer==="rig"'));
  assert.equal(BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith('/electron/assistant-pet.html')),false,'normal startup keeps the character inside the application');
  assert.equal(await host.webContents.executeJavaScript('(()=>{const r=document.querySelector(".assistant-corner-character").getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})()'),true,'packaged application character stays within the client viewport');
  // Explicit legacy bridge regression below; this is not the normal application entry.
  await host.webContents.executeJavaScript('window.yzqxy.companion.invoke({operation:"assistant",action:"figure",figure:"zenbot",scale:.7})');
  await host.webContents.executeJavaScript('window.yzqxy.companion.invoke({operation:"assistant",action:"pet",enabled:true})');
  const pet = await wait(() => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/electron/assistant-pet.html')));
  await wait(() => pet.webContents.executeJavaScript('document.querySelector("canvas")?.dataset.renderer==="rig"'));
  await wait(() => pet.webContents.executeJavaScript('document.documentElement.dataset.bentoStyle==="neon"'));
  const area = require('electron').screen.getDisplayMatching(pet.getBounds()).workArea;
  // The first Windows resize can settle its DIP height on the next native tick.
  await wait(() => pet.getBounds().y+pet.getBounds().height===area.y+area.height);
  assert.equal(pet.getBounds().y+pet.getBounds().height,area.y+area.height);
  await host.webContents.executeJavaScript('window.yzqxy.companion.invoke({operation:"assistant",action:"figure",figure:"whale",scale:.7})');
  await wait(() => pet.webContents.executeJavaScript('document.querySelector("canvas")?.dataset.figure==="whale"&&document.querySelector("canvas")?.dataset.renderer==="rig"'));
  await host.webContents.executeJavaScript('window.yzqxy.companion.invoke({operation:"assistant",action:"figure",figure:"zenbot",scale:.7})');
  await host.webContents.executeJavaScript('window.yzqxy.assistantChat.invoke({action:"toggle"})');
  const pocket = await wait(() => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('assistant-pocket=1')));
  await wait(() => pocket.webContents.executeJavaScript('!!document.querySelector(".zenix-chat-input textarea")'));
  await host.webContents.executeJavaScript(`localStorage.setItem('zenix.ui-appearance.v1',JSON.stringify({version:1,mode:'dark',style:'glass',accent:'cyan',frame:false,button:'outline',buttonFrame:false,radius:18,stroke:2,depth:3,height:44,motion:true}));window.dispatchEvent(new Event('zenix:appearance-changed'));`);
  await wait(() => pet.webContents.executeJavaScript('document.documentElement.dataset.bentoStyle==="glass"&&document.documentElement.dataset.bentoAccent==="cyan"'));
  await wait(() => pocket.webContents.executeJavaScript('document.documentElement.dataset.bentoStyle==="glass"&&document.documentElement.dataset.bentoAccent==="cyan"'));
  assert.equal(await pet.webContents.executeJavaScript('getComputedStyle(document.querySelector("nav button")).borderRadius'),'18px','packaged native pet follows the same appearance');
  await host.webContents.executeJavaScript(`localStorage.removeItem('zenix.ui-appearance.v1');window.dispatchEvent(new Event('zenix:appearance-changed'));`);
  await wait(() => pocket.webContents.executeJavaScript('document.documentElement.dataset.bentoStyle==="neon"'));
  const pocketConfig = await pocket.webContents.executeJavaScript('window.yzqxy.assistantModel.invoke({action:"read"})');
  assert.equal(pocketConfig.keyPresent,false,'real native window gate allows masked pocket configuration');
  assert.equal(await pocket.webContents.executeJavaScript('window.yzqxy.assistantModel.invoke({action:"request"}).then(()=>"allowed",error=>error.message.includes("无权调用远程音乐助手")?"denied":error.message)'), 'denied','pocket cannot bypass the single conversation owner to request a model');
  const probeImage = require('electron').nativeImage.createFromBitmap(Buffer.from([0,180,0,255]),{width:1,height:1}).toPNG().toString('base64');
  const probeAttachment = await pocket.webContents.executeJavaScript(`window.yzqxy.assistantModel.invoke({action:'attachmentImport',value:{name:'isolated-image.png',base64:${JSON.stringify(probeImage)}}})`);
  assert.match(await pocket.webContents.executeJavaScript(`window.yzqxy.assistantModel.invoke({action:'attachmentPreview',attachmentId:${JSON.stringify(probeAttachment.id)}})`),/^data:image\//);
  await pocket.webContents.executeJavaScript(`window.yzqxy.assistantModel.invoke({action:'attachmentRemove',attachmentId:${JSON.stringify(probeAttachment.id)}})`);
  await pocket.webContents.executeJavaScript('document.querySelector("[aria-label=模型连接设置]").click()');
  await wait(() => pocket.webContents.executeJavaScript('document.querySelector(".remote-model-settings fieldset")?.disabled===false'));
  assert.equal(await pocket.webContents.executeJavaScript('!!document.querySelector(".remote-model-error")'),false);
  await pocket.webContents.executeJavaScript('document.querySelector("[aria-label=模型连接设置]").click()');
  await wait(() => pocket.webContents.executeJavaScript('!!document.querySelector(".zenix-chat-input textarea")'));
  await pocket.webContents.executeJavaScript(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'目录包中的共享草稿');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(() => host.webContents.executeJavaScript('window.yzqxy.assistantChat.invoke({action:"snapshot"}).then(value=>value.snapshot.chat.draft.text==="目录包中的共享草稿")'));
  await wait(() => fs.existsSync(path.join(profile, 'client/assistant-conversations.v1.json')));
  const history = JSON.parse(fs.readFileSync(path.join(profile, 'client/assistant-conversations.v1.json'), 'utf8'));
  assert.equal(history.conversations[0].draft.text, '目录包中的共享草稿');
  assert.equal(errors.length, 0, errors.join('\n'));
  await pet.webContents.executeJavaScript('document.getElementById("character").focus()');
  await wait(() => pet.webContents.executeJavaScript('getComputedStyle(document.querySelector("nav")).opacity==="1"'));
  await pet.webContents.capturePage().then(image => fs.writeFileSync(path.resolve('release/zenbot-packaged-pet-controls.png'), image.toPNG()));
  await wait(() => pocket.webContents.executeJavaScript('getComputedStyle(document.querySelector(".zenix-pocket-chat")).opacity==="1"'));
  await pocket.webContents.capturePage().then(image => fs.writeFileSync(path.resolve('release/zenbot-packaged-pocket.png'), image.toPNG()));
  process.stdout.write('ZENBOT_PACKAGED_PASS\n');
  app.quit();
}).catch(error => {console.error(error);app.exit(1);});
