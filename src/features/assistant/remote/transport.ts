import { command, observeAssistantModelDelta } from '../../../mobile/native';
import type { MaskedModelConfig, ModelConfigInput, ModelConnectionResult, ModelRequest, ModelResponse, NativeTransport } from './contracts';

type NativeInvoke = <T>(args: Record<string, unknown>) => Promise<T>;

export const invokeAssistantModel = <T,>(mobile: boolean, args: Record<string, unknown>): Promise<T> => {
  if (mobile) return command<T>('assistantModel', args);
  if (!window.yzqxy?.assistantModel) return Promise.reject(Error('请在 Zenix 客户端使用模型连接'));
  return window.yzqxy.assistantModel.invoke<T>(args);
};

/** Credentials are submitted once to the native vault and are never part of model messages. */
export function createNativeTransport(mobile: boolean, provided?: NativeInvoke): NativeTransport {
  const invoke: NativeInvoke = provided || (async <T,>(args: Record<string, unknown>) => {
    if (mobile) return command<T>('assistantModel', args);
    const bridge = window.yzqxy as typeof window.yzqxy & { assistantModel?: { invoke: NativeInvoke } };
    if (!bridge?.assistantModel) throw Error('请在支持远程助手的 Zenix 客户端中配置模型');
    return bridge.assistantModel.invoke<T>(args);
  });
  const cancel = async (requestId: string) => { await invoke({ action: 'cancel', requestId }); };
  const perform = async <T,>(args: Record<string, unknown>, requestId: string, signal?: AbortSignal): Promise<T> => {
    signal?.throwIfAborted();
    let rejectCancellation: (reason: unknown) => void = () => {};
    const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
    const aborted = () => {
      rejectCancellation(signal?.reason || new DOMException('已取消模型请求', 'AbortError'));
      void cancel(requestId).catch(() => {});
    };
    signal?.addEventListener('abort', aborted, { once: true });
    try {
      const value = await Promise.race([invoke<T>(args), cancellation]);
      signal?.throwIfAborted();
      return value;
    } finally { signal?.removeEventListener('abort', aborted); }
  };
  return {
    read: () => invoke<MaskedModelConfig>({ action: 'read' }),
    configure: async (value: ModelConfigInput) => {
      const result = await invoke<MaskedModelConfig>({ action: 'configure', value });
      window.dispatchEvent(new Event('zenix-assistant-model-configured'));
      return result;
    },
    test: (signal?: AbortSignal, capability: 'text' | 'image' | 'tools' = 'tools') => {
      const requestId = crypto.randomUUID();
      return perform<ModelConnectionResult>({ action: 'test', requestId, capability }, requestId, signal);
    },
    complete: async (request: ModelRequest, signal?: AbortSignal, onDelta?: (text: string) => void) => {
      let remove: (() => void) | undefined;
      let listening = true;
      const receive = (value: {requestId: string; revision: string; text: string}) => {
        if (listening && !signal?.aborted && value.requestId === request.requestId && value.revision === request.revision) onDelta?.(value.text);
      };
      try {
        if (onDelta && !provided) {
          if (mobile) {const handle = await observeAssistantModelDelta(receive); remove = () => {void handle.remove();};}
          else remove = window.yzqxy?.assistantModel?.onDelta?.(receive);
        }
        return await perform<ModelResponse>({ action: 'complete', request }, request.requestId, signal);
      } finally {listening = false; remove?.();}
    },
    cancel,
  };
}
