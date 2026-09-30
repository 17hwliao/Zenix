const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = Object.freeze({ request: 'request', inited: 'inited', updateAlert: 'updateAlert' });
let requestHandler = null;
let initialized = false;
const scriptInfo = ipcRenderer.sendSync('source:lx-info');

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === 'string') return new TextEncoder().encode(value);
  return new Uint8Array(value || []);
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
      ipcRenderer.send('source:lx-inited', data);
    } else if (event !== EVENTS.updateAlert) throw new Error('音乐源事件无效');
  },
  request(url, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (typeof callback !== 'function') throw new Error('音乐源网络回调无效');
    let cancelled = false;
    ipcRenderer.invoke('source:lx-http', { url, options: options || {} }).then(result => {
      if (!cancelled) {
        const body = result.binary ? new Uint8Array(result.body) : result.body;
        callback(null, { statusCode: result.status, headers: result.headers, body }, body);
      }
    }).catch(error => { if (!cancelled) callback(error); });
    return () => { cancelled = true; };
  },
  utils: {
    buffer: {
      from(value, encoding) {
        if (typeof value !== 'string') return bytes(value);
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
      md5(value) { return syncCrypto('md5', value instanceof Uint8Array ? { bytes: Array.from(value) } : { value: String(value) }); },
      randomBytes(size) { return syncCrypto('randomBytes', { size }); },
      aesEncrypt(buffer, mode, key, iv) { return syncCrypto('aesEncrypt', { buffer: Array.from(bytes(buffer)), mode, key: Array.from(bytes(key)), iv: iv == null ? null : Array.from(bytes(iv)) }); },
      rsaEncrypt(buffer, key) { return syncCrypto('rsaEncrypt', { buffer: Array.from(bytes(buffer)), key }); },
    },
    zlib: {
      async inflate(buffer) { return new Uint8Array(await ipcRenderer.invoke('source:lx-zlib', { action: 'inflate', bytes: Array.from(bytes(buffer)) })); },
      async deflate(buffer) { return new Uint8Array(await ipcRenderer.invoke('source:lx-zlib', { action: 'deflate', bytes: Array.from(bytes(buffer)) })); },
    },
  },
};

contextBridge.exposeInMainWorld('lx', lx);
ipcRenderer.on('source:invoke', async (_event, request) => {
  try {
    if (!initialized || !requestHandler) throw new Error('音乐源脚本未初始化');
    const { source, action, info } = request.payload || {};
    const result = await requestHandler({ source, action, info });
    ipcRenderer.send('source:result', { id: request.id, ok: true, result });
  } catch (error) {
    ipcRenderer.send('source:result', { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
