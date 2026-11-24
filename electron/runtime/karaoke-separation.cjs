// PC-only in-process broker for an explicitly requested local Demucs job.
// Renderer supplies a library/cache ID to main, never a native path or command.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');

const MIB = 1024 * 1024;
const OUT_BYTES = 190 * MIB;
const IN_BYTES = 200 * MIB;
const CHART_BYTES = 2 * MIB;
const CHART_SIDECAR_BYTES = 3 * MIB;
const LIMIT_SECONDS = 15 * 60;
const DEFAULT_BUDGET = 512 * MIB;
const DEFAULT_CLOSE_GRACE_MS = 5 * 1000;
const DEFAULT_CHART_TIMEOUT_MS = 20 * 60 * 1000;
const PYTHON_PROBE_TIMEOUT_MS = 15 * 1000;
const HASH = /^[a-f0-9]{64}$/;
const MODEL_FILE = '955717e8-8726e21a.th';
// Upstream pins the 8726e21a prefix. Check the independently published full
// object digest before passing the checkpoint to torch's pickle loader.
const MODEL_SHA = '8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4';
const MODEL_ID = 'demucs-4.0.1/htdemucs-955717e8-8726e21a/cpu-pcm16-v1';
const DEPENDENCY = '需要本机 Python、Demucs 4.0.1、兼容的 PyTorch/torchaudio 和 FFmpeg。';
const MODEL_MISSING = '未找到官方 htdemucs 模型或校验未通过。请先在本机准备官方模型，Zenix 不会自动下载。';
const CHART_DEPENDENCY = '本地伴奏可以生成，但曲谱模型不可用。需要 torch、SciPy 和 torchcrepe 0.0.23。';
const CHART_DEPENDENCY_CHECK = [
  'import importlib.metadata as metadata, sys',
  'try:',
  '  import scipy.signal',
  '  import torch',
  '  import torchcrepe',
  'except Exception:',
  '  sys.exit(2)',
  'try:',
  '  version = metadata.version("torchcrepe")',
  'except metadata.PackageNotFoundError:',
  '  sys.exit(3)',
  'sys.exit(0 if version == "0.0.23" else 4)',
].join('\n');
const DEMUCS_ENTRY = [
  'import os, pathlib, sys, importlib.metadata as md',
  'if md.version("demucs") != "4.0.1": sys.exit(40)',
  'if not pathlib.Path(sys.argv[1]).is_dir(): sys.exit(41)',
  'from demucs.separate import main',
  'main(sys.argv[2:])',
].join('\n');
const SUPPORTED_EXT = new Set(['.wav','.flac','.mp3','.m4a','.aac','.ogg','.opus','.wma','.aiff','.aif','.alac','.ape','.mp4','.webm','.bin']);
// Exclude playlist and concat demuxers. Demucs receives only canonical WAV.
const AUDIO_FORMATS = 'wav,flac,mp3,mov,mp4,m4a,3gp,3g2,mj2,aac,ogg,asf,aiff,ape,matroska,webm';
const DEFAULT_CHART_OPTIONS = Object.freeze({
  title: '',
  artist: '',
  generatorVersion: 'zenix-karaoke-chart-v1',
  pitchModel: 'torchcrepe-0.0.23-full-v1',
  alignerModel: 'timed-lyrics-v1',
  bpmMode: 'auto',
  fixedBpm: null,
  minConfidence: 0.55,
  minEnergy: 0.008,
  minNoteMs: 70,
  quantization: 'ultrastar-v1',
});

function message(text, code) {
  return Object.assign(Error(text), {code});
}

function sha(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function localFile(candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || /^[/\\]{2}/.test(candidate) ||
    candidate.includes('\0') || !SUPPORTED_EXT.has(path.extname(candidate).toLowerCase())) {
    throw message('仅支持已下载或已导入的本机音频文件。','INPUT');
  }
  return candidate;
}

async function hashFile(filename, limit, signal, output) {
  signal?.throwIfAborted();
  const file = await fs.open(filename, 'r');
  let copied;
  try {
    const before = await file.stat({bigint:true});
    if (!before.isFile() || before.size < 1 || before.size > BigInt(limit)) throw message('音频或模型文件大小超出限制。','INPUT');
    if (output) copied = await fs.open(output, 'wx', 0o600);
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(MIB);
    let length = 0;
    for (;;) {
      signal?.throwIfAborted();
      const {bytesRead} = await file.read(buffer,0,buffer.length,null);
      if (bytesRead===0) break;
      if ((length += bytesRead) > limit) throw message('音频或模型文件大小超出限制。','INPUT');
      const chunk = buffer.subarray(0,bytesRead);
      hash.update(chunk);
      if (copied) for (let at=0;at<bytesRead;) {
        const {bytesWritten} = await copied.write(chunk,at,bytesRead-at,null);
        if (!bytesWritten) throw message('无法写入分离临时文件。','DISK');
        at += bytesWritten;
      }
    }
    const after = await file.stat({bigint:true});
    if (after.size !== before.size || after.mtimeNs !== before.mtimeNs || length !== Number(before.size)) {
      throw message('源文件在读取期间发生变化，请重试。','INPUT');
    }
    signal?.throwIfAborted();
    return hash.digest('hex');
  } finally {await copied?.close(); await file.close();}
}

