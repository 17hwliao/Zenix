type Preferences = { automatic: boolean; autoDownload: boolean; channel: string };
type State = { status: string; channel?: string };
type Dependencies = {
  now: () => number;
  allowed: () => boolean;
  busy: () => boolean;
  preferences: () => Preferences;
  lastCheck: (channel: string) => number;
  check: (channel: string) => Promise<State>;
  download: () => Promise<unknown>;
  state: () => Promise<State>;
  canDownload: () => boolean;
  setTimer: (callback: () => void, delay: number) => number;
  clearTimer: (timer: number) => void;
};
const INTERVAL = 12 * 60 * 60 * 1000, RETRY = 15 * 60 * 1000;
/** One due-time timer, suspended in the background/offline; no periodic polling. */
export function automaticUpdateScheduler(deps: Dependencies) {
  let stopped = false, active = false, timer: number | undefined;
  const attempts = new Map<string, number>();
  const clear = () => { if (timer !== undefined) deps.clearTimer(timer); timer = undefined; };
  const schedule = (delay: number) => { clear(); if (!stopped && deps.allowed() && deps.preferences().automatic) timer = deps.setTimer(() => { timer = undefined; void run(); }, Math.max(1000, delay)); };
  async function run() {
    clear();
    const prefs = deps.preferences();
    if (stopped || active || !prefs.automatic || !deps.allowed()) return;
    if (deps.busy()) { schedule(15000); return; }
    const now = deps.now(), stored = deps.lastCheck(prefs.channel);
    const last = Number.isFinite(stored) && stored > 0 && stored <= now ? stored : 0;
    const attempted = attempts.get(prefs.channel);
    const retryIn = attempted === undefined || now < attempted ? 0 : RETRY - (now - attempted);
    const dueIn = last ? INTERVAL - (now - last) : 0;
    if (dueIn > 0 || retryIn > 0) { schedule(Math.max(dueIn, retryIn)); return; }
    active = true; attempts.set(prefs.channel, now);
    try {
      const state = await deps.check(prefs.channel);
      const current = deps.preferences();
      if (!stopped && current.automatic && current.autoDownload && current.channel === prefs.channel && state.status === 'available' && deps.canDownload()) await deps.download();
    } catch { /* Native state/manual UI reports the failure. Retry is bounded. */ }
    finally {
      active = false;
      const checked = deps.lastCheck(deps.preferences().channel), at = deps.now();
      schedule(checked > 0 && checked <= at ? Math.max(RETRY, INTERVAL - (at - checked)) : RETRY);
    }
  }
  async function preferencesChanged() {
    if (stopped) return;
    clear();
    const prefs = deps.preferences();
    if (!prefs.automatic || !deps.allowed()) return;
    if (!active && !deps.busy() && prefs.autoDownload && deps.canDownload()) {
      active = true;
      try { const state = await deps.state(); const current = deps.preferences(); if (!stopped && current.automatic && current.autoDownload && current.channel === prefs.channel && state.channel === prefs.channel && state.status === 'available') await deps.download(); }
      catch { /* A fresh check remains available. */ }
      finally { active = false; }
    }
    await run();
  }
  schedule(15000);
  return { wake: () => { void run(); }, preferencesChanged: () => { void preferencesChanged(); }, stop: () => { stopped = true; clear(); } };
}
