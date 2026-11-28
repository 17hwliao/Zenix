const {app, BrowserWindow, ipcMain, screen, globalShortcut, nativeImage} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const {AssistantChat} = require('../../electron/runtime/assistant-chat.cjs');
const {AssistantModel} = require('../../electron/runtime/assistant-model.cjs');
const {Assistant} = require('../../electron/runtime/assistant.cjs');
app.setPath('userData', process.env.ZENIX_TEST_USER_DATA);
app.disableHardwareAcceleration();
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_event, details) => process.stderr.write('RENDERER_GONE ' + JSON.stringify(details) + '\n'));
  contents.on('console-message', details => {if (details.level === 'error') process.stderr.write('RENDERER ' + details.message + '\n');});
});

const json = value => new Response(JSON.stringify({choices: [{finish_reason: value.tool_calls ? 'tool_calls' : 'stop', message: value}]}), {headers: {'content-type': 'application/json'}});
const tool = (name, args) => json({content: null, tool_calls: [{id: 'call_' + name, type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const inputText = messages => {
  const content = messages.filter(message => message.role === 'user').at(-1).content;
  return typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('');
};
let host, chat, model, pet, requests = 0, imageRequests = 0;
const operations = [];
const evaluate = (window, code) => window.webContents.executeJavaScript(code, true);
async function wait(window, condition, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {if (await evaluate(window, condition)) return;await new Promise(resolve => setTimeout(resolve, 30));}
  throw Error('UI timed out ' + condition + '\n' + await evaluate(window, 'document.body.innerText'));
}
async function send(window, text) {
  await evaluate(window, `(()=>{const input=document.querySelector('.zenix-chat-input textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(window, `document.querySelector('.zenix-chat-input textarea').value===${JSON.stringify(text)}`);
  await new Promise(resolve => setTimeout(resolve, 90));
  await evaluate(window, 'document.querySelector(".zenix-chat-composer").requestSubmit()');
}

app.whenReady().then(async () => {
  host = new BrowserWindow({width: 900, height: 720, show: false, webPreferences: {preload: path.resolve('electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false}});
  host.webContents.on('console-message', (_event, level, message) => {if (level >= 3) process.stderr.write(message + '\n');});
  pet = new Assistant({folder: app.getPath('userData'), dialog: {}, getWindow: () => host, BrowserWindow, ipcMain, screen, execute: async () => {}});
  await pet.load();
  await pet.invoke({action: 'figure', figure: 'zenbot', scale: .7});
  chat = new AssistantChat({getHost: () => host, getPet: () => pet.window, BrowserWindow, ipcMain, screen, globalShortcut, onVisibility: value => pet.setChatOpen(value)});
  pet.openChat = () => chat.toggle();
  model = new AssistantModel({folder: app.getPath('userData'), protection: {encodeProtected: async value => JSON.stringify({value}), decodeProtected: async text => ({value: JSON.parse(text).value, legacy: false})}, onDelta: value => host.webContents.send('assistant-model:delta', value), request: async (_url, options) => {
    requests++;
    const body = JSON.parse(options.body), text = inputText(body.messages);
    const last = body.messages.at(-1);
    if (text.includes('创建歌单')) return tool('playlist_create', {name: '隔离测试歌单'});
    if (text.includes('30%')) return tool('playback_set_volume', {value: .3});
    if (text.includes('Butter-Fly')) {
      if (last.role === 'tool' && body.messages.at(-2).tool_calls[0].function.name === 'music_search') return tool('music_play_result', {candidateRef: JSON.parse(last.content).candidates[0].ref});
      return tool('music_search', {query: '和田光司 Butter-Fly', limit: 5});
    }
    if (text.includes('20 分钟')) return tool('timer_configure', {action: 'set', minutes: 20});
    const images = body.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_url') : []);
    if (images.length) {
      imageRequests++;
      const image = nativeImage.createFromDataURL(images[0].image_url.url);
      assert(!image.isEmpty());assert(image.getSize().width <= 2048);
      const pixel = image.toBitmap();if (text === '描述图片') assert(pixel[1] > pixel[0] && pixel[1] > pixel[2], 'green test pixels reach the model boundary');
    }
    if (!body.stream) return json({content: images.length ? '图中是绿色方块。' : '普通问题的回答。'});
    const parts = [images.length ? '图中是' : '普通问题', images.length ? '绿色方块。' : '的回答。'];
    return new Response(new ReadableStream({async start(controller) {
      for (const content of parts) {controller.enqueue(Buffer.from('data: ' + JSON.stringify({choices: [{index: 0, delta: {content}, finish_reason: null}]}) + '\n\n'));await new Promise(resolve => setTimeout(resolve, 90));}
      controller.enqueue(Buffer.from('data: ' + JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: 'stop'}]}) + '\n\ndata: [DONE]\n\n'));controller.close();
    }}), {headers: {'content-type': 'text/event-stream'}});
  }});
  await model.configure({enabled: true, endpoint: 'https://model.example/v1', model: 'fixture', apiKey: 'fixture-key'});
  ipcMain.handle('assistant-model:invoke', (event, args) => {
    assert(event.sender === host.webContents || event.sender === chat.window?.webContents);
    return model.invoke(args);
  });
  ipcMain.handle('companion:invoke', (_event, args) => {
    operations.push(args);
    if (args.action === 'timerSet') return {minutes: args.minutes};
    return true;
  });
  await host.loadURL(process.env.ZENIX_DEV_SERVER_URL + '/scripts/fixtures/zenbot-host.html');
  await wait(host, '!!window.zenbotTest?.session.getSnapshot().chat');
  await wait(host, 'document.querySelector("canvas")?.dataset.renderer==="rig"');
  const visuals = await evaluate(host, `(async()=>{
    const canvas=document.createElement('canvas');canvas.style.cssText='width:160px;height:220px';document.body.append(canvas);
    const rig=new window.ZenixZenbot.Renderer(canvas,new URL('/assistant/zenbot',location.href).href);await rig.ready;
    const frames=[];
    for(const motion of window.ZenixZenbot.motions){rig.setState('idle',{motion,animated:true});rig.started=performance.now()-400;rig.draw();frames.push(canvas.toDataURL());}
    for(const expression of window.ZenixZenbot.expressions)await rig.face(expression);
    const parts=rig.manifest.parts.length;rig.dispose();canvas.remove();
    return {motions:frames.length,variants:new Set(frames).size,expressions:window.ZenixZenbot.expressions.length,parts};
  })()`);
  assert.deepEqual({motions: visuals.motions, expressions: visuals.expressions, parts: visuals.parts}, {motions:18, expressions:19, parts:18});
  assert(visuals.variants>=12, 'motion transforms change rendered pixels');
  const whale = await evaluate(host, `(async()=>{
    const canvas=document.createElement('canvas');canvas.style.cssText='width:160px;height:220px';document.body.append(canvas);
    const renderer=new window.ZenixZenbot.Renderer(canvas,new URL('/assistant/whale',location.href).href,{figure:'whale'});await renderer.ready;renderer.draw();
    const result={figure:canvas.dataset.figure,renderer:canvas.dataset.renderer,parts:renderer.manifest?.parts.length,pixels:canvas.toDataURL().length};
    renderer.dispose();canvas.remove();return result;
  })()`);
  assert.equal(whale.figure,'whale');assert.equal(whale.renderer,'rig');assert(whale.parts>18);assert(whale.pixels>3000);
  await chat.toggle();
  const pocket = chat.window;
  await wait(pocket, '!!document.querySelector(".zenix-chat-input textarea")');
  await wait(pocket, 'getComputedStyle(document.querySelector(".zenix-pocket-chat")).opacity==="1"&&document.querySelector(".zenix-chat-welcome-portrait img")?.complete&&document.querySelector(".zenix-chat-welcome-portrait img")?.naturalWidth>0');
  await pocket.webContents.capturePage().then(image => fs.writeFile(path.resolve('release/zenbot-pocket-welcome.png'), image.toPNG()));
  await evaluate(pocket, `document.querySelector('.zenix-chat-suggestions button').click()`);
  await wait(host, 'window.zenbotTest.session.getSnapshot().chat.draft.text.includes("Butter-Fly")');
  assert.equal(requests,0,'suggestion fills a draft without a model call or music action');
  await evaluate(pocket, `document.querySelector('.zenix-chat-toolbar button').click()`);
  await wait(pocket, '!!document.querySelector(".zenix-chat-drawer")');
  await evaluate(pocket, `document.querySelector('.zenix-chat-workspace').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);
  assert(!await evaluate(pocket, '!!document.querySelector(".zenix-chat-drawer")'));
  assert(pocket.isVisible(),'Escape closes history before hiding the pocket');
  await pocket.webContents.debugger.attach('1.3');
  await pocket.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert.equal(await evaluate(pocket, 'getComputedStyle(document.querySelector(".zenix-pocket-chat")).animationName'), 'none');
  await pocket.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});pocket.webContents.debugger.detach();
  await send(pocket, '解释彩虹形成的原因');
  await wait(pocket, 'document.querySelector(".zenix-chat-message.is-assistant")?.textContent.includes("普通问题的回答")');
  await wait(host, 'window.zenbotTest.session.getSnapshot().status==="completed"');
  assert.equal(requests, 1);
  await evaluate(pocket, `(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'保留草稿');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(host, 'window.zenbotTest.session.getSnapshot().chat.draft.text==="保留草稿"');
  await chat.invoke({sender: pocket.webContents}, {action: 'hide'});
  await chat.toggle();
  assert.equal(await evaluate(pocket, 'document.querySelector("textarea").value'), '保留草稿');

  const green = nativeImage.createFromBitmap(Buffer.from([0, 220, 0, 255, 0, 220, 0, 255, 0, 220, 0, 255, 0, 220, 0, 255]), {width: 2, height: 2});
  const png = [...green.toPNG()];
  for (const kind of ['select', 'paste', 'drop']) {
    await evaluate(host, `window.zenbotTest.session.selectConversation()`);
    await wait(pocket, '!document.querySelector(".zenix-chat-message")');
    await evaluate(pocket, `(()=>{const file=new File([Uint8Array.from(${JSON.stringify(png)})],'green.png',{type:'image/png'});const transfer=new DataTransfer();transfer.items.add(file);${kind === 'select' ? "const input=document.querySelector('input[type=file]');Object.defineProperty(input,'files',{configurable:true,value:transfer.files});input.dispatchEvent(new Event('change',{bubbles:true}));" : kind === 'paste' ? "const event=new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true});document.querySelector('textarea').dispatchEvent(event);" : "document.querySelector('.zenix-chat-workspace').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));"}})()`);
    await wait(pocket, 'document.querySelector(".zenix-chat-composer .zenix-chat-attachments img")');
    await send(pocket, '描述图片');
    await wait(pocket, 'document.querySelector(".zenix-chat-message.is-assistant")?.textContent.includes("绿色方块")');
  }
  assert.equal(imageRequests, 3);
  const originId = await evaluate(host, 'window.zenbotTest.session.getSnapshot().chat.activeId');
  const originalImport = model.attachments.import.bind(model.attachments);
  let releaseImport, importArrived, lateImage;
  const arrived = new Promise(resolve => {importArrived = resolve;});
  const gate = new Promise(resolve => {releaseImport = resolve;});
  model.attachments.import = async value => {lateImage = await originalImport(value);importArrived();await gate;return lateImage;};
  await evaluate(pocket, `(()=>{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(${JSON.stringify(png)})],'late.png',{type:'image/png'}));document.querySelector('.zenix-chat-workspace').dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));})()`);
  await arrived;
  await evaluate(host, 'window.zenbotTest.session.selectConversation()');
  await wait(pocket, `document.querySelector('textarea').value===''&&!document.querySelector('.zenix-chat-message')`);
  const nextId = await evaluate(host, 'window.zenbotTest.session.getSnapshot().chat.activeId');
  assert.notEqual(nextId, originId);
  releaseImport();
  await wait(pocket, '!document.querySelector(".zenix-chat-attach").disabled');
  assert.equal(await evaluate(host, 'window.zenbotTest.session.getSnapshot().chat.draft.attachments.length'), 0, 'late import must not attach an old conversation image to the new draft');
  await assert.rejects(fs.access(model.attachments.file(lateImage.id)), {code:'ENOENT'});
  model.attachments.import = originalImport;
  const thinPng = nativeImage.createFromBitmap(Buffer.alloc(4 * 4000), {width:1,height:4000}).toPNG();
  const thin = await model.attachments.import({name:'thin.png',base64:thinPng.toString('base64')});
  assert.equal(thin.width,1,'valid thin images retain at least one pixel after resizing');assert.equal(thin.height,2048);
  await model.attachments.remove(thin.id);
  assert.equal((await model.test(require('node:crypto').randomUUID(), 'image')).ok, true);
  await send(pocket, '创建歌单隔离测试歌单');
  await wait(host, '!!window.zenbotTest.session.getSnapshot().confirmation');
  await wait(pocket, '!!document.querySelector(".assistant-plan")');
  const token = await evaluate(host, 'window.zenbotTest.session.getSnapshot().confirmation.token');
  await Promise.all([evaluate(host, `window.zenbotTest.session.confirm(${JSON.stringify(token)})`), chat.invoke({sender: pocket.webContents}, {action: 'confirm', args: [token]})]);
  await wait(host, 'window.zenbotTest.session.getSnapshot().status==="completed"');
  assert.equal(operations.filter(value => value.action === 'create').length, 1);
  await send(pocket, '播放和田光司的 Butter-Fly');
  await wait(host, 'window.zenbotTest.session.getSnapshot().result?.status==="playback_started"');
  assert.equal(operations.filter(value => value.action === 'play').length, 1);
  await send(pocket, '音量调到 30%');
  await wait(host, 'window.zenbotTest.playback.volume===.3');
  await wait(host, '!window.zenbotTest.session.getSnapshot().busy');
  await send(pocket, '20 分钟后停止播放');
  await wait(host, '!window.zenbotTest.session.getSnapshot().busy');
  assert(operations.some(value => value.action === 'timerSet' && value.minutes === 20));
  await pet.open({size: 150});
  await pet.invoke({action: 'figure', figure: 'zenbot', scale: .7, wandering: true});
  pet.window.on('close', () => process.stderr.write('PET_CLOSE\n'));
  await wait(pet.window, 'document.querySelector("canvas")?.dataset.renderer==="rig"');
  await evaluate(pet.window, 'document.getElementById("character").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert(!pocket.isVisible());
  const wanderingStart = pet.window.getBounds().x;
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.notEqual(pet.window.getBounds().x, wanderingStart, 'closed chat permits enabled wandering');
  await chat.toggle();
  const pausedPosition = pet.window.getBounds().x;
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(pet.window.getBounds().x, pausedPosition, 'open chat pauses wandering');
  const bounds = pet.window.getBounds(), area = screen.getDisplayMatching(bounds).workArea;
  assert.equal(bounds.y + bounds.height, area.y + area.height, 'pet walks on the usable screen bottom');
  await pet.invoke({action:'figure',figure:'whale',scale:.7,wandering:true});
  await wait(pet.window,'document.querySelector("canvas")?.dataset.figure==="whale"&&document.querySelector("canvas")?.dataset.renderer==="rig"');
  await pet.window.webContents.capturePage().then(image => fs.writeFile(path.resolve('release/zenbot-whale-pet.png'), image.toPNG()));
  await evaluate(pet.window, 'document.getElementById("character").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}))');
  assert.equal(await evaluate(pet.window,'document.getElementById("pet-menu").hidden'),false);
  await evaluate(pet.window, 'document.querySelector("[data-pet-motion=jump]").click()');
  await wait(pet.window,'document.body.dataset.movement==="falling"');
  await wait(pet.window,'document.body.dataset.movement==="landed"');
  await pocket.webContents.capturePage().then(image => fs.writeFile(path.resolve('release/zenbot-pocket-ui.png'), image.toPNG()));
  await host.webContents.capturePage().then(image => fs.writeFile(path.resolve('release/zenbot-host-ui.png'), image.toPNG()));
  const restored = await model.attachments.readHistory();
  assert(restored.conversations.length >= 4);
  chat.close();pet.close();model.close();host.destroy();
  process.stdout.write('ZENBOT_INTEGRATION_PASS\n');app.exit(0);
}).catch(error => {console.error(error);chat?.close();pet?.close();model?.close();app.exit(1);});
