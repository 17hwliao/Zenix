export function deepFreezeClone<T>(value: T): T {
  const clones = new WeakMap<object, unknown>();

  const clone = (input: unknown): unknown => {
    if (input === null || (typeof input !== 'object' && typeof input !== 'function')) return input;
    const object = input as object;
    const existing = clones.get(object);
    if (existing !== undefined) return existing;
    if (Array.isArray(input)) {
      const result: unknown[] = [];
      clones.set(object, result);
      for (const item of input) result.push(clone(item));
      return Object.freeze(result);
    }
    if (input instanceof Uint8Array) {
      return input.slice();
    }
    const result: Record<string, unknown> = {};
    clones.set(object, result);
    for (const [key, item] of Object.entries(input as Record<string, unknown>)) result[key] = clone(item);
    return Object.freeze(result);
  };

  return clone(value) as T;
}

export function frozenArray<T>(items: readonly T[]): readonly T[] {
  return Object.freeze(items.slice());
}
