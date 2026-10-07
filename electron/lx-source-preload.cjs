const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = Object.freeze({ request: 'request', inited: 'inited', updateAlert: 'updateAlert' });
let requestHandler = null;
let initialized = false;
let httpActive = 0;
const scriptInfo = ipcRenderer.sendSync('source:lx-info');

// Sandbox preloads cannot require local helper modules. Bound the message here,
// before Electron clones it into the privileged process.
function boundedMessage(value, limit = 4 * 1024 * 1024) {
  let remaining = limit, nodes = 0;
  const parents = new Set();
  function visit(item, depth) {
    if (++nodes > 100000 || depth > 32) throw new Error('音乐源数据结构过大');
    if (typeof item === 'string') remaining -= item.length * 2;
    else if (item && typeof item === 'object') {
      if (parents.has(item)) throw new Error('音乐源不能返回循环数据');
      parents.add(item);
      for (const key in item) if (Object.prototype.hasOwnProperty.call(item, key)) {
        remaining -= key.length * 2 + 16;
        if (remaining < 0) throw new Error('音乐源数据超过大小限制');
        visit(item[key], depth + 1);
      }
      parents.delete(item);
    } else if (typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint') throw new Error('音乐源数据类型不受支持');
    else remaining -= 16;
    if (remaining < 0) throw new Error('音乐源数据超过大小限制');
  }
  visit(value, 0); return value;
}

function bytes(value, limit = 4 * 1024 * 1024) {
  const length = value instanceof ArrayBuffer ? value.byteLength : value?.length || 0;
  if (length > limit) throw new Error('音乐源二进制数据过大');
  const data = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value || []);
  if (data.byteLength > limit) throw new Error('音乐源二进制数据过大');
  return data;
}

function syncCrypto(action, values) {
  const result = ipcRenderer.sendSync('source:lx-crypto', { action, values });
  if (result?.error) throw new Error(result.error);
  return result?.bytes ? new Uint8Array(result.bytes) : result?.value;
}

const lx = {
  version: '2.0.0',
  env: 'desktop',
  EVENT_NAMES: EVENTS,
  currentScriptInfo: scriptInfo,
  on(event, handler) {
    if (event !== EVENTS.request || typeof handler !== 'function') throw new Error('音乐源事件无效');
    requestHandler = handler;
  },
  send(event, data) {
    if (event === EVENTS.inited) {
      if (initialized || !requestHandler) throw new Error('音乐源脚本初始化无效');
      initialized = true;
      ipcRenderer.send('source:lx-inited', boundedMessage(data, 256 * 1024));
    } else if (event !== EVENTS.updateAlert) throw new Error('音乐源事件无效');
  },
  request(url, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (typeof callback !== 'function') throw new Error('音乐源网络回调无效');
    boundedMessage({ url, options: options || {} }, 1024 * 1024);
    if (httpActive >= 8) throw new Error('音乐源请求并发过多');
    httpActive++;
    let cancelled = false;
    ipcRenderer.invoke('source:lx-http', { url, options: options || {} }).then(result => {
      if (!cancelled) {
        const body = result.binary ? new Uint8Array(result.body) : result.body;
        callback(null, { statusCode: result.status, headers: result.headers, body }, body);
      }
    }).catch(error => { if (!cancelled) callback(error); }).finally(() => { httpActive--; });
    return () => { cancelled = true; };
  },
  utils: {
    buffer: {
      from(value, encoding) {
        if (typeof value !== 'string') return bytes(value);
        if (value.length > 8 * 1024 * 1024) throw new Error('音乐源二进制数据过大');
        if (encoding === 'base64') return Uint8Array.from(atob(value), char => char.charCodeAt(0));
        if (encoding === 'hex') return Uint8Array.from(value.match(/.{1,2}/g) || [], part => parseInt(part, 16));
        return bytes(value);
      },
      bufToString(value, encoding = 'utf8') {
        if (encoding === 'hex') return Array.from(bytes(value), byte => byte.toString(16).padStart(2, '0')).join('');
        if (encoding === 'base64') {
          const data = bytes(value); let binary = '';
          for (let index = 0; index < data.length; index += 8192) binary += String.fromCharCode(...data.subarray(index, index + 8192));
          return btoa(binary);
        }
        return new TextDecoder().decode(bytes(value));
      },
    },
    crypto: {
      md5(value) { return syncCrypto('md5', value instanceof Uint8Array ? { bytes: bytes(value, 1024 * 1024) } : boundedMessage({ value: String(value) }, 2 * 1024 * 1024 + 100)); },
      randomBytes(size) { return syncCrypto('randomBytes', { size }); },
      aesEncrypt(buffer, mode, key, iv) { return syncCrypto('aesEncrypt', { buffer: bytes(buffer, 1024 * 1024), mode: String(mode).slice(0, 40), key: bytes(key, 64), iv: iv == null ? null : bytes(iv, 32) }); },
      rsaEncrypt(buffer, key) { if (typeof key !== 'string' || key.length > 10000) throw new Error('加密公钥无效'); return syncCrypto('rsaEncrypt', { buffer: bytes(buffer, 1024 * 1024), key }); },
    },
    zlib: {
      async inflate(buffer) { return new Uint8Array(await ipcRenderer.invoke('source:lx-zlib', { action: 'inflate', bytes: bytes(buffer, 2 * 1024 * 1024) })); },
      async deflate(buffer) { return new Uint8Array(await ipcRenderer.invoke('source:lx-zlib', { action: 'deflate', bytes: bytes(buffer, 2 * 1024 * 1024) })); },
    },
  },
};

contextBridge.exposeInMainWorld('lx', lx);
ipcRenderer.on('source:invoke', async (_event, request) => {
  try {
    if (!initialized || !requestHandler) throw new Error('音乐源脚本未初始化');
    const { source, action, info } = request.payload || {};
    const result = await requestHandler({ source, action, info });
    ipcRenderer.send('source:result', { id: request.id, ok: true, result: boundedMessage(result) });
  } catch (error) {
    ipcRenderer.send('source:result', { id: request.id, ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
  }
});
