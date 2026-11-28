import React, {useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import ChatWorkspace from './ChatWorkspace';
import {getAssistantRuntime} from './remote/runtime';
import ModelSettings from './remote/ModelSettings';
import './pocket-chat.css';
import {ChevronLeft, Minus, Settings2} from 'lucide-react';
import {useAssistantFigure, zenbotBase} from './ZenbotCharacter';
import {useApplicationExperience} from '../../ui/useApplicationExperience';
import {StyleButton} from '../themes/ApplicationStyleSettings';

function PocketChat() {
  useApplicationExperience();
  const runtime = useMemo(() => getAssistantRuntime(false), []);
  const snapshot = useSyncExternalStore(runtime.session.subscribe, runtime.session.getSnapshot);
  const [settings, setSettings] = useState(false);
  const [warning, setWarning] = useState('');
  const figure = useAssistantFigure();
  useEffect(() => {
    const hide = () => {void window.zenixChat?.invoke({action: 'hide'});};
    const key = (event: KeyboardEvent) => {if (event.key === 'Escape' && !event.defaultPrevented) {event.preventDefault();hide();}};
    document.addEventListener('keydown', key);
    void window.zenixChat?.invoke<{shortcut: boolean}>({action: 'snapshot'}).then(value => {if (!value.shortcut) setWarning('Ctrl+Alt+C 已被占用，可通过人物或托盘打开聊天');});
    return () => document.removeEventListener('keydown', key);
  }, []);
  return <main className="zenix-pocket-chat" aria-label="Zenix 袖珍聊天"><header className="zenix-pocket-header">
    <div className="zenix-pocket-avatar"><img src={figure === 'whale' ? zenbotBase.replace(/zenbot$/, 'whale') + '/thumbs/deepseek.png' : zenbotBase + '/expressions/neutral.png'} alt=""/></div>
    <div className="zenix-pocket-identity"><strong>{figure === 'whale' ? 'DeepSeek 鲸鱼娘' : 'Zenbot'}</strong><span>Zenix · 你的音乐伙伴</span></div>
    <button aria-label="模型连接设置" title="模型连接设置" aria-expanded={settings} onClick={() => setSettings(value => !value)}><Settings2 size={17}/></button>
    <button aria-label="收起聊天" title="收起 · Esc" onClick={() => void window.zenixChat?.invoke({action: 'hide'})}><Minus size={19}/></button></header>
    {warning && <p className="zenix-chat-error" role="status">{warning}</p>}
    {settings ? <div className="zenix-pocket-settings"><button className="zenix-pocket-back" onClick={() => setSettings(false)}><ChevronLeft size={15}/>返回聊天</button><StyleButton/><ModelSettings transport={runtime.transport} onConfigurationChanged={() => runtime.session.configurationChanged()}/></div>
      : <ChatWorkspace session={runtime.session} snapshot={snapshot}/>}
  </main>;
}

document.body.classList.add('zenix-pocket-body');
createRoot(document.getElementById('root')!).render(<React.StrictMode><PocketChat/></React.StrictMode>);
