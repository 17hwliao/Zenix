import { useEffect, useState } from 'react';
import { AlertCircle, LoaderCircle, RotateCcw, Settings2, X } from 'lucide-react';
import type { SourceActivity } from '../core/types';
import './SourceCallout.css';

type Props = { activity: SourceActivity; title?: string; onRetry: () => void; onManage: () => void; onCancel?: () => void };

export default function SourceCallout({ activity, title, onRetry, onManage, onCancel }: Props) {
  const [now, setNow] = useState(Date.now);
  const failed = activity.phase === 'failed';
  useEffect(() => {
    setNow(Date.now());
    if (failed) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activity.startedAt, failed]);
  const seconds = Math.max(0, Math.floor((now - activity.startedAt) / 1000));
  const detail = activity.detail || (seconds >= 8 && !failed ? '连接耗时较长，仍在处理；超时会自动尝试备用方案' : title);
  return <div className={`zenix-source-callout${failed ? ' is-failed' : ''}`} role="status" aria-live="polite">
    <span className="zenix-source-callout-icon" aria-hidden="true">{failed ? <AlertCircle size={19} /> : <LoaderCircle size={19} />}</span>
    <div className="zenix-source-callout-copy"><strong>{activity.message}</strong>{detail && <small>{detail}</small>}</div>
    {!failed && <time aria-hidden="true">{seconds}s</time>}
    <div className="zenix-source-callout-actions">{failed ? <>
      <button type="button" onClick={onRetry} title="重新尝试播放" aria-label="重新尝试播放"><RotateCcw size={15} /><span>重试</span></button>
      <button type="button" onClick={onManage} title="更换或启用音乐源" aria-label="更换或启用音乐源"><Settings2 size={15} /><span>换源</span></button>
    </> : onCancel && <button type="button" onClick={onCancel} title="取消本次加载" aria-label="取消本次加载"><X size={15} /></button>}</div>
  </div>;
}
