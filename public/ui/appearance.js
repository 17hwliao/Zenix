import {CARD_FRAME, frameVars} from './nine-slice.js';

export const appearanceKey = 'zenix.ui-appearance.v1';
export const styles = ['default', 'glass', 'neon', 'paper', 'sharp'];
export const accents = ['cyan', 'red', 'orange', 'blue', 'purple', 'green'];
export const defaults = Object.freeze({version: 1, mode: 'dark', style: 'neon', accent: 'red', frame: true, button: 'blog', buttonFrame: false, radius: 10, stroke: 1, depth: 2, height: 40, motion: true});
export function parseAppearance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) throw Error('外观设置格式不受支持');
  const next = {...defaults, ...value};
  for (const [key, allowed] of Object.entries({mode: ['dark','light','system'], style: styles, accent: accents, button: ['blog','solid','outline','pixel']})) {
    if (!allowed.includes(next[key])) throw Error('外观设置包含无效选项');
  }
  for (const [key, min, max] of [['radius',0,24],['stroke',1,3],['depth',0,8],['height',36,52]]) {
    if (typeof next[key] !== 'number' || !Number.isFinite(next[key]) || next[key] < min || next[key] > max) throw Error('按钮参数超出范围');
  }
  for (const key of ['frame','buttonFrame','motion']) if (typeof next[key] !== 'boolean') throw Error('外观开关格式无效');
  return Object.fromEntries(Object.keys(defaults).map(key => [key,next[key]]));
}
export function readAppearance(storage) {
  try {const raw = (storage || localStorage).getItem(appearanceKey); return {value: raw === null ? {...defaults} : parseAppearance(JSON.parse(raw)), error: ''};}
  catch {return {value: {...defaults}, error: '已使用默认外观，原设置无法读取。请重试，或恢复默认后重新调节。'};}
}
export function saveAppearance(value, {reset = false, storage = localStorage} = {}) {
  const parsed = parseAppearance(value);
  if (!reset && readAppearance(storage).error) throw Error('原外观设置无法读取；恢复默认后才能覆盖。');
  storage.setItem(appearanceKey, JSON.stringify(parsed));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('zenix:appearance-changed'));
  return parsed;
}
export function applyAppearance(root, value, darkSystem = false) {
  const current = parseAppearance(value);
  Object.assign(root.dataset, {theme: current.mode === 'system' ? darkSystem ? 'dark' : 'light' : current.mode, bentoStyle: current.style, bentoAccent: current.accent, bentoBorder: current.frame ? 'custom' : 'normal', buttonStyle: current.button, buttonFrame: current.buttonFrame ? 'custom' : 'normal', appearanceMotion: current.motion ? 'full' : 'reduced'});
  const vars = {...CARD_FRAME, ...frameVars('bt', {cornerSize: 10 + current.radius * .5, borderWidth: 3 + current.stroke * 3})};
  for (const name of ['radius','stroke','depth','height']) vars['--zx-button-'+name] = current[name] + 'px';
  for (const [key,value] of Object.entries(vars)) root.style.setProperty(key,value);
}
// Shared by React owners and auxiliary native windows. Storage events synchronize
// documents with the same application origin; no library or credential reads.
const owners = new WeakMap();
export function installAppearance(doc = document) {
  let owner = owners.get(doc);
  if (!owner) {
    const root = doc.documentElement, view = doc.defaultView;
    const media = view.matchMedia('(prefers-color-scheme: dark)');
    const names = ['theme','bentoStyle','bentoAccent','bentoBorder','buttonStyle','buttonFrame','appearanceMotion'];
    const previous = names.map(key => [key,root.dataset[key]]);
    const oldStyle = new Map();
    const update = () => {
      let settings;try {settings=readAppearance(view.localStorage);} catch {settings={value:{...defaults}};}
      applyAppearance(root, settings.value, media.matches);
    };
    // Preserve only the inline properties this owner changes.
    for (const key of [...Object.keys(CARD_FRAME),...Object.keys(frameVars('bt')), ...['radius','stroke','depth','height'].map(k=>'--zx-button-'+k)]) oldStyle.set(key,root.style.getPropertyValue(key));
    const storage = event => {if (event.key === appearanceKey || event.key === null) update();};
    const structural = 'nav button,[role=switch],[role=tab],[data-style-option],[data-destination],.yz-switch,.toggle,.zenix-orbit-card,.zenix-holo-card,.zenix-desktop-track,.zenix-desktop-playlist-open,.zenix-desktop-playlist-play,.zenix-manager-track,.zenix-local-track,.zenix-desktop-brand,.assistant-corner-character,.assistant-hold-voice,.zx-home-counts button,.zx-style-quick button,.zenix-style-settings button:not(.zx-button-sample),.yz-window-controls button,.yz-track-actions-menu button,.zenix-select-menu button,.zenix-chat-history-list button,.zenix-workspace-breadcrumb button,.yz-playerbar button,.mobile-mini button,.mobile-nav button,.mobile-lyrics button,.yz-lattice-lyrics button,.space-sticker button,.space-poster,.mini-info,.full-song button';
    const ownedControls = new WeakSet();
    const tag = button => {
      if (!button.matches(structural) && button.textContent.trim()) {
        if (!button.hasAttribute('data-appearance-action')) {ownedControls.add(button);button.setAttribute('data-appearance-action','');}
      } else if (ownedControls.has(button)) button.removeAttribute('data-appearance-action');
    };
    const scan = node => {
      const element = node.nodeType === 1 ? node : node.parentElement;
      if (!element) return;
      if (element.matches('button')) tag(element);
      const button = element.closest('button');if(button)tag(button);
      element.querySelectorAll('button').forEach(tag);
    };
    scan(root);
    const controls = new MutationObserver(records => {for(const record of records){if(record.type==='characterData')scan(record.target);else{record.addedNodes.forEach(scan);const button=record.target.parentElement?.closest('button');if(button)tag(button);}}});
    controls.observe(root,{subtree:true,childList:true,characterData:true});
    update();view.addEventListener('zenix:appearance-changed',update);view.addEventListener('storage',storage);media.addEventListener('change',update);
    owner = {users: 0, dispose() {
      view.removeEventListener('zenix:appearance-changed',update);view.removeEventListener('storage',storage);media.removeEventListener('change',update);
      controls.disconnect();doc.querySelectorAll('[data-appearance-action]').forEach(button=>{if(ownedControls.has(button))button.removeAttribute('data-appearance-action');});
      for (const [key,value] of previous) {if(value === undefined)delete root.dataset[key];else root.dataset[key]=value;}
      for (const [key,value] of oldStyle) {if(value)root.style.setProperty(key,value);else root.style.removeProperty(key);}
      owners.delete(doc);
    }}; owners.set(doc,owner);
  }
  owner.users++;
  let disposed = false;
  return () => {if(disposed)return;disposed=true;if(--owner.users === 0)owner.dispose();};
}
