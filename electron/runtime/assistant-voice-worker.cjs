const {parentPort, workerData} = require('node:worker_threads');
const {EdgeTTS} = require('node-edge-tts');

// A worker owns the socket, including its handshake. Terminating it cancels all network work.
(async () => {
  try {
    const client = new EdgeTTS({voice: 'zh-CN-XiaoyiNeural', lang: 'zh-CN', rate: '+0%',
      pitch: '+0Hz', timeout: 25000, ...(workerData.proxy ? {proxy: workerData.proxy} : {})});
    const chunks = [];
    let size = 0;
    for await (const chunk of client.streamAudio(workerData.text)) {
      if (!Buffer.isBuffer(chunk)) continue;
      size += chunk.length;
      if (size > 2 * 1024 * 1024) throw Error('oversize');
      chunks.push(chunk);
    }
    if (size < 100) throw Error('empty');
    parentPort.postMessage({audio: Buffer.concat(chunks)});
  } catch {
    parentPort.postMessage({error: '晓伊在线语音暂不可用'});
  }
})();
