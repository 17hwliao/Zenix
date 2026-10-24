import {useEffect,useRef} from 'react';
export type LibraryContext={playlistId?:string;collection?:string;selectedIds?:string[]};
const scopes=new Map<symbol,{priority:number;value:LibraryContext}>();
export function useAssistantLibraryContext(value:LibraryContext,priority=10){
 const owner=useRef(Symbol('assistant-context')),signature=JSON.stringify(value);
 useEffect(()=>{const key=owner.current;scopes.set(key,{priority,value:JSON.parse(signature)});return()=>{scopes.delete(key);};},[signature,priority]);
}
export function assistantLibraryContext():LibraryContext{return [...scopes.values()].sort((a,b)=>b.priority-a.priority)[0]?.value||{};}
