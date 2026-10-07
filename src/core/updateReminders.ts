import type { UpdateState } from './updates';

const STORAGE_KEY = 'zenix.updates.dismissed-versions.v1';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
// A public release is one reminder, regardless of download status or internal
// rebuilds. A later public version gets a new reminder; manual updates stay usable.
export function updateReminderKey(state: UpdateState, channel: string) {
  return state.version ? `${state.channel || channel}:${state.version}` : '';
}
export class UpdateReminders {
  private dismissed = new Set<string>();
  constructor(private storage: Storage) {
    try {
      const saved: unknown = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(saved)) for (const key of saved) if (typeof key === 'string' && key.length <= 160) this.dismissed.add(key);
    } catch { /* Keep an in-memory choice when browser storage is unavailable. */ }
  }
  shouldShow(state: UpdateState, channel: string) {
    const key = updateReminderKey(state, channel);
    return Boolean(key && ['available', 'downloading', 'ready'].includes(state.status) && !this.dismissed.has(key));
  }
  dismiss(state: UpdateState, channel: string) {
    const key = updateReminderKey(state, channel); if (!key) return;
    this.dismissed.add(key);
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify([...this.dismissed])); } catch { /* Session suppression still works. */ }
  }
}
