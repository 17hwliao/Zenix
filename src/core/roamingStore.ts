import { createState, identity, prune, type RoamingState } from './roamingEngine';
import type { Track } from './types';

/** The lifetime ledger stays on disk; only the bounded taste profile lives in memory. */
export class RoamingStore {
  private database?: Promise<IDBDatabase>;
  private writes: Promise<void> = Promise.resolve();
  private open(): Promise<IDBDatabase> {
    return this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('zenix-roaming', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('seen');
        request.result.createObjectStore('profile');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  private transaction(database: IDBDatabase, stores: string[], write: (tx: IDBTransaction) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(stores, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('无法保存漫游记录'));
      try { write(tx); } catch (error) { tx.abort(); reject(error); }
    });
  }
  async load(): Promise<RoamingState> {
    const database = await this.open();
    const stored = await new Promise<RoamingState | undefined>((resolve, reject) => {
      const request = database.transaction('profile').objectStore('profile').get('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (stored) {
      // A crash after the migration commit can leave the old key behind.
      localStorage.removeItem('zenix.roaming.v1');
      return prune({ ...createState(), ...stored, seen: {} });
    }
    const legacy = localStorage.getItem('zenix.roaming.v1');
    let state = createState();
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (parsed?.version !== 1 || !parsed.seen || !parsed.feedback || !parsed.artistAffinity) throw new Error('漫游记录格式异常，原记录已保留');
      state = prune({ ...state, ...parsed });
    }
    const entries = Object.entries(state.seen);
    for (let offset = 0; offset < entries.length; offset += 500) {
      await this.transaction(database, ['seen'], tx => {
        for (const [key, value] of entries.slice(offset, offset + 500)) tx.objectStore('seen').put(value, key);
      });
    }
    state.seen = {};
    await this.transaction(database, ['profile'], tx => tx.objectStore('profile').put(state, 'state'));
    localStorage.removeItem('zenix.roaming.v1');
    return state;
  }
  async unseen(tracks: Track[]): Promise<Track[]> {
    const database = await this.open();
    await this.writes;
    return new Promise((resolve, reject) => {
      const tx = database.transaction('seen');
      const result: Track[] = [];
      for (const track of tracks) {
        const request = tx.objectStore('seen').get(identity(track));
        request.onsuccess = () => { if (!request.result) result.push(track); };
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  }
  save(state: RoamingState): Promise<void> {
    const snapshot = structuredClone(state);
    const task = this.writes.catch(() => {}).then(async () => {
      const database = await this.open();
      await this.transaction(database, ['seen', 'profile'], tx => {
        for (const [key, value] of Object.entries(snapshot.seen)) tx.objectStore('seen').put(value, key);
        tx.objectStore('profile').put({ ...snapshot, seen: {} }, 'state');
      });
      const keys = Object.keys(state.seen).sort((a, b) => state.seen[b].at - state.seen[a].at);
      for (const key of keys.slice(512)) if (snapshot.seen[key] && snapshot.seen[key].at === state.seen[key].at) delete state.seen[key];
    });
    this.writes = task;
    return task;
  }
}
