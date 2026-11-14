// Who does a task (as in Base Wework): one person at a time. Giving it to someone (from the task, its card on a board,
// or a sheet import) hands it over: whoever did it before follows it from then on, and the new person, now doing it,
// no longer needs to follow it.
import { all, get, run } from './db';

/** The one person (task_people id) doing the task from now on; null takes it from whoever had it. */
export async function handOver(taskId: string, personId: string | null) {
  const before = await all<any>('SELECT a.person_id, p.user_id FROM task_assignees a JOIN task_people p ON p.id = a.person_id WHERE a.task_id = ?', taskId);
  const doer = personId ? (await get<any>('SELECT user_id FROM task_people WHERE id = ?', personId))?.user_id || null : null;
  await run('DELETE FROM task_assignees WHERE task_id = ?', taskId);
  if (personId) await run('INSERT INTO task_assignees(task_id, person_id) VALUES(?,?)', taskId, personId);
  if (!personId) return;
  for (const b of before) {
    if (b.person_id !== personId && b.user_id && b.user_id !== doer) await run('INSERT OR IGNORE INTO task_followers(task_id, user_id) VALUES(?,?)', taskId, b.user_id);
  }
  if (doer) await run('DELETE FROM task_followers WHERE task_id = ? AND user_id = ?', taskId, doer);
}

/** Of the people a change names, the one who does the task: the last newly added, else the last named. */
export function lastAdded(named: string[], before: string[]) {
  const fresh = named.filter((p) => !before.includes(p));
  return (fresh.length ? fresh : named).at(-1) ?? null;
}
