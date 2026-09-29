const { contextBridge, ipcRenderer } = require('electron');

let handlers = null;

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
      request: options => ipcRenderer.invoke('source:http', options),
    });
    const result = await handlers[method](payload, api);
    ipcRenderer.send('source:result', { id, ok: true, result });
  } catch (error) {
    ipcRenderer.send('source:result', { id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
