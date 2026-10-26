import {useEffect,useState} from 'react';
// @ts-ignore Same pure rules are exercised directly by Node tests.
import * as imported from './model.cjs';
import type {Track,PersonalState} from '../../core/types';
export type Camera={x:number;y:number;scale:number};
export type SpaceBookmark={id:string;name:string;selectedId:string;camera:Camera;tracks:Track[]};
export type Zone={id:string;name:string;trackIds:string[]};
export type RoamPreferences={scope:'all'|'saved'|'playlist';playlistId:string;discovery:number;artistGap:number;excluded:{id:string;kind:'song'|'version'|'artist';effect:'reduce'|'exclude';key:string;label:string}[]};
export type SpaceState={schema:1;revision:number;motion:'full'|'light'|'reduced';bookmarks:SpaceBookmark[];zones:Zone[];roaming:RoamPreferences};
type Rules={clean:(raw?:unknown)=>SpaceState;songKey:(track:Partial<Track>)=>string;versionKey:(track:Partial<Track>)=>string;normal:(v:unknown)=>string;reference:(v:unknown)=>Track;allows:(track:Track,p:RoamPreferences,personal?:PersonalState)=>boolean;order:(tracks:Track[],p:RoamPreferences,personal?:PersonalState,recent?:string[])=>Track[]};
export const rules=((imported as unknown as {default?:Rules}).default||(typeof (imported as unknown as Rules).clean==='function'?imported:(globalThis as typeof globalThis&{zenixSpaceRules:Rules}).zenixSpaceRules)) as Rules;
const key='zenix.space.features.v1';
export function readSpace():SpaceState{const raw=localStorage.getItem(key);return rules.clean(raw?JSON.parse(raw):{});}
export function writeSpace(value:unknown):SpaceState{const state=rules.clean(value);localStorage.setItem(key,JSON.stringify(state));window.dispatchEvent(new CustomEvent('zenix-space-settings',{detail:state}));return state;}
export function commitSpace(value:unknown):SpaceState{const next=rules.clean(value),current=readSpace();if(next.revision!==current.revision)throw Error('空间设置已有新修改，请重新打开工作台后再试');return writeSpace({...next,revision:current.revision+1});}
export function useSpaceSettings(){const [state,setState]=useState(()=>{try{return readSpace();}catch{return rules.clean();}});useEffect(()=>{const update=(event:Event)=>{if(event instanceof CustomEvent)setState(rules.clean(event.detail));else try{setState(readSpace());}catch{}};window.addEventListener('zenix-space-settings',update);window.addEventListener('storage',update);return()=>{window.removeEventListener('zenix-space-settings',update);window.removeEventListener('storage',update);};},[]);return state;}
export type SpaceSnapshot={camera:Camera;selectedId:string;tracks:Track[]};
export async function captureSpace(purpose:'bookmark'|'selection'='bookmark'):Promise<SpaceSnapshot>{return new Promise((resolve,reject)=>{const token=crypto.randomUUID();let finished=false;const done=(event:Event)=>{const result=(event as CustomEvent).detail;if(result?.token!==token)return;finished=true;window.removeEventListener('zenix-space-response',done);if(result.error){reject(Error(String(result.error)));return;}resolve(result.snapshot);};window.addEventListener('zenix-space-response',done);window.dispatchEvent(new CustomEvent('zenix-space-request',{detail:{token,purpose}}));queueMicrotask(()=>{if(!finished){window.removeEventListener('zenix-space-response',done);reject(Error('请先打开音乐空间，再保存空间位置或选择分区歌曲。'));}});});}
export function restoreSpace(bookmark:SpaceBookmark){window.dispatchEvent(new CustomEvent('zenix-space-restore',{detail:bookmark}));}