function childCommand(program, args, {
  cwd,
  signal,
  timeoutMs,
  stdout = false,
  stderr = false,
  env,
  killTree = true,
  timeoutMessage = '本机依赖检查未完成。',
  timeoutCode = 'DEPENDENCY',
  outputLimit = 65536,
  onStderrLine,
} = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve,reject) => {
    let exited = false, settled = false, output = '', errorOutput = '', stderrPending = '', timedOut = false;
    let child;
    let timeout;
    const notifyStderrLines = (final=false) => {
      if (typeof onStderrLine !== 'function') return;
      const lines = stderrPending.split(/\r?\n/);
      if (!final) stderrPending = lines.pop() || '';
      else stderrPending = '';
      for (const line of lines) if (line) onStderrLine(line);
    };
    const finish = (callback,value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort',onAbort);
      callback(value);
    };
    const stop = () => {
      if (!child?.pid || exited) return;
      if (process.platform === 'win32' && killTree) {
        // Demucs/torchaudio can own an ffmpeg child. Wait for tree termination.
        const tool = path.join(process.env.SystemRoot || 'C:\\Windows','System32','taskkill.exe');
        const killer = spawn(tool, ['/PID',String(child.pid),'/T','/F'], {shell:false,windowsHide:true,stdio:'ignore'});
        killer.on('error',() => child.kill());
        killer.on('exit',code => {if (code !== 0 && !exited) child.kill();});
      } else if (killTree) {
        try {process.kill(-child.pid,'SIGKILL');} catch {child.kill('SIGKILL');}
      } else child.kill();
    };
    try {
      child = spawn(program,args,{shell:false,windowsHide:true,detached:process.platform!=='win32'&&killTree,
        stdio:['ignore',stdout?'pipe':'ignore',stderr?'pipe':'ignore'],cwd,env});
    } catch (error) {reject(error);return;}
    const onAbort = () => {
      stop();
      finish(reject,signal?.reason);
    };
    timeout = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      stop();
      finish(reject,message(timeoutMessage,timeoutCode));
    },timeoutMs) : undefined;
    child.stdout?.on('data',chunk => {
      if (output.length + chunk.length > outputLimit) {
        timedOut = true;
        stop();
        finish(reject,message(timeoutMessage,timeoutCode));
        return;
      }
      output += chunk.toString('utf8');
    });
    child.stderr?.on('data',chunk => {
      if (errorOutput.length + chunk.length > outputLimit) {
        timedOut = true;
        stop();
        finish(reject,message(timeoutMessage,timeoutCode));
        return;
      }
      errorOutput += chunk.toString('utf8');
      stderrPending += chunk.toString('utf8');
      notifyStderrLines();
    });
    signal?.addEventListener('abort',onAbort,{once:true});
    child.once('error',error => {exited = true;finish(reject,error);});
    child.once('close',code => {
      exited = true;
      if (!settled) notifyStderrLines(true);
      if (settled) return;
      if (signal?.aborted) {finish(reject,signal.reason);return;}
      if (timedOut) {finish(reject,message(timeoutMessage,timeoutCode));return;}
      finish(resolve,{code,output,errorOutput});
    });
    if (signal?.aborted) onAbort();
  });
}

function normalizeChartOptions(raw) {
  if (raw === undefined || raw === null) return DEFAULT_CHART_OPTIONS;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw message('曲谱生成参数无效。','INPUT');
  const allowed = new Set(Object.keys(DEFAULT_CHART_OPTIONS));
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw message('曲谱生成参数包含未授权字段。','INPUT');
  }
  const merged = {...DEFAULT_CHART_OPTIONS,...raw};
  if (typeof merged.title !== 'string' || !merged.title.trim() || merged.title.length > 300
    || /[\u0000-\u001f]/.test(merged.title)) {
    throw message('曲谱标题无效。','INPUT');
  }
  if (typeof merged.artist !== 'string' || merged.artist.length > 300 || /[\u0000-\u001f]/.test(merged.artist)) {
    throw message('曲谱歌手无效。','INPUT');
  }
  for (const key of ['generatorVersion','pitchModel','alignerModel','quantization']) {
    if (typeof merged[key] !== 'string' || !/^[a-z0-9][a-z0-9._:/+-]{0,159}$/i.test(merged[key])) {
      throw message('曲谱生成模型或版本标识无效。','INPUT');
    }
  }
  if (!['auto','fixed'].includes(merged.bpmMode)) throw message('BPM 模式无效。','INPUT');
  if (merged.bpmMode === 'fixed') {
    if (!Number.isFinite(merged.fixedBpm) || merged.fixedBpm < 40 || merged.fixedBpm > 240) {
      throw message('固定 BPM 必须在 40 到 240 之间。','INPUT');
    }
  } else if (merged.fixedBpm !== null) {
    throw message('估算 BPM 模式不能同时设置固定 BPM。','INPUT');
  }
  if (!Number.isFinite(merged.minConfidence) || merged.minConfidence < 0 || merged.minConfidence > 1) {
    throw message('音高置信度阈值无效。','INPUT');
  }
  if (!Number.isFinite(merged.minEnergy) || merged.minEnergy < 0 || merged.minEnergy > 1) {
    throw message('音高能量阈值无效。','INPUT');
  }
  if (!Number.isFinite(merged.minNoteMs) || merged.minNoteMs < 20 || merged.minNoteMs > 2000) {
    throw message('最短音符长度无效。','INPUT');
  }
  return Object.freeze({
    title: merged.title.trim(),
    artist: merged.artist.trim(),
    generatorVersion: merged.generatorVersion,
    pitchModel: merged.pitchModel,
    alignerModel: merged.alignerModel,
    bpmMode: merged.bpmMode,
    fixedBpm: merged.bpmMode === 'fixed' ? merged.fixedBpm : null,
    minConfidence: merged.minConfidence,
    minEnergy: merged.minEnergy,
    minNoteMs: merged.minNoteMs,
    quantization: merged.quantization,
  });
}

function normalizeLyrics(raw, durationMs) {
  if (!Array.isArray(raw) || raw.length > 4000) throw message('逐句歌词数量无效。','INPUT');
  const normalized = raw.map((row,index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw message('逐句歌词格式无效。','INPUT');
    const startMs = Math.max(0,Math.round(Number(row.startMs)));
    const endMs = Math.min(durationMs,Math.round(Number(row.endMs)));
    const text = typeof row.text === 'string' ? row.text.trim() : '';
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= durationMs
      || endMs <= startMs || !text || text.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
      throw message(`第 ${index + 1} 句歌词时间或文本无效。`,'INPUT');
    }
    return Object.freeze({startMs,endMs,text});
  });
  normalized.sort((left,right) => left.startMs-right.startMs || left.endMs-right.endMs || left.text.localeCompare(right.text));
  return Object.freeze(normalized);
}

function stableJson(value) {
  return JSON.stringify(value);
}

function chartCacheKey(contentDigest, backingKey, lyrics, options) {
  return sha(stableJson({schema:1,contentDigest,backingKey,lyrics,options}));
}

