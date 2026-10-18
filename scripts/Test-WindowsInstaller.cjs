const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { prepareWindowsInstaller } = require('./Prepare-WindowsInstaller.cjs');
const run = promisify(execFile);
const project = path.resolve(__dirname, '..');
const literal = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');

test('standard NSIS migration retains data and runs the unchanged legacy uninstaller with its supported self-check exemption', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zenix-installer-contract-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folder = await prepareWindowsInstaller(root);
  const generated = await fs.readFile(path.join(folder, 'installUtil.nsh'), 'utf8');
  assert.match(generated, /legacy-uninstaller\\\$\{APP_EXECUTABLE_FILENAME\}/);
  assert.match(generated, /\/S \/KEEP_APP_DATA/);
  assert.match(generated, /StrCpy \$0 "\$0 --updated"/);
  assert.match(generated, /Call ZenixExecLegacyUninstaller/);
  assert.doesNotMatch(generated, /ExecWait/);
  assert.doesNotMatch(generated, /ExecWait '"\$uninstallerFileName"/);
});

test('real native NSIS process guard handles idle, running and other-directory Zenix processes in installer and uninstaller', { skip: process.platform !== 'win32' }, async t => {
  const nsis = path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache/nsis/nsis-3.0.4.1');
  const compiler = path.join(nsis, 'makensis.exe');
  try { await fs.access(compiler); }
  catch { t.skip('NSIS compiler is not installed; run this check on a Windows build machine.'); return; }
  await prepareWindowsInstaller(project);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zenix-native-installer-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'app'), other = path.join(root, 'app-other');
  await fs.mkdir(app); await fs.mkdir(other);
  const compile = async (name, body) => {
    const file = path.join(root, name + '.nsi'), exe = path.join(root, name + '.exe');
    await fs.writeFile(file, `Unicode true\nRequestExecutionLevel user\nName "Zenix isolated installer test"\nOutFile "${literal(exe)}"\n${body}`);
    await run(compiler, ['-V2', file], { timeout: 30000, windowsHide: true });
    return exe;
  };
  const sleeper = await compile('sleeper', 'SilentInstall silent\nSection\nSleep 300000\nSectionEnd\n');
  await fs.copyFile(sleeper, path.join(app, 'Zenix.exe'));
  await fs.copyFile(sleeper, path.join(other, 'Zenix.exe'));
  const guard = path.join(project, 'assets/installer.nsh');
  const report = path.join(root, 'result.txt');
  const header = `!include "LogicLib.nsh"\n!define APP_EXECUTABLE_FILENAME "Zenix.exe"\n!include "${literal(guard)}"\n!insertmacro customHeader\n`;
  const result = `Call \$\{ZENIX_RUNNING_FUNCTION\}\nPop $0\nFileOpen $1 "${literal(report)}" w\nFileWrite $1 "$0"\nFileClose $1\n`;
  const installer = await compile('guard', header + `SilentInstall silent\nSection\nStrCpy $INSTDIR "${literal(app)}"\n${result}SectionEnd\n`);
  const uninstaller = path.join(root, 'uninstaller.exe');
  const generator = await compile('uninstall-generator', '!define BUILD_UNINSTALLER\n' + header +
    `SilentInstall silent\nSilentUnInstall silent\nSection\nWriteUninstaller "${literal(uninstaller)}"\nSectionEnd\nSection Uninstall\nStrCpy $INSTDIR "${literal(app)}"\n${result}SectionEnd\n`);
  await run(generator, [], { timeout: 10000, windowsHide: true });
  const check = async expected => {
    for (const executable of [installer, uninstaller]) {
      await run(executable, ['/S', '_?=' + root], { timeout: 10000, windowsHide: true });
      assert.equal(await fs.readFile(report, 'utf8'), String(expected), executable);
    }
  };
  await check(0);
  const child = spawn(path.join(app, 'Zenix.exe'), [], { windowsHide: true, stdio: 'ignore' });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  await check(1);
  const ended = new Promise(resolve => child.once('exit', resolve)); child.kill(); await ended;
  const unrelated = spawn(path.join(other, 'Zenix.exe'), [], { windowsHide: true, stdio: 'ignore' });
  t.after(() => unrelated.kill());
  await new Promise((resolve, reject) => { unrelated.once('spawn', resolve); unrelated.once('error', reject); });
  await check(0);
  const otherEnded = new Promise(resolve => unrelated.once('exit', resolve)); unrelated.kill(); await otherEnded;

  // Exercise the exact historical running-app branch with a harmless marker
  // instead of making another potentially hanging CIM query on the host.
  const templates = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis');
  const legacyMarker = path.join(root, 'legacy-query.txt');
  const legacy = await compile('old-uninstaller', `!addincludedir "${literal(path.join(templates, 'include'))}"\n!include "LogicLib.nsh"\n!define APP_EXECUTABLE_FILENAME "Zenix.exe"\n!define isUpdated '"no" == "yes"'\n!include "allowOnlyOneInstallerInstance.nsh"\n!macroundef FIND_PROCESS\n!macro FIND_PROCESS FILE RESULT\nFileOpen $0 "${literal(legacyMarker)}" w\nFileWrite $0 "query entered"\nFileClose $0\nStrCpy \$\{RESULT\} 1\n!macroend\nSilentInstall silent\nSection\n!insertmacro _CHECK_APP_RUNNING\nSectionEnd\n`);
  await run(legacy, ['/S'], { timeout: 10000, windowsHide: true });
  assert.equal(await fs.readFile(legacyMarker, 'utf8'), 'query entered');
  await fs.unlink(legacyMarker);
  const staged = path.join(root, 'legacy-uninstaller', 'Zenix.exe');
  await fs.mkdir(path.dirname(staged)); await fs.copyFile(legacy, staged);
  await run(staged, ['/S'], { timeout: 10000, windowsHide: true });
  await assert.rejects(fs.access(legacyMarker), { code: 'ENOENT' });

  // Run the FULL historical check, including its real availability macro.
  // Substitute only the shell executable with an inert marker program. The
  // one-process job must deny its launch before any profile/probe can execute.
  const shellMarker=path.join(root,'shell-started.txt'),legacyDone=path.join(root,'legacy-done.txt');
  const shell=await compile('shell-probe',`SilentInstall silent\nSection\nFileOpen $0 "${literal(shellMarker)}" w\nFileWrite $0 "unexpected shell"\nFileClose $0\nSectionEnd\n`);
  const originalGuard=await fs.readFile(path.join(templates,'include/allowOnlyOneInstallerInstance.nsh'),'utf8');
  const availability=originalGuard.match(/!macro IS_POWERSHELL_AVAILABLE\r?\n([\s\S]*?)!macroend/)[1];
  const fullLegacy=await compile('full-legacy',`!addincludedir "${literal(path.join(templates,'include'))}"\n!include "LogicLib.nsh"\n!define APP_EXECUTABLE_FILENAME "Zenix.exe"\n!define isUpdated '"no" == "yes"'\n!include "allowOnlyOneInstallerInstance.nsh"\n!macroundef IS_POWERSHELL_AVAILABLE\n!macro IS_POWERSHELL_AVAILABLE\nStrCpy $PowerShellPath "${literal(shell)}"\n${availability}\n!macroend\nSilentInstall silent\nSection\n!insertmacro CHECK_APP_RUNNING\nFileOpen $0 "${literal(legacyDone)}" w\nFileWrite $0 "$IsPowerShellAvailable|$CMDLINE"\nFileClose $0\nSetErrorLevel 7\nSectionEnd\n`);
  const hash=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  const beforeHash=hash(await fs.readFile(fullLegacy));await fs.copyFile(fullLegacy,staged);
  const guarded=await compile('guarded-migration',header+`SilentInstall silent\nSection\nPush '\"${literal(staged)}\" /S /KEEP_APP_DATA --updated _?=${literal(app)}'\nPush "${literal(staged)}"\nCall ZenixExecLegacyUninstaller\nPop $0\nFileOpen $1 "${literal(report)}" w\nFileWrite $1 "$0"\nFileClose $1\nSectionEnd\n`);
  await run(guarded,['/S'],{timeout:10000,windowsHide:true});
  assert.equal(await fs.readFile(report,'utf8'),'7','propagates actual legacy exit code');
  assert.match(await fs.readFile(legacyDone,'utf8'),/^1\|.*\/KEEP_APP_DATA --updated _\?=/,'full check handles shell unavailability and retains migration flags');
  await assert.rejects(fs.access(shellMarker),{code:'ENOENT'});
  assert.equal(hash(await fs.readFile(staged)),beforeHash,'legacy executable bytes unchanged');
});

