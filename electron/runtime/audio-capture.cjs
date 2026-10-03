const fs = require('node:fs/promises');

function audioHeader(bytes) {
  if (!bytes || bytes.length < 4) return false;
  const head = Buffer.from(bytes.subarray(0, 4)).toString('ascii');
  return head.startsWith('ID3') || ['fLaC', 'OggS', 'RIFF'].includes(head)
    || Buffer.from(bytes.subarray(4, 8)).toString('ascii') === 'ftyp'
    || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
}

// One network reader feeds both playback and a disk file. Backpressure bounds memory
// to one network chunk; cache failures never interrupt the audio consumer.
function captureBody(body, { temporary, expected, signal, commit, partial, finished }) {
  const reader = body.getReader();
  let handle, size = 0, prefix, ended = false, cacheFailed = false;
  let cleanupPromise;
  let pulling = Promise.resolve();
  const cleanup = complete => cleanupPromise ||= (async () => {
    try {
      await handle?.close().catch(() => {}); handle = null;
      if (complete && !cacheFailed && !signal.aborted && size === expected && audioHeader(prefix)) await commit(size);
      else if (!complete && !cacheFailed && !signal.aborted && size >= 1024 && audioHeader(prefix)) partial();
    } catch { /* Saving is optional; playback owns the network stream. */ }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}); finished(); }
  })();
  return new ReadableStream({
    pull(controller) {
      pulling = (async () => {
        try {
          const { done, value } = await reader.read();
          if (ended) return;
          if (done) { ended = true; await cleanup(true); reader.releaseLock(); controller.close(); return; }
          if (!prefix || prefix.length < 64) {
            const combined = new Uint8Array(Math.min(64, (prefix?.length || 0) + value.length));
            if (prefix) combined.set(prefix);
            combined.set(value.subarray(0, combined.length - (prefix?.length || 0)), prefix?.length || 0);
            prefix = combined;
          }
          size += value.byteLength;
          // Deliver the first bytes immediately; the next pull waits for this chunk's
          // disk write, so caching still cannot accumulate an unbounded queue.
          controller.enqueue(value);
          if (!cacheFailed && !signal.aborted && size <= expected) {
            try {
              handle ||= await fs.open(temporary, 'w');
              let offset = 0;
              while (offset < value.byteLength) { const written = await handle.write(value, offset, value.byteLength - offset); if (!written.bytesWritten) throw new Error('缓存写入未完成'); offset += written.bytesWritten; }
            } catch { cacheFailed = true; }
          } else cacheFailed = true;
        } catch (error) { await reader.cancel(error).catch(() => {}); await cleanup(false); controller.error(error); }
      })();
      return pulling;
    },
    async cancel(reason) {
      const completed = ended;
      ended = true;
      if (!completed) await reader.cancel(reason).catch(() => {});
      // A read can already have delivered its chunk while fs.open/write is still
      // pending. Wait for that operation before closing/removing its file.
      await pulling.catch(() => {});
      try { reader.releaseLock(); } catch { /* The completed pull may have released it. */ }
      await cleanup(false);
    },
  }, { highWaterMark: 0 });
}
module.exports = { captureBody, audioHeader };
