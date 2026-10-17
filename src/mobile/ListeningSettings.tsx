import {command,type MobileSnapshot} from './native';
import AudioSettingsPanel from '../ui/AudioSettingsPanel';
import {defaultAudioSettings,type AudioSettings} from '../core/audioSettings';
const loadAudio=async()=>{const state=await command<MobileSnapshot>('snapshot');return state.playback.audioSettings||defaultAudioSettings;};
const saveAudio=async(value:AudioSettings)=>{const state=await command<MobileSnapshot>('audioConfigure',value);return state.playback.audioSettings||defaultAudioSettings;};
export function MobileAudioSettings({value}:{value?:AudioSettings}){return <AudioSettingsPanel observed={value} load={loadAudio} save={saveAudio}/>;}
export {default as MobileRemoteSettings} from './MobileRemoteSettings';
