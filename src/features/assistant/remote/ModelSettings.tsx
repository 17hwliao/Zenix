import {useEffect, useId, useRef, useState, type FormEvent} from 'react';
import type {MaskedModelConfig, NativeTransport} from './contracts';
import './remoteAssistant.css';

type Props = {
  transport: NativeTransport;
  onConfigurationChanged?: () => void;
  mobile?: boolean;
};

/** Only the native vault returns persisted configuration. API keys remain write-only here. */
export default function ModelSettings({transport, onConfigurationChanged, mobile = false}: Props) {
  const prefix = useId();
  const [config, setConfig] = useState<MaskedModelConfig>();
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState<'read' | 'save' | 'test'>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const pending = useRef<AbortController | undefined>(undefined);
  const alive = useRef(false);
  const locked = useRef(false);

  const apply = (value: MaskedModelConfig) => {
    setConfig(value);
    setEndpoint(value.endpoint);
    setModel(value.model);
    setEnabled(value.enabled);
    setClearKey(false);
  };
  const showError = (reason: unknown, suppliedKey = '') => {
    const text = reason instanceof Error ? reason.message : '模型服务暂时不可用，请稍后重试。';
    setError(suppliedKey ? text.split(suppliedKey).join('[已隐藏]') : text);
  };
  const read = async () => {
    if (locked.current) return;
    locked.current = true;
    const token = ++epoch.current;
    setBusy('read');
    setError('');
    try {
      const value = await transport.read();
      if (alive.current && token === epoch.current) apply(value);
    } catch (reason) {
      if (alive.current && token === epoch.current) showError(reason);
    } finally {
      if (token === epoch.current) {
        locked.current = false;
        if (alive.current) setBusy(undefined);
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    void read();
    return () => {
      alive.current = false;
      epoch.current++;
      locked.current = false;
      pending.current?.abort();
    };
  }, [transport]);

  const changedAddress = Boolean(config && endpoint.trim() !== config.endpoint);
  const dirty = Boolean(config && (changedAddress || model.trim() !== config.model
    || enabled !== config.enabled || apiKey || clearKey));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (locked.current || !config) return;
    if (changedAddress && config.keyPresent && !apiKey.trim() && !clearKey) {
      setError('服务地址已改变，请填写这个地址的 API Key，或勾选清除原凭据。');
      return;
    }
    const key = apiKey.trim();
    if (endpoint.trim()) {
      try {
        const url = new URL(endpoint.trim());
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error();
      } catch {
        setError('请填写不含凭据和查询参数的 HTTPS 服务地址。');
        return;
      }
    }
    if (enabled && (!endpoint.trim() || !model.trim())) {
      setError('启用远程助手前，请填写服务地址和模型名称。');
      return;
    }
    locked.current = true;
    const token = ++epoch.current;
    setBusy('save');
    setError('');
    setMessage('');
    // Clear both the visible field and state before awaiting the native write.
    setApiKey('');
    try {
      onConfigurationChanged?.();
      const value = await transport.configure({
        enabled, endpoint: endpoint.trim(), model: model.trim(),
        ...(key ? {apiKey: key} : {}), ...(clearKey ? {clearKey: true} : {}),
      });
      if (!alive.current || token !== epoch.current) return;
      apply(value);
      setMessage(value.enabled && value.keyPresent ? '模型配置已保存。' : '配置已保存，本地音乐指令可继续使用。');
    } catch (reason) {
      if (alive.current && token === epoch.current) {
        showError(reason, key);
        if (key) setMessage('API Key 输入已清空，请重新填写后保存。');
      }
    } finally {
      if (token === epoch.current) {
        locked.current = false;
        if (alive.current) setBusy(undefined);
      }
    }
  };
  const test = async () => {
    if (locked.current || dirty || !config?.keyPresent || !config.enabled) return;
    locked.current = true;
    const token = ++epoch.current;
    const controller = new AbortController();
    pending.current = controller;
    setBusy('test');
    setError('');
    setMessage('正在验证模型连接和工具调用能力…');
    try {
      const value = await transport.test(controller.signal);
      if (!alive.current || token !== epoch.current || controller.signal.aborted) return;
      if (value.revision !== config.revision) {
        setError('配置已经变化，请重新读取后测试。');
        setMessage('');
      } else if (!value.ok || !value.toolCalling) {
        setError(value.message || '该模型尚未确认支持工具调用。');
        setMessage('');
      } else setMessage(value.message);
    } catch (reason) {
      if (alive.current && token === epoch.current && !controller.signal.aborted) {
        showError(reason);
        setMessage('');
      }
    } finally {
      if (token === epoch.current) {
        pending.current = undefined;
        locked.current = false;
        if (alive.current) setBusy(undefined);
      }
    }
  };
  const cancelTest = () => {
    epoch.current++;
    pending.current?.abort();
    pending.current = undefined;
    locked.current = false;
    setBusy(undefined);
    setMessage('已取消连接测试。');
    setError('');
  };

  return <section className={`remote-model-settings${mobile ? ' is-mobile' : ''}`} aria-label="远程模型设置">
    <header><h3>远程音乐助手</h3><span>{config?.enabled && config.keyPresent ? '已配置' : '本地指令可用'}</span></header>
    <form onSubmit={event => void save(event)}>
      <fieldset disabled={Boolean(busy) || !config}>
        <label className="remote-model-switch"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/>使用远程模型理解音乐指令</label>
        <label htmlFor={`${prefix}-endpoint`}>服务地址<input id={`${prefix}-endpoint`} aria-label="模型服务地址" type="url" inputMode="url" autoComplete="off" spellCheck={false} maxLength={2000} value={endpoint} placeholder="https://服务地址/v1" onChange={event => setEndpoint(event.target.value)}/></label>
        <label htmlFor={`${prefix}-model`}>模型名称<input id={`${prefix}-model`} aria-label="模型名称" autoComplete="off" spellCheck={false} maxLength={200} value={model} placeholder="服务商提供的模型名称" onChange={event => setModel(event.target.value)}/></label>
        <label htmlFor={`${prefix}-key`}>API Key<input id={`${prefix}-key`} aria-label="模型 API Key" type="password" autoComplete="new-password" spellCheck={false} maxLength={4096} value={apiKey} placeholder={config?.keyPresent ? '已安全保存，留空保留' : '填写自己的 API Key'} onChange={event => {setApiKey(event.target.value);if (event.target.value) setClearKey(false);}}/></label>
        {config?.keyPresent && <div className="remote-model-key-state"><span>凭据 {config.keyHint}</span><label><input type="checkbox" checked={clearKey} onChange={event => {setClearKey(event.target.checked);if (event.target.checked) setApiKey('');}}/>清除已保存凭据</label></div>}
        {changedAddress && config?.keyPresent && <p className="remote-model-note">更换服务地址时需要提供新凭据，或明确清除原凭据。</p>}
      </fieldset>
      <p className="remote-model-note">兼容 Chat Completions 工具调用。API Key 由{mobile ? '安卓系统' : '本机系统'}加密保管。</p>
      <div className="remote-model-actions">
        <button type="submit" disabled={Boolean(busy) || !config || !dirty}>{busy === 'save' ? '保存中…' : '保存配置'}</button>
        {busy === 'test'
          ? <button type="button" onClick={cancelTest}>取消测试</button>
          : <button type="button" disabled={Boolean(busy) || !config?.enabled || !config.keyPresent || dirty} onClick={() => void test()}>测试连接</button>}
        {!config && !busy && <button type="button" onClick={() => void read()}>重新读取配置</button>}
      </div>
    </form>
    <p className="remote-model-note">连接测试会向服务发送一条极短请求，服务商可能计费。</p>
    {message && <p role="status" className="remote-model-message">{message}</p>}
    {error && <div className="remote-model-error" role="alert"><span>{error}</span><button type="button" aria-label="关闭模型设置错误" onClick={() => setError('')}>×</button></div>}
  </section>;
}