function chartFileName(title) {
  const base = typeof title === 'string'
    ? title.normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').trim()
    : '';
  return `${(base || 'Zenix 生成曲谱').slice(0,180)}.txt`;
}

function safeFailure(error, fallback) {
  const value = error instanceof Error ? error.message : fallback;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0,600) : fallback;
}

function parseChartMetadata(text, stdout) {
  let reported = {};
  const lines = typeof stdout === 'string' ? stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
  for (let index = lines.length-1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('{')) continue;
    try {reported = JSON.parse(lines[index]);break;} catch {}
  }
  const warningsHeader = [];
  let bpm = null;
  let bpmFallback = null;
  for (const line of text.split(/\r?\n/)) {
    const warning = /^#\s*ZENIX-WARNING\s*:\s*(.+)$/i.exec(line);
    if (warning) warningsHeader.push(warning[1].trim());
    const bpmValue = /^#\s*BPM\s*:\s*([0-9]+(?:[.,][0-9]+)?)/i.exec(line);
    if (bpmValue) bpm = Number(bpmValue[1].replace(',','.'));
    const fallback = /^#\s*ZENIX-BPM-FALLBACK\s*:\s*(yes|no)/i.exec(line);
    if (fallback) bpmFallback = fallback[1].toLowerCase()==='yes';
  }
  const warnings = Array.isArray(reported.warnings)
    ? reported.warnings.filter(value => typeof value==='string' && value.trim()).slice(0,50).map(value => value.trim().slice(0,500))
    : warningsHeader.slice(0,50);
  const notes = (text.match(/^(?:[:*RFG])\s+/gim) || []).length;
  const groups = (text.match(/^-(?:\s|$)/gm) || []).length + 1;
  return {
    warnings,
    noteCount: Number.isInteger(reported.noteCount) && reported.noteCount>=0 ? reported.noteCount : notes,
    lineCount: Number.isInteger(reported.lineCount) && reported.lineCount>=0 ? reported.lineCount : groups,
    bpm: Number.isFinite(reported.bpm) && reported.bpm>0 ? reported.bpm : bpm,
    bpmFallback: typeof reported.bpmFallback==='boolean' ? reported.bpmFallback : Boolean(bpmFallback),
    models: reported.models && typeof reported.models==='object' && !Array.isArray(reported.models) ? reported.models : {},
  };
}

function chartWorkerFailure(run, fallback) {
  const lines = typeof run?.errorOutput === 'string'
    ? run.errorOutput.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    : [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith('{')) continue;
    try {
      const report = JSON.parse(lines[index]);
      if (report?.status === 'error' && typeof report.message === 'string' && report.message.trim()) {
        return Object.assign(Error(report.message.trim().slice(0,600)), {
          code: typeof report.code === 'string' ? report.code : 'EXECUTION',
        });
      }
    } catch {}
  }
  return message(fallback,'EXECUTION');
}

function validateChartText(text) {
  if (typeof text !== 'string' || !text.trim()) throw message('曲谱草稿为空。','OUTPUT');
  if (Buffer.byteLength(text,'utf8') > CHART_BYTES) throw message('曲谱草稿超过 2 MiB。','OUTPUT');
  if (text.includes('\0') || /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw message('曲谱草稿包含无效控制字符。','OUTPUT');
  }
  for (const field of ['TITLE','ARTIST','BPM']) {
    if (!new RegExp(`^#\\s*${field}\\s*:\\s*\\S+`,'im').test(text)) {
      throw message(`曲谱草稿缺少 ${field}。`,'OUTPUT');
    }
  }
  if (!/^E\s*$/m.test(text)) throw message('曲谱草稿缺少结束标记。','OUTPUT');
}

function checkpointLocations() {
  const locations=[];
  if (process.env.ZENIX_DEMUCS_CHECKPOINT && path.isAbsolute(process.env.ZENIX_DEMUCS_CHECKPOINT)) {
    locations.push(process.env.ZENIX_DEMUCS_CHECKPOINT);
  }
  const hub = process.env.TORCH_HOME || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(),'.cache'),'torch');
  locations.push(path.join(hub,'hub','checkpoints',MODEL_FILE));
  return locations.filter(item => path.isAbsolute(item) && !/^[/\\]{2}/.test(item));
}

function pythonLocations() {
  const locations = [];
  if (process.env.ZENIX_DEMUCS_PYTHON && path.isAbsolute(process.env.ZENIX_DEMUCS_PYTHON)) locations.push({program:process.env.ZENIX_DEMUCS_PYTHON,prefix:[]});
  if (process.platform === 'win32') {
    locations.push({program:path.join(process.env.SystemRoot || 'C:\\Windows','py.exe'),prefix:['-3']});
    for (const dir of (process.env.Path || process.env.PATH || '').split(path.delimiter)) {
      if (path.isAbsolute(dir) && !/^[/\\]{2}/.test(dir)) locations.push({program:path.join(dir,'python.exe'),prefix:[]});
    }
  } else locations.push({program:'python3',prefix:[]});
  return locations.filter(entry => !/^[/\\]{2}/.test(entry.program) && !/\.(?:cmd|bat)$/i.test(entry.program));
}

function environment() {
  const vars = {...process.env, PYTHONUTF8:'1', OMP_NUM_THREADS:'2', MKL_NUM_THREADS:'2'};
  for (const name of Object.keys(vars)) {
    if (/^(?:PYTHONPATH|PYTHONHOME|PYTHONSTARTUP|TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD|TORCH_FORCE_WEIGHTS_ONLY_LOAD)$/i.test(name)) delete vars[name];
  }
  return vars;
}

function chartEnvironment() {
  const logical = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  const threads = String(Math.max(2,Math.min(6,logical-2)));
  return {...environment(),OMP_NUM_THREADS:threads,MKL_NUM_THREADS:threads};
}

