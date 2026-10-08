import { useState } from 'react';
import { Package, LoaderCircle } from 'lucide-react';
import './SourceBundleImport.css';

export default function SourceBundleExport({ count, disabled, save, onBusy }: { count: number; disabled?: boolean; save: () => Promise<{ saved: boolean; count: number }>; onBusy?: (busy: boolean) => void }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  async function exportFile() {
    if (busy) return; setBusy(true); onBusy?.(true); setMessage(''); setError(false);
    try { const result = await save(); if (result.saved) setMessage(`已保存 ${result.count} 份音乐源文件，可发送给好友`); }
    catch (reason) { setError(true); setMessage(reason instanceof Error ? reason.message : '音乐源打包失败'); }
    finally { setBusy(false); onBusy?.(false); }
  }
  return <section className="zenix-bundle-import zenix-bundle-export" aria-label="打包分享音乐源">
    <button type="button" className="zenix-bundle-pick" disabled={busy || disabled || !count} onClick={() => void exportFile()}>{busy ? <LoaderCircle size={17} className="zenix-bundle-spin"/> : <Package size={17}/>}一键打包全部音乐源{count ? ` · ${count}` : ''}</button>
    <small>保存全部已安装的源文件，包含停用的源，不包含软件中填写的个人配置。源文件中的原始内容会保留。好友通过“导入分享源包”打开即可。</small>
    {message && <p role={error ? 'alert' : 'status'} className={error ? 'zenix-bundle-errors' : ''}>{message}</p>}
  </section>;
}
