const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./fixtures/load-assistant-ts.cjs');
const {AssistantCoordinator} = load(path.join(__dirname, '../src/features/assistant/remote/coordinator.ts'));
const {SessionReferences} = load(path.join(__dirname, '../src/features/assistant/remote/references.ts'));
const {createMemoryOperationJournal, createBrowserOperationJournal} = load(path.join(__dirname, '../src/features/assistant/remote/journal.ts'));

function localHandlerFactory() {
  const fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
  const filename = path.join(__dirname, '../src/features/assistant/remote/local.ts');
  const mod = new Module(filename), original = Module.createRequire(filename);
  mod.require = name => name === '../../featureHost' ? {executeAssistant: () => {throw Error('real host must not run');}}
    : name.startsWith('.') ? load(path.resolve(path.dirname(filename), name + '.ts')) : original(name);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
  }).outputText, filename);
  return mod.exports.createLocalAssistantHandler;
}

const tick = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
const call = (name, args, id = 'model-tool') => ({id, name, arguments: JSON.stringify(args)});
function harness(overrides = {}) {
  let sequence = 0;
  const requests = [], executed = [], cancelled = [];
  const config = {enabled: true, endpoint: 'https://model.example/v1', model: 'fixture', keyPresent: true, keyHint: '***', revision: 'r1'};
  const transport = {
    read: async () => ({...config}),
    configure: async () => ({...config}), test: async () => ({ok: true}),
    complete: async request => { requests.push(structuredClone(request)); return {content: '请补充歌曲名称。', toolCalls: []}; },
    cancel: async id => { cancelled.push(id); },
    ...overrides.transport,
  };
  const business = {
    capabilities: async () => ['context.read', 'music.query', 'music.search', 'music.play_result', 'playback.control', 'playlist.create', 'playlist.remove_tracks', 'collection.set'],
    readContext: async ctx => ({status: 'completed', message: '上下文已读取。', data: {current: {ref: ctx.refs.issue('track', {id: 'current'}), title: '当前歌曲'}}}),
    execute: async (command, ctx) => { executed.push({command, operationId: ctx.operationId}); return {status: 'completed', message: '实际功能已完成。'}; },
    recovery: async command => ({tool: command.name, currentId: 'current'}),
    ...overrides.business,
  };
  const journal = overrides.journal || createMemoryOperationJournal();
  const coordinator = new AssistantCoordinator({platform: overrides.platform || 'pc', transport, business, journal,
    id: () => 'client-' + (++sequence), ...overrides.options});
  return {coordinator, transport, business, config, journal, requests, executed, cancelled};
}

test('session references enforce owner, object kind, cloning, search retirement and finite lifetime', () => {
  let now = 100, seq = 0;
  const refs = new SessionReferences(() => now, () => 'ref-' + (++seq));
  const source = {id: 'local-id', nested: {title: '原歌曲'}};
  const ref = refs.issue('candidate', source);
  source.nested.title = '后改';
  assert.equal(refs.resolve(ref, 'candidate').nested.title, '原歌曲');
  assert.throws(() => refs.resolve(ref, 'track'), /引用已失效/);
  const other = new SessionReferences(() => now, () => 'other-' + (++seq));
  assert.throws(() => other.resolve(ref, 'candidate'), /引用已失效/);
  refs.invalidate('candidate');
  assert.throws(() => refs.resolve(ref, 'candidate'), /引用已失效/);
  const track = refs.issue('track', {id: 'same'});
  now += 16 * 60 * 1000;
  assert.throws(() => refs.resolve(track, 'track'), /引用已失效/);
  const oldest = refs.issue('track', {id: 'old'});
  for (let n = 0; n < 512; n++) refs.issue('track', {id: String(n)});
  assert.throws(() => refs.resolve(oldest, 'track'), /引用已失效/);
});

