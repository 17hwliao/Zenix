import type {Track,ReplacementState} from './types';
import * as imported from './platformReplacement.cjs';
type ReplacementImplementation={
  LIMIT:number;rank(original:Partial<Track>,candidate:Partial<Track>):number;candidateKey(track:Partial<Track>):string;
  cleanTarget(track:Partial<Track>):Track;cleanRecord(value:ReplacementState|undefined):ReplacementState|undefined;
  resume(previous:ReplacementState,adapter:ReplacementAdapter,signal:AbortSignal):Promise<{state:ReplacementState;target?:Track;resolved?:any}>;
  run(original:Track,previous:ReplacementState|undefined,adapter:ReplacementAdapter,signal:AbortSignal,report?:(message:string)=>void,manual?:Track):Promise<{state:ReplacementState;target?:Track;resolved?:any}>;
};
const direct=imported as unknown as ReplacementImplementation;
export const replacement=((imported as {default?:ReplacementImplementation}).default||(typeof direct.run==='function'?direct:undefined)||(globalThis as typeof globalThis&{zenixPlatformReplacement:ReplacementImplementation}).zenixPlatformReplacement);
export type ReplacementAdapter={search:(query:string,signal:AbortSignal)=>Promise<Track[]>;resolve:(target:Track,signal:AbortSignal)=>Promise<any>;check:(result:any,signal:AbortSignal)=>Promise<void>;save:(state:ReplacementState,signal?:AbortSignal)=>Promise<void>};
