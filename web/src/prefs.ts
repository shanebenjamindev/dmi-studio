// Interface choices that belong to the account rather than the browser (theme, language, board layout). They stay in
// this browser for the first paint, are saved to the account as they change, and come back from it at sign-in.
import { api } from './api';
import { ACCOUNT_PREFS } from '../../shared/account-prefs';

const OWNER = 'dms.account';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } };
let pending: Record<string, string | null> = {}, timer = 0;

/** Keep a changed choice with the account too (a moment later, so quick toggles go as one). */
export function remember(key: string, value: string | null) {
  if (!ACCOUNT_PREFS.includes(key)) return;
  pending[key] = value;
  clearTimeout(timer);
  timer = window.setTimeout(() => void flushPrefs(), 500);
}
export async function flushPrefs() {
  clearTimeout(timer);
  const body = pending;
  pending = {};
  if (Object.keys(body).length) await api.savePrefs(body).catch(() => {});
}

/** At sign-in: what another account left in this browser is dropped, then the account's own choices are put in place.
 *  The first time an account has none saved, what this browser has becomes its own. */
export function adoptPrefs(userId: string, saved: Record<string, string> | null | undefined) {
  const owner = read(OWNER);
  if (owner && owner !== userId) {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith('dms.')) localStorage.removeItem(k); } catch { /* private mode */ }
  }
  if (saved) for (const k of ACCOUNT_PREFS) write(k, saved[k] ?? null);
  else if (!owner || owner === userId) {
    const mine = Object.fromEntries(ACCOUNT_PREFS.map((k) => [k, read(k)]).filter(([, v]) => v !== null));
    if (Object.keys(mine).length) void api.savePrefs(mine).catch(() => {});
  }
  write(OWNER, userId);
}
