import GlassSelect from '../../ui/GlassSelect';
import type {PresentationControlsProps,SpacePresentationMode} from './presentationTypes';
import './spacePresentation.css';

const modes:{value:SpacePresentationMode;label:string}[]=[
 {value:'sticker',label:'贴纸拼贴'},{value:'list',label:'简约列表'},
];
export default function PresentationControls({value,onChange,error,onDismissError}:PresentationControlsProps){
 return <div className="space-presentation-controls">
  <div className="space-presentation-setting"><span>歌曲展示方式</span><GlassSelect label="歌曲展示方式" value={value.mode} options={modes} onChange={mode=>onChange({mode:mode as SpacePresentationMode})}/></div>
  {error&&<div className="space-presentation-error" role="alert"><span>{error}</span><button type="button" aria-label="关闭展示偏好错误" onClick={onDismissError}>×</button></div>}
 </div>;
}
