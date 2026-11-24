import type {Track} from '../../core/types';
import type {SoloResult} from './solo-score';

export interface PracticeRecord {
  id: string;
  title: string;
  artist: string;
  at: number;
  result: SoloResult;
}

const numericScore = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
function readablePractice(value: unknown): value is PracticeRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as PracticeRecord;
  const result = item.result;
  return typeof item.id === 'string' && typeof item.title === 'string' && Number.isFinite(item.at) && !!result
    && numericScore(result.total) && numericScore(result.pitch) && numericScore(result.rhythm) && numericScore(result.coverage)
    && Array.isArray(result.lines) && result.lines.every(row => row && Number.isInteger(row.lineIndex) && numericScore(row.total)
      && Array.isArray(row.feedback) && row.feedback.every((text: unknown) => typeof text === 'string'))
    && (result.sections === undefined || (Array.isArray(result.sections) && result.sections.every(section => section && typeof section.label === 'string' && numericScore(section.total))));
}

function openHistory(): Promise<IDBDatabase> {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open('zenix-karaoke-practice', 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore('rounds', {keyPath:'id'}).createIndex('recent', 'at');
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {blocked = true;reject(Error('练唱记录被其他窗口占用'));};
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (blocked) db.close();else resolve(db);
    };
  });
}

export function practiceRecord(track: Track, result: SoloResult): PracticeRecord {
  return {id:crypto.randomUUID(),title:track.title.slice(0,240),artist:track.artist.slice(0,200),at:Date.now(),result};
}

export async function savePractice(record: PracticeRecord): Promise<void> {
  const db = await openHistory();
  try {
    await new Promise<void>((resolve,reject) => {
      const tx = db.transaction('rounds','readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.objectStore('rounds').put(record);
    });
  } finally {db.close();}
}

export async function listPractice(limit = 50): Promise<PracticeRecord[]> {
  const db = await openHistory();
  try {
    return await new Promise<PracticeRecord[]>((resolve,reject) => {
      const request = db.transaction('rounds','readonly').objectStore('rounds').index('recent').openCursor(null,'prev');
      const rows: PracticeRecord[] = [];
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length >= limit) {resolve(rows);return;}
        if (readablePractice(cursor.value)) rows.push(cursor.value);
        cursor.continue();
      };
    });
  } finally {db.close();}
}
