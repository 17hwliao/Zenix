const{contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('zenixPetInteraction',{
  perform:kind=>ipcRenderer.invoke('assistant:pet-action',{action:'interaction',kind}),
  scale:delta=>ipcRenderer.invoke('assistant:pet-action',{action:'scale',delta}),
  hover:inside=>ipcRenderer.invoke('assistant:pet-action',{action:'hover',inside}),
  hit:inside=>ipcRenderer.invoke('assistant:pet-action',{action:'hit',inside}),
});
contextBridge.exposeInMainWorld('zenixPet',{speech:args=>ipcRenderer.invoke('assistant:pet-speech',args),onFeedback:callback=>{const listener=(_,value)=>callback(value);ipcRenderer.on('assistant:feedback',listener);return()=>ipcRenderer.removeListener('assistant:feedback',listener);},act:action=>ipcRenderer.invoke('assistant:pet-action',{action}),drag:(phase,token)=>ipcRenderer.invoke('assistant:pet-drag',{phase,token}),onSkin:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('assistant:pet-skin',listener);return()=>ipcRenderer.removeListener('assistant:pet-skin',listener);},onOptions:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('assistant:pet-options',listener);return()=>ipcRenderer.removeListener('assistant:pet-options',listener);}});
