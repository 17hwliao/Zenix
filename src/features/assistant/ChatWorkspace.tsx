import {useEffect, useRef, useState, type DragEvent} from 'react';
import type {AssistantSession} from './remote/desktop-session';
import type {AssistantSessionSnapshot} from './remote/coordinator';
import type {AssistantAttachment} from './remote/contracts';
import type {ChatAttachment} from './remote/chat-history';
import {invokeAssistantModel} from './remote/transport';
import SessionContent from './remote/SessionContent';
import {ArrowUp, Check, Copy, ImagePlus, LoaderCircle, MessageSquare, Mic2, Plus, Square, Trash2, X} from 'lucide-react';
import {useAssistantFigure, zenbotBase} from './ZenbotCharacter';
import './pocket-chat.css';

function AttachmentPreview({image, mobile}: {image: ChatAttachment; mobile: boolean}) {
  const [preview, setPreview] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void invokeAssistantModel<string>(mobile, {action: 'attachmentPreview', attachmentId: image.id}).then(value => {if (alive) setPreview(value);}).catch(() => {if (alive) setFailed(true);});
    return () => {alive = false;};
  }, [image.id, mobile]);
  return preview ? <img src={preview} alt={image.name} loading="lazy"/> : <span>{failed ? '图片不可用' : '加载图片…'}</span>;
}

