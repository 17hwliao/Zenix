const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {randomUUID} = require('node:crypto');
const {readModelStream} = require('../electron/runtime/assistant-sse.cjs');
const protocol = require('../electron/runtime/assistant-model-protocol.cjs');
const {AssistantAttachments, imageDimensions} = require('../electron/runtime/assistant-attachments.cjs');
const {pocketBounds} = require('../electron/runtime/assistant-chat.cjs');
const load = require('./fixtures/load-assistant-ts.cjs');
const {AssistantCoordinator} = load(path.resolve('src/features/assistant/remote/coordinator.ts'));

const delta = (value, finish = null) => 'data: ' + JSON.stringify({choices: [{index: 0, delta: value, finish_reason: finish}]}) + '\r\n\r\n';
function stream(text, width = 3) {
  const bytes = Buffer.from(text);
  return new ReadableStream({start(controller) {for (let offset = 0; offset < bytes.length; offset += width) controller.enqueue(bytes.subarray(offset, offset + width));controller.close();}}).getReader();
}

test('SSE joins split UTF-8 and tool arguments before native validation, with streaming credential redaction', async () => {
  let text = '';
  const body = delta({content: '你好，fixt'}) + delta({content: 'ure-secret。'})
    + delta({tool_calls: [{index: 0, id: 'call_', type: 'function', function: {name: 'playback_', arguments: '{"action":'}}]})
    + delta({tool_calls: [{index: 0, id: 'one', function: {name: 'control', arguments: '"pause"}'}}]}, 'tool_calls') + 'data: [DONE]\r\n\r\n';
  const raw = await readModelStream(stream(body, 1), {check() {}, secret: 'fixture-secret', onDelta: value => {text += value;}});
  const result = protocol.response(raw, new Set(['playback_control']), 'fixture-secret');
  assert.equal(text, '你好，[凭据已隐藏]。');
  assert.equal(result.toolCalls[0].id, 'call_one');
  assert.deepEqual(JSON.parse(result.toolCalls[0].arguments), {action: 'pause'});
});

test('truncated, oversized, refused and cancelled streams return no executable tool response', async () => {
  await assert.rejects(readModelStream(stream(delta({tool_calls: [{index: 0, id: 'call', function: {name: 'playlist_create', arguments: '{'}}]})), {check() {}}), /提前结束/);
  await assert.rejects(readModelStream(stream(delta({content: 'x'.repeat(257 * 1024)}), 8192), {check() {}}), /过大/);
  await assert.rejects(readModelStream(stream(delta({refusal: 'no'})), {check() {}}), /拒绝/);
  let checks = 0;
  await assert.rejects(readModelStream(stream(delta({content: 'late'})), {check() {if (++checks > 1) throw Error('cancelled');}}), /cancelled/);
});

test('typed requests allow only local opaque image references, retain the text budget and migrate preferences', () => {
  const request = {requestId: randomUUID(), revision: 'v1', tools: [], stream: true, messages: [{role: 'user', content: [{type: 'text', text: '图片里有什么？'}, {type: 'image', attachmentId: randomUUID()}]}]};
  assert.doesNotThrow(() => protocol.request(request));
  const forged = structuredClone(request);
  forged.messages[0].content[1] = {type: 'image_url', image_url: {url: 'file:///private.png'}};
  assert.throws(() => protocol.request(forged), /无效/);
  const overflow = structuredClone(request);
  overflow.messages[0].content[0].text = 'x'.repeat(4001);
  assert.throws(() => protocol.request(overflow), /长度/);
  const previous = protocol.config({enabled: true, endpoint: 'https://model.example/v1', model: 'fixture', apiKey: 'secret', persona: '清楚回答', replyStyle: 'detailed', toolsEnabled: false, streamMode: 'json'});
  const next = protocol.config({enabled: true, endpoint: previous.endpoint, model: 'next'}, previous);
  assert.equal(next.apiKey, 'secret');assert.equal(next.persona, '清楚回答');assert.equal(next.toolsEnabled, false);
});

test('stored image references survive shared histories and retire only after their final draft or message is removed', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zenix-image-history-'));
  t.after(() => fs.rm(folder, {recursive: true, force: true}));
  const store = new AssistantAttachments({folder});
  await store.readHistory();
  await fs.mkdir(store.folder, {recursive: true});
  const id = randomUUID(), conversationId = randomUUID();
  await fs.writeFile(store.file(id), Buffer.from('fixture-jpeg'));
  const image = {id, name: 'test.jpg', bytes: 12, width: 1, height: 1};
  const history = {schemaVersion: 1, activeId: conversationId, conversations: [{id: conversationId, title: '图片', messages: [{id: randomUUID(), role: 'user', text: '图片', attachments: [image]}], draft: {text: '', attachments: [image]}}]};
  await store.saveHistory(history);
  history.conversations[0].draft.attachments = [];
  await store.saveHistory(history);
  await store.remove(id);
  await assert.doesNotReject(fs.access(store.file(id)));
  const messages = await store.hydrate([{role: 'user', content: [{type: 'image', attachmentId: id}]}]);
  assert.match(messages[0].content[0].image_url.url, /^data:image\/jpeg;base64,/);
  history.conversations[0].messages = [];
  await store.saveHistory(history);
  await assert.rejects(fs.access(store.file(id)), {code: 'ENOENT'});
  assert.throws(() => store.file('../outside'), /无效/);
  assert.throws(() => imageDimensions(Buffer.from('<svg></svg>')), /真实/);
  await fs.writeFile(store.historyFile, '{broken');
  const separate = new AssistantAttachments({folder});
  await assert.rejects(separate.readHistory(), /保留/);
  await assert.rejects(separate.saveHistory(history), /保留/);
  assert.equal(await fs.readFile(store.historyFile, 'utf8'), '{broken');
});