test('model sees only supported schema, valid paired context messages and bounded tool results', async () => {
  let round = 0;
  const fixture = harness({business: {
    capabilities: async () => ['context.read', 'music.query'],
    execute: async () => ({status: 'completed', message: '已查询队列。', data: {items: Array(40).fill('x'.repeat(2000)), apiKey: 'never-send', audioUrl: 'private-audio'}}),
  }, transport: {complete: async request => {
    fixture.requests.push(request);
    assert.deepEqual(request.tools.map(row => row.function.name), ['context_read', 'music_query']);
    if (++round === 1) return {content: '', toolCalls: [call('music_query', {scope: 'queue', from: -2, to: 1})]};
    const result = request.messages.at(-1);
    assert.equal(result.role, 'tool');
    assert(result.content.length <= 12000);
    assert(!result.content.includes('never-send') && !result.content.includes('private-audio'));
    return {content: '任意模型叙述', toolCalls: []};
  }}});
  await fixture.coordinator.submit('前两首到后面第一首的信息');
  assert.equal(fixture.coordinator.getSnapshot().message, '已查询队列。');
  assert.equal(fixture.coordinator.getSnapshot().status, 'completed');
  const seed = fixture.requests[0].messages.slice(-2);
  assert.equal(seed[0].tool_calls[0].id, seed[1].tool_call_id);
});

test('one request cannot submit two next-song operations and a new user instruction has a new identity', async () => {
  const fixture = harness({transport: {complete: async () => ({content: '', toolCalls: [
    call('playback_control', {action: 'next'}, 'one'), call('playback_control', {action: 'next'}, 'two'),
  ]})}});
  await fixture.coordinator.submit('下一首');
  assert.equal(fixture.executed.length, 1);
  const first = fixture.executed[0].operationId;
  await fixture.coordinator.submit('再下一首');
  assert.equal(fixture.executed.length, 2);
  assert.notEqual(fixture.executed[1].operationId, first);
});

test('confirmation is fixed, client-owned, voice confidence checked and double activation submits once', async () => {
  let current = 'A', committed = [], valid = true;
  const fixture = harness({business: {execute: async () => {
    const pinned = current;
    return {kind: 'confirmation', summary: '创建并加入 ' + pinned, items: [pinned],
      fingerprint: JSON.stringify({tool: 'playlist.create', name: '固定歌单', trackIds: [pinned]}),
      validate: async () => valid,
      commit: async () => { committed.push(pinned); return {status: 'saved', message: '已保存 ' + pinned}; },
    };
  }}, transport: {complete: async () => ({content: '', toolCalls: [call('playlist_create', {name: '固定歌单'})]})}});
  await fixture.coordinator.submit('创建歌单并加入这首');
  const token = fixture.coordinator.getSnapshot().confirmation.token;
  current = 'B';
  await fixture.coordinator.submit('确认', .3);
  assert.equal(committed.length, 0);
  assert.equal(fixture.coordinator.getSnapshot().confirmation.token, token);
  await Promise.all([fixture.coordinator.confirm('model-invented-token'), fixture.coordinator.confirm(token), fixture.coordinator.confirm(token)]);
  assert.deepEqual(committed, ['A']);
  assert.equal(fixture.coordinator.getSnapshot().message, '已保存 A');
  await fixture.coordinator.submit('创建另一个歌单');
  valid = false;
  await fixture.coordinator.confirm(fixture.coordinator.getSnapshot().confirmation.token);
  assert.deepEqual(committed, ['A']);
  assert.match(fixture.coordinator.getSnapshot().message, /目标已经变化/);
});

test('new request invalidates an old plan and late model completions cannot execute', async () => {
  const pending = deferred();
  let round = 0;
  const fixture = harness({transport: {complete: async () => ++round === 1 ? pending.promise : ({content: '第二条指令没有执行操作。', toolCalls: []})}});
  const first = fixture.coordinator.submit('先下一首');
  await tick(); await tick();
  await fixture.coordinator.submit('查询歌曲');
  pending.resolve({content: '', toolCalls: [call('playback_control', {action: 'next'})]});
  await first;
  assert.equal(fixture.executed.length, 0);
  assert.equal(fixture.coordinator.getSnapshot().heard, '查询歌曲');
  assert(fixture.cancelled.length >= 1);
});

