// Dịch vụ: a project is one of its customer's services (Khách → Dịch vụ → Công việc): it is of one service of the
// catalogue (Quản trị › Dịch vụ) and called by that service's name, and a customer's services are those of its projects. A task names its own (task_services), and a board its type (board_services). Services set on a customer itself (customer_needs, from before projects carried them) are
// handed to its projects: to those naming none yet, as soon as it has one; until then they still count as its own.
import { createHash } from 'node:crypto';
import { all, get, run, now, uid } from './db';
import { HttpError } from './http';

type Ref = { id: string; name: string };
const byKey = (rows: any[], key: string) => {
  const out = new Map<string, Ref[]>();
  for (const r of rows) out.set(r[key], [...(out.get(r[key]) || []), { id: r.id, name: r.name }]);
  return out;
};
const among = (col: string, ids?: string[]) => (ids ? ` AND ${col} IN (SELECT value FROM json_each(?))` : '');

/** Each project's services (of these projects, or of all). */
export async function projectServices(ids?: string[]) {
  return byKey(await all<any>(`SELECT ps.project_id, s.id, s.name FROM project_services ps JOIN services s ON s.id = ps.service_id AND s.deleted_at IS NULL
    WHERE 1=1${among('ps.project_id', ids)} ORDER BY s.name COLLATE NOCASE`, ...(ids ? [JSON.stringify(ids)] : [])), 'project_id');
}
/** Each customer's services (of these customers, or of all): those of its projects, and any still set on it. */
export async function customerServices(ids?: string[]) {
  return byKey(await all<any>(`SELECT p.customer_id, s.id, s.name FROM project_services ps JOIN task_projects p ON p.id = ps.project_id JOIN services s ON s.id = ps.service_id AND s.deleted_at IS NULL
    WHERE p.customer_id IS NOT NULL${among('p.customer_id', ids)}
    UNION SELECT n.customer_id, s.id, s.name FROM customer_needs n JOIN services s ON s.id = n.service_id AND s.deleted_at IS NULL WHERE 1=1${among('n.customer_id', ids)}
    ORDER BY name COLLATE NOCASE`, ...(ids ? [JSON.stringify(ids), JSON.stringify(ids)] : [])), 'customer_id');
}

/** Services asked for by id: at most 50, each in the catalogue. */
export async function serviceIds(v: unknown) {
  if (!Array.isArray(v) || v.length > 50 || v.some((x) => typeof x !== 'string')) throw new HttpError(400, 'Danh sách dịch vụ không hợp lệ');
  const ids = [...new Set(v as string[])];
  for (const id of ids) if (!(await get('SELECT 1 FROM services WHERE id = ? AND deleted_at IS NULL', id))) throw new HttpError(400, 'Không tìm thấy dịch vụ trong danh mục');
  return ids;
}
/** The service of a project (a customer's service) or of a board (its kind): none or one, `refused` said otherwise. */
export async function oneService(v: unknown, refused: string) {
  const ids = await serviceIds(v);
  if (ids.length > 1) throw new HttpError(400, refused);
  return ids;
}
/** Makes these the project's services; with one, the project takes its name. */
export async function saveProjectServices(projectId: string, ids: string[], by: string) {
  await run('DELETE FROM project_services WHERE project_id = ? AND service_id NOT IN (SELECT value FROM json_each(?))', projectId, JSON.stringify(ids));
  for (const id of ids) await run('INSERT OR IGNORE INTO project_services(project_id, service_id, added_by, created_at) VALUES(?,?,?,?)', projectId, id, by, now());
  if (ids.length === 1) await nameAfterService(projectId);
}
/** A project is called by its service's name: it, its own board and its cards on boards take it. */
export async function nameAfterService(projectId: string) {
  const s = await get<any>('SELECT s.name FROM project_services ps JOIN services s ON s.id=ps.service_id WHERE ps.project_id=? ORDER BY ps.created_at LIMIT 1', projectId);
  if (!s?.name) return;
  const p = await get<any>('SELECT name FROM task_projects WHERE id=?', projectId);
  if (!p || p.name === s.name) return;
  await run('UPDATE task_projects SET name=? WHERE id=?', s.name, projectId);
  await run("UPDATE board_cards SET title=? WHERE card_kind='project' AND work_project_id=?", s.name, projectId);
  // Its own board (a project of no customer; taskworkspace.ts's projectBoardId), without importing that module here.
  await run('UPDATE boards SET name=? WHERE id=?', s.name, `b_proj_${createHash('sha256').update(projectId).digest('hex').slice(0, 16)}`);
}
/** Every project is a service of its customer (run with the data repairs, so ones made since, by an import say, too):
 *  one of no service takes the service of its name (made in the catalogue when there is none), one of several keeps the
 *  first, and each takes its service's name. */
