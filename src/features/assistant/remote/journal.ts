import {REMOTE_LIMITS, type OperationRecovery, type ToolName, type ToolResult} from './contracts';
import {getToolDefinition} from './registry';

export type OperationRecord = {
  id: string;
  requestId: string;
  tool: ToolName | 'local';
  status: 'submitted' | 'settled' | 'unknown';
  startedAt: number;
  updatedAt: number;
  fingerprint?: string;
  recovery?: OperationRecovery;
  result?: Pick<ToolResult, 'status' | 'message'>;
};

export interface OperationJournalStore {
  load(): Promise<OperationRecord[]>;
  save(records: OperationRecord[]): Promise<void>;
}

const JOURNAL_KEY = 'zenix.assistant.operation-journal.v1';
const SETTLED_LIFETIME = 24 * 60 * 60 * 1000;
const UNKNOWN_LIFETIME = 7 * SETTLED_LIFETIME;

/** This journal contains receipts, never model configuration or conversation transcripts. */
export function retainOperations(records: OperationRecord[], now = Date.now()): OperationRecord[] {
  return records
    .filter(record => now - record.updatedAt <= (record.status === 'settled' ? SETTLED_LIFETIME : UNKNOWN_LIFETIME))
    .slice(-REMOTE_LIMITS.operationRecords)
    .map(record => record.status === 'settled' ? {...record, fingerprint: undefined, recovery: undefined} : record);
}

export function createBrowserOperationJournal(storage: Pick<Storage, 'getItem' | 'setItem'>): OperationJournalStore {
  return {
    async load() {
      const raw = storage.getItem(JOURNAL_KEY);
      if (!raw) return [];
      if (raw.length > 1024 * 1024) throw Error('助手操作回执过大，请先检查本地资料。');
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length > REMOTE_LIMITS.operationRecords) throw Error('助手操作回执格式无效。');
      for (const row of parsed) {
        if (!row || typeof row !== 'object' || typeof row.id !== 'string' || row.id.length > 160
          || typeof row.requestId !== 'string' || row.requestId.length > 160
          || row.tool !== 'local' && !getToolDefinition(row.tool)
          || !['submitted', 'settled', 'unknown'].includes(row.status)
          || !Number.isFinite(row.startedAt) || !Number.isFinite(row.updatedAt)
          || row.fingerprint !== undefined && (typeof row.fingerprint !== 'string' || row.fingerprint.length > 256 * 1024)
          || row.recovery !== undefined && (!row.recovery || row.recovery.operationId !== row.id || row.recovery.requestId !== row.requestId
            || typeof row.recovery.call?.name !== 'string' || !getToolDefinition(row.recovery.call.name)
            || !Number.isFinite(row.recovery.submittedAt))
          || row.result !== undefined && (!row.result || typeof row.result.status !== 'string' || typeof row.result.message !== 'string' || row.result.message.length > 1500)) {
          throw Error('助手操作回执格式无效。');
        }
      }
      return retainOperations(parsed as OperationRecord[]);
    },
    async save(records) {
      const text = JSON.stringify(retainOperations(records));
      if (text.length > 1024 * 1024) throw Error('助手操作回执空间不足，请先核查未确认操作。');
      storage.setItem(JOURNAL_KEY, text);
    },
  };
}

export function createMemoryOperationJournal(): OperationJournalStore {
  let records: OperationRecord[] = [];
  return {
    async load() { return structuredClone(records); },
    async save(value) { records = structuredClone(value); },
  };
}