test('configuration change retires old requests before a late response can propose a write', async () => {
  const response = deferred();
  const fixture = harness({transport: {complete: async () => response.promise}});
  const request = fixture.coordinator.submit('下一首');
  await tick(); await tick();
  fixture.config.revision = 'r2';
  fixture.coordinator.configurationChanged();
  response.resolve({content: '', toolCalls: [call('playback_control', {action: 'next'})]});
  await request;
  assert.equal(fixture.executed.length, 0);
  assert.equal(fixture.coordinator.getSnapshot().status, 'cancelled');
});

test('cancelling submitted work still records and presents its actual completion while unsubscribe only hides an observer', async () => {
  const commit = deferred();
  let commits = 0;
  const fixture = harness({business: {execute: async () => ({kind: 'confirmation', summary: '创建', items: [],
    fingerprint: JSON.stringify({tool: 'playlist.create', name: '夜间'}), validate: async () => true,
    commit: async () => { commits++; return commit.promise; },
  })}, transport: {complete: async () => ({content: '', toolCalls: [call('playlist_create', {name: '夜间'})]})}});
  const stop = fixture.coordinator.subscribe(() => {});
  await fixture.coordinator.submit('创建歌单夜间');
  const confirmation = fixture.coordinator.confirm(fixture.coordinator.getSnapshot().confirmation.token);
  await tick(); await tick();
  assert.equal(commits, 1);
  stop();
  fixture.coordinator.cancel();
  commit.resolve({status: 'saved', message: '夜间已真实保存'});
  await confirmation;
  assert.equal(fixture.coordinator.getSnapshot().status, 'completed');
  assert.match(fixture.coordinator.getSnapshot().message, /已核对.*夜间已真实保存/);
  const records = await fixture.journal.load();
  assert.equal(records.at(-1).status, 'settled');
  assert.equal(records.at(-1).result.status, 'saved');
});

test('cancel during durable pre-submit recording prevents business execution', async () => {
  const save = deferred();
  let first = true, records = [];
  const journal = {load: async () => [], save: async value => {
    records = structuredClone(value);
    if (value.some(row => row.status === 'submitted') && first) { first = false; await save.promise; }
  }};
  const fixture = harness({journal, transport: {complete: async () => ({content: '', toolCalls: [call('playback_control', {action: 'next'})]})}});
  const request = fixture.coordinator.submit('下一首');
  for (let n = 0; n < 20 && first; n++) await tick();
  assert.equal(first, false);
  fixture.coordinator.cancel();
  save.resolve();
  await request;
  assert.equal(fixture.executed.length, 0);
  assert.equal(records.at(-1).status, 'settled');
  assert.equal(records.at(-1).result.status, 'cancelled');
});

test('no key and model unavailability preserve the local flow including nested low-confidence plans', async () => {
  let localExecutions = 0;
  const local = async text => text === '创建' ? {kind: 'confirmation', summary: '识别确认', items: [],
    commit: async () => ({kind: 'confirmation', summary: '资料确认', items: ['A'],
      commit: async () => {localExecutions++; return {reply: '资料已保存'};}}),
  } : {reply: '本地已暂停'};
  const fixture = harness({options: {local}});
  fixture.config.keyPresent = false;
  await fixture.coordinator.submit('创建', .3);
  await fixture.coordinator.confirm(fixture.coordinator.getSnapshot().confirmation.token);
  assert.equal(fixture.coordinator.getSnapshot().confirmation.summary, '资料确认');
  assert.equal(localExecutions, 0);
  await fixture.coordinator.submit('确认', .95);
  assert.equal(localExecutions, 1);
  fixture.config.keyPresent = true;
  fixture.transport.complete = async () => { throw Error('mock unavailable'); };
  await fixture.coordinator.submit('暂停');
  assert.equal(fixture.coordinator.getSnapshot().message, '本地已暂停');
});