async function findPython(cwd, signal) {
  const check = 'import importlib.metadata as m; import sys; sys.exit(0 if m.version("demucs") == "4.0.1" else 1)';
  for (const entry of pythonLocations()) {
    signal?.throwIfAborted();
    if (path.isAbsolute(entry.program) && !(await fs.stat(entry.program).catch(()=>null))?.isFile()) continue;
    if (process.platform==='win32' && entry.program.toLowerCase().includes('windowsapps')) continue;
    const out=await childCommand(entry.program,[...entry.prefix,'-I','-c',check],{
      cwd,
      signal,
      timeoutMs:PYTHON_PROBE_TIMEOUT_MS,
      env:environment(),
      killTree:true,
    }).catch(error => {
      signal?.throwIfAborted(); if (error?.code==='ENOENT'||error?.code==='DEPENDENCY') return null;return null;
    });
    if (out?.code===0) return entry;
  }
  return null;
}

async function inspectChart(python,cwd,signal) {
  try {
    const result=await childCommand(python.program,[...python.prefix,'-I','-c',CHART_DEPENDENCY_CHECK],{
      cwd,
      signal,
      timeoutMs:20000,
      timeoutMessage:'曲谱依赖检查超时。',
      timeoutCode:'DEPENDENCY',
      env:chartEnvironment(),
      killTree:true,
    });
    return result.code===0
      ? {available:true,message:''}
      : {available:false,message:CHART_DEPENDENCY};
  } catch (error) {
    signal?.throwIfAborted();
    return {available:false,message:CHART_DEPENDENCY};
  }
}

async function modelPath(signal) {
  for (const candidate of checkpointLocations()) {
    signal?.throwIfAborted();
    try {
      if (await hashFile(candidate,150*MIB,signal)===MODEL_SHA) return candidate;
    } catch {signal?.throwIfAborted();}
  }
  return '';
}

async function probeAudio(input,cwd,signal) {
  const {code,output,errorOutput}=await childCommand(process.platform==='win32'?'ffprobe.exe':'ffprobe',
    ['-v','error','-protocol_whitelist','file','-format_whitelist',AUDIO_FORMATS,'-select_streams','a:0','-show_entries','stream=codec_name,duration:format=duration','-of','json','-i',input],
    {cwd,signal,timeoutMs:15000,stdout:true,stderr:true,killTree:false}).catch(error => {
      signal?.throwIfAborted();if (error?.code==='ENOENT') throw message(DEPENDENCY,'DEPENDENCY');throw error;
    });
  if (code !== 0) {
    console.error(`local karaoke probe failed (${code}) for ${input}: ${String(errorOutput || output || '').trim().slice(0,2000)}`);
    throw message('不能解码选定的本机音频。','INPUT');
  }
  let info;try {info=JSON.parse(output);} catch {throw message('不能解析音频时长。','INPUT');}
  const streamDuration = Number(info?.streams?.[0]?.duration);
  const duration = Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : Number(info?.format?.duration);
  if (!info?.streams?.[0]?.codec_name || !Number.isFinite(duration) || duration <= 0 || duration > LIMIT_SECONDS) {
    throw message('只能分离 15 分钟内且时长有效的完整音频。','INPUT');
  }
  return duration;
}

async function decodeAudio(input,output,cwd,signal) {
  const result=await childCommand(process.platform==='win32'?'ffmpeg.exe':'ffmpeg',
    ['-nostdin','-hide_banner','-v','error','-xerror','-protocol_whitelist','file','-format_whitelist',AUDIO_FORMATS,
      '-i',input,'-map','0:a:0','-vn','-sn','-dn','-map_metadata','-1','-t',String(LIMIT_SECONDS+1),
      '-ac','2','-ar','44100','-c:a','pcm_s16le','-f','wav','-n',output],{cwd,signal,killTree:false}).catch(error=>{
    signal?.throwIfAborted();
    if (error?.code==='ENOENT') throw message(DEPENDENCY,'DEPENDENCY');
    throw error;
  });
  if (result.code!==0) throw message('不能解码选定的本机音频。','INPUT');
  return wavInfo(output);
}

async function verifyAudio(input,cwd,signal) {
  const result=await childCommand(process.platform==='win32'?'ffmpeg.exe':'ffmpeg',
    ['-nostdin','-hide_banner','-v','error','-xerror','-protocol_whitelist','file','-format_whitelist',AUDIO_FORMATS,
      '-i',input,'-map','0:a:0','-vn','-sn','-dn','-f','null','-'],{cwd,signal,killTree:false}).catch(error=>{
    signal?.throwIfAborted();
    if (error?.code==='ENOENT') throw message(DEPENDENCY,'DEPENDENCY');
    throw error;
  });
  signal?.throwIfAborted();
  if (result.code!==0) throw message('不能解码选定的本机音频。','INPUT');
}

async function wavInfo(filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.size < 46 || stat.size > OUT_BYTES) throw message('分离结果没有有效的 WAV 音频。','OUTPUT');
  const file = await fs.open(filename,'r');
  try {
    const head = Buffer.alloc(Math.min(65536,stat.size));
    const result = await file.read(head,0,head.length,0);
    if (result.bytesRead !== head.length || head.toString('ascii',0,4)!=='RIFF' || head.toString('ascii',8,12)!=='WAVE' || head.readUInt32LE(4)+8 !== stat.size) throw message('分离结果的 WAV 文件不完整。','OUTPUT');
    let bytesPerSec = 0, format = 0, channels = 0, sampleRate = 0, bits = 0;
    for (let at=12;at+8<=head.length;) {
      const name=head.toString('ascii',at,at+4);
      const length=head.readUInt32LE(at+4);
      if (at+8+length > stat.size) break;
      if (name==='fmt ' && length>=16 && at+24 <= head.length) {
        format=head.readUInt16LE(at+8); channels=head.readUInt16LE(at+10);
        sampleRate=head.readUInt32LE(at+12);bytesPerSec=head.readUInt32LE(at+16);bits=head.readUInt16LE(at+22);
      } else if (name==='data') {
        if (format!==1 || channels!==2 || sampleRate!==44100 || bits!==16 || bytesPerSec!==176400 || length % 4 || !length) break;
        const duration=length/bytesPerSec;
        if (duration > LIMIT_SECONDS+1) break;
        return {size:stat.size,duration};
      }
      at+=8+length+(length%2);
    }
    throw message('分离结果格式与预期不符。','OUTPUT');
  } finally {await file.close();}
}

