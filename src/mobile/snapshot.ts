import type { MobileSnapshot, MobileUpdate } from './native';

// Native events carry JSON. Keep unchanged presentation objects stable across
// progress ticks and repeated full snapshots, so they do not rerender every page.
function share(previous: unknown, next: unknown): unknown {
  if (previous === next) return previous;
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object' || Array.isArray(previous) !== Array.isArray(next)) return next;
  if (Array.isArray(next)) {
    const old = previous as unknown[], values = next.map((value,index)=>share(old[index],value));
    return old.length === values.length && values.every((value,index)=>value === old[index]) ? old : values;
  }
  const old = previous as Record<string,unknown>, value = next as Record<string,unknown>, keys = Object.keys(value);
  let same = Object.keys(old).length === keys.length;
  const result: Record<string,unknown> = {};
  for (const key of keys) { result[key] = share(old[key],value[key]); if (!Object.hasOwn(old,key) || result[key] !== old[key]) same = false; }
  return same ? previous : result;
}

export function mergeMobileSnapshot(previous: MobileSnapshot, update: MobileUpdate): MobileSnapshot {
  // A queue-bearing playback snapshot is authoritative. Optional activity,
  // errors and track must disappear when native playback clears them.
  const playback = update.playback ? 'queue' in update.playback ? update.playback : { ...previous.playback, ...update.playback } : previous.playback;
  return share(previous,{ ...previous, ...update, playback }) as MobileSnapshot;
}
