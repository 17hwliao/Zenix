const fs = require('node:fs/promises');
const path = require('node:path');

// Keep electron-builder's installer, signing, identity and data-preserving
// uninstallation flow. Stage unchanged legacy bytes and constrain shell probes.
async function prepareWindowsInstaller(projectDir) {
  const templates = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis');
  const guard = await fs.readFile(path.join(templates, 'include/allowOnlyOneInstallerInstance.nsh'), 'utf8');
  const source = await fs.readFile(path.join(templates, 'include/installUtil.nsh'), 'utf8');
  const original = 'StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\\old-uninstaller.exe"';
  const fallback = `ExecWait '"$uninstallerFileName" /S /KEEP_APP_DATA $0 _?=$installationDir' $R0`;
  const launch = `ExecWait '"$uninstallerFileNameTemp" /S /KEEP_APP_DATA $0 _?=$installationDir' $R0`;
  const uninstall = await fs.readFile(path.join(templates,'uninstaller.nsh'),'utf8');
  if (!guard.includes('${if} $3 != "${APP_EXECUTABLE_FILENAME}"') || !guard.includes('!insertmacro IS_POWERSHELL_AVAILABLE') || source.split(original).length !== 2 || source.split(fallback).length !== 2 || source.split(launch).length!==2 || /\b(?:Exec|ExecWait|ExecShell)\b/.test(uninstall)) {
    throw Error('NSIS legacy migration contract changed; review the installer before building.');
  }
  // Old published uninstallers skip their CIM-based running-app check when
  // executed with APP_EXECUTABLE_FILENAME. The new installer already checks
  // running processes natively before launching this unchanged legacy binary.
  const replacement = 'StrCpy $uninstallerFileNameTemp "$PLUGINSDIR\\legacy-uninstaller\\${APP_EXECUTABLE_FILENAME}"';
  const folder = path.join(projectDir, 'release/windows-installer');
  await fs.mkdir(folder, { recursive: true });
  // If staging cannot execute, stop before removing any old files. Falling
  // back to the original filename would re-enter the legacy CIM query.
  const safeFailure = 'SetErrorLevel 2\n      Quit';
  const controlledLaunch = `Push '"$uninstallerFileNameTemp" /S /KEEP_APP_DATA $0 _?=$installationDir'\n    Push "$uninstallerFileNameTemp"\n    Call ZenixExecLegacyUninstaller\n    Pop $R0\n    ClearErrors\n    \${if} $R0 == -1\n      SetErrors\n    \${endif}`;
  await fs.writeFile(path.join(folder, 'installUtil.nsh'), source.replace(original, replacement).replace(launch,controlledLaunch).replace(fallback, safeFailure));
  return folder;
}

module.exports = async context => {
  if (context.electronPlatformName === 'win32') await prepareWindowsInstaller(context.packager.projectDir);
};
module.exports.prepareWindowsInstaller = prepareWindowsInstaller;
