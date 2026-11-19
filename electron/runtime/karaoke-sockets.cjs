const http = require('node:http');
const os = require('node:os');
const { WebSocket, WebSocketServer } = require('ws');

const PATH = '/zenix/karaoke';
const MAX_FRAME = 144 * 1024;
const MAX_PEERS = 12;

function privateIpv4(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) return false;
  const [a, b, c, d] = value.split('.').map(Number);
  return [a, b, c, d].every(n => n <= 255)
    && (a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168);
}

function lanInterfaces() {
  return [...new Set(Object.values(os.networkInterfaces()).flat()
    .filter(info => info && info.family === 'IPv4' && !info.internal && privateIpv4(info.address))
    .map(info => info.address))];
}

function validFrame(value) {
  return typeof value === 'string' && Buffer.byteLength(value) <= MAX_FRAME;
}

class KaraokeSockets {
  constructor(emit) {
    this.emit = emit;
    this.peers = new Map();
    this.servers = new Set();
    this.nextPeer = 0;
  }

  attach(socket, id, address) {
    this.peers.set(id, socket);
    const emit = (type, fields = {}) => {
      if (this.peers.get(id) === socket) this.emit({ type, id, address, ...fields });
    };
    socket.on('error', error => emit('error', {
      code: error.code === 'ECONNREFUSED' ? 'PORT_REFUSED' : 'UNREACHABLE',
    }));
    socket.on('close', () => {
      emit('closed');
      if (this.peers.get(id) === socket) this.peers.delete(id);
    });
    socket.on('message', (buffer, binary) => {
      if (binary) return socket.close(1003, 'Text frames required');
      emit('message', { data: buffer.toString('utf8') });
    });
    if (socket.readyState === WebSocket.OPEN) emit('open');
    else socket.once('open', () => emit('open'));
  }

  async listen() {
    if (this.servers.size || this.peers.size) throw Error('请先关闭当前房间连接');
    const addresses = lanInterfaces();
    if (!addresses.length) throw Error('没有可用于 K 歌的局域网 IPv4 地址');
    const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME, perMessageDeflate: false, clientTracking: false, skipUTF8Validation: false });
    this.sockets = sockets;
    const bound = [];
    try {
      for (const address of addresses) {
        if (this.sockets !== sockets) break;
        const server = http.createServer({ maxHeaderSize: 4096, requestTimeout: 5000, headersTimeout: 5000 },
          (_request, response) => response.writeHead(404).end());
        server.maxConnections = MAX_PEERS + 4;
        server.on('upgrade', (request, connection, head) => {
          const remote = connection.remoteAddress;
          if (this.sockets !== sockets || this.peers.size >= MAX_PEERS || !privateIpv4(remote)
              || request.url !== PATH || request.headers.origin !== undefined
              || request.headers.host !== `${address}:${server.address()?.port}`) {
            connection.destroy();
            return;
          }
          sockets.handleUpgrade(request, connection, head, socket => this.attach(socket, `peer-${++this.nextPeer}`, remote));
        });
        this.servers.add(server);
        try {
          await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.once('close', () => reject(Error('已关闭 K 歌监听')));
            server.listen({ port: 0, host: address, exclusive: true }, resolve);
          });
          if (this.sockets !== sockets) {
            server.close();
            break;
          }
          bound.push(`${address}:${server.address().port}`);
        } catch {
          this.servers.delete(server);
          server.close();
        }
      }
      if (!bound.length || this.sockets !== sockets) throw Error('无法监听本机局域网地址');
      return bound;
    } catch (error) {
      if (this.sockets === sockets) this.stop();
      throw error;
    }
  }

  connect(address, id) {
    if (this.servers.size || this.peers.size || typeof id !== 'string' || !/^guest-\d{1,10}$/.test(id)) throw Error('无效的 K 歌连接');
    const match = /^(\d{1,3}(?:\.\d{1,3}){3}):([1-9]\d{0,4})$/.exec(typeof address === 'string' ? address : '');
    if (!match || !privateIpv4(match[1]) || Number(match[2]) > 65535) throw Error('请输入局域网 IP 和端口');
    const socket = new WebSocket(`ws://${address}${PATH}`, {
      maxPayload: MAX_FRAME, perMessageDeflate: false, followRedirects: false, handshakeTimeout: 5000,
    });
    this.attach(socket, id, match[1]);
    return true;
  }

  invoke(args) {
    switch (args?.action) {
      case 'listen': return this.listen();
      case 'connect': return this.connect(args.address, args.id);
      case 'send': {
        const socket = this.peers.get(args.id);
        if (!validFrame(args.data) || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_FRAME * 4) throw Error('K 歌连接当前无法发送消息');
        socket.send(args.data, { binary: false });
        return true;
      }
      case 'close': {
        const socket = this.peers.get(args.id);
        this.peers.delete(args.id);
        if (socket?.readyState === WebSocket.OPEN) {
          socket.close(1000);
          const deadline = setTimeout(() => socket.terminate(), 750);
          deadline.unref();
          socket.once('close', () => clearTimeout(deadline));
        } else socket?.terminate();
        return true;
      }
      case 'stop': this.stop(); return true;
      default: throw Error('无效的 K 歌网络操作');
    }
  }

  stop() {
    for (const id of this.peers.keys()) this.invoke({ action: 'close', id });
    for (const server of this.servers) {
      server.close();
      server.closeAllConnections();
    }
    this.servers.clear();
    this.sockets?.close();
    this.sockets = null;
  }
}

module.exports = { KaraokeSockets, privateIpv4 };
