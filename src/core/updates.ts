import { Capacitor, registerPlugin } from '@capacitor/core';
export type UpdateState = { status: 'idle' | 'checking' | 'unpublished' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'; currentVersion: string; currentBuild?: number; version?: string; build?: number; channel?: string; message: string; progress: number; notes?: string };
export type UpdateRequest = { operation: 'state' | 'check' | 'download' | 'cancel' | 'install' | 'sourceBundle'; channel?: string; url?: string };
export type UpdatePreferences = { automatic: boolean; autoDownload: boolean; channel: 'stable' | 'preview' };
const plugin = registerPlugin<{ invoke(options: { action: string; payload: UpdateRequest }): Promise<{ value: unknown }> }>('ZenixNative');
let pending = 0;
export const updatesBusy = () => pending > 0;
export const updateSupported = () => Boolean(window.yzqxy?.updates || Capacitor.isNativePlatform());
export const updateIsIOS = () => Capacitor.getPlatform() === 'ios';
export async function invokeUpdate<T = UpdateState>(request: UpdateRequest): Promise<T> {
  const long = ['check', 'download', 'install'].includes(request.operation);
  if (long) { pending++; window.dispatchEvent(new Event('zenix-update-state')); }
  try {
    let value: unknown;
    if (window.yzqxy?.updates) value = await window.yzqxy.updates.invoke(request);
    else if (Capacitor.isNativePlatform()) value = (await plugin.invoke({ action: 'updates', payload: request })).value;
    else throw new Error('请在安装后的 Zenix 应用中使用此功能');
    if (request.operation === 'check' && ['available', 'current'].includes((value as UpdateState).status)) localStorage.setItem('zenix.updates.lastCheck', String(Date.now()));
    return value as T;
  } finally { if (long) { pending--; window.dispatchEvent(new Event('zenix-update-state')); } }
}
export function updatePreferences(): UpdatePreferences {
  try { const saved = JSON.parse(localStorage.getItem('zenix.updates') || '{}'); return { automatic: saved.automatic !== false, autoDownload: saved.autoDownload === true, channel: saved.channel === 'preview' ? 'preview' : 'stable' }; }
  catch { return { automatic: true, autoDownload: false, channel: 'stable' }; }
}
export function saveUpdatePreferences(value: UpdatePreferences) { localStorage.setItem('zenix.updates', JSON.stringify(value)); }
// One startup timer, one foreground recheck after 12 hours; no idle polling.
export function startAutomaticUpdates() {
  if (!updateSupported()) return () => {};
  let stopped = false, active = false, lastAttempt = 0;
  async function check() {
    if (stopped || active || updatesBusy() || document.hidden || !navigator.onLine) return;
    const preferences = updatePreferences(); if (!preferences.automatic) return;
    if (Date.now() - Number(localStorage.getItem('zenix.updates.lastCheck') || 0) < 12 * 60 * 60 * 1000) return;
    if (Date.now() - lastAttempt < 15 * 60 * 1000) return;
    active = true; lastAttempt = Date.now();
    try {
      const next = await invokeUpdate({ operation: 'check', channel: preferences.channel });
      if (!['error', 'unpublished'].includes(next.status)) localStorage.setItem('zenix.updates.lastCheck', String(Date.now()));
      window.dispatchEvent(new Event('zenix-update-state'));
      if (!stopped && next.status === 'available' && preferences.autoDownload && !updateIsIOS()) { await invokeUpdate({ operation: 'download' }); window.dispatchEvent(new Event('zenix-update-state')); }
    } catch { /* Manual update UI reports errors; startup does not interrupt listening. */ }
    finally { active = false; }
  }
  const timer = window.setTimeout(() => void check(), 15000);
  document.addEventListener('visibilitychange', check); window.addEventListener('online', check);
  return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', check); window.removeEventListener('online', check); };
}
