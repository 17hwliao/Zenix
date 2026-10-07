export type SourceNetworkPolicy = { allowHttp: boolean; hosts: string[] | null };
export const DEFAULT_SOURCE_POLICY: SourceNetworkPolicy = { allowHttp: false, hosts: null };
export function SourceNetworkEditor({ policy, compatible, save }: { policy: SourceNetworkPolicy; compatible: boolean; save: (policy: SourceNetworkPolicy) => Promise<unknown> }) {
  const [draft, setDraft] = useState(policy), [busy, setBusy] = useState(false);
  const signature = JSON.stringify(policy);
  useEffect(() => setDraft(policy), [signature]);
  return <div><SourceNetworkOptions policy={draft} compatible={compatible} onChange={setDraft} /><button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await save(draft); } finally { setBusy(false); } }}>{busy ? '保存中…' : '保存网络权限'}</button></div>;
}
export function SourceNetworkOptions({ policy, compatible, onChange }: { policy: SourceNetworkPolicy; compatible: boolean; onChange: (policy: SourceNetworkPolicy) => void }) {
  return <fieldset className="zenix-network-options"><legend>网络权限</legend>
    {compatible ? <><label><input type="checkbox" checked={policy.allowHttp} onChange={event => onChange({ ...policy, allowHttp: event.target.checked })} />允许 HTTP 兼容访问</label>
      <label>授权域名<input aria-label="授权域名" value={policy.hosts?.join(', ') || ''} maxLength={8000} placeholder="留空允许公网；填写域名可缩小范围" onChange={event => onChange({ ...policy, hosts: event.target.value.trim() ? event.target.value.split(',').map(host => host.trim()) : null })} /></label>
      <small>只允许公网连接。域名限制同时适用于脚本接口、音频和封面；可使用 *.example.com。开启 HTTP 后传输不加密。</small></> : <small>此源仅使用 HTTPS，按其声明的接口、媒体和封面域名授权。</small>}
  </fieldset>;
}
import { useEffect, useState } from 'react';
