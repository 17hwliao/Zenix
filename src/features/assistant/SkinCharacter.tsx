import {useSpaceSettings} from '../space/state';
import ZenbotCharacter, {useAssistantFigure} from './ZenbotCharacter';

export default function SkinCharacter({state,motion:action,direction,reduced=false,groundAligned=false}: {state:string;motion?:string;direction?:number;reduced?:boolean;groundAligned?:boolean;invoke?:<T=unknown>(args:Record<string,unknown>)=>Promise<T>}) {
  const figure = useAssistantFigure();
  const motion = useSpaceSettings().motion;
  return <ZenbotCharacter state={state} figure={figure} motion={action} direction={direction} reduced={reduced||motion === 'reduced'} groundAligned={groundAligned}/>;
}
