import { useEffect, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import type { PlayerState } from '../core/types';

export default function PlaybackStatus({ activity, stop, retry, sources }: {
  activity: NonNullable<PlayerState['sourceActivity']>;
  stop: () => void; retry: () => void; sources: () => void;
}) {
  const failed = activity.phase === 'failed';
  const [now,setNow] = useState(Date.now());
  useEffect(() => {
    setNow(Date.now());
    if(failed)return;
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>clearInterval(timer);
  },[failed,activity.startedAt]);
  const seconds=Math.max(0,Math.floor((now-activity.startedAt)/1000));
  const detail=activity.detail?.replace(/https?:\/\/\S+/gi,'[资源链接]').slice(0,400);
  return <div className={`mobile-source-status glass phase-${activity.phase}`} role="status">
    {failed?<X/>:<LoaderCircle className="spin"/>}
    <div className="source-status-copy"><span>{activity.message}</span>
      {failed?detail&&<details><summary>查看原因</summary><small>{detail}</small></details>:<small>已等待 {seconds} 秒 · 可停止加载</small>}
    </div>
    {failed?<><button onClick={retry}>重试</button><button onClick={sources}>换源</button></>:<button onClick={stop}>停止</button>}
  </div>;
}
