// @ts-ignore Universal format module also required by the desktop runtime.
import * as imported from './backupFormat.cjs';
type Format = { canonical(value: unknown): string; cleanProfile(value: unknown): Record<string, unknown>; PROFILE_FIELDS: string[] };
const direct = imported as unknown as Format;
const api = ((imported as { default?: Format }).default || (typeof direct.cleanProfile === 'function' ? direct : undefined) || (globalThis as typeof globalThis & { zenixBackupFormat: Format }).zenixBackupFormat);
export const { canonical, cleanProfile, PROFILE_FIELDS } = api;
