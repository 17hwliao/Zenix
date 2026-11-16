export type KaraokeErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_TRACK'
  | 'INVALID_LYRIC'
  | 'INVALID_PITCH'
  | 'PARSE_FAILED'
  | 'UNSUPPORTED_FORMAT'
  | 'ACCOMPANIMENT_NOT_FOUND'
  | 'ROOM_NOT_FOUND'
  | 'MEMBER_NOT_FOUND'
  | 'HOST_REQUIRED'
  | 'INVALID_TRANSITION'
  | 'ROOM_FULL'
  | 'QUEUE_FULL'
  | 'DUPLICATE_ID'
  | 'ITEM_NOT_FOUND'
  | 'LIMIT_EXCEEDED';

export interface KaraokeError {
  code: KaraokeErrorCode;
  message: string;
  details?: Readonly<Record<string, string | number | boolean | null>>;
}

export type KaraokeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KaraokeError };

export function karaokeOk<T>(value: T): KaraokeResult<T> {
  return Object.freeze({ ok: true as const, value });
}

export function karaokeFailure<T = never>(
  code: KaraokeErrorCode,
  message: string,
  details?: KaraokeError['details'],
): KaraokeResult<T> {
  const frozenDetails = details ? Object.freeze({ ...details }) : undefined;
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ code, message, ...(frozenDetails ? { details: frozenDetails } : {}) }),
  });
}