function cleanFileExtension(filename) {
  // Complete downloaded media in Zenix's cache is a .bin, regardless of codec.
  const ext=path.extname(filename).toLowerCase();
  return SUPPORTED_EXT.has(ext) ? ext : '.bin';
}

function publicRecord(key,duration,cacheHit) {
  return {key, audioUrl:'yzqxy://karaoke-backing/'+key, duration, cacheHit, kind:'separated', model:MODEL_ID};
}

function resolveChartWorker(worker = path.join(__dirname,'karaoke-chart-worker.py')) {
  // Electron Builder unpacks executable resources while leaving CJS in the
  // archive. Python needs the real filesystem path outside app.asar.
  const packed = `${path.sep}app.asar${path.sep}`;
  return worker.includes(packed)
    ? worker.replace(packed,`${path.sep}app.asar.unpacked${path.sep}`)
    : worker;
}

async function dropStage(parent, stage) {
  const root=await fs.realpath(parent);
  const resolved=await fs.realpath(stage).catch(()=>null);
  if (resolved && path.dirname(resolved)===root && /^\.job-[\da-z]+$/i.test(path.basename(resolved))) {
    await fs.rm(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:200});
  }
}

// Main process wiring:
//   new KaraokeSeparation({folder: path.join(app.getPath('userData'),'...')})
//   inspect() -> {available, model?, message?}
//   cached(verifiedAbsolutePath, signal) -> null or {key, audioUrl, duration, ...}
//   start(verifiedAbsolutePath, {signal, requestId}) -> same result
//   cancel(requestId) -> boolean; close() -> settled Promise
//   fileFor(key) -> validated local WAV path, or null (media protocol only)
class KaraokeSeparation {
  constructor({
    folder,
    budgetBytes = DEFAULT_BUDGET,
    chartWorker = resolveChartWorker(),
    closeGraceMs = DEFAULT_CLOSE_GRACE_MS,
  } = {}, dependencies = {}) {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw Error('Karaoke separation cache requires an absolute folder');
    if (typeof chartWorker !== 'string' || !path.isAbsolute(chartWorker) || /^[/\\]{2}/.test(chartWorker)) {
      throw Error('Karaoke chart worker requires an absolute local path');
    }
    this.folder = folder;
    this.budget = budgetBytes;
    this.chartWorker = chartWorker;
    this.closeGraceMs = Number.isFinite(closeGraceMs) && closeGraceMs >= 0
      ? closeGraceMs
      : DEFAULT_CLOSE_GRACE_MS;
    this.closed = false;
    this.active = null;
    this.lifecycle = new AbortController();
    this.engine = {...{
      findPython,
      inspectChart,
      modelPath,
      modelSha:MODEL_SHA,
      probe:probeAudio,
      verify:verifyAudio,
      decode:decodeAudio,
      run:childCommand,
      runChart:(program,args,options) => childCommand(program,args,{
        ...options,
        stdout:true,
        stderr:true,
        timeoutMessage:'本地曲谱生成超时。',
        timeoutCode:'TIMEOUT',
        outputLimit:256*1024,
      }),
    },...dependencies};
  }

  async inspect(signal) {
    if (this.closed) return {available:false,message:'本地分离已关闭。'};
    const jobSignal = signal ? AbortSignal.any([signal,this.lifecycle.signal]) : this.lifecycle.signal;
    jobSignal.throwIfAborted();
    await fs.mkdir(this.folder,{recursive:true});
    const python = await this.engine.findPython(this.folder,jobSignal);
    if (!python) return {available:false,message:DEPENDENCY};
    const model = await this.engine.modelPath(jobSignal);
    if (!model) return {available:false,message:MODEL_MISSING};
    const chart = await this.engine.inspectChart(python,this.folder,jobSignal);
    return {
      available:true,
      model:MODEL_ID,
      chartAvailable:chart.available,
      ...(chart.available ? {} : {message:chart.message || CHART_DEPENDENCY}),
    };
  }

  async inputPath(file) {
    // Caller must resolve the audio path from a local-library ID or a complete
    // trusted cache entry, not pass a path supplied by the renderer.
    const absolute = await fs.realpath(localFile(file));
    if (!path.isAbsolute(absolute) || /^[/\\]{2}/.test(absolute)) throw message('不能处理网络磁盘路径。','INPUT');
    return absolute;
  }

  async verify(file, signal) {
    const jobSignal = signal ? AbortSignal.any([signal,this.lifecycle.signal]) : this.lifecycle.signal;
    jobSignal.throwIfAborted();
    const input = await this.inputPath(file);
    await this.engine.verify(input,path.dirname(input),jobSignal);
  }

  async cached(file, signal) {
    if (this.closed) return null;
    const jobSignal = signal ? AbortSignal.any([signal,this.lifecycle.signal]) : this.lifecycle.signal;
    const input = await this.inputPath(file);
    const hash = await hashFile(input,IN_BYTES,jobSignal);
    return this.readCache(this.cacheKey(hash),true);
  }

  cacheKey(content) {return sha(MODEL_ID+'\0'+content);}

  start(file, {signal, requestId} = {}) {
    return this.runExclusive('backing',file,{signal,requestId},jobSignal => this.process(file,jobSignal));
  }

  startWithChart(file, {signal, requestId, lyrics, options, metadata, onProgress} = {}) {
    return this.runExclusive(
      'chart',
      file,
      {signal,requestId},
      jobSignal => this.processWithChart(file,{signal:jobSignal,lyrics,options,metadata,onProgress}),
    );
  }

  runExclusive(operation,file,{signal,requestId},execute) {
    if (this.closed) return Promise.reject(message('本地分离已关闭。','CLOSED'));
    if (this.active) {
      if (this.active.file===file && this.active.id===requestId && this.active.operation===operation
        && !this.active.controller.signal.aborted) return this.active.promise;
      return Promise.reject(message('已有分离任务正在运行。请先等待完成或取消。','BUSY'));
    }
    const controller = new AbortController();
    const propagate=()=>controller.abort(signal.reason);
    if (signal?.aborted) propagate();
    else signal?.addEventListener('abort',propagate,{once:true});
    const task={file,id:requestId,operation,controller};
    this.active=task;
    task.promise=execute(controller.signal).finally(()=>{
      signal?.removeEventListener('abort',propagate);
      if (this.active===task) this.active=null;
    });
    return task.promise;
  }

