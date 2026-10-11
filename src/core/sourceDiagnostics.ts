// @ts-ignore Universal module also required by the desktop runtime.
import * as imported from './sourceDiagnostics.cjs';
type Diagnostics = { redact(value: unknown): string };
const direct = imported as unknown as Diagnostics;
const api = ((imported as { default?: Diagnostics }).default || (typeof direct.redact === 'function' ? direct : undefined) || (globalThis as typeof globalThis & { zenixSourceDiagnostics: Diagnostics }).zenixSourceDiagnostics);
export const { redact } = api;
