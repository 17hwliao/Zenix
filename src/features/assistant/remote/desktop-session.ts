import type {AssistantCoordinator, AssistantSessionSnapshot} from './coordinator';
import type {ChatAttachment} from './chat-history';

export type AssistantSession = Pick<AssistantCoordinator, 'subscribe' | 'getSnapshot' | 'submit' | 'submitChat' | 'cancel' | 'confirm' | 'chooseCandidate' | 'setListening' | 'setDraft' | 'selectConversation' | 'deleteConversation' | 'configurationChanged'>;

const allowed = new Set(['submitChat', 'cancel', 'confirm', 'chooseCandidate', 'setDraft', 'selectConversation', 'deleteConversation', 'configurationChanged']);

export function publishDesktopSession(session: AssistantCoordinator): () => void {
  const bridge = window.yzqxy?.assistantChat;
  if (!bridge) return () => {};
  const publish = () => bridge.publish(session.getSnapshot());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = session.subscribe(() => {timer ??= setTimeout(() => {timer = undefined; publish();}, 40);});
  const commands = bridge.onCommand(value => {
    if (!allowed.has(value.action)) return;
    const action = value.action as keyof AssistantSession;
    void (async () => {
      try {
        const method = session[action] as (...args: unknown[]) => unknown;
        if (['submitChat', 'cancel', 'confirm', 'chooseCandidate', 'configurationChanged'].includes(action)) window.dispatchEvent(new Event('zenix-assistant-silence'));
        const result = await method.apply(session, value.args);
        bridge.respond({id: value.id, value: result ?? true});
      } catch (reason) {bridge.respond({id: value.id, error: reason instanceof Error ? reason.message : '助手操作未完成'});}
    })();
  });
  publish();
  return () => {clearTimeout(timer);unsubscribe(); commands();};
}

export function createPocketSession(): AssistantSession {
  const bridge = window.zenixChat!;
  let snapshot: AssistantSessionSnapshot = {revision: 0, status: 'idle', message: '正在连接主窗口…', heard: '', busy: false, candidates: [], events: []};
  let sequence = -1;
  const listeners = new Set<() => void>();
  const receive = (value: {sequence: number; snapshot: AssistantSessionSnapshot | null}) => {
    if (value.sequence < sequence) return;
    sequence = value.sequence;
    snapshot = value.snapshot || {...snapshot, status: 'failed', busy: false, confirmation: undefined, message: '主窗口业务宿主尚未就绪，请打开 Zenix 后重试'};
    for (const listener of listeners) listener();
  };
  const unsubscribe = bridge.onSnapshot(receive);
  window.addEventListener('beforeunload', unsubscribe, {once: true});
  void bridge.invoke<{sequence: number; snapshot: AssistantSessionSnapshot | null}>({action: 'snapshot'}).then(receive).catch(() => {});
  const command = async (action: string, args: unknown[] = []) => {await bridge.invoke({action, args});};
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {listeners.add(listener); return () => {listeners.delete(listener);};},
    submit: text => command('submitChat', [text]),
    submitChat: (text, images: readonly ChatAttachment[] = []) => command('submitChat', [text, images]),
    cancel: () => {void command('cancel').catch(() => {});},
    confirm: token => command('confirm', [token]),
    chooseCandidate: ref => command('chooseCandidate', [ref]),
    setListening: () => {},
    setDraft: (text, images) => command('setDraft', [text, images]),
    selectConversation: id => command('selectConversation', id ? [id] : []),
    deleteConversation: id => command('deleteConversation', [id]),
    configurationChanged: () => {void command('configurationChanged').catch(() => {});},
  };
}
