// Authorized acceptance of an installed app launched with --remote-debugging-port.
// Connects only to loopback; reports update state or hashes/counts, never personal contents.
const port = Number(process.argv[2]), operation = process.argv[3] || 'state', channel = process.argv[4] || 'preview';
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !['state', 'check', 'download', 'snapshot'].includes(operation) || !['stable', 'preview'].includes(channel)) throw Error('Usage: node scripts/Inspect-WindowsUpdate.mjs port state|check|download|snapshot [stable|preview]');
const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(5000) })).json();
const target = targets.find(item => item.type === 'page' && /^file:/.test(item.url) && /\/dist\/index\.html$/.test(item.url));
if (!target) throw Error('Installed Zenix main renderer not found');
const endpoint = new URL(target.webSocketDebuggerUrl);
if (endpoint.hostname !== '127.0.0.1' || endpoint.port !== String(port) || endpoint.protocol !== 'ws:') throw Error('Unexpected local debugger endpoint');
const socket = new WebSocket(endpoint);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const expression = operation === 'snapshot' ? `(async()=>{
  const personal=await window.yzqxy.personal.load(),sources=await window.yzqxy.sources.list(),library=await window.yzqxy.library.load();
  const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
  return {personal:{liked:personal.liked.length,favorites:personal.favorites.length,history:personal.history.length,playlists:personal.playlists.length,sha256:await digest(personal)},
    sources:{count:sources.length,identitySha256:await digest(sources.map(source=>({id:source.id,enabled:source.enabled,sha256:source.sha256})))},
    library:{count:library.tracks.length,playlists:library.playlists.length,identitySha256:await digest(library.tracks.map(track=>track.id))},
    update:await window.yzqxy.updates.invoke({operation:'state'})};
})()` : `window.yzqxy.updates.invoke(${JSON.stringify({ operation, channel })})`;
try {
  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { reject(Error('Device acceptance response timed out')); }, 650000);
    socket.onerror = () => { clearTimeout(timeout); reject(Error('Local debugger connection failed')); };
    socket.onmessage = event => { const data = JSON.parse(event.data); if (data.id !== 1) return; clearTimeout(timeout); resolve(data); };
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  if (response.error || response.result?.exceptionDetails) throw Error('Installed acceptance operation failed');
  console.log(JSON.stringify(response.result.result.value));
} finally { socket.close(); }
