import type {AssistantAttachment, ModelMessage, SessionStatus} from './contracts';

export type ChatAttachment = Omit<AssistantAttachment, 'preview'>;
export type ChatMessage = {id: string; requestId: string; role: 'user' | 'assistant'; text: string; attachments: ChatAttachment[]; status: SessionStatus; at: number};
export type ChatConversation = {id: string; title: string; messages: ChatMessage[]; draft: {text: string; attachments: ChatAttachment[]}};
export type ChatHistoryData = {schemaVersion: 1; activeId: string; conversations: ChatConversation[]};
export type ChatSnapshot = {activeId: string; conversations: {id: string; title: string}[]; messages: ChatMessage[]; draft: ChatConversation['draft']; error: string};
export type ChatPersistence = {load(): Promise<ChatHistoryData | null>; save(value: ChatHistoryData): Promise<unknown>};

const metadata = (images: readonly ChatAttachment[]): ChatAttachment[] => images.map(({id, name, bytes, width, height}) => ({id, name, bytes, width, height}));

export class ConversationHistory {
  private data: ChatHistoryData;
  private error = '';
  private writes = Promise.resolve();
  private pendingSave?: ChatHistoryData;
  private readonly draftVersions = new Map<string, number>();
  private readonly submittedDrafts = new Map<string, number>();
  readonly ready: Promise<void>;

  constructor(private readonly changed: (snapshot: ChatSnapshot) => void, private readonly persistence?: ChatPersistence) {
    const conversation = this.empty();
    this.data = {schemaVersion: 1, activeId: conversation.id, conversations: [conversation]};
    this.ready = this.restore();
  }

  private empty(): ChatConversation {
    return {id: crypto.randomUUID(), title: '新对话', messages: [], draft: {text: '', attachments: []}};
  }

  private async restore() {
    try {
      const saved = await this.persistence?.load();
      if (saved?.schemaVersion === 1 && saved.conversations.length && saved.conversations.some(value => value.id === saved.activeId)) {
        this.data = saved;
        for (const conversation of this.data.conversations) for (const message of conversation.messages) {
          if (['understanding', 'executing', 'awaiting_confirmation', 'listening'].includes(message.status)) {
            message.status = 'unknown';
            message.text += '\n上次会话已中断，请先核对操作状态。';
          }
        }
      }
    } catch (reason) {this.error = reason instanceof Error ? reason.message : '会话历史读取失败，本轮仍可使用';}
    this.publish();
  }

  get current(): ChatConversation {return this.data.conversations.find(value => value.id === this.data.activeId)!;}

  snapshot(): ChatSnapshot {
    return {activeId: this.data.activeId, conversations: this.data.conversations.map(({id, title}) => ({id, title})), messages: this.current.messages,
      draft: this.current.draft, error: this.error};
  }

  private publish(save = false) {
    this.changed(this.snapshot());
    if (!save || !this.persistence) return;
    this.pendingSave = this.data;
    this.writes = this.writes.then(async () => {
      if (!this.pendingSave) return;
      const value = structuredClone(this.pendingSave);
      this.pendingSave = undefined;
      await this.persistence!.save(value);
      if (this.error) {this.error = '';this.changed(this.snapshot());}
    }).catch(reason => {
      this.error = reason instanceof Error ? reason.message : '会话未能保存，当前内容仍可查看';
      this.changed(this.snapshot());
    });
  }

  setDraft(text: string, attachments: readonly ChatAttachment[]) {
    if (text.length > 4000 || attachments.length > 8 || attachments.reduce((total, image) => total + image.bytes, 0) > 8 * 1024 * 1024) throw Error('草稿最多 4000 字、8 张图片，处理后图片总量最多 8 MiB');
    this.current.draft = {text, attachments: metadata(attachments)};
    this.draftVersions.set(this.data.activeId, (this.draftVersions.get(this.data.activeId) || 0) + 1);
    this.publish(true);
  }

  start(requestId: string, text: string, attachments: readonly ChatAttachment[]) {
    const conversation = this.current;
    this.submittedDrafts.set(requestId, this.draftVersions.get(conversation.id) || 0);
    if (this.submittedDrafts.size > 128) this.submittedDrafts.delete(this.submittedDrafts.keys().next().value!);
    if (!conversation.messages.length) conversation.title = text.slice(0, 40) || '图片问答';
    const at = Date.now();
    conversation.messages = [...conversation.messages, {id: crypto.randomUUID(), requestId, role: 'user' as const, text, attachments: metadata(attachments), status: 'completed' as const, at},
      {id: crypto.randomUUID(), requestId, role: 'assistant' as const, text: '', attachments: [], status: 'understanding' as const, at}].slice(-100);
    this.publish(true);
  }

  acknowledge(requestId: string) {
    const conversation = this.data.conversations.find(value => value.messages.some(message => message.requestId === requestId));
    const user = conversation?.messages.find(value => value.requestId === requestId && value.role === 'user');
    if (!conversation || !user) return;
    const version = this.submittedDrafts.get(requestId);
    this.submittedDrafts.delete(requestId);
    if (version === undefined || version !== (this.draftVersions.get(conversation.id) || 0)) return;
    const draft = conversation.draft;
    if ((draft.text.trim() === user.text || !draft.text.trim() && user.attachments.length > 0) && draft.attachments.map(image => image.id).join() === user.attachments.map(image => image.id).join()) {
      conversation.draft = {text: '', attachments: []};
      this.publish(true);
    }
  }

  result(requestId: string, text: string, status: SessionStatus, incremental = false) {
    for (const conversation of this.data.conversations) {
      const message = conversation.messages.find(value => value.requestId === requestId && value.role === 'assistant');
      if (!message) continue;
      conversation.messages = conversation.messages.map(value => value === message ? {...message, text: (incremental ? message.text + text : text).slice(0, 24000), status} : value);
      this.publish(!incremental);
      return;
    }
  }

  select(id?: string) {
    if (id) {
      if (!this.data.conversations.some(value => value.id === id)) throw Error('会话已不存在');
      this.data.activeId = id;
    } else {
      if (this.data.conversations.length >= 20) throw Error('最多保留 20 个会话，请先删除部分历史');
      const conversation = this.empty();
      this.data.conversations = [...this.data.conversations, conversation];
      this.data.activeId = conversation.id;
    }
    this.publish(true);
  }

  remove(id: string) {
    this.draftVersions.delete(id);
    this.data.conversations = this.data.conversations.filter(value => value.id !== id);
    if (!this.data.conversations.length) this.data.conversations = [this.empty()];
    if (this.data.activeId === id) this.data.activeId = this.data.conversations[0].id;
    this.publish(true);
  }

  modelHistory(): ModelMessage[][] {
    const messages = this.current.messages;
    const pairs: ModelMessage[][] = [];
    for (let index = 0; index + 1 < messages.length; index += 2) {
      const user = messages[index], assistant = messages[index + 1];
      if (user.role !== 'user' || assistant.role !== 'assistant' || assistant.status !== 'completed') continue;
      pairs.push([{role: 'user', content: user.attachments.length ? [{type: 'text', text: user.text}, ...user.attachments.map(image => ({type: 'image' as const, attachmentId: image.id}))] : user.text}, {role: 'assistant', content: assistant.text}]);
    }
    return pairs.slice(-10);
  }
}
