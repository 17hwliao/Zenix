import {useEffect, useRef, useState} from 'react';

type Renderer = {ready: Promise<void>; setState(state: string, options: Record<string, unknown>): void; dispose(): void};
type ZenbotApi = {Renderer: new (canvas: HTMLCanvasElement, base: string, options?: Record<string, unknown>) => Renderer; expressions: string[]; motions: string[]};
declare global {interface Window {ZenixZenbot?: ZenbotApi}}

export const zenbotBase = new URL('assistant/zenbot', import.meta.env.DEV ? new URL('/', location.href) : new URL(import.meta.env.BASE_URL, document.baseURI)).href;
let loading: Promise<ZenbotApi> | undefined;

function loadRenderer() {
  loading ||= new Promise<ZenbotApi>((resolve, reject) => {
    if (window.ZenixZenbot) {resolve(window.ZenixZenbot); return;}
    const script = document.createElement('script');
    script.src = zenbotBase + '/renderer.js';
    script.onload = () => window.ZenixZenbot ? resolve(window.ZenixZenbot) : reject(Error('人物渲染器未就绪'));
    script.onerror = () => {loading = undefined; script.remove(); reject(Error('人物渲染器无法读取'));};
    document.head.append(script);
  });
  return loading;
}

export default function ZenbotCharacter({state, motion, expression,direction=1, reduced = false, figure = 'zenbot',groundAligned=false}: {state: string; motion?: string; expression?: string;direction?:number; reduced?: boolean; figure?: 'zenbot' | 'whale';groundAligned?:boolean}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Renderer | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const latest = useRef({state, motion, expression, reduced,direction});
  latest.current = {state, motion, expression, reduced,direction};
  useEffect(() => {
    let alive = true;
    void loadRenderer().then(api => {
      if (!alive || !canvas.current) return;
      const value = new api.Renderer(canvas.current, figure === 'whale' ? zenbotBase.replace(/zenbot$/, 'whale') : zenbotBase, {figure,groundAligned});
      renderer.current = value;
      void value.ready.then(() => {
        if (alive) value.setState(latest.current.state, {motion: latest.current.motion, expression: latest.current.expression,direction:latest.current.direction, animated: !latest.current.reduced});
      }).catch(() => {if (alive) setFailed(true);});
    }).catch(() => {if (alive) setFailed(true);});
    return () => {alive = false; renderer.current?.dispose(); renderer.current = undefined;};
  }, [figure,groundAligned]);
  useEffect(() => {renderer.current?.setState(state, {motion, expression,direction, animated: !reduced});}, [state, motion, expression,direction, reduced]);
  return <span className="pet-body pet-portrait zenix-zenbot" role="img" aria-label={figure === 'whale' ? 'DeepSeek 鲸鱼娘助手' : 'Zenbot 助手'} style={{display: 'block', width: '100%', height: '100%'}}>
    {failed ? <img src={figure === 'whale' ? zenbotBase.replace(/zenbot$/, 'whale') + '/thumbs/deepseek.png' : zenbotBase + '/expressions/neutral.png'} alt="助手形象"/> : <canvas ref={canvas} style={{width: '100%', height: '100%', display: 'block'}}/>}
  </span>;
}

export function useAssistantFigure() {
  const read = (): 'zenbot' | 'whale' => {try {return localStorage.getItem('zenix.assistant.figure.v1') === 'whale' ? 'whale' : 'zenbot';} catch {return 'zenbot';}};
  const [figure, setFigure] = useState(read);
  useEffect(() => {const update = () => setFigure(read()); window.addEventListener('zenix-assistant-figure', update); window.addEventListener('storage', update); return () => {window.removeEventListener('zenix-assistant-figure', update); window.removeEventListener('storage', update);};}, []);
  return figure;
}
