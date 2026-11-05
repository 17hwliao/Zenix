const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./fixtures/load-assistant-ts.cjs');
const {toolRegistry, toolsForPlatform, getToolDefinition} = load(path.join(__dirname, '../src/features/assistant/remote/registry.ts'));
const {validateToolCall, requiresConfirmation} = load(path.join(__dirname, '../src/features/assistant/remote/validation.ts'));
const {REMOTE_LIMITS} = load(path.join(__dirname, '../src/features/assistant/remote/contracts.ts'));

const examples = {
  'context.read': {},
  'playback.control': {action: 'pause'},
  'playback.set_volume': {value: 0.5},
  'playback.set_mode': {repeat: 'one'},
  'music.search': {query: '红豆 王菲', limit: 3},
  'music.play_result': {candidateRef: 'client-candidate-1'},
  'music.query': {scope: 'queue', from: -3, to: 2, fields: ['title', 'artist']},
  'playlist.find': {query: '通勤'},
  'playlist.open': {playlistRef: 'client-playlist-1'},
  'playlist.create': {name: '新的歌单', trackRefs: ['client-track-1']},
  'playlist.add_tracks': {playlistRef: 'client-playlist-1', trackRefs: ['client-track-1']},
  'playlist.remove_tracks': {playlistRef: 'client-playlist-1', trackRefs: ['client-track-1']},
  'collection.set': {kind: 'liked', value: true, trackRefs: ['client-track-1']},
  'lyrics.configure': {pure: true, offsetSeconds: -0.5},
  'cache.prepare': {playlistRef: 'client-playlist-1', pin: true},
  'tasks.query': {include: 'active', limit: 10},
  'network.set_policy': {audio: 'never', preload: 'never'},
  'navigation.open': {page: 'home'},
  'roaming.configure': {action: 'temporary_branch', keyword: '轻音乐', count: 3},
  'stats.query': {period: 'week'},
  'timer.configure': {action: 'set', minutes: 30},
  'device.transfer': {deviceRef: 'client-device-1', kind: 'submission', trackRef: 'client-track-1'},
  'backup.export_playlists': {scope: 'all'},
  'updates.check': {},
};

test('every registered capability uses one strict schema for model tools and local validation', () => {
  assert.equal(toolRegistry.length, 24);
  assert.equal(new Set(toolRegistry.map(tool => tool.wireName)).size, 24);
  for (const tool of toolRegistry) {
    assert.match(tool.wireName, /^[A-Za-z0-9_-]{1,64}$/);
    assert.equal(tool.parameters.type, 'object');
    assert.equal(tool.parameters.additionalProperties, false);
    assert(tool.description && tool.module && tool.resultDescription && tool.retry && tool.confirmation);
    const result = validateToolCall(tool.wireName, examples[tool.name], {platform: tool.platforms[0]});
    assert.equal(result.name, tool.name);
    assert.deepEqual(result.args, examples[tool.name]);
    assert.throws(() => validateToolCall(tool.name, {...examples[tool.name], unexpected: 'ignored?'}, {platform: tool.platforms[0]}), /未知字段/);
  }
});

test('unsupported, unavailable and unregistered functions cannot be exposed or dispatched', () => {
  const available = new Set(['context.read', 'playback.control', 'device.transfer']);
  assert.deepEqual(toolsForPlatform('pc', available).map(tool => tool.function.name), ['context_read', 'playback_control']);
  assert.deepEqual(toolsForPlatform('android', available).map(tool => tool.function.name), ['context_read', 'playback_control', 'device_transfer']);
  assert.throws(() => validateToolCall('device_transfer', examples['device.transfer'], {platform: 'pc'}), /没有提供/);
  assert.throws(() => validateToolCall('music_search', examples['music.search'], {platform: 'android', available}), /没有提供/);
  for (const name of ['invoke', 'execute', 'shell', 'open_file', '__proto__']) assert.throws(() => validateToolCall(name, {}, {platform: 'pc'}), /没有提供/);
});

