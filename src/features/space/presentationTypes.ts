import type {ReactNode} from 'react';
import type {Track} from '../../core/types';
export type SpacePresentationMode='sticker'|'orbit'|'list';
export type SpacePresentationSettings={mode:SpacePresentationMode;cardScale:number};
export type SongPresentationProps={
 tracks:Track[];selectedId?:string;currentId?:string;playing:boolean;compact?:boolean;cardScale:number;
 onFocus:(track:Track)=>void;onPlay:(track:Track)=>void;onExpand?:()=>void;
 renderCover:(track:Track)=>ReactNode;renderActions?:(track:Track)=>ReactNode;
};
export type PresentationControlsProps={value:SpacePresentationSettings;onChange:(patch:Partial<SpacePresentationSettings>)=>void;error?:string;onDismissError?:()=>void};