test('replacing search candidates invalidates old references, explicit valid candidate play uses a new operation', async () => {
  let lastCandidate, search = 0;
  const fixture = harness({business: {execute: async (command, ctx) => {
    if (command.name === 'music.search') {
      const ref = ctx.refs.issue('candidate', {id: 'song-' + (++search)});
      lastCandidate = ref;
      return {status: 'completed', message: '已找到候选', candidates: [{ref, kind: 'candidate', label: '候选 ' + search}]};
    }
    const actual = ctx.refs.resolve(command.args.candidateRef, 'candidate');
    fixture.executed.push(actual);
    return {status: 'loading_started', message: '已开始指定版本加载'};
  }}, transport: {complete: async request => request.messages.at(-1).role === 'tool' && request.messages.at(-2).tool_calls[0].function.name === 'music_search'
    ? {content: '', toolCalls: []}
    : {content: '', toolCalls: [call('music_search', {query: '同名歌曲'})]}}});
  await fixture.coordinator.submit('搜索同名歌曲');
  const old = lastCandidate;
  await fixture.coordinator.submit('重新搜索另一版本');
  assert.notEqual(lastCandidate, old);
  await fixture.coordinator.chooseCandidate(old);
  assert.equal(fixture.executed.length, 0);
  await fixture.coordinator.chooseCandidate(lastCandidate);
  assert.deepEqual(fixture.executed, [{id: 'song-2'}]);
  assert.equal(fixture.coordinator.getSnapshot().result.status, 'loading_started');
});

test('recovery reconciles submitted records without replay and credentials never enter journal storage', async () => {
  const journal = createMemoryOperationJournal();
  await journal.save([{id: 'operation-before-restart', requestId: 'request-old', tool: 'playlist.create',
    status: 'submitted', startedAt: Date.now(), updatedAt: Date.now(), recovery: {
      operationId: 'operation-before-restart', requestId: 'request-old', call: {name: 'playlist.create', args: {name: '夜间'}},
      submittedAt: Date.now(), data: {tool: 'playlist.create', name: '夜间', trackIds: ['A']},
    }}]);
  let reconciled = 0;
  const fixture = harness({journal, business: {reconcile: async operation => {
    reconciled++;
    assert.equal(operation.data.name, '夜间');
    return {status: 'saved', message: '已确认此前歌单保存'};
  }}});
  await fixture.coordinator.recover();
  assert.equal(reconciled, 1);
  assert.equal(fixture.executed.length, 0);
  assert.equal((await journal.load())[0].status, 'settled');
  const saved = JSON.stringify(await journal.load());
  assert(!saved.includes('keyHint') && !saved.includes('endpoint') && !saved.includes('apiKey'));
  let raw;
  const browser = createBrowserOperationJournal({getItem: () => raw || null, setItem: (_key, value) => { raw = value; }});
  await browser.save(await journal.load());
  assert.equal((await browser.load()).length, 1);
  raw = '{invalid';
  await assert.rejects(browser.load());
});

test('model loop limits terminate repeated reads and an extension error does not disable later basic playback', async () => {
  let mode = 'loop', rounds = 0;
  const fixture = harness({business: {execute: async command => {
    if (command.name === 'music.query') throw Error('歌词服务失败');
    fixture.executed.push(command);
    return {status: 'completed', message: '已暂停'};
  }}, transport: {complete: async () => {
    rounds++;
    return {content: '', toolCalls: [mode === 'loop' ? call('music_query', {scope: 'current'}, 'query-' + rounds)
      : call('playback_control', {action: 'pause'})]};
  }}});
  await fixture.coordinator.submit('查询歌词');
  assert.equal(rounds, 6);
  assert.equal(fixture.coordinator.getSnapshot().status, 'failed');
  mode = 'pause';
  await fixture.coordinator.submit('暂停');
  assert.equal(fixture.executed.length, 1);
  assert.equal(fixture.coordinator.getSnapshot().message, '已暂停');
});

