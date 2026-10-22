import type {Track,PersonalState,PlayerState} from '../../core/types';
export type TrackReference=Pick<Track,'id'|'title'|'artist'|'album'|'source'|'providerId'|'remoteId'|'duration'>;
export type Bookmark={id:string;track:TrackReference;seconds:number;note:string;lyric:string;createdAt:number};
export type PersonalFeaturesState={schema:1;revision:number;notice?:string;bookmarks:Bookmark[];lyrics:{track:TrackReference;text:string;updatedAt:number}[];journal:{id:string;label:string;createdAt:number;undone:boolean;changes:{id:string;before:unknown;after:unknown}[]}[]};
export type PersonalFeaturesInvoke=<T>(args:Record<string,unknown>)=>Promise<T>;
export type SearchMatch={kind:'bookmark'|'lyric'|'track';track:TrackReference;seconds:number|null;excerpt:string;id:string};
export type PersonalFeaturesProps={personal:PersonalState;playback:PlayerState;invoke:PersonalFeaturesInvoke;onOpen?:(track:TrackReference,seconds:number|null)=>Promise<void>|void;readLyrics?:(track:Track)=>Promise<{text:string}|null>;saveText?:(name:string,text:string)=>Promise<void>};
