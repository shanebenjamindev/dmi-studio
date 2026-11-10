// Khoá tạm website: while it is on only Super Admins get in; for anyone else signing in is refused and the API answers
// 423 with the notice to show. The switch lives in settings (Quản trị › Cấu hình chung, or the pill Super Admins see);
// until someone has used it, SITE_LOCKED=1 in the deploy's vars turns it on, so a deploy alone can lock the site.
import { getSetting, setSetting, now } from './db';
import { HttpError } from './http';

export interface SiteLock { on: boolean; message: string; at: number | null; by: string | null }
export const LOCK_MESSAGE = 'Website đang tạm khoá để bảo trì. Vui lòng quay lại sau.';
const KEY = 'site_lock';
// Asked on every request of everyone but Super Admins: read at most every few seconds per server.
const FRESH = 5000;
let known: { until: number; lock: SiteLock } | null = null;

export async function siteLock(): Promise<SiteLock> {
  if (known && known.until > Date.now()) return known.lock;
  const s = await getSetting<Partial<SiteLock> | null>(KEY, null);
  const lock: SiteLock = s
    ? { on: !!s.on, message: s.message || LOCK_MESSAGE, at: s.at ?? null, by: s.by ?? null }
    : { on: process.env.SITE_LOCKED === '1', message: LOCK_MESSAGE, at: null, by: null };
  known = { until: Date.now() + FRESH, lock };
  return lock;
}
export async function setSiteLock(on: boolean, message: string, by: string) {
  const lock: SiteLock = { on, message: message || LOCK_MESSAGE, at: now(), by };
  await setSetting(KEY, lock);
  known = null;
  return lock;
}
/** Refuses everyone but a Super Admin while the site is locked. */
export async function assertSiteOpen(u: { role: string }) {
  if (u.role === 'admin') return;
  const lock = await siteLock();
  if (lock.on) throw new HttpError(423, lock.message);
}
