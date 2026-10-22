export type Skin={schema:1;name:string;author:string;version:string;width:number;height:number;frames:string[];animations:Record<string,{frames:number[];fps:number;loop:boolean}>;hit:number[];drag:number[];scale:number};
export const states:string[];
export function clean(raw:unknown,files:Record<string,Uint8Array>):Skin;
export const actions:{id:string;label:string}[];
export function parse(input:unknown):{action:string;args:Record<string,unknown>}|null;
