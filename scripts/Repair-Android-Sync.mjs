import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localCapacitor = '../node_modules/@capacitor/android/capacitor';

export async function repairAndroidSync(root = projectRoot) {
  const settings = path.join(root, 'android', 'capacitor.settings.gradle');
  const source = await readFile(settings, 'utf8');
  if (!/include\s+['"]:capacitor-android['"]/.test(source)) {
    throw new Error(`Capacitor Android project is missing from ${settings}`);
  }
  const repaired = source.replace(
    /(project\(['"]:capacitor-android['"]\)\.projectDir\s*=\s*new File\()(['"])[^'"]*\2(\))/,
    `$1$2${localCapacitor}$2$3`,
  );
  if (!repaired.includes(`new File('${localCapacitor}')`)) {
    throw new Error(`Could not normalize the Capacitor Android project path in ${settings}`);
  }
  if (repaired !== source) await writeFile(settings, repaired);
  return {path:settings,changed:repaired !== source};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await repairAndroidSync();
  process.stdout.write(`Capacitor Android path ${result.changed ? 'repaired' : 'already canonical'}: ${result.path}\n`);
}
