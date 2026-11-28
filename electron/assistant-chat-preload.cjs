const {contextBridge, ipcRenderer} = require('electron');

const observe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('zenixChat', {
  pocket: true,
  invoke: value => ipcRenderer.invoke('assistant-chat:invoke', value),
  onSnapshot: callback => observe('assistant-chat:snapshot', callback),
});
contextBridge.exposeInMainWorld('yzqxy', {
  assistantModel: {
    invoke: value => ipcRenderer.invoke('assistant-model:invoke', value),
    onDelta: callback => observe('assistant-model:delta', callback),
  },
});
