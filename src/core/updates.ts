import { Capacitor, registerPlugin } from '@capacitor/core';
import { automaticUpdateScheduler } from './updateScheduler';
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
    if (request.operation === 'check' && ['available', 'current'].includes((value as UpdateState).status)) {
      try { localStorage.setItem(`zenix.updates.lastCheck.${request.channel || 'stable'}`, String(Date.now())); } catch { /* Storage failure cannot turn a successful check into an error. */ }
    }
    return value as T;
  } finally { if (long) { pending--; window.dispatchEvent(new Event('zenix-update-state')); } }
}
export function updatePreferences(): UpdatePreferences {
  try { const saved = JSON.parse(localStorage.getItem('zenix.updates') || '{}'); return { automatic: saved.automatic !== false, autoDownload: saved.autoDownload === true, channel: saved.channel === 'preview' ? 'preview' : 'stable' }; }
  catch { return { automatic: true, autoDownload: false, channel: 'stable' }; }
}
export function saveUpdatePreferences(value: UpdatePreferences) { localStorage.setItem('zenix.updates', JSON.stringify(value)); window.dispatchEvent(new Event('zenix-update-preferences')); }
export function startAutomaticUpdates() {
  if (!updateSupported()) return () => {};
  const scheduler = automaticUpdateScheduler({ now: Date.now, allowed: () => !document.hidden && navigator.onLine, busy: updatesBusy,
    preferences: updatePreferences,
    lastCheck: channel => { try { return Number(localStorage.getItem(`zenix.updates.lastCheck.${channel}`) || 0); } catch { return 0; } },
    check: channel => invokeUpdate({ operation: 'check', channel }), state: () => invokeUpdate({ operation: 'state' }),
    download: () => invokeUpdate({ operation: 'download' }), canDownload: () => !updateIsIOS(),
    setTimer: (callback, delay) => window.setTimeout(callback, delay), clearTimer: timer => window.clearTimeout(timer),
  });
  document.addEventListener('visibilitychange', scheduler.wake); window.addEventListener('online', scheduler.wake);
  window.addEventListener('zenix-update-preferences', scheduler.preferencesChanged);
  return () => { scheduler.stop(); document.removeEventListener('visibilitychange', scheduler.wake); window.removeEventListener('online', scheduler.wake); window.removeEventListener('zenix-update-preferences', scheduler.preferencesChanged); };
}
