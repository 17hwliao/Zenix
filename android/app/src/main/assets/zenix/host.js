(() => {
  const pending = new Map(); let sequence = 0, handlers, lxHandler;
  const bytes = value => value instanceof Uint8Array ? value : typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value || []);
  const buffer = {
    from(value, encoding) {
      if (typeof value !== 'string') return bytes(value);
      if (encoding === 'base64' || encoding === 'base64url') return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      if (encoding === 'hex') return Uint8Array.from(value.match(/.{1,2}/g) || [], p => parseInt(p, 16));
      return bytes(value);
    },
    bufToString(value, encoding = 'utf8') {
      const data = bytes(value);
      if (encoding === 'hex') return [...data].map(b => b.toString(16).padStart(2, '0')).join('');
      if (encoding === 'base64' || encoding === 'base64url') {
        let binary = ''; for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
        const result = btoa(binary); return encoding === 'base64url' ? result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : result;
      }
      return new TextDecoder().decode(data);
    }
  };
  class PortableBuffer extends Uint8Array {
    static from(value, encoding) { return new PortableBuffer(buffer.from(value, encoding)); }
    static byteLength(value) { return bytes(value).length; }
    toString(encoding) { return buffer.bufToString(this, encoding); }
    indexOf(value, start = 0) {
      if (typeof value !== 'string') return super.indexOf(value, start);
      const needle = bytes(value); outer: for (let i = start; i <= this.length - needle.length; i++) { for (let j = 0; j < needle.length; j++) if (this[i+j] !== needle[j]) continue outer; return i; } return -1;
    }
  }
  globalThis.Buffer = PortableBuffer;
  const request = (url, options = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject });
    NativeHost.http(JSON.stringify({ id, url: String(url), options }));
  });
  globalThis.__networkResult = (id, data, error) => {
    const callback = pending.get(id); if (!callback) return; pending.delete(id);
    if (error) callback.reject(new Error(error)); else callback.resolve(data);
  };
  globalThis.fetch = async (url, options) => {
    const result = await request(url, options); const data = buffer.from(result.data, 'base64');
    return { ok: result.status >= 200 && result.status < 300, status: result.status,
      headers: { get: name => result.headers[String(name).toLowerCase()] ?? null },
      text: async () => buffer.bufToString(data), arrayBuffer: async () => data.buffer, json: async () => JSON.parse(buffer.bufToString(data)) };
  };
  const crypto = (action, values) => {
    const result = JSON.parse(NativeHost.crypto(JSON.stringify({ action, values })));
    if (result.error) throw new Error(result.error);
    return result.bytes ? buffer.from(result.bytes, 'base64') : result.value;
  };
  globalThis.lx = Object.freeze({
    version: '2.0.0', env: 'mobile', currentScriptInfo: globalThis.__scriptInfo,
    EVENT_NAMES: Object.freeze({ request: 'request', inited: 'inited', updateAlert: 'updateAlert' }),
    on(event, handler) { if (event !== 'request' || typeof handler !== 'function') throw new Error('无效音乐源事件'); lxHandler = handler; },
    send(event, data) { if (event === 'inited') { if (!lxHandler) throw new Error('未注册播放解析'); NativeHost.ready(JSON.stringify(data)); } },
    request(url, options, callback) {
      if (typeof options === 'function') { callback = options; options = {}; }
      let cancelled = false;
      request(url, options).then(result => {
        if (cancelled) return;
        const raw = buffer.from(result.data, 'base64'); const binary = options?.encoding === null || options?.responseType === 'arraybuffer' || /(?:image|audio|octet-stream|gzip|zip)/i.test(result.headers['content-type'] || '');
        let body = binary ? raw : buffer.bufToString(raw);
        if (typeof body === 'string' && (options?.json || /json/i.test(result.headers['content-type'] || '') || /^\s*[\[{]/.test(body))) { try { body = JSON.parse(body); } catch {} }
        callback(null, { statusCode: result.status, headers: result.headers, body }, body);
      }).catch(error => { if (!cancelled) callback(error); });
      return () => { cancelled = true; };
    },
    utils: Object.freeze({ buffer, crypto: {
      md5: value => crypto('md5', { buffer: buffer.bufToString(bytes(value), 'base64') }),
      randomBytes: size => crypto('randomBytes', { size }),
      aesEncrypt: (value, mode, key, iv) => crypto('aesEncrypt', { buffer: buffer.bufToString(bytes(value), 'base64'), mode, key: buffer.bufToString(bytes(key), 'base64'), iv: iv == null ? null : buffer.bufToString(bytes(iv), 'base64') }),
      rsaEncrypt: (value, key) => crypto('rsaEncrypt', { buffer: buffer.bufToString(bytes(value), 'base64'), key }),
    }, zlib: {
      inflate: async value => buffer.from(NativeHost.zlib('inflate', buffer.bufToString(bytes(value), 'base64')), 'base64'),
      deflate: async value => buffer.from(NativeHost.zlib('deflate', buffer.bufToString(bytes(value), 'base64')), 'base64'),
    } })
  });
  globalThis.zenix = Object.freeze({ register(value) { if (handlers) throw new Error('只允许注册一次'); handlers = value; NativeHost.ready('{}'); } });
  globalThis.__invoke = async (id, method, payload, settings) => {
    try {
      let result;
      if (method.startsWith('catalog:')) result = await globalThis.zenixCatalog[method.slice(8)](...payload);
      else if (method === 'lx') result = await lxHandler(payload);
      else {
        if (typeof handlers?.[method] !== 'function') throw new Error('音乐源未实现此能力');
        result = await handlers[method](payload, Object.freeze({ settings: Object.freeze(settings), request: async options => {
          const response = await request(options.url, options); const text = buffer.bufToString(buffer.from(response.data, 'base64')); let body = text; try { body = JSON.parse(text); } catch {}
          return options.responseType === 'full' ? { status: response.status, headers: response.headers, body } : body;
        } }));
      }
      NativeHost.result(JSON.stringify({ id, value: result ?? null }));
    } catch (error) { NativeHost.result(JSON.stringify({ id, error: error.message || String(error) })); }
  };
})();
