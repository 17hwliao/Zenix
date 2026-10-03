const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { serveFile } = require('../electron/runtime/media-protocol.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const folder = path.resolve(__dirname, '../release/profiles/stream-backpressure');
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'generated.wav');
  const mode = process.argv[2];
  if (mode) {
    let stream; const original = fs.createReadStream;
    fs.createReadStream = (...args) => (stream = original(...args));
    const before = process.memoryUsage();
    const response = mode === 'previous-default'
      ? new Response(Readable.toWeb(fs.createReadStream(file)))
      : await serveFile(file, new Request('https://example.com/generated'));
    await wait(250);
    const after = process.memoryUsage();
    const result = { mode, bytesReadWhileUnconsumed: stream.bytesRead, rssDeltaMiB: (after.rss - before.rss) / 1048576, externalDeltaMiB: (after.external - before.external) / 1048576 };
    await response.body.cancel(); await wait(20);
    process.stdout.write(JSON.stringify(result)); return;
  }
  const handle = fs.openSync(file, 'w'); fs.ftruncateSync(handle, 64 * 1024 * 1024); fs.closeSync(handle);
  const results = ['previous-default', 'bounded-bytes'].map(mode => {
    const output = spawnSync(process.execPath, [__filename, mode], { encoding: 'utf8', windowsHide: true });
    if (output.status !== 0) throw Error(output.stderr); return JSON.parse(output.stdout);
  });
  fs.writeFileSync(path.join(folder, 'measurement.json'), JSON.stringify({ fileBytes: 64 * 1024 * 1024, results }, null, 2));
  fs.unlinkSync(file); console.log(JSON.stringify(results, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
