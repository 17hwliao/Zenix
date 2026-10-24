import * as imported from './hold-recording.cjs';
const direct=imported as typeof imported;
const api=(imported as unknown as {default?:typeof imported}).default||(typeof direct.HoldRecording==='function'?direct:undefined)||(globalThis as typeof globalThis&{zenixHoldRecording:typeof imported}).zenixHoldRecording;
export const {HoldRecording,wavBase64}=api;
