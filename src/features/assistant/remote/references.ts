import {REMOTE_LIMITS, type ReferenceKind, type ReferenceStore} from './contracts';

type ReferenceEntry = {
  kind: ReferenceKind;
  value: unknown;
  expiresAt: number;
};

export class ReferenceExpiredError extends Error {
  constructor() {
    super('这个对象引用已失效，请重新查询或选择。');
    this.name = 'ReferenceExpiredError';
  }
}

/** References are opaque session capabilities. Their values never come from model arguments. */
export class SessionReferences implements ReferenceStore {
  private readonly entries = new Map<string, ReferenceEntry>();
  private readonly session: string;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly id: () => string = () => crypto.randomUUID(),
  ) {
    this.session = id();
  }

  issue(kind: ReferenceKind, value: unknown, _summary?: string): string {
    this.prune();
    while (this.entries.size >= REMOTE_LIMITS.referenceCount) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    const reference = `${this.session}:${kind}:${this.id()}`;
    this.entries.set(reference, {
      kind,
      value: structuredClone(value),
      expiresAt: this.now() + REMOTE_LIMITS.referenceLifetimeMs,
    });
    return reference;
  }

  resolve<T>(reference: string, kind: ReferenceKind): T {
    this.prune();
    if (typeof reference !== 'string' || !reference.startsWith(this.session + ':')) {
      throw new ReferenceExpiredError();
    }
    const entry = this.entries.get(reference);
    if (!entry || entry.kind !== kind) throw new ReferenceExpiredError();
    return structuredClone(entry.value) as T;
  }

  invalidate(kind?: ReferenceKind): void {
    if (!kind) {
      this.entries.clear();
      return;
    }
    for (const [reference, entry] of this.entries) {
      if (entry.kind === kind) this.entries.delete(reference);
    }
  }

  private prune(): void {
    const now = this.now();
    for (const [reference, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(reference);
    }
  }
}
