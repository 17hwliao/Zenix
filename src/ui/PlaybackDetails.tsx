import { useState } from 'react';
import type { SourceActivity } from '../core/types';
import { redact } from '../core/sourceDiagnostics';
export default function PlaybackDetails({ activity, seconds }: { activity: SourceActivity; seconds: number }) {
  const [copied, setCopied] = useState(false);
  const stage = ['cache', 'resolving', 'retrying', 'switching'].includes(activity.phase) ? 0 : activity.phase === 'connecting' ? 1 : 2;
  const text = `播放诊断\n阶段：${redact(activity.message)}\n等待：${seconds} 秒\n${redact(activity.detail || '')}`;
  return <details className="playback-details"><summary>{activity.phase === 'failed' ? '查看失败原因' : '查看加载进度'}</summary>
    {activity.phase !== 'failed' && <small>{['查找资源', '连接音频', '等待缓冲'].map((label, index) => `${index === stage ? '●' : index < stage ? '✓' : '○'} ${label}`).join(' → ')}</small>}
    {activity.detail && <small>{redact(activity.detail)}</small>}
    <button onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } }}>{copied ? '已复制诊断' : '复制诊断'}</button>
    <textarea readOnly aria-label="可复制的播放诊断" value={text} rows={3} />
  </details>;
}
