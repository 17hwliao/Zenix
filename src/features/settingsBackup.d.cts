export type SettingsSnapshot={schema:1;present:Record<string,boolean>;space:Record<string,unknown>;playbackPreferences:Record<string,unknown>;assistant:Record<string,unknown>;networkPolicy:Record<string,string>};
export function clean(raw?:unknown):SettingsSnapshot;
export function canonical(value:unknown):string;
export function diff(current:unknown,incoming:unknown):{key:string;label:string;status:string}[];
export function merge(current:unknown,incoming:unknown,replace?:boolean):SettingsSnapshot;
export function cleanAssistant(raw?:unknown):Record<string,unknown>;
