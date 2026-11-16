import type {SpacePresentationMode,SpacePresentationSettings} from './presentationTypes';

export const presentationSchema=2 as const;
export const presentationKey='zenix.space.presentation.v2';
export const legacyPresentationKey='zenix.space.presentation.v1';
export const corruptPresentationPrefix='zenix.space.presentation.corrupt.';

export type DisplayPreferenceStatus='missing'|'ready'|'migrated'|'error';
export type DisplayPreferenceSnapshot={
  value:SpacePresentationSettings;
  status:DisplayPreferenceStatus;
  needsOnboarding:boolean;
  error:string;
};
type StorageLike=Pick<Storage,'getItem'|'setItem'>;
type LegacyPresentation={mode:'sticker'|'orbit'|'list';cardScale:number};

export const defaultPresentation:SpacePresentationSettings=Object.freeze({
  schema:presentationSchema,
  mode:'sticker',
  cardScale:1,
});

function clampScale(value:number){return Math.min(1.25,Math.max(.65,value));}

function readMode(value:unknown):value is SpacePresentationMode {
  return value==='sticker'||value==='list';
}

function readScale(value:unknown):value is number {
  return typeof value==='number'&&Number.isFinite(value);
}

export function normalizePresentation(raw:unknown):SpacePresentationSettings {
  if(!raw||typeof raw!=='object')throw Error('invalid presentation');
  const value=raw as Partial<SpacePresentationSettings>;
  if(value.schema!==presentationSchema||!readMode(value.mode)||!readScale(value.cardScale))throw Error('invalid presentation');
  return {schema:presentationSchema,mode:value.mode,cardScale:clampScale(value.cardScale)};
}

function normalizeLegacy(raw:unknown):LegacyPresentation {
  if(!raw||typeof raw!=='object')throw Error('invalid legacy presentation');
  const value=raw as Partial<LegacyPresentation>;
  if(!['sticker','orbit','list'].includes(String(value.mode))||!readScale(value.cardScale))throw Error('invalid legacy presentation');
  return {mode:value.mode!,cardScale:clampScale(value.cardScale)};
}

function migratedValue(value:LegacyPresentation):SpacePresentationSettings {
  return {schema:presentationSchema,mode:value.mode==='list'?'list':'sticker',cardScale:value.cardScale};
}

function serialize(value:SpacePresentationSettings){return JSON.stringify(value);}

function diagnosticKey(){
  const nonce=Math.random().toString(36).slice(2,10);
  return `${corruptPresentationPrefix}${Date.now()}.${nonce}`;
}

function preserveInvalid(storage:StorageLike,key:string,raw:string){
  if(!raw)return;
  storage.setItem(diagnosticKey(),JSON.stringify({key,raw,preservedAt:new Date().toISOString()}));
}

export function readDisplayPreference(storage:StorageLike):DisplayPreferenceSnapshot {
  let currentRaw:string|null;
  try {
    currentRaw=storage.getItem(presentationKey);
  } catch {
    return {
      value:{...defaultPresentation},
      status:'error',
      needsOnboarding:false,
      error:'无法访问音乐空间展示偏好，暂用默认贴纸。原歌单和其他设置未改动。',
    };
  }
  if(currentRaw!==null){
    try {
      return {value:normalizePresentation(JSON.parse(currentRaw)),status:'ready',needsOnboarding:false,error:''};
    } catch {
      return {
        value:{...defaultPresentation},
        status:'error',
        needsOnboarding:false,
        error:'音乐空间展示偏好无法读取，暂用默认贴纸。原数据已保留用于诊断，可在设置中重新选择。',
      };
    }
  }

  let legacyRaw:string|null;
  try {
    legacyRaw=storage.getItem(legacyPresentationKey);
  } catch {
    return {
      value:{...defaultPresentation},
      status:'error',
      needsOnboarding:false,
      error:'无法访问音乐空间展示偏好，暂用默认贴纸。原歌单和其他设置未改动。',
    };
  }
  if(legacyRaw===null){
    return {value:{...defaultPresentation},status:'missing',needsOnboarding:true,error:''};
  }

  let value:SpacePresentationSettings;
  try {
    value=migratedValue(normalizeLegacy(JSON.parse(legacyRaw)));
  } catch {
    return {
      value:{...defaultPresentation},
      status:'error',
      needsOnboarding:false,
      error:'旧版音乐空间展示偏好无法读取，暂用默认贴纸。原数据已保留用于诊断，可在设置中重新选择。',
    };
  }
  try {
    storage.setItem(presentationKey,serialize(value));
    return {value,status:'migrated',needsOnboarding:false,error:''};
  } catch {
    return {
      value,
      status:'error',
      needsOnboarding:false,
      error:'旧版音乐空间展示偏好暂时无法写入新格式，本次继续使用原选择。原数据已保留，请检查存储空间。',
    };
  }
}

export function writeDisplayPreference(
  patch:Partial<SpacePresentationSettings>,
  current:SpacePresentationSettings,
  storage:StorageLike,
):DisplayPreferenceSnapshot {
  const raw=storage.getItem(presentationKey);
  if(raw!==null){
    try {
      normalizePresentation(JSON.parse(raw));
    } catch {
      preserveInvalid(storage,presentationKey,raw);
    }
  }
  const next=normalizePresentation({...current,...patch,schema:presentationSchema});
  storage.setItem(presentationKey,serialize(next));
  return {value:next,status:'ready',needsOnboarding:false,error:''};
}
