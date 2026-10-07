const { contextBridge, ipcRenderer } = require('electron');

let handlers = null;
let httpActive = 0;

// Keep this check in the sandbox preload: validating after IPC is too late to
// prevent the main process from receiving an oversized structured clone.
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

contextBridge.exposeInMainWorld('zenix', {
  register(value) {
    if (handlers || !value || typeof value !== 'object') throw new Error('音乐源只能注册一次');
    handlers = value;
    ipcRenderer.send('source:registered');
  },
});

ipcRenderer.on('source:invoke', async (_event, request) => {
  const { id, method, payload, settings } = request || {};
  try {
    if (!handlers || typeof handlers[method] !== 'function') throw new Error(`音乐源未实现 ${method}`);
    const api = Object.freeze({
      settings: Object.freeze(settings || {}),
      request: async options => {
        boundedMessage(options, 1024 * 1024);
        if (httpActive >= 8) throw new Error('音乐源请求并发过多');
        httpActive++;
        try { return await ipcRenderer.invoke('source:http', options); }
        finally { httpActive--; }
      },
    });
    const result = await handlers[method](payload, api);
    ipcRenderer.send('source:result', { id, ok: true, result: boundedMessage(result) });
  } catch (error) {
    ipcRenderer.send('source:result', { id, ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
  }
});
