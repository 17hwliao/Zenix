const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopLyrics', {
  onData: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('lyrics:data', listener); return () => ipcRenderer.removeListener('lyrics:data', listener); },
  hide: () => ipcRenderer.send('lyrics:hide'),
  command: command => ipcRenderer.send('lyrics:command', command),
  seek: (trackId, seconds) => ipcRenderer.send('lyrics:seek', { trackId, seconds }),
  lockState: () => ipcRenderer.invoke('lyrics:lock-state'),
  setLocked: value => ipcRenderer.invoke('lyrics:set-locked', value),
  unlock: () => ipcRenderer.send('lyrics:unlock'),
  onLockedChanged: callback => { const listener = (_event, value) => callback(Boolean(value)); ipcRenderer.on('lyrics:locked', listener); return () => ipcRenderer.removeListener('lyrics:locked', listener); },
});
