const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { AssistantModel } = require('../electron/runtime/assistant-model.cjs');
const protocol = require('../electron/runtime/assistant-model-protocol.cjs');
const load = require('./fixtures/load-assistant-ts.cjs');
const { toolsForPlatform } = load(path.resolve('src/features/assistant/remote/registry.ts'));

function encryptedFixture() {
  const key = crypto.randomBytes(32);
  return {
    async encodeProtected(value) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
    },
    async decodeProtected(text) {
      const value = JSON.parse(text), decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
      return { value: JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString()), legacy: false };
    },
  };
}
async function fixture(t, request, options = {}) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zenix-model-'));
  const protection = encryptedFixture(), model = new AssistantModel({ folder, request, protection, ...options });
  t.after(async () => { model.close(); await fs.rm(folder, { recursive: true, force: true }); });
  await model.load();
  return { folder, model, protection, configure: value => model.invoke({ action: 'configure', value: { enabled: true, endpoint: 'https://model.example/v1', model: 'fixture', apiKey: 'fixture-secret', ...value } }) };
}
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
const answer = content => ({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }] });
const call = (name, args, id = 'call_1') => ({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const request = (revision, tools = []) => ({ requestId: crypto.randomUUID(), revision, messages: [{ role: 'user', content: '当前歌曲是谁唱的' }], tools });

test('remote configuration starts empty and never requires credentials for local startup', async t => {
  let calls = 0;
  const { model } = await fixture(t, () => { calls++; throw Error('unexpected'); });
  const value = await model.invoke({ action: 'read' });
  assert.equal(value.enabled, false); assert.equal(value.keyPresent, false);
  await assert.rejects(model.invoke({ action: 'complete', request: request(value.revision) }), { code: 'not_configured' });
  assert.equal(calls, 0);
});

test('native encrypted credential vault masks keys, binds them to the full endpoint and preserves failed writes', async t => {
  const f = await fixture(t, () => { throw Error('network should not run'); });
  const first = await f.configure();
  assert.equal(first.endpoint, 'https://model.example/v1/chat/completions');
  assert.equal(first.keyPresent, true); assert.doesNotMatch(JSON.stringify(first), /fixture-secret/);
  const disk = await fs.readFile(f.model.file, 'utf8'); assert.doesNotMatch(disk, /fixture-secret|model\.example/);
  const same = await f.configure({ apiKey: undefined, model: 'another' }); assert.equal(same.keyPresent, true);
  const changed = await f.configure({ endpoint: 'https://other.example/v1', apiKey: undefined }); assert.equal(changed.keyPresent, false);
  const recovered = new AssistantModel({ folder: f.folder, protection: f.protection, request: () => { throw Error('unexpected'); } });
  await recovered.load(); assert.deepEqual(await recovered.invoke({ action: 'read' }), changed); recovered.close();
  f.protection.encodeProtected = async () => { throw Error('fixture-secret must never escape'); };
  await assert.rejects(f.configure({ endpoint: 'https://third.example', apiKey: 'next-secret' }), error => error.code === 'storage' && !error.message.includes('secret'));
  assert.deepEqual(await f.model.invoke({ action: 'read' }), changed);
});

test('only explicit HTTPS model endpoints are accepted, without URL credentials or query secrets', () => {
  for (const address of ['http://model.example', 'https://user:password@model.example', 'https://model.example?api_key=secret', 'https://model.example#secret', 'file:///tmp/model', 'javascript:alert(1)']) assert.throws(() => protocol.endpoint(address));
  assert.equal(protocol.endpoint('https://model.example/v1/chat/completions/'), 'https://model.example/v1/chat/completions');
});

test('actual registry tools and bounded role/tool transcripts pass native shape validation', async t => {
  let sent;
  const f = await fixture(t, async (url, options) => { sent = { url, options, body: JSON.parse(options.body) }; return json(call('context_read', {})); });
  const config = await f.configure(), tools = toolsForPlatform('pc');
  const result = await f.model.complete(request(config.revision, tools));
  assert.equal(result.toolCalls[0].name, 'context_read'); assert.equal(sent.options.redirect, 'manual');
  assert.equal(sent.body.stream, false); assert.equal(sent.options.headers.Authorization, 'Bearer fixture-secret');
  assert.doesNotMatch(JSON.stringify(sent.body), /fixture-secret/); assert.equal(sent.body.tools.length, 23);
  const next = request(config.revision, tools);
  next.messages.push({ role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'context_read', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'call_1', content: '{"status":"completed"}' });
  assert.doesNotThrow(() => protocol.request(next));
  next.messages.pop(); assert.throws(() => protocol.request(next), /工具结果/);
});

test('connection probe verifies forced tool format without sending business tools or running actions', async t => {
  let bodies = [];
  const f = await fixture(t, async (_url, options) => {
    const body = JSON.parse(options.body); bodies.push(body);
    return json(call('zenix_connection_probe', { nonce: body.tools[0].function.parameters.properties.nonce.enum[0] }));
  });
  await f.configure({ enabled: false });
  const value = await f.model.invoke({ action: 'test', requestId: crypto.randomUUID() });
  assert.equal(value.ok, true); assert.equal(value.toolCalling, true); assert.equal(bodies.length, 1);
  assert.deepEqual(bodies[0].tool_choice, { type: 'function', function: { name: 'zenix_connection_probe' } });
  assert.equal(bodies[0].tools.length, 1); assert.doesNotMatch(JSON.stringify(bodies[0]), /playlist_create|playback_control/);
});

test('unoffered tools, incomplete output and unsafe native request shapes are rejected', async t => {
  let output = call('evil_operation', {}), calls = 0;
  const f = await fixture(t, async () => { calls++; return json(output); });
  const config = await f.configure(), tools = toolsForPlatform('pc');
  await assert.rejects(f.model.complete(request(config.revision, tools)), { code: 'protocol' });
  output = { choices: [{ finish_reason: 'length', message: { content: 'truncated' } }] };
  await assert.rejects(f.model.complete(request(config.revision, tools)), { code: 'protocol' });
  const malformed = request(config.revision, tools); malformed.messages[0].operation = 'execute';
  await assert.rejects(f.model.complete(malformed), { code: 'invalid_request' });
  assert.equal(calls, 2);
});

test('redirects and remote error bodies cannot leak Authorization or key text', async t => {
  let calls = 0, status = 302;
  const f = await fixture(t, async () => { calls++; return new Response('server echo fixture-secret', { status, headers: { location: 'https://evil.example/' } }); });
  const config = await f.configure();
  await assert.rejects(f.model.complete(request(config.revision)), error => error.code === 'redirect' && !error.message.includes('fixture-secret'));
  status = 401; await assert.rejects(f.model.complete(request(config.revision)), error => error.code === 'authentication' && !error.message.includes('fixture-secret'));
  assert.equal(calls, 2);
});

test('remote content and argument echoes redact even keys containing JSON quotes', async t => {
  const secret = 'fixture-"quoted\\key';
  const f = await fixture(t, async () => json({ choices: [{ finish_reason: 'tool_calls', message: { content: secret, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'music_search', arguments: JSON.stringify({ query: secret }) } }] } }] }));
  const config = await f.configure({ apiKey: secret }), value = await f.model.complete(request(config.revision, toolsForPlatform('pc')));
  assert.doesNotMatch(value.content, /quoted/); assert.doesNotMatch(value.toolCalls[0].arguments, /quoted/);
});

