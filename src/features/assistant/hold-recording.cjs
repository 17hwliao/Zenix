(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.zenixHoldRecording=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{const exports={};"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HoldRecording = void 0;
exports.wavBase64 = wavBase64;
/** Memory-only PCM; recording permission is obtained solely after an explicit hold. */
class HoldRecording {
    stream;
    context;
    source;
    processor;
    silence;
    chunks = [];
    samples = 0;
    cancelled = false;
    error = '';
    async start() {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
        if (this.cancelled) {
            stream.getTracks().forEach(track => track.stop());
            return false;
        }
        this.stream = stream;
        try {
            const context = this.context = new AudioContext();
            await context.resume();
            if (this.cancelled) {
                this.dispose();
                return false;
            }
            this.source = context.createMediaStreamSource(stream);
            this.processor = context.createScriptProcessor(4096, 1, 1);
            this.silence = context.createGain();
            this.silence.gain.value = 0;
            this.processor.onaudioprocess = event => { if (this.cancelled || this.error)
                return; const samples = event.inputBuffer.getChannelData(0); if ((this.samples + samples.length) / context.sampleRate * 32000 > 8 * 1024 * 1024 - 44) {
                this.error = '本次语音过长，请分句说话';
                this.dispose();
                return;
            } this.chunks.push(new Float32Array(samples)); this.samples += samples.length; };
            this.source.connect(this.processor);
            this.processor.connect(this.silence);
            this.silence.connect(context.destination);
            return true;
        }
        catch (error) {
            this.dispose();
            throw error;
        }
    }
    finish() { const rate = this.context?.sampleRate || 48000; this.dispose(); if (this.error)
        throw Error(this.error); if (this.samples / rate < .18)
        throw Error('按住时间太短，请按住后说话'); const data = new Float32Array(this.samples); let offset = 0; for (const part of this.chunks) {
        data.set(part, offset);
        offset += part.length;
    } this.chunks = []; return wavBase64(data, rate); }
    cancel() { this.cancelled = true; this.chunks = []; this.dispose(); }
    dispose() { this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined; if (this.processor)
        this.processor.onaudioprocess = null; this.source?.disconnect(); this.processor?.disconnect(); this.silence?.disconnect(); if (this.context)
        void this.context.close().catch(() => { }); }
}
exports.HoldRecording = HoldRecording;
function wavBase64(data, rate) {
    const length = Math.floor(data.length * 16000 / rate), bytes = new Uint8Array(44 + length * 2), view = new DataView(bytes.buffer);
    const word = (offset, text) => { [...text].forEach((c, i) => bytes[offset + i] = c.charCodeAt(0)); };
    word(0, 'RIFF');
    view.setUint32(4, bytes.length - 8, true);
    word(8, 'WAVE');
    word(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    word(36, 'data');
    view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) {
        const at = i * rate / 16000, left = Math.floor(at), mix = at - left, sample = Math.max(-1, Math.min(1, (data[left] || 0) * (1 - mix) + (data[left + 1] || 0) * mix));
        view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
    let raw = '';
    for (let i = 0; i < bytes.length; i += 8192)
        raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(raw);
}

return exports;});