// What changed, for the pages to stay fresh with one small request instead of a poll per panel (web/src/live.ts): every
// change that succeeds stamps its area here (handleApi, server/app.ts), and GET /api/live answers the stamps with the
// person's notification count. A page reloads only the area whose stamp moved.
import { all, get, run, now } from './db';
import { json, type Router } from './http';
import { currentUser } from './auth';

/** The area each changing path belongs to; a quick note is its writer's own (`notes:<user>`). */
const AREAS: [RegExp, (userId: string) => string][] = [
  [/^\/api\/chat(\/|$)/, () => 'chat'],
  [/^\/api\/(cards|lists|boards|tasks|task-projects|customers|planner)(\/|$)/, () => 'work'],
  [/^\/api\/quick-notes(\/|$)/, (u) => `notes:${u}`],
];

export async function stampChange(method: string, path: string, userId: string | undefined) {
  if (method === 'GET' || method === 'HEAD' || !userId) return;
  const area = AREAS.find(([r]) => r.test(path))?.[1](userId);
  if (area) await run('INSERT INTO live_changes(topic, at) VALUES(?, ?) ON CONFLICT(topic) DO UPDATE SET at = excluded.at', area, now());
}

export function registerLive(api: Router) {
  api.get('/api/live', async (req, res) => {
    const user = (await currentUser(req))!, at = now();
    // Being on the page keeps the person online in Tin nhắn (shown for 3 minutes after); written at most once a minute.
    await run('UPDATE users SET updated_at = ? WHERE id = ? AND COALESCE(updated_at, 0) < ?', at, user.id, at - 60e3).catch(() => {});
    const rows = await all<{ topic: string; at: number }>('SELECT topic, at FROM live_changes WHERE topic IN (?, ?, ?)', 'chat', 'work', `notes:${user.id}`);
    const n = await get<any>('SELECT MAX(created_at) n, SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) u FROM notifications WHERE user_id = ?', user.id);
    const stamp = (t: string) => Number(rows.find((r) => r.topic === t)?.at) || 0;
    json(res, 200, { chat: stamp('chat'), work: stamp('work'), notes: stamp(`notes:${user.id}`), notifications: `${Number(n?.n) || 0}:${Number(n?.u) || 0}` });
  });
}
