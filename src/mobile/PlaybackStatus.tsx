import PlaybackDetails from '../ui/PlaybackDetails';
import '../ui/ReliabilityTools.css';
import { useEffect, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import type { PlayerState } from '../core/types';

export default function PlaybackStatus({ activity, stop, retry, sources }: {
  activity: NonNullable<PlayerState['sourceActivity']>;
  stop: () => void; retry: () => void; sources: () => void;
}) {
  const failed = activity.phase === 'failed';
  const [now,setNow] = useState(Date.now());
  const [dismissed, setDismissed] = useState('');
  const failureKey = JSON.stringify(activity);
  useEffect(() => {
    setNow(Date.now());
    if(failed)return;
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>clearInterval(timer);
  },[failed,activity.startedAt]);
  const seconds=Math.max(0,Math.floor((now-activity.startedAt)/1000));

  if (failed && dismissed === failureKey) return null;
  return <div className={`mobile-source-status glass phase-${activity.phase}`} role="status">
    {failed?<button type="button" className="source-status-close" aria-label="关闭播放错误" onClick={() => setDismissed(failureKey)}><X/></button>:<LoaderCircle className="spin"/>}
    <div className="source-status-copy"><span>{activity.message}</span>
      {!failed && <small>已等待 {seconds} 秒 · 可随时停止，慢速源请稍候</small>}<PlaybackDetails activity={activity} seconds={seconds}/>
    </div>
    {failed?<><button onClick={retry}>重试</button><button onClick={sources}>换源</button></>:<button onClick={stop}>停止</button>}
  </div>;
}
