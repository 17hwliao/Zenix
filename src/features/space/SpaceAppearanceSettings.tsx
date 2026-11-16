import PresentationControls from './PresentationControls';
import {useSpacePresentation} from './presentation';

export type SpaceAppearanceSettingsProps=Readonly<Record<string,unknown>>;

/** Shares the existing persisted preference; opening settings never resets the space. */
export default function SpaceAppearanceSettings(_props:SpaceAppearanceSettingsProps={}){
 const value=useSpacePresentation();
 return <section className="space-appearance-settings" data-setting="space-presentation" data-mobile-setting="space-presentation" aria-label="音乐空间展示设置">
  <header><h3>音乐空间</h3></header>
  <PresentationControls value={value} onChange={value.change} error={value.error} onDismissError={value.dismissError}/>
 </section>;
}
