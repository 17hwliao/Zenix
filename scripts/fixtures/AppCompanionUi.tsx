import React from 'react';
import {createRoot} from 'react-dom/client';
import AssistantCornerCharacter from '../../src/features/assistant/AssistantCornerCharacter';
import ZenbotSettings from '../../src/features/assistant/ZenbotSettings';
import {useApplicationExperience} from '../../src/ui/useApplicationExperience';
import '../../src/features/assistant/conversation.css';
localStorage.clear();localStorage.setItem('zenix.assistant.zenbot-roaming.v2','false');localStorage.setItem('zenix.ui-sounds.v1','{"enabled":false}');
const fixture={calls:[] as Record<string,unknown>[],opens:0,figure:{id:'zenbot',scale:.7,wandering:false}};
const invoke=async<T,>(args:Record<string,unknown>):Promise<T>=>{fixture.calls.push(args);if(args.action==='figure')fixture.figure={id:String(args.figure),scale:Number(args.scale),wandering:args.wandering===true};return {figure:fixture.figure} as T;};
(window as any).appCompanionFixture=fixture;
function Fixture(){useApplicationExperience();return <><main style={{padding:30,height:1200}}><div className="zenix-assistant-panel"><ZenbotSettings mobile={false} invoke={invoke}/></div></main><aside className="assistant-conversation"><AssistantCornerCharacter hidden={false} phase="idle" invoke={invoke} onOpen={()=>fixture.opens++}/></aside></>;}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture/></React.StrictMode>);