test('long sessions retire complete prior turns and retain valid active tool groups within the message cap', async () => {
  let complicated = false, round = 0;
  const fixture = harness({transport: {complete: async request => {
    assert(request.messages.length <= 32);
    const declared = new Set();
    for (const message of request.messages) {
      for (const item of message.tool_calls || []) declared.add(item.id);
      if (message.role === 'tool') assert(declared.has(message.tool_call_id), 'tool result has its assistant call');
    }
    if (!complicated) return {content: '请输入一个音乐操作。', toolCalls: []};
    if (++round === 6) return {content: '', toolCalls: []};
    return {content: '', toolCalls: [call('music_query', {scope: 'current'}, 'query-' + round)]};
  }}});
  for (let n = 0; n < 20; n++) await fixture.coordinator.submit('查询音乐 ' + n);
  complicated = true;
  await fixture.coordinator.submit('继续查询音乐信息');
  assert.equal(round, 6);
});

test('actual local bridge retains naming follow-up and never submits its low-confidence name without confirmation', async () => {
  let writes = 0, pinnedName;
  const bridge = localHandlerFactory()(false, async () => undefined, async (action, args) => {
    assert.equal(action, 'playlist-create');
    if (!args.name) return {reply: '请告诉我名字', ask: {action, args: {}}};
    const name = args.name;
    return {kind: 'confirmation', summary: '创建 ' + name, items: [name], commit: async () => {
      writes++; pinnedName = name; return {reply: '已保存 ' + name};
    }};
  });
  const fixture = harness({options: {local: bridge.handle, onLocalReset: bridge.reset}});
  fixture.config.keyPresent = false;
  await fixture.coordinator.submit('创建歌单');
  assert.equal(fixture.coordinator.getSnapshot().status, 'needs_input');
  await fixture.coordinator.submit('午夜车站', .3);
  assert.match(fixture.coordinator.getSnapshot().confirmation.summary, /识别把握不足/);
  assert.equal(writes, 0);
  await fixture.coordinator.confirm(fixture.coordinator.getSnapshot().confirmation.token);
  assert.equal(fixture.coordinator.getSnapshot().confirmation.summary, '创建 午夜车站');
  assert.equal(writes, 0);
  await fixture.coordinator.confirm(fixture.coordinator.getSnapshot().confirmation.token);
  assert.equal(writes, 1);
  assert.equal(pinnedName, '午夜车站');
  await fixture.coordinator.submit('创建歌单');
  fixture.coordinator.cancel();
  await fixture.coordinator.submit('不应创建为名字');
  assert.equal(writes, 1);
  assert.equal(fixture.coordinator.getSnapshot().confirmation, undefined);
  await fixture.coordinator.submit('创建歌单');
  await fixture.coordinator.submit('星夜', Number.NaN);
  assert.match(fixture.coordinator.getSnapshot().confirmation.summary, /识别把握不足/);
  assert.equal(writes, 1);
});

test('a revision changed during model completion cannot submit a stale direct mutation', async () => {
  const fixture = harness({transport: {complete: async () => {
    fixture.config.revision = 'native-new-revision';
    return {content: '', toolCalls: [call('playback_control', {action: 'next'})]};
  }}});
  await fixture.coordinator.submit('下一首');
  assert.equal(fixture.executed.length, 0);
  assert.match(fixture.coordinator.getSnapshot().message, /配置已经改变/);
});

test('a confirmation refuses an expired object reference even while its own ticket and pinned target remain valid', async () => {
  let now = 0, commits = 0, reference;
  const fixture = harness({options: {now: () => now}, business: {execute: async () => ({kind: 'confirmation',
    summary: '保存指定歌曲', items: ['A'], fingerprint: JSON.stringify({tool: 'playlist.create', name: '夜间', trackIds: ['A']}),
    validate: async () => true, commit: async () => {commits++; return {status: 'saved', message: '已保存'};},
  })}, transport: {complete: async () => ({content: '', toolCalls: [call('playlist_create', {name: '夜间', trackRefs: [reference]})]})}});
  reference = fixture.coordinator.refs.issue('track', {id: 'A'});
  now = 14 * 60 * 1000;
  await fixture.coordinator.submit('把刚才选的歌曲加入新歌单');
  const token = fixture.coordinator.getSnapshot().confirmation.token;
  now = 16 * 60 * 1000;
  await fixture.coordinator.confirm(token);
  assert.equal(commits, 0);
  assert.match(fixture.coordinator.getSnapshot().message, /引用已失效/);
});

