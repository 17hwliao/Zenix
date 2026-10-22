const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomBytes, randomInt, timingSafeEqual} = require('node:crypto');
const privateIp = value => { const parts=String(value).replace(/^::ffff:/,'').split('.').map(Number);return parts.length===4&&parts.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(parts[0]===10||parts[0]===192&&parts[1]===168||parts[0]===172&&parts[1]>=16&&parts[1]<=31||parts[0]===127); };
const equal = (a,b) => typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
class RemoteControl {
  constructor(command){this.command=command;this.clients=new Map();this.collaboration=new(require('./collaboration.cjs').Collaboration)(this.clients);this.attempts=new Map();this.state={title:'暂无歌曲',artist:'',playing:false,position:0,duration:0,volume:.75};}
  collaborate(args){if(args.action==='start')return this.start();if(args.action==='stop'){this.stop();return this.status();}if(args.action==='approve')return this.approve(args.id,args.allow===true);if(args.action==='hostStatus')return this.status();return this.collaboration.local(args);}
  update(state){for(const key of ['title','artist'])if(state[key]!==undefined)this.state[key]=String(state[key]).slice(0,300);if(typeof state.playing==='boolean')this.state.playing=state.playing;for(const key of ['position','duration','volume'])if(Number.isFinite(state[key]))this.state[key]=state[key];}
  status(){return {listening:!!this.server,code:this.server?this.code:undefined,expiresAt:this.expiresAt||0,addresses:this.server?Object.values(os.networkInterfaces()).flat().filter(item=>item&&item.family==='IPv4'&&!item.internal&&privateIp(item.address)).map(item=>`${item.address}:${this.port}`):[],clients:[...this.clients.entries()].map(([id,c])=>({id,label:c.label,approved:c.approved}))};}
  async start(){if(this.server)return this.status();this.code=String(randomInt(100000,1000000));this.expiresAt=Date.now()+30*60000;this.clients.clear();this.attempts.clear();this.page=await fs.readFile(path.join(__dirname,'../remote-control.html'),'utf8');const server=http.createServer((req,res)=>{void this.request(req,res).catch(()=>{if(!res.headersSent)res.writeHead(400);res.end('请求无效');});});this.server=server;server.requestTimeout=5000;server.headersTimeout=5000;server.maxConnections=16;
    try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'0.0.0.0',resolve);});this.port=server.address().port;this.timer=setTimeout(()=>this.stop(),30*60000);this.timer.unref();return this.status();}catch(error){this.server=null;server.close();throw error;}
  }
  stop(){clearTimeout(this.timer);this.server?.close();this.server?.closeAllConnections();this.server=null;this.clients.clear();this.collaboration.clear();this.code='';this.expiresAt=0;}
  approve(id,allow){const client=this.clients.get(id);if(!client)throw Error('配对请求已失效');if(allow)client.approved=true;else{this.clients.delete(id);this.collaboration.revoke(id);}return this.status();}
  async request(req,res){
    const host=String(req.headers.host||''),match=host.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
    if(!match||!privateIp(match[1])||+match[2]!==this.port||!privateIp(req.socket.remoteAddress))throw Error('仅支持局域网连接');
    if(req.headers.origin&&req.headers.origin!==`http://${host}`)throw Error('来源无效');
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    if(req.method==='GET'&&req.url==='/'){const nonce=randomBytes(16).toString('hex');res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',`default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'`);res.end(this.page.replaceAll('__NONCE__',nonce));return;}
    if(req.method!=='POST'||req.url!=='/api'||!String(req.headers['content-type']||'').startsWith('application/json'))throw Error('请求无效');
    let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1024*1024+8192){res.writeHead(413);res.end();return;}chunks.push(chunk);}const args=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(args.action!=='collaboration'&&size>4096)throw Error('请求过大');
    let value;
    if(args.action==='pair'){
      const ip=req.socket.remoteAddress,now=Date.now();let entry=this.attempts.get(ip);if(!entry||now-entry.at>60000)entry={at:now,count:0};entry.count++;if(this.attempts.size>256)this.attempts.clear();this.attempts.set(ip,entry);
      if(entry.count>5||!equal(String(args.code),this.code)||Date.now()>this.expiresAt)throw Error('配对码错误、过期或尝试过多');
      for(const [id,c] of this.clients)if(!c.approved&&now-c.at>120000)this.clients.delete(id);
      if(this.clients.size>=8)throw Error('请先在电脑移除多余设备');const token=randomBytes(24).toString('hex');this.clients.set(token,{at:now,label:String(args.label||'手机浏览器').slice(0,40),approved:false});value={token,approved:false};
    }else{
      const client=this.clients.get(args.token);if(!client)throw Error('请重新配对');
      if(args.action==='disconnect'){this.clients.delete(args.token);this.collaboration.revoke(args.token);value=true;}
      else if(args.action==='pairStatus')value={approved:client.approved};
      else{if(!client.approved)throw Error('请在电脑确认配对');
        if(args.action==='collaboration')value=this.collaboration.remote(args.token,args.request||{});
        else if(args.action==='status')value=this.state;
        else if(['play-pause','next','previous'].includes(args.action)){this.command(args.action);value=true;}
        else if(args.action==='seek'){const seconds=Number(args.seconds);if(!Number.isFinite(seconds)||seconds<0||seconds>this.state.duration)throw Error('进度无效');this.command('seek',seconds);value=true;}
        else if(args.action==='volume'){const volume=Number(args.volume);if(!Number.isFinite(volume)||volume<0||volume>1)throw Error('音量无效');this.command('volume',volume);value=true;}
        else throw Error('未知遥控操作');
      }
    }
    res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));
  }
}
module.exports={RemoteControl,privateIp};