  cancel(requestId) {
    const task=this.active;
    if (!task || task.id!==requestId) return false;
    task.controller.abort();
    return true;
  }

  close() {
    const active = this.active?.promise.catch(()=>{});
    this.closed=true;
    this.lifecycle.abort();
    this.active?.controller.abort();
    if (!active) return Promise.resolve();
    return Promise.race([
      active,
      new Promise(resolve => setTimeout(resolve,this.closeGraceMs)),
    ]);
  }

  async readCache(key, touch) {
    if (this.closed || typeof key!=='string' || !HASH.test(key)) return null;
    const file = path.join(this.folder,key+'.wav');
    try {
      const info = await wavInfo(file);
      if (touch) {
        const now = new Date();
        await fs.utimes(file,now,now).catch(()=>{});
      }
      return publicRecord(key,info.duration,touch);
    } catch {return null;}
  }

  async fileFor(key) {
    // Only a validated opaque SHA-256 key from the separation store is accepted.
    return await this.readCache(key,false) ? path.join(this.folder,key+'.wav') : null;
  }

  chartPath(key) {
    return HASH.test(key || '') ? path.join(this.folder,key+'.chart.json') : '';
  }

  async readChartCache(key, backingKey, lyricsDigest, optionsDigest) {
    if (this.closed || !HASH.test(key || '') || !HASH.test(backingKey || '')) return null;
    const filename = this.chartPath(key);
    try {
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.size < 2 || stat.size > CHART_SIDECAR_BYTES) return null;
      const row = JSON.parse(await fs.readFile(filename,'utf8'));
      if (!row || row.schema !== 1 || row.key !== key || row.backingKey !== backingKey
        || row.lyricsDigest !== lyricsDigest || row.optionsDigest !== optionsDigest
        || !row.chart || typeof row.chart !== 'object') return null;
      const {name,data,warnings,noteCount,lineCount,bpm,bpmFallback,models,sha256} = row.chart;
      if (typeof name !== 'string' || !name || name.length > 240 || typeof data !== 'string'
        || typeof sha256 !== 'string' || !HASH.test(sha256)) return null;
      validateChartText(data);
      if (sha(data) !== sha256) return null;
      if (!Array.isArray(warnings) || !warnings.every(value => typeof value==='string')) return null;
      if (!Number.isInteger(noteCount) || noteCount < 1 || !Number.isInteger(lineCount) || lineCount < 1) return null;
      if (!Number.isFinite(bpm) || bpm < 20 || bpm > 400 || typeof bpmFallback !== 'boolean') return null;
      if (!models || typeof models !== 'object' || Array.isArray(models)) return null;
      return {name,data,warnings,noteCount,lineCount,bpm,bpmFallback,lyricsSha256:lyricsDigest,models,key,sha256,cacheHit:true,cachePersisted:true};
    } catch {
      return null;
    }
  }

  async writeChartCache({key,backingKey,lyricsDigest,optionsDigest,chart}) {
    const target = this.chartPath(key);
    if (!target) throw message('曲谱缓存标识无效。','OUTPUT');
    const payload = JSON.stringify({
      schema:1,
      key,
      backingKey,
      lyricsDigest,
      optionsDigest,
      at:Date.now(),
      chart,
    });
    if (Buffer.byteLength(payload,'utf8') > CHART_SIDECAR_BYTES) throw message('曲谱缓存超过大小限制。','OUTPUT');
    const temporary = path.join(this.folder,`.${key}.${crypto.randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary,payload,{encoding:'utf8',flag:'wx',mode:0o600});
      try {
        await fs.rename(temporary,target);
      } catch (error) {
        if (!['EEXIST','EPERM'].includes(error?.code)) throw error;
        let existing;
        try {existing = JSON.parse(await fs.readFile(target,'utf8'));}
        catch {existing = null;}
        if (existing?.chart?.sha256 !== chart.sha256) {
          await fs.rm(target,{force:true});
          await fs.rename(temporary,target);
        }
      }
    } finally {
      await fs.rm(temporary,{force:true}).catch(()=>{});
    }
  }

  async publishBacking(output,key,info,signal) {
    await this.prune(info.size);
    signal.throwIfAborted();
    const target=path.join(this.folder,key+'.wav');
    try {
      await fs.rename(output,target);
    } catch (error) {
      if (error.code==='EEXIST'||error.code==='EPERM') {
        const existing=await this.readCache(key,true);
        if (existing) return existing;
      }
      throw error;
    }
    if (signal.aborted) {
      await fs.unlink(target).catch(()=>{});
      signal.throwIfAborted();
    }
    return publicRecord(key,info.duration,false);
  }

  async prune(needed) {
    const entries = await fs.readdir(this.folder,{withFileTypes:true});
    const list = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.wav$/.test(entry.name)) continue;
      const file=path.join(this.folder,entry.name);
      const info=await fs.stat(file).catch(()=>null);
      if (info) list.push({file,bytes:info.size,at:info.mtimeMs});
    }
    list.sort((a,b)=>a.at-b.at);
    let size=list.reduce((total,entry)=>total+entry.bytes,0);
    for (const entry of list) {
      if (size+needed<=this.budget) break;
      try {await fs.unlink(entry.file);size-=entry.bytes;} catch {}
    }
    if (size+needed>this.budget) throw message('本地伴奏缓存空间不足。','DISK');
  }

  async removeAbandonedStages() {
    // This broker is singleton per profile. Only visit its own expired scratch
    // folders; do not follow symlinks or delete live work.
    for (const entry of await fs.readdir(this.folder,{withFileTypes:true})) {
      if (!entry.isDirectory() || !/^\.job-[\da-z]+$/i.test(entry.name)) continue;
      const target = path.join(this.folder,entry.name);
      const stat = await fs.lstat(target).catch(()=>null);
      if (stat?.isDirectory() && stat.mtimeMs < Date.now()-24*60*60*1000) await dropStage(this.folder,target);
    }
  }

  async process(file,signal) {
    signal.throwIfAborted();
    const input = await this.inputPath(file);
    const hash = await hashFile(input,IN_BYTES,signal);
    const key = this.cacheKey(hash);
    const hit = await this.readCache(key,true);
    if (hit) {signal.throwIfAborted();return hit;}
    await fs.mkdir(this.folder,{recursive:true});
    const python = await this.engine.findPython(this.folder,signal);
    if (!python) throw message(DEPENDENCY,'DEPENDENCY');
    const model = await this.engine.modelPath(signal);
    if (!model) throw message(MODEL_MISSING,'MODEL');
    signal.throwIfAborted();
    await this.removeAbandonedStages();
    signal.throwIfAborted();
    const stage = await fs.mkdtemp(path.join(this.folder,'.job-'));
    try {
      const repo = path.join(stage,'model');
      await fs.mkdir(repo);
      const stagedModel = await hashFile(model,150*MIB,signal,path.join(repo,MODEL_FILE));
      if (stagedModel !== this.engine.modelSha) throw message(MODEL_MISSING,'MODEL');
      const staged = path.join(stage,'input'+cleanFileExtension(input));
      const stagedHash = await hashFile(input,IN_BYTES,signal,staged);
      if (stagedHash!==hash) throw message('源文件在准备期间发生变化，请重试。','INPUT');
      const duration = await this.engine.probe(staged,stage,signal);
      const expectedBytes=Math.ceil(duration*176400)+4096;
      const space=await fs.statfs(stage);
      if (space.bavail*space.bsize < expectedBytes*3+16*MIB) throw message('磁盘剩余空间不足，未启动本地分离。','DISK');
      const source=path.join(stage,'decoded.wav');
      const decoded=await this.engine.decode(staged,source,stage,signal);
      if (decoded.duration>LIMIT_SECONDS || Math.abs(decoded.duration-duration)>Math.max(.35,duration*.002)) throw message('无法读取与原时长一致的完整音频。','INPUT');
      const args=[...python.prefix,'-I','-c',DEMUCS_ENTRY,repo,'--repo',repo,'-n','955717e8','-d','cpu',
        '--two-stems','vocals','--shifts','0','--segment','5','--jobs','0','--filename','{stem}.{ext}','-o',stage,'--',source];
      const run=await this.engine.run(python.program,args,{cwd:stage,signal,env:environment()});
      signal.throwIfAborted();
      if (run.code!==0) throw message(
        run.code===40 ? DEPENDENCY : '本地分离未完成，请检查 Demucs、PyTorch、torchaudio 和 FFmpeg 的安装兼容性。',
        run.code===40 ? 'DEPENDENCY' : 'EXECUTION',
      );
      const output = path.join(stage,'955717e8','no_vocals.wav');
      const info = await wavInfo(output);
      if (Math.abs(info.duration-decoded.duration)>Math.max(.04,decoded.duration*.0002)) throw message('分离结果与原音频时长不一致，已丢弃。','OUTPUT');
      return await this.publishBacking(output,key,info,signal);
    } finally {await dropStage(this.folder,stage);}
  }

  async processWithChart(file,{signal,lyrics,options,metadata,onProgress}={}) {
    signal.throwIfAborted();
    const report = stage => { if (typeof onProgress === 'function') onProgress(stage); };
    await fs.mkdir(this.folder,{recursive:true});
    const input = await this.inputPath(file);
    const contentDigest = await hashFile(input,IN_BYTES,signal);
    const backingKey = this.cacheKey(contentDigest);
    const duration = await this.engine.probe(input,this.folder,signal);
    const frozenLyrics = normalizeLyrics(lyrics,duration*1000);
    const trustedMetadata = metadata && typeof metadata === 'object' ? metadata : {};
    const chartOptions = normalizeChartOptions({
      ...options,
      ...(typeof trustedMetadata.title === 'string' ? {title:trustedMetadata.title} : {}),
      ...(typeof trustedMetadata.artist === 'string' ? {artist:trustedMetadata.artist} : {}),
    });
    const lyricsDigest = sha(stableJson(frozenLyrics));
    const optionsDigest = sha(stableJson(chartOptions));
    const chartKey = chartCacheKey(contentDigest,backingKey,frozenLyrics,chartOptions);
    const cachedBacking = await this.readCache(backingKey,true);
    if (cachedBacking) {
      const cachedChart = await this.readChartCache(chartKey,backingKey,lyricsDigest,optionsDigest);
      if (cachedChart) return {status:'ready',backing:cachedBacking,chart:cachedChart};
      if (frozenLyrics.length === 0) {
        return {status:'partial',backing:cachedBacking,chartFailure:'当前歌曲缺少逐句时间歌词，已复用本地伴奏。'};
      }
    }

    const python = await this.engine.findPython(this.folder,signal);
    if (!python) throw message(DEPENDENCY,'DEPENDENCY');
    const model = await this.engine.modelPath(signal);
    if (!model) throw message(MODEL_MISSING,'MODEL');
    signal.throwIfAborted();
    await this.removeAbandonedStages();
    signal.throwIfAborted();
    const stage = await fs.mkdtemp(path.join(this.folder,'.job-'));
    try {
      const repo = path.join(stage,'model');
      await fs.mkdir(repo);
      const stagedModel = await hashFile(model,150*MIB,signal,path.join(repo,MODEL_FILE));
      if (stagedModel !== this.engine.modelSha) throw message(MODEL_MISSING,'MODEL');
      const staged = path.join(stage,'input'+cleanFileExtension(input));
      const stagedHash = await hashFile(input,IN_BYTES,signal,staged);
      if (stagedHash!==contentDigest) throw message('源文件在准备期间发生变化，请重试。','INPUT');
      const probed = await this.engine.probe(staged,stage,signal);
      if (Math.abs(probed-duration)>Math.max(.35,duration*.002)) throw message('源文件时长在准备期间发生变化，请重试。','INPUT');
      const expectedBytes=Math.ceil(duration*176400)+4096;
      const space=await fs.statfs(stage);
      if (space.bavail*space.bsize < expectedBytes*4+24*MIB) throw message('磁盘剩余空间不足，未启动本地生成。','DISK');
      const source=path.join(stage,'decoded.wav');
      const decoded=await this.engine.decode(staged,source,stage,signal);
      if (decoded.duration>LIMIT_SECONDS || Math.abs(decoded.duration-duration)>Math.max(.35,duration*.002)) {
        throw message('无法读取与原时长一致的完整音频。','INPUT');
      }
      const args=[...python.prefix,'-I','-c',DEMUCS_ENTRY,repo,'--repo',repo,'-n','955717e8','-d','cpu',
        '--two-stems','vocals','--shifts','0','--segment','5','--jobs','0','--filename','{stem}.{ext}','-o',stage,'--',source];
      const run=await this.engine.run(python.program,args,{cwd:stage,signal,env:environment()});
      signal.throwIfAborted();
      if (run.code!==0) throw message(
        run.code===40 ? DEPENDENCY : '本地分离未完成，请检查 Demucs、PyTorch、torchaudio 和 FFmpeg 的安装兼容性。',
        run.code===40 ? 'DEPENDENCY' : 'EXECUTION',
      );
      const outputFolder = path.join(stage,'955717e8');
      const vocalsPath = path.join(outputFolder,'vocals.wav');
      const backingPath = path.join(outputFolder,'no_vocals.wav');
      const [vocalsInfo,backingInfo] = await Promise.all([wavInfo(vocalsPath),wavInfo(backingPath)]);
      const tolerance = Math.max(.04,decoded.duration*.0002);
      if (Math.abs(vocalsInfo.duration-backingInfo.duration)>tolerance
        || Math.abs(vocalsInfo.duration-decoded.duration)>tolerance
        || Math.abs(backingInfo.duration-decoded.duration)>tolerance) {
        throw message('分离后的两条音轨与原音频时长不一致，已丢弃。','OUTPUT');
      }
      report('publishing');
      const backing = cachedBacking || await this.publishBacking(backingPath,backingKey,backingInfo,signal);

      if (frozenLyrics.length === 0) {
        return {status:'partial',backing,chartFailure:'当前歌曲缺少逐句时间歌词，伴奏已生成。'};
      }

      let chart;
      try {
        report('pitching');
        const workerStat = await fs.lstat(this.chartWorker).catch(()=>null);
        if (!workerStat?.isFile()) throw message('本地曲谱生成组件缺失。','DEPENDENCY');
        const chartOutput = path.join(stage,'generated-chart.txt');
        const config = {
          schema:1,
          title:chartOptions.title,
          artist:chartOptions.artist,
          durationMs:Math.round(duration*1000),
          lyrics:frozenLyrics,
          generatorVersion:chartOptions.generatorVersion,
          pitchModel:chartOptions.pitchModel,
          alignerModel:chartOptions.alignerModel,
          bpmMode:chartOptions.bpmMode,
          fixedBpm:chartOptions.fixedBpm,
          minConfidence:chartOptions.minConfidence,
          minEnergy:chartOptions.minEnergy,
          minNoteMs:chartOptions.minNoteMs,
          quantization:chartOptions.quantization,
        };
        const chartConfig = path.join(stage,'chart-config.json');
        await fs.writeFile(chartConfig,JSON.stringify(config),{encoding:'utf8',flag:'wx',mode:0o600});
        const workerArgs=[...python.prefix,'-I',this.chartWorker,'--input',vocalsPath,'--output',chartOutput,'--config-file',chartConfig];
        const chartRun=await this.engine.runChart(python.program,workerArgs,{
          cwd:stage,
          signal,
          timeoutMs:DEFAULT_CHART_TIMEOUT_MS,
          env:chartEnvironment(),
          killTree:true,
          onStderrLine:line => {
            if (!line.startsWith('{')) return;
            try {
              const event = JSON.parse(line);
              if (event?.status==='progress' && event.stage==='aligning') report('aligning');
            } catch {}
          },
        });
        signal.throwIfAborted();
        if (chartRun.code!==0) {
          throw chartWorkerFailure(chartRun,'本地曲谱生成失败，请检查 CREPE 和逐句歌词。');
        }
        const chartStat = await fs.lstat(chartOutput);
        if (!chartStat.isFile() || chartStat.size <= 0 || chartStat.size > CHART_BYTES) {
          throw message('曲谱草稿为空或超过 2 MiB。','OUTPUT');
        }
        const dataStage = await fs.readFile(chartOutput);
        let text;
        try {text = new TextDecoder('utf-8',{fatal:true}).decode(dataStage);}
        catch {throw message('曲谱草稿不是有效 UTF-8。','OUTPUT');}
        text = text.replace(/^\uFEFF/,'');
        validateChartText(text);
        const metadata = parseChartMetadata(text,chartRun.output);
        if (metadata.noteCount < 1) throw message('生成的曲谱没有有效音高音符。','OUTPUT');
        if (!Number.isFinite(metadata.bpm) || metadata.bpm < 20 || metadata.bpm > 400) {
          throw message('生成的曲谱缺少有效 BPM。','OUTPUT');
        }
        report('validating');
        chart = {
          name:chartFileName(chartOptions.title),
          data:text,
          warnings:metadata.warnings,
          noteCount:metadata.noteCount,
          lineCount:metadata.lineCount,
          bpm:metadata.bpm,
          bpmFallback:metadata.bpmFallback,
          lyricsSha256:lyricsDigest,
          models:{...metadata.models,pitch:chartOptions.pitchModel,aligner:chartOptions.alignerModel,generator:chartOptions.generatorVersion},
          key:chartKey,
          sha256:sha(text),
          cacheHit:false,
        };
        try {
          await this.writeChartCache({key:chartKey,backingKey,lyricsDigest,optionsDigest,chart});
          chart = {...chart,cachePersisted:true};
        } catch (error) {
          signal.throwIfAborted();
          chart = {
            ...chart,
            cachePersisted:false,
            warnings:[...chart.warnings,'曲谱本轮可用，但未能写入本地草稿缓存。'],
          };
        }
        return {status:'ready',backing,chart};
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        return {status:'partial',backing,chartFailure:safeFailure(error,'本地曲谱生成失败，伴奏仍可使用。')};
      }
    } finally {
      await dropStage(this.folder,stage);
    }
  }
}

module.exports = {KaraokeSeparation, MODEL_FILE, MODEL_ID, MODEL_SHA, childCommand, resolveChartWorker, wavInfo};
