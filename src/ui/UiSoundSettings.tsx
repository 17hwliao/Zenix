import {useEffect, useState} from 'react';
import {Volume2} from 'lucide-react';
import {getSoundSettings, playUiSound, setSoundSettings, subscribeSoundSettings} from '../core/sounds';

export default function UiSoundSettings() {
  const [settings, setSettings] = useState(getSoundSettings);
  const [error, setError] = useState('');
  useEffect(() => subscribeSoundSettings(() => setSettings(getSoundSettings())), []);
  const change = (patch: Partial<typeof settings>) => {
    try { setSoundSettings({...getSoundSettings(), ...patch}); setError(''); }
    catch { setError('音效设置未能保存，请重试。'); }
  };
  return <section className="zenix-ui-sounds" data-mobile-setting="ui-sounds">
    <h3>界面音效</h3><p>按钮点击、触摸和键盘操作的轻声反馈。只影响界面音效，不改变音乐音量。</p>
    <label><span>开启界面音效</span><input type="checkbox" role="switch" checked={settings.enabled} onChange={event=>change({enabled:event.target.checked})}/></label>
    {settings.enabled&&<div data-ui-sound="off"><label><span>音量</span><input aria-label="界面音效音量" type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={event=>change({volume:Number(event.target.value)})}/><output>{Math.round(settings.volume*100)}%</output></label><button type="button" onClick={()=>playUiSound('enter', .35)}><Volume2 size={16}/>试听按键音效</button></div>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