export async function projectsAsServices() {
  let changed = 0;
  for (const p of await all<any>('SELECT id, name, created_by FROM task_projects WHERE id NOT IN (SELECT project_id FROM project_services)')) {
    const name = String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Dịch vụ';
    let svc = await get<any>('SELECT id FROM services WHERE deleted_at IS NULL AND lower(name)=lower(?) ORDER BY created_at LIMIT 1', name);
    if (!svc) {
      svc = { id: uid('sv_') };
      await run('INSERT INTO services(id, name, status, created_by, updated_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', svc.id, name, 'active', p.created_by, p.created_by, now(), now());
    }
    await saveProjectServices(p.id, [svc.id], p.created_by);
    changed++;
  }
  for (const r of await all<any>('SELECT project_id FROM project_services GROUP BY project_id HAVING COUNT(*) > 1')) {
    await run('DELETE FROM project_services WHERE project_id=? AND service_id <> (SELECT service_id FROM project_services WHERE project_id=? ORDER BY created_at LIMIT 1)', r.project_id, r.project_id);
    changed++;
  }
  for (const r of await all<any>('SELECT DISTINCT project_id FROM project_services')) await nameAfterService(r.project_id);
  return changed;
}

/** Each task's services (of these tasks, or of all). */
export async function taskServices(ids?: string[]) {
  return byKey(await all<any>(`SELECT ts.task_id, s.id, s.name FROM task_services ts JOIN services s ON s.id = ts.service_id AND s.deleted_at IS NULL
    WHERE 1=1${among('ts.task_id', ids)} ORDER BY s.name COLLATE NOCASE`, ...(ids ? [JSON.stringify(ids)] : [])), 'task_id');
}
/** Makes these the task's services. */
export async function saveTaskServices(taskId: string, ids: string[], by: string) {
  await run('DELETE FROM task_services WHERE task_id = ? AND service_id NOT IN (SELECT value FROM json_each(?))', taskId, JSON.stringify(ids));
  for (const id of ids) await run('INSERT OR IGNORE INTO task_services(task_id, service_id, added_by, created_at) VALUES(?,?,?,?)', taskId, id, by, now());
}

/** Each board's services, its type (of these boards, or of all). */
export async function boardServices(ids?: string[]) {
  return byKey(await all<any>(`SELECT bs.board_id, s.id, s.name FROM board_services bs JOIN services s ON s.id = bs.service_id AND s.deleted_at IS NULL
    WHERE 1=1${among('bs.board_id', ids)} ORDER BY s.name COLLATE NOCASE`, ...(ids ? [JSON.stringify(ids)] : [])), 'board_id');
}
/** Makes these the board's services. */
export async function saveBoardServices(boardId: string, ids: string[], by: string) {
  await run('DELETE FROM board_services WHERE board_id = ? AND service_id NOT IN (SELECT value FROM json_each(?))', boardId, JSON.stringify(ids));
  for (const id of ids) await run('INSERT OR IGNORE INTO board_services(board_id, service_id, added_by, created_at) VALUES(?,?,?,?)', boardId, id, by, now());
}

/** Hands the services set on these customers to their projects that name none yet, once they have one (repairData in
 *  db.ts does the same for all customers). */
export async function settleCustomerServices(customerIds: string[]) {
  // The whole SELECT is read before inserting (SQLite does so when it reads the table it fills), so every service lands.
  // One service each (a project is one service): the first the customer was given.
  await run(`INSERT OR IGNORE INTO project_services(project_id, service_id, added_by, created_at) SELECT p.id, n.service_id, n.added_by, n.created_at
    FROM customer_needs n JOIN task_projects p ON p.customer_id = n.customer_id
    WHERE NOT EXISTS(SELECT 1 FROM project_services x WHERE x.project_id = p.id)${among('n.customer_id', customerIds)}
      AND n.created_at = (SELECT MIN(m.created_at) FROM customer_needs m WHERE m.customer_id = n.customer_id)`, JSON.stringify(customerIds));
  for (const p of await all<any>(`SELECT id FROM task_projects WHERE 1=1${among('customer_id', customerIds)}`, JSON.stringify(customerIds))) await nameAfterService(p.id);
  await run(`DELETE FROM customer_needs WHERE customer_id IN (SELECT customer_id FROM task_projects WHERE customer_id IS NOT NULL)${among('customer_id', customerIds)}`, JSON.stringify(customerIds));
}
