import {useEffect, useRef, useState} from 'react';
import type {AssistantSessionSnapshot} from './coordinator';
import type {SessionStatus} from './contracts';
import {resultSummaryLines} from './presentation';
import './remoteAssistant.css';

type Props = {
  snapshot: AssistantSessionSnapshot;
  onConfirm: (token: string) => void | Promise<void>;
  onCancel: () => void;
  onChoose: (ref: string) => void | Promise<void>;
};

const statusLabels: Record<SessionStatus, string> = {
  idle: '就绪', listening: '正在听', understanding: '理解中', needs_input: '等待补充',
  awaiting_confirmation: '等待确认', executing: '执行中', task_created: '后台任务已建立',
  completed: '完成', failed: '失败', cancelled: '已取消', unknown: '结果待核实',
};

export function remoteCharacterPhase(status: SessionStatus) {
  if (status === 'listening') return 'listening';
  if (status === 'understanding' || status === 'needs_input' || status === 'awaiting_confirmation') return 'thinking';
  if (status === 'executing') return 'executing';
  if (status === 'failed' || status === 'unknown') return 'failure';
  if (status === 'completed' || status === 'task_created') return 'success';
  return 'idle';
}

/** A view of coordinator state. It never interprets tool arguments or commits business work. */
export default function SessionContent({snapshot, onConfirm, onCancel, onChoose}: Props) {
  const [failure, setFailure] = useState('');
  const [acting, setActing] = useState(false);
  const submitted = useRef<string | undefined>(undefined);
  const choosing = useRef(false);
  const mounted = useRef(false);
  const actionEpoch = useRef(0);
  const latestRevision = useRef(snapshot.revision);
  latestRevision.current = snapshot.revision;
  const confirmation = snapshot.confirmation;
  useEffect(() => {mounted.current = true;return () => {mounted.current = false;actionEpoch.current++;};}, []);
  useEffect(() => {actionEpoch.current++;submitted.current = undefined;setActing(false);setFailure('');}, [confirmation?.token]);
  useEffect(() => {setFailure('');}, [snapshot.revision]);
  const items = Array.isArray(snapshot.result?.data?.items)
    ? snapshot.result.data.items.filter((item): item is string => typeof item === 'string') : [];
  const detail = typeof snapshot.result?.data?.detail === 'string' ? snapshot.result.data.detail : '';
  // Keep legacy lists and lyric blocks intact; only add summaries of remote structured fields.
  const summaries = resultSummaryLines(snapshot.result ? {...snapshot.result, data: {...snapshot.result.data, items: undefined, detail: undefined}} : undefined);
  const confirm = async () => {
    if (!confirmation || snapshot.busy || submitted.current === confirmation.token) return;
    submitted.current = confirmation.token;
    const epoch = ++actionEpoch.current;
    const revision = snapshot.revision;
    setActing(true);
    try {await onConfirm(confirmation.token);}
    catch {if (mounted.current && epoch === actionEpoch.current && revision === latestRevision.current) setFailure('确认未完成，请查看当前结果后再决定下一步。');}
    finally {if (mounted.current && epoch === actionEpoch.current) setActing(false);}
  };
  const choose = async (ref: string) => {
    if (snapshot.busy || choosing.current) return;
    choosing.current = true;
    const epoch = ++actionEpoch.current;
    const revision = snapshot.revision;
    setActing(true);
    try {await onChoose(ref);}
    catch {if (mounted.current && epoch === actionEpoch.current && revision === latestRevision.current) setFailure('这首候选暂时无法播放，请重新查询。');}
    finally {choosing.current = false;if (mounted.current && epoch === actionEpoch.current) setActing(false);}
  };

  return <div className="remote-session-content" data-session-state={snapshot.status}>
    <span className="remote-session-status">{statusLabels[snapshot.status]}</span>
    <p role="status">{snapshot.message}</p>
    {items.length > 0 && <ul className="assistant-results" aria-label="检索结果">{items.map((item, index) => <li key={index}>{item}</li>)}</ul>}
    {detail && <pre className="assistant-lyrics" aria-label="歌曲资料与歌词">{detail}</pre>}
    {summaries.length > 0 && <ul className="assistant-results" aria-label="音乐资料">{summaries.map((line, index) => <li key={index}>{line}</li>)}</ul>}
    {snapshot.candidates.length > 0 && <ol className="remote-song-candidates" aria-label="搜索候选歌曲">{snapshot.candidates.filter(candidate => candidate.kind === 'candidate').map(candidate =>
      <li key={candidate.ref}><div><strong>{candidate.label}</strong>{candidate.description && <span>{candidate.description}</span>}</div><button type="button" disabled={snapshot.busy || acting} aria-label={`播放候选 ${candidate.label}`} onClick={() => void choose(candidate.ref)}>播放</button></li>,
    )}</ol>}
    {confirmation && <div className="assistant-plan" role="group" aria-label="确认资料操作" data-confirmation-token={confirmation.token}>
      <p>{confirmation.summary}</p>
      {confirmation.items.length > 0 && <ul>{confirmation.items.map((item, index) => <li key={index}>{item}</li>)}</ul>}
      <div className="assistant-confirm"><button type="button" disabled={snapshot.busy || acting || submitted.current === confirmation.token} onClick={() => void confirm()}>确认执行</button><button type="button" onClick={onCancel}>取消操作</button></div>
    </div>}
    {failure && <div className="remote-model-error" role="alert"><span>{failure}</span><button type="button" aria-label="关闭助手操作错误" onClick={() => setFailure('')}>×</button></div>}
  </div>;
}
