import {useCallback, useEffect, useRef, useState} from 'react';
import {parseThemeArchive, resourceMime} from './archive';
import {BUILTIN_THEME_IDS, DEFAULT_THEME_ID, builtinThemes, defaultTheme, type ResolvedTheme, type ThemeAssets, type ThemePackage} from './model';

const databaseName = 'zenix-visual-themes';
const storeName = 'packages';
const activeKey = 'zenix.theme.active.v1';
const changeEvent = 'zenix-themes-changed';

interface StoredTheme {
  id: string;
  bytes: ArrayBuffer;
  importedAt: number;
  name: string;
  author: string;
  version: string;
}

interface ThemeLibraryState {
  themes: ResolvedTheme[];
  active: ResolvedTheme;
  loading: boolean;
  error: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(Error('当前环境无法保存本地主题'));
      return;
    }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) database.createObjectStore(storeName, {keyPath: 'id'});
    };
    request.onerror = () => reject(request.error ?? Error('无法打开主题存储'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function databaseRequest<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = run(transaction.objectStore(storeName));
      request.onerror = () => reject(request.error ?? Error('主题存储操作失败'));
      request.onsuccess = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? Error('主题存储事务失败'));
    });
  } finally {
    database.close();
  }
}

function readActiveId() {
  try {
    return localStorage.getItem(activeKey) || DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

function writeActiveId(id: string) {
  localStorage.setItem(activeKey, id);
}

function objectUrl(bytes: Uint8Array, path: string) {
  if (!bytes.length) return undefined;
  return URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], {type: resourceMime(path)}));
}

function resolveArchive(record: StoredTheme): ResolvedTheme {
  const parsed = parseThemeArchive(new Uint8Array(record.bytes), {
    name: `${record.id}.zenuxtheme`,
    type: 'application/zip',
    size: record.bytes.byteLength,
  });
  const assets: ThemeAssets = {
    previewUrl: objectUrl(parsed.files[parsed.theme.preview], parsed.theme.preview),
    backgroundUrl: parsed.theme.tokens.backgroundImage ? objectUrl(parsed.files[parsed.theme.tokens.backgroundImage], parsed.theme.tokens.backgroundImage) : undefined,
    textureUrl: parsed.theme.tokens.texture ? objectUrl(parsed.files[parsed.theme.tokens.texture], parsed.theme.tokens.texture) : undefined,
    fontUrl: parsed.theme.font ? objectUrl(parsed.files[parsed.theme.font.file], parsed.theme.font.file) : undefined,
  };
  return {...parsed.theme, source: 'user', assets};
}

function releaseTheme(theme: ResolvedTheme) {
  if (theme.source !== 'user') return;
  for (const url of Object.values(theme.assets ?? {})) if (url) URL.revokeObjectURL(url);
}

async function readCatalog(): Promise<{themes: ResolvedTheme[]; error: string}> {
  const themes = builtinThemes.map(theme => ({...theme}));
  let error = '';
  try {
    const records = await databaseRequest<StoredTheme[]>('readonly', store => store.getAll());
    for (const record of records.sort((left, right) => right.importedAt - left.importedAt)) {
      try {
        themes.push(resolveArchive(record));
      } catch (reason) {
        // A damaged saved package stays in storage for diagnosis and only loses selection.
        error = reason instanceof Error ? `本地主题无法读取，已暂用默认主题：${reason.message}` : '本地主题无法读取，已暂用默认主题';
      }
    }
  } catch (reason) {
    error = reason instanceof Error ? `无法读取本地主题，已暂用默认主题：${reason.message}` : '无法读取本地主题，已暂用默认主题';
  }
  return {themes, error};
}

