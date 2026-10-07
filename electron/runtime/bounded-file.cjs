const fs = require('node:fs/promises');

// Read at most limit + one byte even if a file grows after stat().
async function readBoundedFile(file, limit, encoding) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('文件超过大小限制');
    const chunks = []; let total = 0;
    while (total <= limit) {
      const chunk = Buffer.allocUnsafe(Math.min(65536, limit + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) throw new Error('文件超过大小限制');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const data = Buffer.concat(chunks, total);
    return encoding ? data.toString(encoding) : data;
  } finally { await handle.close(); }
}
module.exports = { readBoundedFile };
