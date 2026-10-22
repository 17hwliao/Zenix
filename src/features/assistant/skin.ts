import * as imported from './skin-model.cjs';
import type {Skin} from './skin-model.cjs';
type SkinAPI={states:string[];clean:(raw:unknown,files:Record<string,Uint8Array>)=>Skin;actions:{id:string;label:string}[];parse:(input:unknown)=>{action:string;args:Record<string,unknown>}|null};
const direct=imported as unknown as SkinAPI;
const api=(imported as {default?:SkinAPI}).default||(typeof direct.clean==='function'?direct:undefined)||(globalThis as typeof globalThis&{zenixAssistantSkin:SkinAPI}).zenixAssistantSkin;
export const {states,clean,actions,parse}=api;
export type {Skin};
