const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('zenixWidget',{action:action=>ipcRenderer.invoke('widget:action',action),observe:callback=>ipcRenderer.on('widget:state',(_event,state)=>callback(state))});