async function loadLibrary(): Promise<ThemeLibraryState> {
  const catalog = await readCatalog();
  const activeId = readActiveId();
  const active = catalog.themes.find(theme => theme.id === activeId) ?? defaultTheme();
  return {
    themes: catalog.themes,
    active,
    loading: false,
    error: catalog.error || (catalog.themes.some(theme => theme.id === activeId) ? '' : activeId === DEFAULT_THEME_ID ? '' : '选中的本地主题不可用，已暂用默认主题。'),
  };
}

function installFont(theme: ResolvedTheme) {
  const url = theme.assets?.fontUrl;
  const config = theme.font;
  if (!url || !config || !('fonts' in document)) return () => {};
  const family = `ZenixTheme-${theme.id.replace(/[^a-z0-9-]/gi, '')}`;
  let face: FontFace | undefined;
  try {
    face = new FontFace(family, `url("${url}")`, {weight: String(config.weight)});
    void face.load().then(loaded => {
      document.fonts.add(loaded);
    }).catch(() => {});
  } catch {
    face = undefined;
  }
  return () => {
    if (face) {
      try {
        document.fonts.delete(face);
      } catch {}
    }
  };
}

export function useThemeLibrary() {
  const [state, setState] = useState<ThemeLibraryState>(() => ({
    themes: builtinThemes.map(theme => ({...theme})),
    active: defaultTheme(),
    loading: true,
    error: '',
  }));
  const revision = useRef(0);
  const ownedThemes = useRef<ResolvedTheme[]>([]);
  const cleanups = useRef<Array<() => void>>([]);

  const refresh = useCallback(async () => {
    const token = ++revision.current;
    const next = await loadLibrary();
    if (token !== revision.current) {
      next.themes.forEach(releaseTheme);
      return;
    }
    ownedThemes.current.forEach(releaseTheme);
    cleanups.current.forEach(cleanup => cleanup());
    ownedThemes.current = next.themes.filter(theme => theme.source === 'user');
    cleanups.current = [installFont(next.active)];
    setState(next);
  }, []);

  useEffect(() => {
    void refresh();
    const sync = () => void refresh();
    window.addEventListener(changeEvent, sync);
    window.addEventListener('storage', sync);
    return () => {
      revision.current++;
      window.removeEventListener(changeEvent, sync);
      window.removeEventListener('storage', sync);
      ownedThemes.current.forEach(releaseTheme);
      cleanups.current.forEach(cleanup => cleanup());
    };
  }, [refresh]);

  const select = useCallback(async (id: string) => {
    if (!BUILTIN_THEME_IDS.includes(id)) {
      const saved = await databaseRequest<StoredTheme | undefined>('readonly', store => store.get(id));
      if (!saved) throw Error('主题包已不存在');
    }
    writeActiveId(id);
    await refresh();
    window.dispatchEvent(new Event(changeEvent));
  }, [refresh]);

  const importTheme = useCallback(async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseThemeArchive(bytes, {name: file.name, type: file.type, size: file.size});
    const record: StoredTheme = {
      id: parsed.theme.id,
      bytes: bytes.slice().buffer as ArrayBuffer,
      importedAt: Date.now(),
      name: parsed.theme.name,
      author: parsed.theme.author,
      version: parsed.theme.version,
    };
    await databaseRequest<IDBValidKey>('readwrite', store => store.put(record));
    writeActiveId(record.id);
    await refresh();
    window.dispatchEvent(new Event(changeEvent));
    return parsed.theme as ThemePackage;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    if (BUILTIN_THEME_IDS.includes(id)) throw Error('内置主题不能删除');
    await databaseRequest<undefined>('readwrite', store => store.delete(id));
    if (readActiveId() === id) writeActiveId(DEFAULT_THEME_ID);
    await refresh();
    window.dispatchEvent(new Event(changeEvent));
  }, [refresh]);

  return {
    ...state,
    select,
    importTheme,
    remove,
  };
}

export function useActiveTheme() {
  const library = useThemeLibrary();
  return {
    theme: library.active,
    loading: library.loading,
    error: library.error,
  };
}