test('electron-builder compiles the standard installer and uninstaller with the compatibility include', { skip: process.platform !== 'win32' }, async t => {
  const compiler = path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache/nsis/nsis-3.0.4.1/makensis.exe');
  try { await fs.access(compiler); }
  catch { t.skip('NSIS compiler is not installed; run this check on a Windows build machine.'); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zenix-installer-build-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'app'), assets = path.join(root, 'assets');
  await fs.mkdir(app); await fs.mkdir(assets);
  await fs.mkdir(path.join(app, 'resources'));
  await fs.symlink(path.join(project, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  await fs.copyFile(path.join(project, 'assets/installer.nsh'), path.join(assets, 'installer.nsh'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'zenix-installer-fixture', version: '0.0.1', description: 'Isolated installer contract', author: 'Zenix tests' }));
  // A tiny inert PE is sufficient for compiling the real NSIS installation path.
  const binary = path.join(app, 'ZenixInstallerFixture.exe');
  const source = path.join(root, 'fixture.nsi');
  await fs.writeFile(source, `Unicode true\nName "Fixture"\nOutFile "${literal(binary)}"\nRequestExecutionLevel user\nSilentInstall silent\nSection\nSectionEnd\n`);
  await run(compiler, ['-V2', source], { windowsHide: true, timeout: 30000 });
  await prepareWindowsInstaller(root);
  const output = path.join(root, 'release');
  const code = `require(${JSON.stringify(require.resolve('electron-builder'))}).build({projectDir:${JSON.stringify(root)},prepackaged:${JSON.stringify(app)},targets:require(${JSON.stringify(require.resolve('electron-builder'))}).Platform.WINDOWS.createTarget('nsis',require(${JSON.stringify(require.resolve('builder-util'))}).Arch.x64),config:{appId:'com.zenix.installer-fixture',productName:'ZenixInstallerFixture',directories:{output:${JSON.stringify(output)},buildResources:${JSON.stringify(assets)}},beforePack:${JSON.stringify(path.join(project, 'scripts/Prepare-WindowsInstaller.cjs'))},win:{signAndEditExecutable:false},nsis:{oneClick:false,perMachine:false,allowToChangeInstallationDirectory:true,deleteAppDataOnUninstall:false,runAfterFinish:false}}}).catch(e=>{console.error(e);process.exitCode=1;});`;
  const result = await run(process.execPath, ['-e', code], { cwd: root, windowsHide: true, timeout: 60000,
    env: { ...process.env, CSC_LINK: '', WIN_CSC_LINK: '', CSC_KEY_PASSWORD: '', CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  assert.doesNotMatch(result.stdout, /uninstaller is not signed by electron-builder/);
  const files = await fs.readdir(output);
  assert.ok(files.some(name => name.endsWith('.exe')), result.stdout);
});
