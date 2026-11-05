import {executeAssistant} from '../../featureHost';
import {understand, type Intent} from '../intent';
import type {AssistantResult} from '../libraryCommands';
import type {LocalAssistantHandler, LocalPlan} from './coordinator';

type Invoke = <T = unknown>(args: Record<string, unknown>) => Promise<T>;
type Executor = (action: string, args: Record<string, unknown>) => Promise<unknown>;

/** The existing local interpreter stays available independently of model configuration. */
export function createLocalAssistantHandler(mobile: boolean, invoke: Invoke, provided?: Executor) {
  let naming: AssistantResult['ask'];

  const execute = async (intent: Intent, signal: AbortSignal): Promise<AssistantResult | LocalPlan> => {
    signal.throwIfAborted();
    if (!intent.action) return {reply: intent.reply};
    const value = provided
      ? await provided(intent.action, intent.args || {})
      : await executeAssistant(
        mobile, intent.action, intent.args || {}, invoke,
        () => window.dispatchEvent(new CustomEvent('zenix-open-workbench', {detail: {tab: 'tasks'}})),
        signal,
      );
    if (value && typeof value === 'object' && 'kind' in value && value.kind === 'confirmation') {
      return value as LocalPlan;
    }
    const result = value && typeof value === 'object' && 'reply' in value
      ? value as AssistantResult
      : {reply: intent.action === 'search'
        ? `已打开${intent.reply}的结果，请选择想听的版本。`
        : `已${intent.reply}。`};
    if (!signal.aborted) naming = result.ask;
    return result;
  };

  const handle: LocalAssistantHandler = async (text, confidence, signal) => {
    let intent = understand(text, confidence);
    const question = naming;
    naming = undefined;
    if (question && intent.kind === 'unknown'
      && !/^(不要|别|取消|删除|清空|移除|搜索|打开|返回|播放|创建|新建)/.test(text.trim())) {
      const name = text.trim().replace(/^(?:叫|名字叫|命名为)/, '').replace(/^[《“"]|[》”"]$/g, '').trim();
      intent = {kind: Number.isFinite(confidence) && confidence >= .62 ? 'action' : 'confirm', action: question.action, args: {...question.args, name}, reply: '创建歌单'};
    }
    if (intent.kind === 'confirm') {
      const pinned = structuredClone(intent);
      return {
        kind: 'confirmation',
        summary: `我理解为“${intent.reply}”，识别把握不足，请确认。`,
        items: [],
        commit: () => execute(pinned, signal),
      };
    }
    if (intent.kind === 'action') return execute(intent, signal);
    if (intent.kind === 'unknown') return undefined;
    return {reply: intent.reply};
  };
  handle.readOnly = (text: string, confidence: number) => {
    if (naming) return false;
    const intent = understand(text, confidence);
    if (intent.kind === 'confirm') return false;
    if (intent.kind !== 'action') return true;
    return ['song-query', 'now-lyrics', 'now-artist', 'recent-songs', 'network-tasks', 'week-stats',
      'home', 'playlist-open', 'tasks', 'space-open'].includes(intent.action || '');
  };
  return {handle, reset: () => {naming = undefined;}};
}
