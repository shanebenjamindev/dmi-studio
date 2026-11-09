// Dịch vụ: each project names the services of the catalogue (Quản trị › Dịch vụ) it is for, and a customer's services
// are those of its projects. Services set on a customer itself (customer_needs, from before projects carried them) are
// handed to its projects: to those naming none yet, as soon as it has one; until then they still count as its own.
import { all, get, run, now } from './db';
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
/** Makes these the project's services. */
export async function saveProjectServices(projectId: string, ids: string[], by: string) {
  await run('DELETE FROM project_services WHERE project_id = ? AND service_id NOT IN (SELECT value FROM json_each(?))', projectId, JSON.stringify(ids));
  for (const id of ids) await run('INSERT OR IGNORE INTO project_services(project_id, service_id, added_by, created_at) VALUES(?,?,?,?)', projectId, id, by, now());
}

/** Hands the services set on these customers to their projects that name none yet, once they have one (repairData in
 *  db.ts does the same for all customers). */
export async function settleCustomerServices(customerIds: string[]) {
  // The whole SELECT is read before inserting (SQLite does so when it reads the table it fills), so every service lands.
  await run(`INSERT OR IGNORE INTO project_services(project_id, service_id, added_by, created_at) SELECT p.id, n.service_id, n.added_by, n.created_at
    FROM customer_needs n JOIN task_projects p ON p.customer_id = n.customer_id
    WHERE NOT EXISTS(SELECT 1 FROM project_services x WHERE x.project_id = p.id)${among('n.customer_id', customerIds)}`, JSON.stringify(customerIds));
  await run(`DELETE FROM customer_needs WHERE customer_id IN (SELECT customer_id FROM task_projects WHERE customer_id IS NOT NULL)${among('customer_id', customerIds)}`, JSON.stringify(customerIds));
}