test('general image Q&A has no library context or tools, duplicate window submissions execute once and cancelled deltas cannot append', async () => {
  let finish, onDelta, calls = 0;
  const config = {enabled: true, endpoint: 'https://model.example', model: 'fixture', keyPresent: true, revision: 'r1'};
  const coordinator = new AssistantCoordinator({platform: 'pc', business: {capabilities: async () => {throw Error('general Q&A cannot need a business host');}, readContext: async () => {throw Error('must not read library');}, execute: async () => {throw Error('must not execute');}}, transport: {
    read: async () => config, configure: async () => config, test: async () => ({ok: true}), cancel: async () => {},
    complete: async (request, _signal, receive) => {
      calls++;assert.deepEqual(request.tools, []);assert.equal(request.messages.length, 2);
      assert.equal(request.messages[1].content[1].type, 'image');onDelta = receive;
      return new Promise(resolve => {finish = resolve;});
    },
  }});
  const attachment = {id: randomUUID(), name: 'test.png', bytes: 12, width: 1, height: 1};
  await coordinator.setDraft('描述图片', [attachment]);
  const first = coordinator.submitChat('描述图片', [attachment]);
  await assert.rejects(coordinator.submitChat('same-turn duplicate', [attachment]), /先停止/);
  while (!finish) await new Promise(setImmediate);
  await assert.rejects(coordinator.submitChat('duplicate', [attachment]), /先停止/);
  assert.equal(calls, 1);
  assert.equal(coordinator.getSnapshot().chat.draft.text, '描述图片');
  onDelta('部分回复');
  assert.equal(coordinator.getSnapshot().chat.draft.text, '');
  coordinator.cancel();
  const cancelled = structuredClone(coordinator.getSnapshot().chat.messages);
  onDelta('迟到文字');finish({content: 'late', toolCalls: []});
  await first;
  assert.deepEqual(coordinator.getSnapshot().chat.messages, cancelled);
  assert.match(cancelled.at(-1).text, /部分回复.*\n已停止/);
  await coordinator.selectConversation();
  assert.equal(coordinator.getSnapshot().chat.messages.length, 0);
  coordinator.dispose();
});

test('pocket bounds choose the visible side and clamp against negative-origin and small screens', () => {
  assert.deepEqual(pocketBounds({x: 900, y: 700, width: 100, height: 100}, {x: 0, y: 0, width: 1024, height: 768}), {x: 538, y: 280, width: 352, height: 488});
  const small = pocketBounds({x: -100, y: 50, width: 90, height: 90}, {x: -320, y: 0, width: 320, height: 400});
  assert.deepEqual(small, {x: -320, y: 0, width: 320, height: 400});
});

test('failed sends retain the draft and a late acknowledgement cannot clear a newer identical draft', async () => {
  const {ConversationHistory} = load(path.resolve('src/features/assistant/remote/chat-history.ts'));
  const history = new ConversationHistory(() => {});
  await history.ready;
  history.setDraft('保留输入', []);
  history.start('failed-turn', '保留输入', []);
  history.result('failed-turn', '连接失败', 'failed');
  assert.equal(history.snapshot().draft.text, '保留输入');
  history.start('later-turn', '保留输入', []);
  history.setDraft('保留输入', []);
  history.acknowledge('later-turn');
  assert.equal(history.snapshot().draft.text, '保留输入');
  history.start('accepted-turn', '保留输入', []);
  history.acknowledge('accepted-turn');
  assert.equal(history.snapshot().draft.text, '');
});

test('successful history persistence clears a prior transient save error without losing the latest draft', async () => {
  const {ConversationHistory} = load(path.resolve('src/features/assistant/remote/chat-history.ts'));
  let unavailable = true, saved;
  const history = new ConversationHistory(() => {}, {load: async () => null, save: async value => {if (unavailable) throw Error('temporary disk failure');saved = value;}});
  await history.ready;
  history.setDraft('first', []);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(history.snapshot().error, /temporary disk failure/);
  unavailable = false;
  history.setDraft('recovered draft', []);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved.conversations[0].draft.text, 'recovered draft');
  assert.equal(history.snapshot().error, '', 'the UI must reflect successful persistence after recovery');
});

test('production shared chat, native images, Zenbot rendering and two-window confirmation work with an isolated model', {skip: process.platform !== 'win32'}, async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zenix-zenbot-ui-'));
  t.after(() => fs.rm(folder, {recursive: true, force: true}));
  const {createServer} = await import('vite');
  const http = require('node:http').createServer();
  const server = await createServer({cacheDir: path.join(folder, 'vite'), optimizeDeps: {entries: ['scripts/fixtures/zenbot-host.html', 'index.html']}, server: {middlewareMode: true, hmr: {server: http}, watch: {ignored: ['**/release/**', '**/android/**']}}, logLevel: 'error'});
  http.on('request', server.middlewares);
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => {await server.close();await new Promise(resolve => http.close(resolve));});
  const environment = {...process.env, ZENIX_TEST_USER_DATA: folder, ZENIX_DEV_SERVER_URL: `http://127.0.0.1:${http.address().port}`};
  delete environment.ELECTRON_RUN_AS_NODE;
  const {stdout, stderr} = await require('node:util').promisify(require('node:child_process').execFile)(require('electron'), [path.resolve('scripts/fixtures/ElectronZenbotIntegration.cjs')], {env: environment, timeout: 120000, windowsHide: true});
  assert.match(stdout, /ZENBOT_INTEGRATION_PASS/, stderr);
});
