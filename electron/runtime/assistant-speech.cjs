const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
/** Only receives an explicit, completed push-to-talk recording. No background microphone. */
class AssistantSpeech {
 constructor({platform=process.platform,spawnProcess=spawn}={}){this.platform=platform;this.spawn=spawnProcess;this.sessions=new Map();}
 request(args={}){
  if(this.platform!=='win32')return Promise.reject(Error('此系统请使用支持语音识别的浏览器或文字指令'));
  const token=args.token;if(typeof token!=='string'||!/^[a-f0-9-]{36}$/i.test(token))return Promise.reject(Error('语音会话无效'));
  if(this.sessions.has(token)||this.sessions.size>=2)return Promise.reject(Error('语音识别正在进行，请先取消或等待完成'));
  const operation=args.action==='speechCapabilities'?'capabilities':'recognize';
  if(operation==='recognize'){
   if(typeof args.wav!=='string'||args.wav.length>12*1024*1024)return Promise.reject(Error('本次语音过长，请分句说话'));
   const bytes=Buffer.from(args.wav,'base64');
   if(bytes.length<46||bytes.length>8*1024*1024||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE'||bytes.toString('ascii',12,16)!=='fmt '||bytes.readUInt16LE(20)!==1||bytes.readUInt16LE(22)!==1||bytes.readUInt32LE(24)!==16000||bytes.readUInt16LE(34)!==16||bytes.toString('ascii',36,40)!=='data'||bytes.readUInt32LE(40)!==bytes.length-44)return Promise.reject(Error('录音格式无效'));
  }
  return new Promise((resolve,reject)=>{
   const script=fs.readFileSync(path.join(__dirname,'assistant-speech.ps1'),'utf8');
   const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
   const child=this.spawn(executable,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
   let output='',settled=false;
   const finish=(error,value)=>{if(settled)return;settled=true;this.sessions.delete(token);error?reject(error):resolve(value);};
   this.sessions.set(token,{cancel:()=>{finish(Error('已取消语音识别'));child.kill();}});
   child.stdout.setEncoding('utf8');child.stdout.on('data',data=>{output+=data;if(output.length>65536){finish(Error('语音服务返回内容过大'));child.kill();}});
   child.stderr.resume();child.on('error',()=>finish(Error('无法启动系统语音识别，请使用文字指令')));
   child.on('close',()=>{try{const value=JSON.parse(output.trim());if(value.error)throw Error(value.error);finish(null,operation==='capabilities'?value:{transcript:String(value.transcript||'').slice(0,200),confidence:Number(value.confidence),offline:true});}catch(error){finish(error instanceof Error?error:Error('语音识别未完成'));}});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({operation,wav:args.wav}));
  });
 }
 cancel(token){this.sessions.get(token)?.cancel();return true;}
 close(){for(const session of [...this.sessions.values()])session.cancel();}
}
module.exports={AssistantSpeech};
