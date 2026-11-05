import {command} from '../../../mobile/native';
import {AssistantCoordinator} from './coordinator';
import {createBusinessAdapter} from './business';
import {createBrowserOperationJournal} from './journal';
import {createLocalAssistantHandler} from './local';
import {createNativeTransport} from './transport';
import type {NativeTransport} from './contracts';

type Invoke = <T = unknown>(args: Record<string, unknown>) => Promise<T>;
type Executor = (action: string, args: Record<string, unknown>) => Promise<unknown>;
export type AssistantRuntime = {
  session: AssistantCoordinator;
  transport: NativeTransport;
  invoke: Invoke;
  attach(): void;
  detach(): void;
};
const clients = new Map<boolean, AssistantRuntime>();

function createRuntime(mobile: boolean, provided?: Invoke, execute?: Executor): AssistantRuntime {
  const isolated = Boolean(provided || execute);
  const invoke: Invoke = provided || (async <T,>(args: Record<string, unknown>): Promise<T> => {
    if (mobile) return command<T>('features', args);
    if (!window.yzqxy?.companion) throw Error('请在 Zenix 客户端使用音乐助手');
    return window.yzqxy.companion.invoke(args) as Promise<T>;
  });
  const transport = createNativeTransport(mobile);
  const local = createLocalAssistantHandler(mobile, invoke, execute);
  const session = new AssistantCoordinator({
    platform: mobile ? 'android' : 'pc',
    transport,
    business: createBusinessAdapter(mobile ? 'android' : 'pc'),
    local: local.handle,
    onLocalReset: local.reset,
    ...(!isolated ? {journal: createBrowserOperationJournal(localStorage)} : {}),
  });
  const configured = () => session.configurationChanged();
  if (!isolated) window.addEventListener('zenix-assistant-model-configured', configured);
  const close = () => {
    session.dispose();
    window.removeEventListener('zenix-assistant-model-configured', configured);
    window.removeEventListener('beforeunload', close);
  };
  if (!isolated) window.addEventListener('beforeunload', close);
  if (!isolated) void session.recover();
  let observers = 0;
  let cleanup: ReturnType<typeof setTimeout> | undefined;
  return {
    session, transport, invoke,
    attach() { observers++; clearTimeout(cleanup); },
    detach() {
      observers--;
      // A StrictMode effect remount reattaches before this runs.
      if (isolated) cleanup = setTimeout(() => {if (!observers) close();}, 0);
    },
  };
}

/** The application lifetime owns dispatch. Opening or closing a panel only changes observers. */
export function getAssistantRuntime(mobile: boolean, provided?: Invoke, execute?: Executor): AssistantRuntime {
  if (provided || execute) return createRuntime(mobile, provided, execute);
  let runtime = clients.get(mobile);
  if (!runtime) { runtime = createRuntime(mobile); clients.set(mobile, runtime); }
  return runtime;
}
