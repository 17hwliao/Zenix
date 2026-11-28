import {useEffect, useRef, useState} from 'react';
import ZenbotCharacter, {useAssistantFigure} from './ZenbotCharacter';
import {ArrowUpRight, Grip, Minus, Move, Plus, RotateCcw} from 'lucide-react';
import './assistant-design.css';

const expressions: Record<string, string> = {neutral:'平常',happy:'开心',wink:'眨眼',love:'喜欢',shy:'害羞',surprised:'惊讶',angry:'生气',sad:'难过',sleepy:'困困',thinking:'思考',smug:'得意',pout:'嘟嘴',worried:'担心',determined:'认真',flustered:'慌张',scared:'害怕',excited:'兴奋',cry:'哭泣',confused:'疑惑'};
const motions: Record<string, string> = {stand:'站立',jump:'跳跃',hop:'轻跳',look:'张望',turn:'转身',nod:'点头',shake:'摇头',spin:'转圈',sit:'坐下',sleep:'休息',dizzy:'晕乎乎',walk:'散步',run:'小跑',wave:'招手',bow:'鞠躬',shiver:'抖一抖',flap:'摆摆手',dance:'跳舞'};

export default function ZenbotSettings({mobile, invoke}: {mobile: boolean; invoke: <T = unknown>(args: Record<string, unknown>) => Promise<T>}) {
  const figure = useAssistantFigure();
  const [error, setError] = useState('');
  const [scale, setScale] = useState(() => {try {return Number(localStorage.getItem('zenix.assistant.zenbot-scale.v1')) || .7;} catch {return .7;}});
  const [motion, setMotion] = useState('stand');
  const [wandering, setWandering] = useState(() => {try {return localStorage.getItem('zenix.assistant.zenbot-roaming.v2') !== 'false';} catch {return true;}});
  const revision = useRef(0);
  const savedScale = useRef(scale);
  const sizeEdit = useRef(0);
  const resize = useRef<{id: number; y: number; scale: number; events: AbortController} | null>(null);
  const liveScale = useRef(scale);
  liveScale.current = scale;
  const requestedScale = useRef<number | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  useEffect(() => () => {resize.current?.events.abort();resize.current = null;}, []);
  useEffect(() => {
    let alive = true;
    const token = revision.current;
    void invoke<{figure: {id: 'zenbot' | 'whale';scale: number;wandering: boolean}}>({operation: 'assistant', action: 'state'}).then(value => {
      if (!alive || !value.figure || token !== revision.current || sizeEdit.current) return;
      const next = value.figure;
      localStorage.setItem('zenix.assistant.figure.v1', next.id === 'whale' ? 'whale' : 'zenbot');
      localStorage.setItem('zenix.assistant.zenbot-scale.v1', String(next.scale));
      localStorage.setItem('zenix.assistant.zenbot-roaming.v2', String(next.wandering !== false));
      savedScale.current = next.scale;setScale(next.scale);setWandering(next.wandering !== false);
      window.dispatchEvent(new Event('zenix-assistant-figure'));
    }).catch(reason => {if (alive) setError(String(reason));});
    return () => {alive = false;};
  }, [mobile, invoke]);
  const [expression, setExpression] = useState('neutral');
  const change = async (next: string, size = scale, roam = wandering) => {
    const token = ++revision.current;
    const edit = sizeEdit.current;
    setSaving(true);
    setError('');
    try {
      await invoke({operation: 'assistant', action: 'figure', figure: next, scale: size, wandering: roam});
      if (token !== revision.current) return;
      localStorage.setItem('zenix.assistant.figure.v1', next);
      localStorage.setItem('zenix.assistant.zenbot-scale.v1', String(size));
      localStorage.setItem('zenix.assistant.zenbot-roaming.v2', String(roam));
      setWandering(roam);
      savedScale.current = size;
      if (edit === sizeEdit.current) setScale(size);
      window.dispatchEvent(new Event('zenix-assistant-figure'));
    } catch (reason) {if (token === revision.current) {setError(reason instanceof Error ? reason.message : '形象设置未保存');if (edit === sizeEdit.current) setScale(savedScale.current);}}
    finally {if (token === revision.current) setSaving(false);}
  };
  const previewSize = (value: number) => {sizeEdit.current++;liveScale.current = Math.max(.45, Math.min(1.25, Math.round(value * 20) / 20));setScale(liveScale.current);};
  const commitSize = (value: number) => {
    if (value === savedScale.current || value === requestedScale.current) return;
    requestedScale.current = value;
    void change(figure, value).finally(() => {if (requestedScale.current === value) requestedScale.current = undefined;});
  };
  const resizeEnd = (id: number, cancelled = false) => {
    if (resize.current?.id !== id) return;
    resize.current.events.abort();
    resize.current = null;
    if (cancelled) {sizeEdit.current++;liveScale.current = savedScale.current;setScale(savedScale.current);} else commitSize(liveScale.current);
  };
  return <section className="zenix-figure-settings" aria-label="助手形象">
    <header className="zenix-design-heading"><div><span className="zenix-design-eyebrow">你的应用内伙伴</span><h3>让陪伴有一点个性</h3></div><span className="zenix-setting-save" role="status">{saving ? '保存中…' : scale !== savedScale.current ? '预览中' : ''}</span></header>
    <div className="zenix-figure-layout">
      <div className="zenix-figure-stage" data-resizing={!!resize.current}>
        <span className="zenix-figure-stage-caption">{figure === 'whale' ? 'DeepSeek 鲸鱼娘' : 'Zenbot'}</span>
        <div className="zenix-figure-preview" style={{transform: mobile ? 'scale(.9)' : `scale(${.65 + (scale - .45) * .45})`}}><ZenbotCharacter state="idle" figure={figure} motion={motion} expression={expression}/></div>
        <span className="zenix-figure-ground" aria-hidden="true"/>
        {!mobile && <><span className="zenix-figure-measure">尺寸预览 · 松手保存</span><button className="zenix-figure-resize" data-ui-sound="off" aria-label="拖动调整人物大小" title="向上拖动放大，向下拖动缩小。也可用方向键调整。"
          onPointerDown={event => {
            if (event.button !== 0 || resize.current) return;event.preventDefault();
            const gesture = {id: event.pointerId, y: event.clientY, scale, events: new AbortController()};resize.current = gesture;
            const options = {capture: true, signal: gesture.events.signal};
            window.addEventListener('pointermove', value => {if (value.pointerId === gesture.id) previewSize(gesture.scale + (gesture.y - value.clientY) / 220);}, options);
            window.addEventListener('pointerup', value => resizeEnd(value.pointerId), options);
            window.addEventListener('pointercancel', value => resizeEnd(value.pointerId, true), options);
            window.addEventListener('blur', () => resizeEnd(gesture.id, true), options);
            window.addEventListener('keydown', value => {if (value.key === 'Escape') {value.preventDefault();value.stopImmediatePropagation();resizeEnd(gesture.id, true);}}, options);
            try {event.currentTarget.setPointerCapture(event.pointerId);} catch {/* Window listeners retain the gesture when native capture is unavailable. */}
          }}
          onPointerCancel={event => resizeEnd(event.pointerId, true)} onLostPointerCapture={event => resizeEnd(event.pointerId, true)}
          onKeyDown={event => {if (['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].includes(event.key)) {event.preventDefault();previewSize(scale + (['ArrowUp','ArrowRight'].includes(event.key) ? .05 : -.05));}}}
          onKeyUp={event => {if (event.key.startsWith('Arrow')) commitSize(scale);}} onBlur={() => {if (!resize.current) commitSize(scale);}}><Grip size={17}/></button></>}
      </div>
      <div className="zenix-figure-options">
        <label className="zenix-setting-field">当前形象<select value={figure} onChange={event => void change(event.target.value)}><option value="zenbot">Zenbot · 默认</option><option value="whale">DeepSeek 鲸鱼娘</option></select></label>
        {!mobile && <div className="zenix-figure-sizing"><div className="zenix-size-heading"><label htmlFor="zenix-pet-scale">人物大小</label><output htmlFor="zenix-pet-scale">{Math.round(scale * 100)}<small>%</small></output></div>
          <div className="zenix-size-slider"><button aria-label="缩小人物" disabled={scale <= .45} onClick={() => {const next = Math.max(.45, scale - .05);previewSize(next);commitSize(Math.round(next * 20) / 20);}}><Minus size={15}/></button><input id="zenix-pet-scale" type="range" min="45" max="125" step="5" value={Math.round(scale * 100)}
            onChange={event => previewSize(Number(event.target.value) / 100)} onPointerUp={event => commitSize(Number(event.currentTarget.value) / 100)}
            onPointerCancel={() => {sizeEdit.current++;setScale(savedScale.current);}} onKeyUp={event => commitSize(Number(event.currentTarget.value) / 100)} onBlur={event => commitSize(Number(event.currentTarget.value) / 100)}/><button aria-label="放大人物" disabled={scale >= 1.25} onClick={() => {const next = Math.min(1.25, scale + .05);previewSize(next);commitSize(Math.round(next * 20) / 20);}}><Plus size={15}/></button></div>
          <div className="zenix-size-presets">{([['小巧', .5], ['标准', .7], ['舒展', 1]] as const).map(([label, value]) => <button key={label} aria-pressed={Math.abs(scale - value) < .001} onClick={() => {previewSize(value);commitSize(value);}}>{label}</button>)}<button aria-label="恢复默认大小" title="恢复默认 70%" onClick={() => {previewSize(.7);commitSize(.7);}}><RotateCcw size={13}/></button></div>
          <p className="zenix-setting-hint">仅尺寸滑块、预设和预览右下角可调整大小；人物拖动和页面滚动不会缩放。</p></div>}
        {!mobile && <label className="zenix-setting-toggle"><span><Move size={16}/><span>沿底部漫步<small>聊天和拖动时会停下来等你</small></span></span><input type="checkbox" role="switch" checked={wandering} onChange={event => void change(figure, scale, event.target.checked)}/></label>}
        {!mobile && <button className="zenix-design-primary" onClick={() => window.dispatchEvent(new Event('zenix-assistant-conversation'))}>打开应用内聊天<ArrowUpRight size={16}/></button>}
      </div>
    </div>
      <details className="zenix-figure-expression"><summary>试试表情与动作<span>19 种表情 · 18 个动作</span></summary>
        <label>表情<select value={expression} onChange={event => setExpression(event.target.value)}>{Object.entries(expressions).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>动作<select value={motion} onChange={event => setMotion(event.target.value)}>{Object.entries(motions).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </details>
    {error && <p className="zenix-design-error" role="alert">{error}</p>}
  </section>;
}
