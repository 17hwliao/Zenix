import type { KaraokeLanHost } from './host';
import { serializeKaraokeLanEnvelope } from './protocol';
import {
  lanFailure,
  lanOk,
  type KaraokeLanAuthorization,
  type KaraokeLanControlResponse,
  type KaraokeLanEnvelope,
  type KaraokeLanResult,
} from './types';

export interface KaraokeLanWebSocket {
  send(payload: string): void | Promise<void>;
  close(code?: number, reason?: string): void;
}

export class KaraokeLanWebSocketBinding {
  private closed = false;

  private constructor(
    private readonly host: KaraokeLanHost,
    private readonly authorization: KaraokeLanAuthorization,
    private readonly hostId: string,
    private readonly socket: KaraokeLanWebSocket,
    private readonly unsubscribe: () => void,
  ) {}

  static attach(input: {
    readonly host: KaraokeLanHost;
    readonly authorization: KaraokeLanAuthorization;
    readonly hostId: string;
    readonly socket: KaraokeLanWebSocket;
    readonly nowMs: number;
  }): KaraokeLanResult<KaraokeLanWebSocketBinding> {
    if (!input?.host
      || !input.authorization
      || typeof input.hostId !== 'string'
      || !input.hostId
      || !input.socket
      || typeof input.socket.send !== 'function'
      || typeof input.socket.close !== 'function') {
      return lanFailure('INVALID_INPUT', 'WebSocket 绑定参数无效', false);
    }
    const deliver = (envelope: KaraokeLanEnvelope): void => {
      const serialized = serializeKaraokeLanEnvelope(envelope);
      if (!serialized.ok) {
        input.socket.close(1009, 'Karaoke message too large');
        return;
      }
      try {
        const sent = input.socket.send(serialized.value);
        if (sent && typeof sent.catch === 'function') {
          void sent.catch(() => input.socket.close(1011, 'Karaoke transport failed'));
        }
      } catch {
        input.socket.close(1011, 'Karaoke transport failed');
      }
    };
    const subscribed = input.host.subscribe(
      input.authorization,
      deliver,
      input.nowMs,
    );
    if (!subscribed.ok) return subscribed;
    return lanOk(new KaraokeLanWebSocketBinding(
      input.host,
      input.authorization,
      input.hostId,
      input.socket,
      subscribed.value,
    ));
  }

  receive(raw: string, nowMs: number): KaraokeLanResult<KaraokeLanControlResponse> {
    if (this.closed) return lanFailure('ROOM_CLOSED', 'WebSocket 绑定已关闭', false);
    const result = this.host.handleRaw(this.authorization, raw, nowMs);
    if (!result.ok) {
      this.host.sendStructuredError(this.authorization, result.error, nowMs);
    }
    return result;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.socket.close(1000, 'Karaoke room closed');
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

export function attachKaraokeLanWebSocket(input: {
  readonly host: KaraokeLanHost;
  readonly authorization: KaraokeLanAuthorization;
  readonly hostId: string;
  readonly socket: KaraokeLanWebSocket;
  readonly nowMs: number;
}): KaraokeLanResult<KaraokeLanWebSocketBinding> {
  return KaraokeLanWebSocketBinding.attach(input);
}
