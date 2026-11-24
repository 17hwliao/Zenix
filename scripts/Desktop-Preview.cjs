// Local interactive previews share one managed process per checkout.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = fs.realpathSync(path.join(__dirname, '..'));
const release = path.join(root, 'release');
const home = path.join(release, 'managed-desktop-preview');
const receipt = path.join(home, 'session.json');
const logFile = path.join(home, 'preview.log');
const pipe = process.platform === 'win32'
  ? `\\\\.\\pipe\\zenix-preview-${crypto.createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 20)}`
  : path.join(home, 'control.sock');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const nonceValid = value => typeof value === 'string' && /^[\da-f]{64}$/.test(value);

function readReceipt() {
  try {return JSON.parse(fs.readFileSync(receipt, 'utf8'));}
  catch (error) {if (error.code === 'ENOENT') return null; throw error;}
}

function target(file) {
  if (!file) return '';
  const absolute = fs.realpathSync(path.resolve(root, file));
  const relative = path.relative(release, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(relative) !== '.cjs') {
    throw Error('自定义验收启动器必须是本工作区 release 目录下的 .cjs 文件。');
  }
  return absolute;
}

function command(action, token) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipe);
    let data = '';
    socket.setTimeout(2500, () => socket.destroy(Error('旧验收实例未响应')));
    socket.once('connect', () => socket.write(`${JSON.stringify({action, token})}\n`));
    socket.on('data', bytes => {
      data += bytes;
      if (data.length > 8192) {socket.destroy(Error('无效验收回执')); return;}
      if (!data.includes('\n')) return;
      try {
        const reply = JSON.parse(data);
        if (!reply.ok) throw Error('旧验收实例身份不匹配，未关闭任何进程。');
        resolve(reply);
      } catch (error) {reject(error);}
      socket.destroy();
    });
    socket.once('end', () => resolve(null));
    socket.once('error', error => {
      if (['ENOENT', 'ECONNREFUSED', 'ECONNRESET'].includes(error.code)) resolve(null);
      else reject(error);
    });
  });
}

async function cli() {
  const [action = 'status', launcher] = process.argv.slice(2);
  if (!['start', 'stop', 'status'].includes(action)) throw Error('用法: node scripts/Desktop-Preview.cjs start|status|stop [release/launcher.cjs]');
  fs.mkdirSync(home, {recursive: true});
  const current = readReceipt();
  const status = await command('status', current?.token);
  if (action === 'status') {console.log(JSON.stringify(status || {running: false})); return;}
  const launchFile = action === 'start' ? target(launcher) : '';
  if (status) {
    await command('quit', current.token);
    const end = Date.now() + 9000;
    while (Date.now() < end && await command('status', current.token)) await wait(120);
    if (await command('status', current.token)) throw Error('旧验收实例未退出，未启动第二个实例。');
    console.log(`已退出旧验收实例（PID ${status.pid}）`);
  }
  if (action === 'stop') {if (!status) console.log('没有正在运行的受管验收实例。'); return;}

  const token = crypto.randomBytes(32).toString('hex');
  const fd = fs.openSync(logFile, 'a');
  let child;
  try {
    const env = {...process.env, ZENIX_PREVIEW_TOKEN: token, ZENIX_PREVIEW_LAUNCHER: launchFile};
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(require('electron'), [__filename], {cwd: root, env, detached: true, windowsHide: true, stdio: ['ignore',fd,fd]});
  } finally {fs.closeSync(fd);}
  let failed;
  child.once('error', error => {failed = error;});
  child.unref();
  for (const end = Date.now() + 12000; Date.now() < end;) {
    if (failed) throw failed;
    if (readReceipt()?.token === token) {
      const next = await command('status', token);
      if (next) {console.log(JSON.stringify(next)); return;}
    }
    if (child.exitCode !== null) break;
    await wait(150);
  }
  throw Error(`验收实例未就绪，请查看 ${logFile}`);
}

function desktop() {
  const {app} = require('electron');
  const token = process.env.ZENIX_PREVIEW_TOKEN;
  if (!nonceValid(token)) throw Error('请通过本地验收命令启动。');
  const launchFile = target(process.env.ZENIX_PREVIEW_LAUNCHER);
  const server = net.createServer(socket => {
    let line = '';
    let replied = false;
    socket.setTimeout(2500, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', bytes => {
      if (replied) return;
      line += bytes;
      if (line.length > 1024) {socket.destroy(); return;}
      if (!line.includes('\n')) return;
      replied = true;
      let request;
      try {request = JSON.parse(line);} catch {socket.destroy(); return;}
      const authenticated = nonceValid(request?.token) && crypto.timingSafeEqual(Buffer.from(request.token), Buffer.from(token));
      if (!authenticated) {socket.end('{"ok":false}\n'); return;}
      if (request.action === 'quit') socket.once('close', () => setImmediate(() => app.quit()));
      socket.end(`${JSON.stringify({ok: true, running: true, pid: process.pid, profile: app.getPath('userData'), launcher: launchFile || 'desktop'})}\n`);
    });
  });
  const cleanup = () => {
    server.close();
    try {if (readReceipt()?.token === token) fs.unlinkSync(receipt);} catch {}
  };
  app.once('will-quit', cleanup);
  server.once('error', error => {console.error(error.message); app.exit(1);});
  server.listen(pipe, () => {
    try {
      if (launchFile) require(launchFile);
      else {
        const profile = path.join(home, 'profile');
        fs.mkdirSync(profile, {recursive: true});
        app.setPath('appData', home);
        app.setPath('userData', profile);
        require('../electron/main.cjs');
      }
      const next = `${receipt}.${process.pid}.tmp`;
      fs.writeFileSync(next, JSON.stringify({token, pid: process.pid}), {mode: 0o600});
      fs.renameSync(next, receipt);
    } catch (error) {console.error(error.message); cleanup(); app.exit(1);}
  });
}

if (process.versions.electron) desktop();
else cli().catch(error => {console.error(error.message); process.exitCode = 1;});
