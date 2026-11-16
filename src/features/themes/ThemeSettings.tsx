import {Check, FileArchive, Trash2, Upload} from 'lucide-react';
import {useRef, useState} from 'react';
import {useThemeLibrary} from './storage';
import './themes.css';

export default function ThemeSettings() {
  const library = useThemeLibrary();
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const choose = async (id: string) => {
    if (busy) return;
    setError('');
    setMessage('');
    try {
      await library.select(id);
      setMessage('主题已应用。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '主题切换失败，当前主题保持不变。');
    }
  };

  const importFile = async (selected: File) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const theme = await library.importTheme(selected);
      setMessage(`“${theme.name}”已导入并应用。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '主题包无法读取，当前主题保持不变。');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (busy || !window.confirm('删除这个本地主题包？内置主题和当前播放不会受影响。')) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await library.remove(id);
      setMessage('本地主题已删除。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '主题删除失败。');
    } finally {
      setBusy(false);
    }
  };

  return <section className="zenix-theme-settings" data-setting="themes" data-mobile-setting="themes" aria-labelledby="zenix-theme-heading">
    <header className="zenix-theme-settings-head">
      <div>
        <h3 id="zenix-theme-heading">歌词主题</h3>
        <p>用于纯净歌词背景、文字、控制与节奏。主题异常只影响这里的视觉。</p>
      </div>
      <span className="zenix-theme-current">当前：{library.active.name}</span>
    </header>
    <div className="zenix-theme-grid" aria-label="可用歌词主题">
      {library.themes.map(theme => {
        const selected = library.active.id === theme.id;
        return <article key={theme.id} className={`zenix-theme-card${selected ? ' is-selected' : ''}`} data-theme-preview={theme.id}>
          <button type="button" className="zenix-theme-card-select" aria-pressed={selected} onClick={() => void choose(theme.id)} disabled={busy}>
            <span className="zenix-theme-swatch" style={{
              background: theme.tokens.background,
              color: theme.tokens.activeLyrics,
              ...(theme.assets?.backgroundUrl ? {backgroundImage: `linear-gradient(#0006,#0006),url("${theme.assets.backgroundUrl}")`} : {}),
            }}>
              {theme.assets?.previewUrl && <img src={theme.assets.previewUrl} alt="" />}
              <span className="zenix-theme-swatch-line">正在播放这一句</span>
              <span className="zenix-theme-swatch-line is-muted">下一句歌词</span>
            </span>
            <span className="zenix-theme-card-copy">
              <strong>{theme.name}</strong>
              <small>{theme.source === 'builtin' ? '内置主题' : `${theme.author} · v${theme.version}`}</small>
              <em>{theme.tokens.fontSize}px · {theme.tokens.maxWidth}px · {theme.tokens.motionMs}ms</em>
            </span>
            {selected && <span className="zenix-theme-check" aria-hidden="true"><Check size={15}/></span>}
          </button>
          {theme.source === 'user' && <button type="button" className="zenix-theme-delete" aria-label={`删除主题 ${theme.name}`} onClick={() => void remove(theme.id)} disabled={busy}><Trash2 size={15}/></button>}
        </article>;
      })}
    </div>
    <div className="zenix-theme-import-row">
      <input ref={file} hidden type="file" accept=".zenuxtheme,.zenuxtheme.zip,application/zip" onChange={event => {
        const selected = event.target.files?.[0];
        event.target.value = '';
        if (selected) void importFile(selected);
      }}/>
      <button type="button" onClick={() => file.current?.click()} disabled={busy}><Upload size={16}/>{busy ? '正在校验…' : '导入本地主题'}</button>
      <details>
        <summary><FileArchive size={15}/>主题包规范</summary>
        <p>ZIP 内必须包含 theme.json 和白名单预览图，可加入 background、texture 与 fonts 资源。只接受声明字段与安全资源，不执行脚本，未知文件会被拒绝。</p>
      </details>
    </div>
    {(message || error || library.error) && <div className={`zenix-theme-status${error || library.error ? ' is-error' : ''}`} role={error || library.error ? 'alert' : 'status'}>
      <span>{error || library.error || message}</span>
      {error && <button type="button" aria-label="关闭主题错误" onClick={() => setError('')}>×</button>}
    </div>}
  </section>;
}
