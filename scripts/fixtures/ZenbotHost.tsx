import {createRoot} from 'react-dom/client';
import {useSyncExternalStore} from 'react';
import {AssistantCoordinator} from '../../src/features/assistant/remote/coordinator';
import {createNativeTransport, invokeAssistantModel} from '../../src/features/assistant/remote/transport';
import {publishDesktopSession} from '../../src/features/assistant/remote/desktop-session';
import {createBusinessAdapter, type BusinessHost} from '../../src/features/assistant/remote/business';
import type {ChatHistoryData} from '../../src/features/assistant/remote/chat-history';
import type {PersonalState, PlayerState, Track} from '../../src/core/types';
import ChatWorkspace from '../../src/features/assistant/ChatWorkspace';
import ZenbotCharacter from '../../src/features/assistant/ZenbotCharacter';

const song: Track = {id: 'fixture-butterfly', source: 'local', title: 'Butter-Fly', artist: '和田光司', duration: 240};
let personal: PersonalState = {liked: [], favorites: [], playlists: [], history: []};
const playback: PlayerState = {track: song, playing: false, position: 0, duration: 240, volume: .7, muted: false, shuffle: false, repeat: 'all', queue: [song], queueIndex: 0};
const count = (action: string, args: Record<string, unknown> = {}) => window.yzqxy!.companion.invoke({action, ...args});
const host: BusinessHost = {
  snapshot: async () => ({personal, playback: structuredClone(playback), context: {}, sources: [{id: 'fixture', enabled: true, manifest: {capabilities: ['search']}}] as never}),
  selection: async () => [song], search: async () => [song],
  control: async (action, args) => {if (action === 'volume') playback.volume = Number(args.value);await count(action, args);},
  play: async track => {playback.track = track; playback.playing = true; await count('play');},
  create: async name => {await count('create');personal = {...personal, playlists: [...personal.playlists, {id: crypto.randomUUID(), name, tracks: []}]};return personal;},
  add: async () => personal, remove: async () => personal, collect: async () => personal,
  lyrics: async () => null, configureLyrics: async () => {}, navigate: async page => {await count('navigate', {page});},
  invoke: async <T,>(args: Record<string, unknown>): Promise<T> => await count(String(args.action || args.operation), args) as T,
  device: async () => null, transfer: async () => ({id: 'fixture'}), roaming: async () => {},
};
const transport = createNativeTransport(false);
const session = new AssistantCoordinator({platform: 'pc', transport, business: createBusinessAdapter('pc', host), history: {
  load: () => invokeAssistantModel<ChatHistoryData | null>(false, {action: 'historyRead'}),
  save: value => invokeAssistantModel(false, {action: 'historySave', value}),
}});
publishDesktopSession(session);
Object.assign(window, {zenbotTest: {session, playback}});

function Host() {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return <main style={{height: '90vh', display: 'flex', maxWidth: 800, margin: 'auto'}}><div style={{width: 160, height: 230}}><ZenbotCharacter state={snapshot.busy ? 'thinking' : 'idle'}/></div><ChatWorkspace session={session} snapshot={snapshot}/></main>;
}
createRoot(document.getElementById('root')!).render(<Host/>);
