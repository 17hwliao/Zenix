import GlassSelect from '../../ui/GlassSelect';
import type {PresentationControlsProps,SpacePresentationMode} from './presentationTypes';
import './spacePresentation.css';

const modes:{value:SpacePresentationMode;label:string}[]=[
 {value:'sticker',label:'贴纸拼贴'},{value:'orbit',label:'多轨环绕'},{value:'list',label:'简约列表'},
];
const mobileModes=modes.filter(({value})=>value!=='orbit');
export default function PresentationControls({value,allowOrbit=true,onChange,error,onDismissError}:PresentationControlsProps){
 return <div className="space-presentation-controls">
  <div className="space-presentation-setting"><span>歌曲展示方式</span><GlassSelect label="歌曲展示方式" value={value.mode} options={allowOrbit?modes:mobileModes} onChange={mode=>onChange({mode:mode as SpacePresentationMode})}/></div>
  {allowOrbit&&value.mode==='orbit'&&<label className="space-presentation-size"><span>卡片大小</span><input aria-label="环绕卡片大小" type="range" min="0.65" max="1.25" step="0.05" value={value.cardScale} onChange={event=>onChange({cardScale:Number(event.target.value)})}/><output>{Math.round(value.cardScale*100)}%</output></label>}
  {error&&<div className="space-presentation-error" role="alert"><span>{error}</span><button type="button" aria-label="关闭展示偏好错误" onClick={onDismissError}>×</button></div>}
 </div>;
}