test('model tool definitions are detached from the canonical registry', () => {
  const tools = toolsForPlatform('pc');
  const query = tools.find(tool => tool.function.name === 'music_query');
  query.function.parameters.properties.from.minimum = -100000;
  assert.equal(getToolDefinition('music.query').parameters.properties.from.minimum, -10);
  assert.throws(() => validateToolCall('music_query', {scope: 'queue', from: -11}, {platform: 'pc'}), /数值过小/);
});

test('malformed data and object injection fail closed without exposing submitted values', () => {
  for (const value of [null, [], 'pause', 1]) assert.throws(() => validateToolCall('updates_check', value, {platform: 'pc'}), /必须是对象/);
  const inherited = Object.create({action: 'pause'});
  assert.throws(() => validateToolCall('playback_control', inherited, {platform: 'pc'}), /普通对象/);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const value = JSON.parse('{"' + key + '":"private-key-value"}');
    assert.throws(() => validateToolCall('updates_check', value, {platform: 'pc'}), error => /未知字段/.test(error.message) && !error.message.includes('private-key-value'));
  }
  for (const value of [NaN, Infinity, -0.1, 1.01, '0.5']) assert.throws(() => validateToolCall('playback_set_volume', {value}, {platform: 'pc'}));
  assert.throws(() => validateToolCall('music_search', {query: 'a'.repeat(201)}, {platform: 'pc'}), /文字过长/);
  assert.throws(() => validateToolCall('collection_set', {...examples['collection.set'], trackRefs: ['one', 'one']}, {platform: 'pc'}), /不能重复/);
  assert.throws(() => validateToolCall('collection_set', {...examples['collection.set'], trackRefs: Array.from({length: 51}, (_, index) => 'r' + index)}, {platform: 'pc'}), /项目过多/);
});

test('conditional parameters reject ambiguous or contradictory requests', () => {
  const invalid = [
    ['playback.control', {action: 'seek'}],
    ['playback.control', {action: 'next', positionSeconds: 5}],
    ['playback.set_mode', {}], ['lyrics.configure', {}], ['network.set_policy', {}],
    ['music.query', {scope: 'reference'}],
    ['music.query', {scope: 'current', trackRef: 'one'}],
    ['music.query', {scope: 'history', from: -1}],
    ['music.query', {scope: 'queue', count: 3}],
    ['music.query', {scope: 'queue', from: 2, to: 1}],
    ['music.query', {scope: 'history', count: 11}],
    ['timer.configure', {action: 'set'}],
    ['timer.configure', {action: 'cancel', minutes: 30}],
    ['roaming.configure', {action: 'temporary_branch'}],
    ['roaming.configure', {action: 'reduce_track'}],
    ['roaming.configure', {action: 'pause', keyword: '放松'}],
    ['device.transfer', {deviceRef: 'device', kind: 'submission'}],
    ['device.transfer', {deviceRef: 'device', kind: 'handoff', trackRef: 'track'}],
    ['backup.export_playlists', {scope: 'selected'}],
    ['backup.export_playlists', {scope: 'all', playlistRefs: ['playlist']}],
  ];
  for (const [name, args] of invalid) assert.throws(() => validateToolCall(name, args, {platform: 'android'}), name);
  assert.equal(validateToolCall('playback_control', {action: 'seek', positionSeconds: 5}, {platform: 'pc'}).args.positionSeconds, 5);
});

test('confirmation belongs to client metadata and cannot be forged as a model argument', () => {
  const validate = (name, args) => validateToolCall(name, args, {platform: 'pc'});
  assert(requiresConfirmation(validate('playlist_create', examples['playlist.create'])));
  assert(requiresConfirmation(validate('playlist_remove_tracks', examples['playlist.remove_tracks'])));
  assert.equal(requiresConfirmation(validate('collection_set', examples['collection.set'])), false);
  assert(requiresConfirmation(validate('collection_set', {...examples['collection.set'], trackRefs: ['one', 'two']})));
  assert.equal(requiresConfirmation(validate('playback_control', {action: 'next'})), false);
  assert.throws(() => validate('playlist_create', {...examples['playlist.create'], confirmed: true}), /未知字段/);
  assert(REMOTE_LIMITS.modelRounds > 0 && REMOTE_LIMITS.toolCallsPerRequest >= REMOTE_LIMITS.toolCallsPerRound);
});
