const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopLyrics', {
  onData: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('lyrics:data', listener); return () => ipcRenderer.removeListener('lyrics:data', listener); },
  hide: () => ipcRenderer.send('lyrics:hide'),
  command: command => ipcRenderer.send('lyrics:command', command),
});