test('cancellation, configuration replacement and revision checks discard late model results', async t => {
  let finish;
  const f = await fixture(t, async () => new Promise(resolve => { finish = resolve; }));
  const config = await f.configure(), args = request(config.revision);
  const cancelled = f.model.complete(args), rejected = assert.rejects(cancelled, { code: 'cancelled' });
  while (!finish) await new Promise(setImmediate);
  f.model.cancel(args.requestId); finish(json(answer('late'))); await rejected;
  const before = request(config.revision); f.model.cancel(before.requestId);
  await assert.rejects(f.model.complete(before), { code: 'cancelled' });
  finish = undefined; const nextArgs = request(config.revision), replaced = f.model.complete(nextArgs), ignored = assert.rejects(replaced, error => ['cancelled', 'configuration_changed'].includes(error.code));
  while (!finish) await new Promise(setImmediate);
  await f.configure({ model: 'replacement' }); finish(json(answer('late'))); await ignored;
  await assert.rejects(f.model.complete(request(config.revision)), { code: 'configuration_changed' });
});

test('model deadline and response bound release resources without changing playback controls', async t => {
  const f = await fixture(t, async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('fixture-secret')))), { timeoutMs: 25 });
  const config = await f.configure();
  await assert.rejects(f.model.complete(request(config.revision)), { code: 'timeout' }); assert.equal(f.model.active.size, 0);
  f.model.request = async () => new Response('x'.repeat(protocol.MAX_RESPONSE_BYTES + 1));
  await assert.rejects(f.model.complete(request(config.revision)), { code: 'oversize' }); assert.equal(f.model.active.size, 0);
});

