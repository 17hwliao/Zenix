import portrait from '../../../assets/assistant/zenix-muse.png';
import blink from '../../../assets/assistant/zenix-muse-blink.png';
import shy from '../../../assets/assistant/zenix-muse-shy.png';
import listening from '../../../assets/assistant/zenix-muse-listening.png';
import speakingClosed from '../../../assets/assistant/zenix-muse-speaking-closed.png';
export const defaultMascot={portrait,blink,shy,listening,speakingClosed,width:1086,height:1448,name:'Zenix 星音'};
export default function DefaultCharacter({state}:{state:string}){
 const labels:Record<string,string>={idle:'待机',listening:'正在聆听',thinking:'正在思考',executing:'正在执行',success:'已完成',failure:'执行失败',shy:'害羞',greeting:'招手',cheer:'开心',talking:'正在回复'};
 return <span className="pet-body pet-portrait" role="img" aria-label={`Zenix 星音看板娘：${labels[state]||labels.idle}`}><img src={state==='shy'?shy:state==='greeting'||state==='cheer'?portrait:['listening','talking','thinking'].includes(state)?listening:portrait} alt="" draggable={false}/>{!['shy','listening','talking','thinking'].includes(state)&&<img className="pet-blink" src={blink} alt="" aria-hidden="true" draggable={false}/>}{state==='talking'&&<img className="pet-talking-mouth" src={speakingClosed} alt="" aria-hidden="true" draggable={false}/>}<small className="pet-brand">Zenix</small></span>;
}
