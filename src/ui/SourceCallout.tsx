import PlaybackDetails from './PlaybackDetails';
import './ReliabilityTools.css';
import { useEffect, useState } from 'react';
import { AlertCircle, LoaderCircle, RotateCcw, Settings2, X } from 'lucide-react';
import type { SourceActivity } from '../core/types';
import './SourceCallout.css';

type Props = { activity: SourceActivity; title?: string; onRetry: () => void; onManage: () => void; onCancel?: () => void; onReplace?:()=>void };

export default function SourceCallout({ activity, title, onRetry, onManage, onCancel,onReplace }: Props) {
  const [now, setNow] = useState(Date.now);
  const failed = activity.phase === 'failed';
  const [dismissed,setDismissed]=useState('');
  const failureKey=String(activity.startedAt);
  useEffect(() => {
    setNow(Date.now());
    if (failed) return;
    setDismissed('');
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activity.startedAt, failed]);
  const seconds = Math.max(0, Math.floor((now - activity.startedAt) / 1000));
  const detail = activity.detail || (!failed ? '等待当前阶段完成；明确失败才尝试备用方案' : title);
  if(failed&&dismissed===failureKey)return null;
  return <div className={`zenix-source-callout${failed ? ' is-failed' : ''}`} role="status" aria-live="polite">
    <span className="zenix-source-callout-icon" aria-hidden="true">{failed ? <AlertCircle size={19} /> : <LoaderCircle size={19} />}</span>
    <div className="zenix-source-callout-copy"><strong>{activity.message}</strong><PlaybackDetails activity={{...activity, detail}} seconds={seconds}/></div>
    {!failed && <time aria-hidden="true">{seconds}s</time>}
    <div className="zenix-source-callout-actions">{failed ? <>
      <button type="button" onClick={onRetry} title="重新尝试播放" aria-label="重新尝试播放"><RotateCcw size={15} /><span>重试</span></button>
      <button type="button" onClick={onManage} title="更换或启用音乐源" aria-label="更换或启用音乐源"><Settings2 size={15} /><span>换源</span></button>
      {onReplace&&<button type="button" onClick={onReplace}>寻找替代版本</button>}
      <button type="button" aria-label="关闭播放错误" onClick={()=>setDismissed(failureKey)}><X size={16}/></button>
    </> : onCancel && <button type="button" onClick={onCancel} title="取消本次加载" aria-label="取消本次加载"><X size={15} /></button>}</div>
  </div>;
}
