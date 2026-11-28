import {useMemo, useState} from 'react';
import type {PlayerState} from '../../core/types';
import {actions} from './skin';
import ModelSettings from './remote/ModelSettings';
import {createNativeTransport} from './remote/transport';
import {getAssistantRuntime} from './remote/runtime';
import ZenbotSettings from './ZenbotSettings';
import './assistant.css';
import {Hand, MessageCircle, MousePointer2, Move, Sparkles} from 'lucide-react';

type Invoke = <T = unknown>(args: Record<string, unknown>) => Promise<T>;
const defaults = {locked: false, hidden: false, reduced: false};

export default function AssistantPanel({mobile, invoke}: {mobile: boolean; playback: PlayerState; invoke: Invoke; execute: (action: string, args: Record<string, unknown>) => Promise<unknown>}) {
  const transport = useMemo(() => createNativeTransport(mobile), [mobile]);
  const [settings, setSettings] = useState(() => {
    try {const saved = JSON.parse(localStorage.getItem('zenix.assistant.ui.v1') || '{}');return {locked: saved.locked === true, hidden: saved.hidden === true, reduced: saved.reduced === true};}
    catch {return defaults;}
  });
  const [error, setError] = useState('');
  const change = (key: keyof typeof defaults, value: boolean) => {
    const next = {...settings, [key]: value};
    try {localStorage.setItem('zenix.assistant.ui.v1', JSON.stringify(next));setSettings(next);window.dispatchEvent(new Event('zenix-assistant-ui'));}
    catch {setError('助手设置未能保存');}
  };
  return <div className="zenix-assistant-panel">
    <ZenbotSettings mobile={mobile} invoke={invoke}/>
    <section className="zenix-interaction-settings"><header className="zenix-design-heading"><div><span className="zenix-design-eyebrow">相处方式</span><h3>一点互动，一点回应</h3></div><Sparkles size={19}/></header>
      <div className="zenix-interaction-guide">{(mobile ? ([[MousePointer2,'轻触','打开对话'],[Move,'拖动','放到顺手的位置']] as const) : ([[MousePointer2,'轻触 / 双击','回应 / 打开聊天'],[Hand,'轻轻抚摸','来回移动鼠标'],[Move,'拎起 / 松手','拖动与自然落地']] as const)).map(([Icon,title,description]) => <div key={title}><Icon size={18}/><strong>{title}</strong><span>{description}</span></div>)}</div>
      <div className="assistant-controls">{([['locked','锁定位置'],['hidden','隐藏形象'],['reduced','减少动效']] as const).map(([key,label]) => <label className="zenix-setting-toggle" key={key}><span>{label}</span><input type="checkbox" role="switch" checked={settings[key]} onChange={event => change(key,event.target.checked)}/></label>)}</div>
      <div className="zenix-interaction-actions">{!mobile && <button className="zenix-design-primary" onClick={() => change('hidden',!settings.hidden)}>{settings.hidden?'显示应用内人物':'隐藏应用内人物'}</button>}
      <button onClick={() => window.dispatchEvent(new Event('zenix-assistant-conversation'))}><MessageCircle size={15}/>打开对话与语音</button></div>
      <div className="assistant-shortcuts">{actions.filter(action => action.id !== 'search').map(action => <button key={action.id} onClick={() => {window.dispatchEvent(new Event('zenix-assistant-conversation'));window.dispatchEvent(new CustomEvent('zenix-assistant-input',{detail:{text:action.label}}));}}>{action.label}</button>)}</div>
      <p className="zenix-setting-hint">人物只在 Zenix 窗口内活动。拖动改变位置，大小仅通过上方尺寸控件调整。</p>
    </section>
    <ModelSettings transport={transport} mobile={mobile} onConfigurationChanged={() => getAssistantRuntime(mobile).session.configurationChanged()}/>
    {error && <p role="alert">{error}</p>}
  </div>;
}
