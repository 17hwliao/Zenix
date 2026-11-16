import type { AccompanimentDescriptor, AccompanimentKind } from './contracts';
import {
  karaokeFailure,
  karaokeOk,
  type KaraokeErrorCode,
  type KaraokeResult,
} from './result';

export const ACCOMPANIMENT_PRIORITY: readonly AccompanimentKind[] = Object.freeze([
  'local-file',
  'source-official',
  'separated',
  'channel-cancel',
]);

export interface AccompanimentCandidate {
  kind: AccompanimentKind;
  label?: string;
  uri: string;
  fingerprint?: string;
  modelVersion?: string;
  outputFormat?: string;
  rehearsalOnly?: boolean;
}

export interface AccompanimentRequest {
  recordingId: string;
  /** Hash of the recording bytes or a stable source-provided content hash. */
  audioContentFingerprint: string;
  candidates: readonly AccompanimentCandidate[];
}

export interface AccompanimentProvider {
  resolve(request: AccompanimentRequest, signal?: AbortSignal): Promise<KaraokeResult<AccompanimentDescriptor>>;
}

export interface AccompanimentCacheIdentity {
  recordingId: string;
  audioContentFingerprint: string;
  modelVersion: string;
  outputFormat: string;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function sameFingerprint(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

export function accompanimentCacheKey(identity: AccompanimentCacheIdentity): KaraokeResult<string> {
  if (!nonEmpty(identity.recordingId)
    || !nonEmpty(identity.audioContentFingerprint)
    || !nonEmpty(identity.modelVersion)
    || !nonEmpty(identity.outputFormat)) {
    return karaokeFailure('INVALID_INPUT', '伴奏缓存身份不完整');
  }
  const normalize = (value: string) => encodeURIComponent(value.trim().toLowerCase());
  return karaokeOk([
    'karaoke-accompaniment',
    `recording=${normalize(identity.recordingId)}`,
    `audio=${normalize(identity.audioContentFingerprint)}`,
    `model=${normalize(identity.modelVersion)}`,
    `format=${normalize(identity.outputFormat)}`,
  ].join('|'));
}

function candidateFailureCode(kind: AccompanimentKind): KaraokeErrorCode {
  return kind === 'channel-cancel' ? 'INVALID_INPUT' : 'ACCOMPANIMENT_NOT_FOUND';
}

export function resolveAccompaniment(request: AccompanimentRequest): KaraokeResult<AccompanimentDescriptor> {
  if (!request || !nonEmpty(request.recordingId) || !nonEmpty(request.audioContentFingerprint)) {
    return karaokeFailure('INVALID_INPUT', '缺少录音身份或音频内容指纹');
  }
  if (!Array.isArray(request.candidates) || request.candidates.length === 0) {
    return karaokeFailure('ACCOMPANIMENT_NOT_FOUND', '没有可用伴奏');
  }

  const candidates = request.candidates.filter((candidate) => candidate && typeof candidate === 'object')
    .sort((left, right) => {
      const leftPriority = ACCOMPANIMENT_PRIORITY.indexOf(left.kind);
      const rightPriority = ACCOMPANIMENT_PRIORITY.indexOf(right.kind);
      return (leftPriority < 0 ? Number.MAX_SAFE_INTEGER : leftPriority)
        - (rightPriority < 0 ? Number.MAX_SAFE_INTEGER : rightPriority);
    });

  let invalidCandidate: ReturnType<typeof karaokeFailure<AccompanimentDescriptor>> | undefined;
  for (const candidate of candidates) {
    if (!ACCOMPANIMENT_PRIORITY.includes(candidate.kind)) continue;
    if (nonEmpty(candidate.fingerprint) && !sameFingerprint(candidate.fingerprint, request.audioContentFingerprint)) {
      continue;
    }
    if (!nonEmpty(candidate.uri)) {
      invalidCandidate = karaokeFailure(candidateFailureCode(candidate.kind), `${candidate.kind} 候选缺少 URI`);
      continue;
    }
    if (candidate.kind === 'channel-cancel' && candidate.rehearsalOnly !== true) {
      invalidCandidate = karaokeFailure('INVALID_INPUT', '声道抵消只能作为 rehearsalOnly 伴奏');
      continue;
    }

    let cacheKey: string | undefined;
    if (candidate.kind === 'separated' || candidate.kind === 'channel-cancel') {
      if (!nonEmpty(candidate.modelVersion)) {
        invalidCandidate = karaokeFailure('INVALID_INPUT', `${candidate.kind} 缺少模型版本`);
        continue;
      }
      if (!nonEmpty(candidate.outputFormat)) {
        invalidCandidate = karaokeFailure('INVALID_INPUT', `${candidate.kind} 缺少输出格式`);
        continue;
      }
      const key = accompanimentCacheKey({
        recordingId: request.recordingId,
        audioContentFingerprint: request.audioContentFingerprint,
        modelVersion: candidate.modelVersion,
        outputFormat: candidate.outputFormat,
      });
      if (!key.ok) {
        invalidCandidate = key;
        continue;
      }
      cacheKey = key.value;
    }

    return karaokeOk(Object.freeze({
      kind: candidate.kind,
      label: nonEmpty(candidate.label) ? candidate.label.trim() : candidate.kind,
      uri: candidate.uri.trim(),
      ...(cacheKey ? { cacheKey } : {}),
      ...(nonEmpty(candidate.fingerprint) ? { fingerprint: candidate.fingerprint.trim() } : {}),
      ...(nonEmpty(candidate.modelVersion) ? { modelVersion: candidate.modelVersion.trim() } : {}),
      rehearsalOnly: candidate.kind === 'channel-cancel',
    }));
  }

  return invalidCandidate
    ?? karaokeFailure('ACCOMPANIMENT_NOT_FOUND', '没有符合约束的可用伴奏');
}

export function createCandidateAccompanimentProvider(
  candidatesFor: (request: AccompanimentRequest) => readonly AccompanimentCandidate[],
): AccompanimentProvider {
  return Object.freeze({
    async resolve(request: AccompanimentRequest, signal?: AbortSignal) {
      if (signal?.aborted) return karaokeFailure('INVALID_INPUT', '伴奏解析已取消');
      return resolveAccompaniment({
        ...request,
        candidates: candidatesFor(request),
      });
    },
  });
}