test('a revision changed during durable recording retires the unsubmitted receipt and does not poison later local storage', async () => {
  let change = true, records = [];
  const journal = {load: async () => records, save: async rows => {
    records = structuredClone(rows);
    if (change && rows.some(row => row.status === 'submitted')) {
      change = false;
      fixture.config.revision = 'r2';
    }
  }};
  const fixture = harness({journal, transport: {complete: async () => ({content: '', toolCalls: [call('playback_control', {action: 'next'})]})}});
  await fixture.coordinator.submit('下一首');
  assert.equal(fixture.executed.length, 0);
  assert.equal(records.at(-1).status, 'settled');
  assert.equal(records.at(-1).result.status, 'failed');
  await fixture.coordinator.submit('使用新配置下一首');
  assert.equal(fixture.executed.length, 1);
});

test('a failed old model request cannot turn into a local mutation after native configuration changes', async () => {
  let localWrites = 0;
  const fixture = harness({options: {local: async () => {localWrites++; return {reply: '已下一首'};}}, transport: {complete: async () => {
    fixture.config.revision = 'r2';
    throw Error('old request cancelled by native configuration');
  }}});
  await fixture.coordinator.submit('下一首');
  assert.equal(localWrites, 0);
  assert.match(fixture.coordinator.getSnapshot().message, /配置已经改变/);
});

test('corrupt optional receipts leave no-key local read queries usable while withholding all local writes', async () => {
  const called = [];
  const bridge = localHandlerFactory()(false, async () => undefined,
    async action => {called.push(action); return {reply: '当前歌手：王菲'};});
  const journal = {load: async () => {throw Error('corrupt receipt');}, save: async () => {throw Error('corrupt receipt');}};
  const fixture = harness({journal, options: {local: bridge.handle}});
  fixture.config.keyPresent = false;
  await fixture.coordinator.submit('当前歌手');
  assert.equal(fixture.coordinator.getSnapshot().message, '当前歌手：王菲');
  await fixture.coordinator.submit('下一首');
  assert.deepEqual(called, ['song-query']);
  assert.equal(fixture.coordinator.getSnapshot().status, 'failed');
  assert.match(fixture.coordinator.getSnapshot().message, /回执暂时不可用/);
});

test('a cancelled local request cannot leave a late playlist naming prompt for the next request', async () => {
  let finish, calls = 0;
  const bridge = localHandlerFactory()(false, async () => undefined, async action => {
    calls++;
    return new Promise(resolve => {finish = () => resolve({reply: '叫什么名字', ask: {action, args: {}}});});
  });
  const controller = new AbortController();
  const pending = bridge.handle('把当前歌曲加入一个新歌单', 1, controller.signal);
  controller.abort();
  finish();
  await pending;
  assert.equal(await bridge.handle('星夜', 1, new AbortController().signal), undefined);
  assert.equal(calls, 1);
});

test('a fixed workbench shortcut uses the same coordinator and local capability even with a model configured', async () => {
  let writes = 0;
  const fixture = harness({options: {local: async text => {writes++;return {reply: '已标记当前片段：' + text};}}});
  await fixture.coordinator.submit('标记当前片段', 1, 'local');
  assert.equal(writes, 1);
  assert.equal(fixture.requests.length, 0);
  assert.equal((await fixture.journal.load()).at(-1).status, 'settled');
  assert.match(fixture.coordinator.getSnapshot().message, /已标记当前片段/);
});
