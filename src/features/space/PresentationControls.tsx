import type {PresentationControlsProps,SpacePresentationMode} from './presentationTypes';
import './spacePresentation.css';
const modes:{mode:SpacePresentationMode;label:string}[]=[{mode:'sticker',label:'贴纸拼贴'},{mode:'orbit',label:'多轨环绕'},{mode:'list',label:'简约列表'}];
export default function PresentationControls({value,onChange,error,onDismissError}:PresentationControlsProps){
 return <div className="space-presentation-controls" onPointerDown={event=>event.stopPropagation()} onWheel={event=>event.stopPropagation()}>
  <div className="space-presentation-modes" role="group" aria-label="歌曲展示风格">
   {modes.map(({mode,label})=><button type="button" key={mode} aria-pressed={value.mode===mode} onClick={()=>onChange({mode})}>{label}</button>)}
  </div>
  {value.mode==='orbit'&&<label className="space-presentation-size">卡片大小<input aria-label="环绕卡片大小" type="range" min="0.65" max="1.25" step="0.05" value={value.cardScale} onChange={event=>onChange({cardScale:Number(event.target.value)})}/><output>{Math.round(value.cardScale*100)}%</output></label>}
  {error&&<div className="space-presentation-error" role="alert"><span>{error}</span><button type="button" aria-label="关闭展示偏好错误" onClick={onDismissError}>×</button></div>}
 </div>;
}
