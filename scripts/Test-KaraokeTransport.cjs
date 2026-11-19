const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { setTimeout: delay } = require('node:timers/promises');
const test = require('node:test');
const ts = require('typescript');

for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, file) => module._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    file,
  );
}

const { KaraokeRoomTransport } = require('../src/features/karaoke/lan/transport.ts');
const {
  createKaraokeHandshakeKey, KaraokeSecureChannel, makeKaraokeChallenge, parseKaraokeAddress,
} = require('../src/features/karaoke/lan/secure-channel.ts');

async function until(condition, what) {
  for (let i = 0; i < 350; i++) {
    if (condition()) return;
    await delay(10);
  }
  assert.fail(what);
}

test('Android websocket rejects oversized frames before reading payload and exchanges UTF-8 with a real server', async t => {
  const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'zenix-karaoke-ws-'));
  t.after(() => fsp.rm(folder, {recursive: true, force: true}));
  const javaHome = process.env.JAVA_HOME || (process.platform === 'win32' ? 'C:/Program Files/Android/Android Studio/jbr' : '');
  const bin = name => javaHome ? path.join(javaHome, 'bin', process.platform === 'win32' ? name + '.exe' : name) : name;
  const fixture = path.join(__dirname, 'fixtures/KaraokeWebSocketCheck.java');
  const production = path.join(__dirname, '../android/app/src/main/java/com/zenix/musicplayer/KaraokeWebSocket.java');
  await execFile(bin('javac'), ['-encoding', 'UTF-8', '-d', folder, production, fixture], {timeout: 30000, windowsHide: true});
  const {WebSocketServer} = require('ws');
  const server = new WebSocketServer({host: '127.0.0.1', port: 0, path: '/zenix/karaoke', perMessageDeflate: false});
  t.after(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
  });
  await once(server, 'listening');
  let sentText;
  server.on('connection', socket => socket.once('message', data => {
    sentText = data.toString();
    const text = Buffer.from('蓝方已准备');
    socket.send(text.subarray(0, 2), {fin: false, binary: false});
    socket.ping('clock');
    socket.send(text.subarray(2), {fin: true, binary: false});
  }));
  const result = await execFile(bin('java'), ['-cp', folder, 'com.zenix.musicplayer.KaraokeWebSocketCheck', String(server.address().port)], {timeout: 15000, windowsHide: true});
  assert.match(result.stdout, /KARAOKE_WEBSOCKET_PASS/);
  assert.equal(sentText, 'Zenix 入场');
});

function networkPair() {
  const endpoint = '192.168.100.20:44001';
  const frames = [];
  const handlers = { host: undefined, guest: undefined };
  let connection, next = 0, dropGuestWrites = false;
  const emit = (owner, event) => setImmediate(() => handlers[owner]?.({ address: endpoint, ...event }));
  const disconnect = () => {
    if (!connection) return;
    const { host, guest } = connection;
    connection = undefined;
    emit('host', { type: 'closed', id: host });
    emit('guest', { type: 'closed', id: guest });
  };
  const port = owner => ({
    observe: async callback => {
      handlers[owner] = callback;
      return () => { if (handlers[owner] === callback) handlers[owner] = undefined; };
    },
    invoke: async args => {
      switch (args.action) {
        case 'listen': return [endpoint];
        case 'connect':
          assert.equal(args.address, endpoint);
          assert.equal(connection, undefined, 'single active guest connection');
          connection = { host: 'peer-' + ++next, guest: args.id };
          emit('host', { type: 'open', id: connection.host });
          emit('guest', { type: 'open', id: connection.guest });
          return true;
        case 'send': {
          if (!connection || connection[owner] !== args.id) throw Error('connection closed');
          frames.push({ owner, value: args.data });
          if (owner === 'guest' && dropGuestWrites) {
            dropGuestWrites = false;
            disconnect();
            throw Error('connection dropped');
          }
          const other = owner === 'host' ? 'guest' : 'host';
          emit(other, { type: 'message', id: connection[other], data: args.data });
          return true;
        }
        case 'close':
          if (connection?.[owner] === args.id) disconnect();
          return true;
        case 'stop': disconnect(); return true;
        default: assert.fail('unexpected native call ' + args.action);
      }
    },
  });
  return { frames, port, dropNextGuestWrite() { dropGuestWrites = true; }, disconnect };
}

