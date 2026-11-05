/** Shared remote-assistant boundary. Business objects and credentials stay in the client. */
export type RemotePlatform = 'pc' | 'android';
export type ToolName =
  | 'context.read' | 'playback.control' | 'playback.set_volume' | 'playback.set_mode'
  | 'music.search' | 'music.play_result' | 'music.query'
  | 'playlist.find' | 'playlist.open' | 'playlist.create' | 'playlist.add_tracks' | 'playlist.remove_tracks'
  | 'collection.set' | 'lyrics.configure' | 'cache.prepare' | 'tasks.query' | 'network.set_policy'
  | 'navigation.open' | 'roaming.configure' | 'stats.query' | 'timer.configure'
  | 'device.transfer' | 'backup.export_playlists' | 'updates.check';

export type ReferenceKind = 'track' | 'playlist' | 'candidate' | 'device';
export type ObjectReference = {
  ref: string;
  kind: ReferenceKind;
  label: string;
  description?: string;
};
export interface ReferenceStore {
  issue(kind: ReferenceKind, value: unknown, summary?: string): string;
  resolve<T>(ref: string, kind: ReferenceKind): T;
  invalidate(kind?: ReferenceKind): void;
}

export type ToolResultStatus =
  | 'completed' | 'saved' | 'loading_started' | 'playback_started' | 'task_created' | 'page_opened'
  | 'needs_input' | 'cancelled' | 'failed' | 'unknown' | 'partial';
export type ToolResult = {
  status: ToolResultStatus;
  message: string;
  data?: Record<string, unknown>;
  candidates?: ObjectReference[];
  speech?: string[];
};
export type ValidatedToolCall = {name: ToolName; args: Record<string, unknown>};
export type ExecutionContext = {
  requestId: string;
  operationId: string;
  signal: AbortSignal;
  refs: ReferenceStore;
};
/** Native object identities used only for local recovery, never sent to the model. */
export type OperationRecovery = {
  operationId: string;
  requestId: string;
  call: ValidatedToolCall;
  submittedAt: number;
  data?: Record<string, unknown>;
};
/** Fixed targets live in the closures. Only the client may call commit after a user confirmation. */
export type PreparedToolPlan = {
  kind: 'confirmation';
  summary: string;
  items: string[];
  fingerprint: string;
  validate(): Promise<boolean>;
  commit(): Promise<ToolResult>;
};
export interface BusinessAdapter {
  capabilities(): Promise<ToolName[]>;
  readContext(context: ExecutionContext): Promise<ToolResult>;
  execute(call: ValidatedToolCall, context: ExecutionContext): Promise<ToolResult | PreparedToolPlan>;
  recovery?(call: ValidatedToolCall, context: ExecutionContext): Promise<Record<string, unknown> | undefined>;
  reconcile?(operation: OperationRecovery, context: ExecutionContext): Promise<ToolResult>;
}

export type ModelToolCall = {id: string; name: string; arguments: string};
export type ModelMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: {id: string; type: 'function'; function: {name: string; arguments: string}}[];
  tool_call_id?: string;
};
export type JsonSchema = {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: false;
  enum?: readonly (string | number | boolean)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  items?: JsonSchema;
};
export type ModelToolDefinition = {
  type: 'function';
  function: {name: string; description: string; parameters: JsonSchema};
};
export type MaskedModelConfig = {
  enabled: boolean;
  endpoint: string;
  model: string;
  keyPresent: boolean;
  keyHint: string;
  revision: string;
};
export type ModelConfigInput = {
  enabled: boolean;
  endpoint: string;
  model: string;
  apiKey?: string;
  clearKey?: boolean;
};
export type ModelRequest = {
  requestId: string;
  revision: string;
  messages: ModelMessage[];
  tools: ModelToolDefinition[];
};
export type ModelResponse = {content: string; toolCalls: ModelToolCall[]};
export type ModelConnectionResult = {ok: boolean; message: string; revision: string; toolCalling: boolean};
export interface NativeTransport {
  read(): Promise<MaskedModelConfig>;
  configure(value: ModelConfigInput): Promise<MaskedModelConfig>;
  test(signal?: AbortSignal): Promise<ModelConnectionResult>;
  complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse>;
  cancel(requestId: string): Promise<void>;
}

export type SessionStatus =
  | 'idle' | 'listening' | 'understanding' | 'needs_input' | 'awaiting_confirmation' | 'executing'
  | 'task_created' | 'completed' | 'failed' | 'cancelled' | 'unknown';
export type ToolEffect = 'read' | 'navigation' | 'playback' | 'write' | 'task';
export type ConfirmationRule = 'never' | 'always' | 'batch';
export type RetryRule = 'query' | 'set_target' | 'reconcile_before_retry';
export type ToolDefinition = {
  name: ToolName;
  wireName: string;
  description: string;
  module: string;
  batch: 'A' | 'B' | 'C';
  parameters: JsonSchema;
  platforms: readonly RemotePlatform[];
  conditions: readonly string[];
  effect: ToolEffect;
  confirmation: ConfirmationRule;
  retry: RetryRule;
  resultDescription: string;
};

/** Bounds apply only to assistant/model work, never music parsing or playback loading. */
export const REMOTE_LIMITS = Object.freeze({
  modelRounds: 6,
  toolCallsPerRound: 4,
  toolCallsPerRequest: 12,
  userTextChars: 4000,
  modelResponseBytes: 256 * 1024,
  toolResultChars: 12000,
  conversationMessages: 32,
  searchCandidates: 10,
  queryRadius: 10,
  referenceCount: 512,
  referenceLifetimeMs: 15 * 60 * 1000,
  confirmationLifetimeMs: 5 * 60 * 1000,
  operationRecords: 128,
});
