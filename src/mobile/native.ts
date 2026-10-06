import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { PlayerState, PersonalState, Track, RawLyrics, InstalledSource } from '../core/types';

export type MobileSnapshot = {
  playback: PlayerState;
  personal: PersonalState;
  sources: InstalledSource[];
  cache: { usedBytes: number; limitMiB: number; enabled: boolean };
  profile?: { name: string; bio: string; email?: string; lyricSize?: number; lyricColor?: string; cardTransparency?: number };
  appearance?: { completed: boolean; background: { kind: 'image' | 'video'; name: string; url: string } | null };
  localTracks?: Track[];
  overlay?: { enabled: boolean; permitted: boolean; locked: boolean; compact: boolean; fontSize: number; color: string; font?: string };
};
interface NativePlugin {
  invoke(options: { action: string; payload: Record<string, unknown> }): Promise<{ value: unknown }>;
  addListener(event: 'snapshot', callback: (event: MobileUpdate) => void): Promise<PluginListenerHandle>;
}
export type MobileUpdate = Omit<Partial<MobileSnapshot>, 'playback'> & { playback?: Partial<PlayerState> };
const plugin = registerPlugin<NativePlugin>('ZenixNative');
export const isAndroid = Capacitor.getPlatform() === 'android';
export const isIOS = Capacitor.getPlatform() === 'ios';
export const isNativeMobile = isAndroid || isIOS;
export const mobilePlatform = isIOS || import.meta.env.MODE === 'ios' ? 'iOS' : 'Android';
export const supportsOverlay = isAndroid || (!Capacitor.isNativePlatform() && mobilePlatform === 'Android');
export async function command<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!isNativeMobile) throw new Error(`此操作需要安装 ${mobilePlatform} 应用；浏览器只提供界面预览。`);
  return (await plugin.invoke({ action, payload })).value as T;
}
export const observe = (callback: (state: MobileUpdate) => void) => plugin.addListener('snapshot', callback);
export type MobileSearchPage = { items: Track[]; nextCursor: string | null };
export const readLyrics = (track: Track) => command<RawLyrics | null>('lyrics', { track });
export const initialSnapshot: MobileSnapshot = {
  playback: { playing: false, position: 0, duration: 0, volume: .75, muted: false, shuffle: false, repeat: 'all', queue: [], queueIndex: -1 },
  personal: { liked: [], favorites: [], history: [], playlists: [] }, sources: [],
  cache: { usedBytes: 0, limitMiB: 512, enabled: true },
};