export default function ChatWorkspace({session, snapshot, mobile = false, onStop, onSubmit}: {
  session: AssistantSession; snapshot: AssistantSessionSnapshot; mobile?: boolean; onStop?: () => void;
  onSubmit?: () => void;
}) {
  const draft = snapshot.chat?.draft;
  const [text, setText] = useState(draft?.text || '');
  const [attachments, setAttachments] = useState<ChatAttachment[]>(draft?.attachments || []);
  const [drawer, setDrawer] = useState(false);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [copied, setCopied] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const figure = useAssistantFigure();
  const historyButton = useRef<HTMLButtonElement>(null);
  const dragDepth = useRef(0);
  const file = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const writing = useRef(0);
  const importingRef = useRef(false);
  const sending = useRef(false);
  const latest = useRef({text, attachments});
  latest.current = {text, attachments};
  const alive = useRef(true);
  const conversation = useRef({id: snapshot.chat?.activeId});
  if (conversation.current.id !== snapshot.chat?.activeId) conversation.current = {id: snapshot.chat?.activeId};

  useEffect(() => {alive.current = true;return () => {alive.current = false;};}, []);
  useEffect(() => {
    if (!writing.current && draft) {latest.current = {text: draft.text, attachments: draft.attachments};setText(draft.text); setAttachments(draft.attachments);}
  }, [draft]);
  useEffect(() => {followLatest.current = true;}, [snapshot.chat?.activeId]);
  useEffect(() => {
    const area = feed.current;
    if (area && followLatest.current) area.scrollTop = area.scrollHeight;
  }, [snapshot.chat?.messages]);

  const updateDraft = async (value: string, images: ChatAttachment[]) => {
    latest.current = {text: value, attachments: images};
    setText(value); setAttachments(images); writing.current++;
    try {await session.setDraft(value, images);}
    catch (reason) {if (alive.current) setError(reason instanceof Error ? reason.message : '草稿未能同步');}
    finally {
      writing.current--;
    }
  };

  const addFiles = async (files: File[]) => {
    if (importingRef.current || !files.length) return;
    importingRef.current = true;
    setImporting(true); setError('');
    const imported: ChatAttachment[] = [];
    const origin = conversation.current;
    const checkOrigin = () => {if (!alive.current || conversation.current !== origin) throw Error('会话已切换或关闭，图片未添加到其他会话');};
    try {
      if (latest.current.attachments.length + files.length > 8) throw Error('每条消息最多添加 8 张图片');
      for (const value of files) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(value.type)) throw Error('请选择 PNG、JPEG 或 WebP 图片');
        if (value.size > 20 * 1024 * 1024) throw Error(`“${value.name}”超过 20 MiB`);
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(Error('图片读取失败'));
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.readAsDataURL(value);
        });
        checkOrigin();
        const image = await invokeAssistantModel<AssistantAttachment>(mobile, {action: 'attachmentImport', value: {base64, name: value.name}});
        const {preview: _preview, ...metadata} = image;
        imported.push(metadata);
        checkOrigin();
      }
      if ([...latest.current.attachments, ...imported].reduce((total, image) => total + image.bytes, 0) > 8 * 1024 * 1024) throw Error('图片处理后总量超过 8 MiB，请减少图片');
      await updateDraft(latest.current.text, [...latest.current.attachments, ...imported]);
    } catch (reason) {
      await Promise.all(imported.map(image => invokeAssistantModel(mobile, {action: 'attachmentRemove', attachmentId: image.id}).catch(() => {})));
      if (alive.current) setError(reason instanceof Error ? reason.message : '图片添加失败');
    } finally {importingRef.current = false;if (alive.current) setImporting(false);}
  };

  const send = async () => {
    if (sending.current || importingRef.current || snapshot.busy || snapshot.confirmation || (!latest.current.text.trim() && !latest.current.attachments.length)) return;
    sending.current = true; setError(''); onSubmit?.();
    try {await session.submitChat(latest.current.text, latest.current.attachments);}
    catch (reason) {if (alive.current) setError(reason instanceof Error ? reason.message : '消息发送结果尚未确认，请先查看当前会话');}
    finally {sending.current = false;}
  };
  const act = async (callback: () => Promise<void>) => {
    try {await callback(); setDrawer(false); setError(''); composer.current?.focus();}
    catch (reason) {setError(reason instanceof Error ? reason.message : '会话操作失败');}
  };
  const drop = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); dragDepth.current = 0; setDragOver(false); void addFiles(Array.from(event.dataTransfer.files));
  };

  return <div className="zenix-chat-workspace" data-busy={snapshot.busy} data-drag-over={dragOver}
    onKeyDown={event => {if (event.key === 'Escape' && drawer) {event.preventDefault();event.stopPropagation();setDrawer(false);historyButton.current?.focus();}}}
    onDragEnter={event => {if (event.dataTransfer.types.includes('Files')) {event.preventDefault();dragDepth.current++;setDragOver(true);}}}
    onDragLeave={() => {dragDepth.current = Math.max(0, dragDepth.current - 1);if (!dragDepth.current) setDragOver(false);}}
    onDragOver={event => {if (event.dataTransfer.types.includes('Files')) {event.preventDefault();event.dataTransfer.dropEffect = 'copy';}}} onDrop={drop}>
    <div className="zenix-chat-toolbar"><button ref={historyButton} type="button" aria-expanded={drawer} onClick={() => setDrawer(value => !value)}><MessageSquare size={14}/>会话</button>
      <span className="zenix-chat-live" aria-hidden="true">{snapshot.confirmation ? '等待你的确认' : snapshot.busy ? <><span className="zenix-thinking-dots"><i/><i/><i/></span>正在处理</> : snapshot.status === 'needs_input' ? '等待补充' : '随时聊聊'}</span>
      <button type="button" disabled={snapshot.busy || !!snapshot.confirmation} onClick={() => void act(() => session.selectConversation())}><Plus size={14}/>新对话</button></div>
    {drawer && <nav className="zenix-chat-drawer" aria-label="会话历史">
      <header><strong>最近的对话</strong><button aria-label="收起会话历史" onClick={() => {setDrawer(false);historyButton.current?.focus();}}><X size={15}/></button></header>
      <div className="zenix-chat-history-list">{snapshot.chat?.conversations.map(conversation => <div key={conversation.id}><button aria-current={snapshot.chat?.activeId === conversation.id} onClick={() => void act(() => session.selectConversation(conversation.id))}><MessageSquare size={14}/><span>{conversation.title}</span></button>
        <button aria-label={`删除会话 ${conversation.title}`} onClick={() => {if (window.confirm(`删除会话“${conversation.title}”？`)) void act(() => session.deleteConversation(conversation.id));}}><Trash2 size={14}/></button></div>)}</div>
      <button className="zenix-chat-karaoke" onClick={() => {if(window.zenixChat?.pocket)void window.zenixChat.invoke({action:'karaoke'});else window.dispatchEvent(new CustomEvent('zenix-open-workbench', {detail: {tab: 'karaoke'}}));setDrawer(false);}}><Mic2 size={15}/>打开 K 歌<span>↗</span></button>
    </nav>}
    <div className="zenix-chat-feed" ref={feed} role="log" aria-label="聊天消息" aria-live="polite" onScroll={event => {const area = event.currentTarget;followLatest.current = area.scrollHeight - area.scrollTop - area.clientHeight < 80;}}>
      {!snapshot.chat?.messages.length && <div className="zenix-chat-empty">
        <div className="zenix-chat-welcome-portrait"><img src={figure === 'whale' ? zenbotBase.replace(/zenbot$/, 'whale') + '/thumbs/deepseek.png' : zenbotBase + '/expressions/neutral.png'} alt=""/></div>
        <h2>今天，想聊些什么？</h2><p>聊聊日常，看看图片，或一起听首歌。</p>
        <div className="zenix-chat-suggestions">{['播放和田光司的 Butter-Fly', '20 分钟后停止播放'].map(value => <button key={value} type="button" onClick={() => {void updateDraft(value, attachments);composer.current?.focus();}}>{value}<ArrowUp size={13}/></button>)}</div>
      </div>}
      {snapshot.chat?.messages.map(message => <article key={message.id} className={`zenix-chat-message is-${message.role}`} data-message-status={message.status}>
        <span className="zenix-chat-author">{message.role === 'user' ? '你' : figure === 'whale' ? 'DeepSeek 鲸鱼娘' : 'Zenbot'}{message.status === 'cancelled' && <small>已停止</small>}</span>
        {message.attachments.length > 0 && <div className="zenix-chat-attachments">{message.attachments.map(image => <AttachmentPreview key={image.id} image={image} mobile={mobile}/>)}</div>}
        <p>{message.text || (snapshot.busy ? <span className="zenix-thinking-dots" aria-label="正在思考"><i/><i/><i/></span> : '回复未完成')}</p>
        {message.role === 'assistant' && message.text && <button className="zenix-chat-copy" onClick={() => {void navigator.clipboard.writeText(message.text).then(() => setCopied(message.id)).catch(() => setError('复制失败，请选中文字复制'));}}>{copied === message.id ? <Check size={12}/> : <Copy size={12}/>} {copied === message.id ? '已复制' : '复制'}</button>}
      </article>)}
      {(snapshot.confirmation || snapshot.candidates.length > 0 || snapshot.result?.data || (!snapshot.chat?.messages.length && snapshot.status !== 'idle')) && <SessionContent snapshot={snapshot} hideMessage={!!snapshot.chat?.messages.some(message => message.role === 'assistant' && message.text === snapshot.message)} onConfirm={token => session.confirm(token)} onCancel={() => {onStop?.();session.cancel();}} onChoose={ref => session.chooseCandidate(ref)}/>}
    </div>
    <form className="zenix-chat-composer" onSubmit={event => {event.preventDefault();void send();}}>
      {attachments.length > 0 && <div className="zenix-chat-attachments" aria-label={`已添加 ${attachments.length} 张图片`}>{attachments.map(image => <div key={image.id}><AttachmentPreview image={image} mobile={mobile}/><button type="button" aria-label={`移除图片 ${image.name}`} onClick={() => {void updateDraft(latest.current.text, latest.current.attachments.filter(value => value.id !== image.id)).then(() => invokeAssistantModel(mobile, {action: 'attachmentRemove', attachmentId: image.id})).catch(() => {});}}>×</button></div>)}</div>}
      <label className="zenix-chat-input"><span className="zenix-visually-hidden">你想说的话</span><textarea ref={composer} value={text} maxLength={4000} placeholder="说点什么，或放一张图片…" rows={2}
        onChange={event => void updateDraft(event.target.value, attachments)}
        onKeyDown={event => {if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {event.preventDefault();void send();}}}
        onPaste={event => {const images = Array.from(event.clipboardData.files);if (images.length) {event.preventDefault();void addFiles(images);}}}/></label>
      <div className="zenix-chat-compose-actions">
        <input hidden ref={file} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={event => {const values = Array.from(event.target.files || []);event.target.value = '';void addFiles(values);}}/>
        <button className="zenix-chat-attach" type="button" disabled={importing} onClick={() => file.current?.click()}>{importing ? <LoaderCircle className="zenix-spin" size={17}/> : <ImagePlus size={17}/>}<span>{importing ? '处理中' : '添加图片'}</span></button>
        <span className="zenix-chat-key-hint">{attachments.length ? `${attachments.length} / 8 张` : mobile ? '' : 'Enter 发送'}</span>
        {snapshot.busy || snapshot.confirmation ? <button className="zenix-chat-send is-stop" type="button" aria-label="停止" title="停止回复" onClick={() => {onStop?.();session.cancel();}}><Square size={14} fill="currentColor"/></button> : <button className="zenix-chat-send" type="submit" aria-label="发送" title="发送" disabled={importing || (!text.trim() && !attachments.length)}><ArrowUp size={19}/></button>}
      </div>
    </form>
    {(error || snapshot.chat?.error) && <p className="zenix-chat-error" role="alert">{error || snapshot.chat?.error}</p>}
    {dragOver && <div className="zenix-chat-drop"><ImagePlus size={28}/><strong>松开，添加到这条消息</strong><span>PNG · JPEG · WebP</span></div>}
  </div>;
}
