import './space/model.cjs';
import './playback/preferences.cjs';
import * as imported from './settingsBackup.cjs';
type Settings={schema:1;present:Record<string,boolean>;space:Record<string,unknown>;playbackPreferences:Record<string,unknown>;assistant:Record<string,unknown>;networkPolicy:Record<string,string>};
type API={clean:(raw?:unknown)=>Settings;canonical:(value:unknown)=>string;diff:(current:unknown,incoming:unknown)=>{key:string;label:string;status:string}[]};
const direct=imported as unknown as API;
export const settingsBackup=((imported as unknown as {default?:API}).default||(typeof direct.clean==='function'?direct:(globalThis as typeof globalThis&{zenixSettingsBackup:API}).zenixSettingsBackup));
const keys={space:'zenix.space.features.v1',playbackPreferences:'zenix.playback-preferences.v1',assistant:'zenix.assistant.ui.v1'} as const;
export function captureFeatureSettings(storage:Storage=localStorage):Settings{const values:Record<string,unknown>={},present:Record<string,boolean>={};for(const [kind,key]of Object.entries(keys)){const raw=storage.getItem(key);present[kind]=raw!==null;if(raw!==null)values[kind]=JSON.parse(raw);}return settingsBackup.clean({...values,present});}
export function applyFeatureSettings(target:unknown,previous:unknown,storage:Storage=localStorage):void{
 const next=settingsBackup.clean(target),before=settingsBackup.clean(previous),current=captureFeatureSettings(storage);
 const selected=(value:Settings)=>({space:value.space,playbackPreferences:value.playbackPreferences,assistant:value.assistant,present:{space:value.present.space,playbackPreferences:value.present.playbackPreferences,assistant:value.present.assistant}});
 if(settingsBackup.canonical(selected(current))===settingsBackup.canonical(selected(next)))return;
 if(settingsBackup.canonical(selected(current))!==settingsBackup.canonical(selected(before)))throw Error('设置已有新的修改，已保留当前内容；请重新处理恢复预览');
 const written:{key:string;old:string|null;value:string|null}[]=[];
 try{for(const [kind,key]of Object.entries(keys)){const old=storage.getItem(key),value=next.present[kind]?JSON.stringify(next[kind as keyof typeof keys]):null;if(value===null)storage.removeItem(key);else storage.setItem(key,value);written.push({key,old,value});}}
 catch(error){for(const row of written.reverse())if(storage.getItem(row.key)===row.value){try{if(row.old===null)storage.removeItem(row.key);else storage.setItem(row.key,row.old);}catch{}}throw error;}
 window.dispatchEvent(new CustomEvent('zenix-space-settings',{detail:next.space}));window.dispatchEvent(new CustomEvent('zenix-playback-preferences'));window.dispatchEvent(new CustomEvent('zenix-settings-restored'));
}
