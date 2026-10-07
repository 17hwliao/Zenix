export async function sourceDeadline<T>(operation: () => Promise<T>, signal: AbortSignal, milliseconds = 18000): Promise<T> {
  signal.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason || new DOMException('已取消', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => reject(new Error('连接超时')), milliseconds);
  });
  try { return await Promise.race([operation(), deadline]); }
  finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/** A deadline owns a native request as well as its renderer wait. */
export async function sourceRequest<T>(operation: (requestId: string) => Promise<T>, signal: AbortSignal, milliseconds = 18000): Promise<T> {
  const requestId = crypto.randomUUID();
  let completed = false;
  const cancel = () => { if (!completed) void window.yzqxy?.sources.cancelRequest(requestId).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try { const value = await sourceDeadline(() => operation(requestId), signal, milliseconds); completed = true; return value; }
  finally { cancel(); signal.removeEventListener('abort', cancel); }
}