test('corrupt model vault is isolated and never overwritten with an empty replacement', async t => {
  const f = await fixture(t, () => { throw Error('unexpected'); });
  await fs.writeFile(f.model.file, 'corrupt-key-vault');
  const separate = new AssistantModel({ folder: f.folder, protection: f.protection });
  await assert.doesNotReject(separate.load());
  await assert.rejects(separate.invoke({ action: 'read' }), { code: 'storage' });
  await assert.rejects(separate.configure({ enabled: false, endpoint: '', model: '' }), { code: 'storage' });
  assert.equal(await fs.readFile(f.model.file, 'utf8'), 'corrupt-key-vault'); separate.close();
});

test('frontend bridge cancels promptly even when the native completion reply is late', async () => {
  const Module = require('node:module'), ts = require('typescript');
  const filename = path.resolve('src/features/assistant/remote/transport.ts'), source = await fs.readFile(filename, 'utf8');
  const mod = new Module(filename);
  mod.require = name => { assert.equal(name, '../../../mobile/native'); return { command: () => { throw Error('provided bridge must be used'); } }; };
  mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  const calls = []; let finish;
  const bridge = mod.exports.createNativeTransport(false, async args => { calls.push(args); if (args.action === 'complete') return new Promise(resolve => { finish = resolve; }); return true; });
  const controller = new AbortController(), args = request('revision-fixture'), waiting = bridge.complete(args, controller.signal);
  const cancelled = assert.rejects(waiting, { name: 'AbortError' });
  controller.abort(); await cancelled;
  assert.deepEqual(calls.map(value => value.action), ['complete', 'cancel']); assert.equal(calls[1].requestId, args.requestId);
  finish({ content: 'late', toolCalls: [] }); await new Promise(setImmediate);
  assert.equal(calls.length, 2);
});

test('production Android transport validates and cancels native requests under a controlled JVM network', async t => {
  const { execFile } = require('node:child_process'), { promisify } = require('node:util');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'zenix-model-jvm-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const javaHome = process.env.JAVA_HOME || (process.platform === 'win32' ? 'C:/Program Files/Android/Android Studio/jbr' : null);
  const binary = name => javaHome ? path.join(javaHome, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
  const cache = path.join(os.homedir(), '.gradle/caches/modules-2/files-2.1/org.json/json/20250517');
  let jar;
  try { for (const child of await fs.readdir(cache)) { const candidate = path.join(cache, child, 'json-20250517.jar'); try { await fs.access(candidate); jar = candidate; break; } catch {} } } catch {}
  if (!jar) {
    jar = path.join(folder, 'json.jar');
    const reply = await fetch('https://repo.maven.apache.org/maven2/org/json/json/20250517/json-20250517.jar');
    assert(reply.ok, 'JSON test dependency must be available'); await fs.writeFile(jar, Buffer.from(await reply.arrayBuffer()));
  }
  const context = path.join(folder, 'android/content/Context.java'), vault = path.join(folder, 'com/zenix/musicplayer/AssistantModelCredentials.java');
  await fs.mkdir(path.dirname(context), { recursive: true }); await fs.mkdir(path.dirname(vault), { recursive: true });
  await fs.writeFile(context, 'package android.content; public class Context {}');
  await fs.writeFile(vault, 'package com.zenix.musicplayer; final class AssistantModelCredentials implements AssistantModel.Vault { AssistantModelCredentials(android.content.Context context) {} public org.json.JSONObject read(){throw new AssertionError("inject the isolated test vault");} public void write(org.json.JSONObject value){throw new AssertionError();}}');
  const root = path.resolve('android/app/src/main/java/com/zenix/musicplayer');
  await promisify(execFile)(binary('javac'), ['-cp', jar, '-d', folder, context, vault, path.join(root, 'AssistantModelProtocol.java'), path.join(root, 'AssistantModel.java'), path.resolve('scripts/fixtures/AssistantModelCheck.java')], { windowsHide: true, timeout: 30000 });
  const { stdout, stderr } = await promisify(execFile)(binary('java'), ['-cp', folder + path.delimiter + jar, 'com.zenix.musicplayer.AssistantModelCheck'], { windowsHide: true, timeout: 20000 });
  assert.match(stdout, /ASSISTANT_MODEL_JVM_PASS/, stderr);
  const credentials = await fs.readFile(path.join(root, 'AssistantModelCredentials.java'), 'utf8');
  assert.match(credentials, /getNoBackupFilesDir/); assert.match(credentials, /zenix\.assistant-model\.v1/); assert.match(credentials, /AES\/GCM\/NoPadding/);
  assert.doesNotMatch(credentials, /private-config\.v1|zenix\.json/);
});
