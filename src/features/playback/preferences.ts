import type {Track} from '../../core/types';
import * as imported from './preferences.cjs';
export type VersionPreferences={mode:'any'|'original'|'live'|'acoustic';choices:Record<string,{providerId:string;remoteId:string}>;excluded?:Record<string,string[]>};
type PreferenceTrack=Partial<Pick<Track,'id'|'title'|'artist'|'providerId'|'remoteId'>>;
type API={KEY:string;songKey(track:PreferenceTrack):string;versionKey(track:PreferenceTrack):string;clean(value:unknown):VersionPreferences;read():VersionPreferences;write(value:VersionPreferences):VersionPreferences;order<T extends PreferenceTrack>(rows:T[],original:PreferenceTrack,prefs:VersionPreferences):T[]};
const direct=imported as unknown as API;
export const versionPreferences=((imported as unknown as {default?:API}).default||(typeof direct.clean==='function'?direct:undefined)||(globalThis as typeof globalThis&{zenixPlaybackPreferences:API}).zenixPlaybackPreferences);
