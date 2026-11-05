import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ModelSettings from '../../src/features/assistant/remote/ModelSettings';
import SessionContent, {remoteCharacterPhase} from '../../src/features/assistant/remote/SessionContent';
import type {MaskedModelConfig, ModelConfigInput, NativeTransport} from '../../src/features/assistant/remote/contracts';
import type {AssistantSessionSnapshot} from '../../src/features/assistant/remote/coordinator';

const privateTestKey = 'sk-fixture-private-never-render';
let config: MaskedModelConfig = {enabled: false, endpoint: '', model: '', keyPresent: false, keyHint: '', revision: '0'};
let finishSave: ((value: MaskedModelConfig) => void) | undefined;
let finishTest: ((value: {ok: boolean;message: string;revision: string;toolCalling: boolean}) => void) | undefined;
let failTest: ((reason: Error) => void) | undefined;
let finishConfirm: (() => void) | undefined;
let finishChoose: (() => void) | undefined;
const calls = {read: 0, configure: 0, test: 0, changed: 0, confirm: 0, cancel: 0, choose: [] as string[], keyMatches: false, aborted: false};
let holdSave = true;
let failSave = false;
const transport: NativeTransport = {
  read: async () => {calls.read++;return config;},
  configure: async (input: ModelConfigInput) => {
    calls.configure++;
    calls.keyMatches = input.apiKey === privateTestKey;
    if (failSave) throw Error('保存失败：' + input.apiKey);
    config = {enabled: input.enabled, endpoint: input.endpoint, model: input.model,
      keyPresent: input.clearKey ? false : Boolean(input.apiKey) || config.keyPresent,
      keyHint: input.clearKey ? '' : '••••render', revision: String(Number(config.revision) + 1)};
    if (holdSave) return new Promise(resolve => {finishSave = resolve;});
    return config;
  },
  test: async signal => {
    calls.test++;calls.aborted = false;
    signal?.addEventListener('abort', () => {calls.aborted = true;}, {once: true});
    return new Promise((resolve, reject) => {finishTest = resolve;failTest = reject;});
  },
  complete: async () => {throw Error('UI fixture must not invoke a real model');},
  cancel: async () => {throw Error('UI connection test must cancel only its own AbortSignal');},
};
const initial: AssistantSessionSnapshot = {revision: 0, status: 'idle', message: '本地音乐指令可用。', heard: '', busy: false, candidates: [], events: []};

function App() {
  const [snapshot, setSnapshot] = useState(initial);
  const [visible, setVisible] = useState(true);
  Object.assign(window, {remoteUiFixture: {
    calls, phase: remoteCharacterPhase,
    saveDone: () => finishSave?.(config),
    setSaveMode: (hold: boolean, fail: boolean) => {holdSave = hold;failSave = fail;},
    testDone: () => finishTest?.({ok: true, message: '连接正常。', revision: config.revision, toolCalling: true}),
    testFail: () => failTest?.(Error('长错误'.repeat(800))),
    snapshot: (next: Partial<AssistantSessionSnapshot>) => setSnapshot(old => ({...old, ...next, revision: old.revision + 1})),
    hide: () => setVisible(false), show: () => setVisible(true),
    confirmDone: () => finishConfirm?.(), chooseDone: () => finishChoose?.(),
  }});
  return <main><ModelSettings transport={transport} onConfigurationChanged={() => {calls.changed++;}}/>
    {visible && <SessionContent snapshot={snapshot}
      onConfirm={() => {calls.confirm++;return new Promise(resolve => {finishConfirm = resolve;});}}
      onCancel={() => {calls.cancel++;}}
      onChoose={ref => {calls.choose.push(ref);return new Promise(resolve => {finishChoose = resolve;});}}/>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
