import { useEffect, useState } from 'react';
import type { Track } from './types';

export function readLocal<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
export function writeLocal(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); window.dispatchEvent(new Event('zenix-preferences')); } catch { /* Optional preferences never stop audio. */ } }
export function useLocalPreference<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState(() => readLocal(key, fallback));
  useEffect(() => { const changed = () => setValue(readLocal(key, fallback)); changed(); window.addEventListener('zenix-preferences', changed); window.addEventListener('storage', changed); return () => { window.removeEventListener('zenix-preferences', changed); window.removeEventListener('storage', changed); }; }, [key]);
  return [value, next => { writeLocal(key, next); setValue(next); }];
}
export function searchHistory(): string[] { const raw = readLocal<unknown>('zenix.searchHistory', []); return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && !!v.trim() && v.length <= 120).slice(0, 30) : []; }
export function rememberSearch(value: string) { const term = value.trim().slice(0, 120); if (term) writeLocal('zenix.searchHistory', [term, ...searchHistory().filter(item => item.toLocaleLowerCase() !== term.toLocaleLowerCase())].slice(0, 30)); }
export function suggestedSearches(keyword: string, tracks: Pick<Track, 'title' | 'artist' | 'album'>[]): string[] {
  const q = keyword.trim().toLocaleLowerCase(); if (!q) return searchHistory();
  const values = new Set([...searchHistory(), ...tracks.slice(0, 5000).flatMap(track => [track.title, track.artist, track.album || ''])]);
  return [...values].filter(value => value && value.toLocaleLowerCase().includes(q) && value.toLocaleLowerCase() !== q).slice(0, 8);
}
export type LyricDisplay = { offset: number; fontSize: number; lineHeight: number; weight: number; translation: boolean; focus: boolean; customSize?: boolean; customLineHeight?: boolean; customWeight?: boolean };
export const defaultLyricDisplay: LyricDisplay = { offset: 0, fontSize: 26, lineHeight: 1.7, weight: 600, translation: true, focus: false };
export function useLyricDisplay(track?: Pick<Track, 'id'>, fallbackSize=26) {
  // Corrections are keyed to a recording/source identity, never just a song title.
  const key = `zenix.lyric.${track?.id || 'default'}`;
  const [stored, setStored] = useLocalPreference<Partial<LyricDisplay>>(key, {});
  const raw=stored&&typeof stored==='object'?stored:{};
  const finite=(value:unknown,fallback:number,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;
  const value:LyricDisplay={offset:finite(raw.offset,0,-30,30),fontSize:finite(raw.fontSize,fallbackSize,18,44),lineHeight:finite(raw.lineHeight,1.7,1.2,2.6),weight:finite(raw.weight,600,400,800),translation:raw.translation!==false,focus:raw.focus===true,customSize:typeof raw.fontSize==='number',customLineHeight:typeof raw.lineHeight==='number',customWeight:typeof raw.weight==='number'};
  return [value, (patch: Partial<LyricDisplay>) => setStored({ ...raw, ...patch })] as const;
}
export function reorderQueue<T extends { id: string }>(queue: T[], from: number, to: number): T[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= queue.length || to >= queue.length) throw Error('队列位置已变化，请重试');
  const next = [...queue]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}
export function groupCollection<T extends Pick<Track,'id'|'title'|'artist'|'album'>>(tracks: T[], kind: 'artist' | 'album') {
  const groups = new Map<string, { name: string; artist: string; tracks: T[] }>();
  for (const track of tracks) {
    const name = kind === 'artist' ? track.artist : track.album; if (!name?.trim()) continue;
    const artist = kind === 'album' ? track.artist : '';
    const key = JSON.stringify([name.trim().toLocaleLowerCase(), artist.toLocaleLowerCase()]);
    const group = groups.get(key) || { name, artist, tracks: [] };
    if (!group.tracks.some(item => item.id === track.id)) group.tracks.push(track); groups.set(key, group);
  }
  return [...groups.entries()].map(([id, group]) => ({ id, ...group })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