test('room channel pins the host key, separates directions and rejects replay', async () => {
  const hostKey = await createKaraokeHandshakeKey();
  const guestKey = await createKaraokeHandshakeKey();
  const wrongKey = await createKaraokeHandshakeKey();
  const challenge = makeKaraokeChallenge();
  const host = await KaraokeSecureChannel.create('host', hostKey, guestKey.publicKey, challenge);
  const guest = await KaraokeSecureChannel.create('guest', guestKey, hostKey.publicKey, challenge);
  const impersonator = await KaraokeSecureChannel.create('host', wrongKey, guestKey.publicKey, challenge);
  const value = { password: 'test-phrase' };
  const request = await guest.seal(value);
  assert.equal(request.includes(value.password), false);
  await assert.rejects(() => impersonator.open(request));
  assert.deepEqual(await host.open(request), value);
  await assert.rejects(() => host.open(request));
  const response = await host.seal({ approved: true });
  assert.deepEqual(await guest.open(response), { approved: true });
  assert.throws(() => parseKaraokeAddress('8.8.8.8:1234#' + hostKey.publicKey));
  assert.throws(() => parseKaraokeAddress('192.168.1.8:1234'));
});

test('encrypted LAN lifecycle covers admission, synced scores, reconnect, and room shutdown', async t => {
  const network = networkPair();
  const host = new KaraokeRoomTransport(false, network.port('host'));
  const guest = new KaraokeRoomTransport(true, network.port('guest'));
  t.after(() => Promise.all([host.close(), guest.close()]));
  await host.create({ displayName: 'Host', password: 'test-room-pass' });
  assert.equal(host.state.phase, 'connected');
  const { addresses: [address], roomCode } = host.state.invitation;

  await guest.join({ address, roomCode, displayName: 'Guest', password: 'wrong-pass' });
  await until(() => guest.state.error?.code === 'WRONG_PASSWORD', 'bad password error');

  await guest.join({ address, roomCode, displayName: 'Guest', password: 'test-room-pass' });
  await until(() => guest.state.phase === 'waiting' && host.state.requests.length === 1, 'join pending');
  host.reject(host.state.requests[0].id);
  await until(() => guest.state.phase === 'rejected', 'host rejection');

  await guest.join({ address, roomCode, displayName: 'Guest', password: 'test-room-pass' });
  await until(() => guest.state.phase === 'waiting' && host.state.requests.length === 1, 'new pending join');
  host.approve(host.state.requests[0].id, 'singer', 'red');
  await until(() => guest.state.phase === 'connected', 'approved snapshot');
  const memberId = guest.state.memberId;
  assert.equal(guest.state.room.members.find(member => member.id === memberId)?.side, 'red');
  assert.ok(Math.abs(guest.state.clockOffsetMs) < 500);
  assert.ok(network.frames.every(({ value }) => !/test-room-pass|wrong-pass|Guest/.test(value)), 'wire text never has join credentials');

  guest.send({ type: 'member.ready', ready: true });
  guest.send({ type: 'queue.add', recordingId: 'test-song', mode: 'solo' });
  await until(() => host.state.room.members.find(member => member.id === memberId)?.ready && host.state.room.queue.length, 'host queue and ready');
  host.start(host.state.room.queue[0].id);
  await until(() => guest.state.room.status === 'singing', 'synchronized countdown');
  const itemId = guest.state.room.currentItemId;
  const revision = guest.state.room.battle.revision;
  const score = (lineIndex, total) => ({
    type: 'score.line', itemId, revision, lineIndex, clientSentAtMs: Date.now(),
    lineScore: { lineIndex, startMs: lineIndex * 1000, endMs: (lineIndex + 1) * 1000, pitch: 90, rhythm: 90, lyrics: 90, completeness: 90, breath: 90, total, feedback: [] },
  });
  guest.send(score(0, 80));
  await until(() => host.state.room.battle.redScore > 0 && guest.state.room.battle.redScore === host.state.room.battle.redScore, 'red score synchronized');
  const confirmed = guest.state.room.battle.redScore;
  network.dropNextGuestWrite();
  guest.send(score(1, 85));
  await until(() => guest.state.phase === 'connected' && guest.state.room.battle.redScore > confirmed, 'reconnected and delivered pending score');
  assert.equal(guest.state.memberId, memberId);
  assert.equal(host.state.room.battle.redScore, 165);

  network.dropNextGuestWrite();
  guest.send(score(2, 90));
  await until(() => host.state.room.members.some(member => member.id === memberId && !member.connected), 'host observes disconnect');
  host.finish();
  assert.equal(host.state.room.status, 'results');
  assert.equal(host.state.room.battle.redScore, 165);
  assert.ok(host.state.room.battle.settlingUntilMs);
  await until(() => guest.state.phase === 'connected' && guest.state.room.battle.redScore === 255, 'finishing round accepts pending score after reconnect');
  assert.equal(guest.state.unsubmittedScoreCount, 0);

  await host.closeRoom();
  await until(() => guest.state.phase === 'closed', 'room shutdown broadcast');
});
