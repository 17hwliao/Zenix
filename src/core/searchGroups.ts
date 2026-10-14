import type { TrackView } from '../ui/types';
// @ts-ignore Universal module: CommonJS in Electron, namespace side effect in Vite development.
import * as imported from './searchGroups.cjs';
type Grouping = {
  sameRecordingMetadata(a: TrackView, b: TrackView): boolean;
  mergeSearchGroups<T extends TrackView>(previous: T[], incoming: T[]): T[];
  queueForSelection<T extends TrackView>(groups: T[], selected: T): T[];
  containsTrack(group: TrackView, id?: string): boolean;
};
const direct = imported as unknown as Grouping;
const api = ((imported as { default?: Grouping }).default || (typeof direct.mergeSearchGroups === 'function' ? direct : undefined) || (globalThis as typeof globalThis & { zenixSearchGroups: Grouping }).zenixSearchGroups);
export const { sameRecordingMetadata, mergeSearchGroups, queueForSelection, containsTrack } = api;
