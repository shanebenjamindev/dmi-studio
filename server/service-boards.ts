// Khách hàng → workspace → board → công việc. A customer has workspaces; every board in them is one of the customer's
// services (a task project: customer × service, boards.project_id), and each customer × service has exactly one board.
// The fields follow each other: a board's customer is its project's (and its workspace's), its service is the
// project's, and the tasks of the project are cards on it. Each person's own boards for tasks of no service
// (b_tasks_*, taskworkspace.ts) are the one kind of board outside this.
import { createHash } from 'node:crypto';
import { all, get, getSetting, setSetting, run, uid, now } from './db';
import { HttpError } from './http';
import { FLOW_COLUMNS, listColor } from './flow-columns';
import { saveBoardServices } from './project-services';
import { syncBoardGrants, syncBoardPeople } from './board-people';

/** A board made for its owner's tasks of no service: outside customers and services. */
export const personalBoard = (boardId: string) => boardId.startsWith('b_tasks_');
const hash = (s: string, n: number) => createHash('sha256').update(s).digest('hex').slice(0, n);
const listId = (board: string, status: string) => `l_task_${hash(`${board}|${status}`, 24)}`;

/** The one service of a project (task_projects carry one, server/project-services.ts). */
export const serviceOf = async (projectId: string) =>
  (await get<{ id: string; name: string }>('SELECT s.id, s.name FROM project_services ps JOIN services s ON s.id = ps.service_id WHERE ps.project_id = ? ORDER BY ps.created_at LIMIT 1', projectId)) || null;
/** The project of a customer's service, if the customer has it. */
export const projectOf = async (customerId: string, serviceId: string) =>
  (await get<any>('SELECT p.* FROM task_projects p JOIN project_services ps ON ps.project_id = p.id WHERE p.customer_id = ? AND ps.service_id = ? ORDER BY p.created_at, p.id LIMIT 1', customerId, serviceId)) || null;
/** The board of a project, if it has one yet. */
export const boardOfProject = async (projectId: string) => (await get<any>('SELECT * FROM boards WHERE project_id = ?', projectId)) || null;

/** The workspace a customer's new service board goes to: the customer's first, else one made for it, named after it and
 *  kept by whoever keeps the customer. */
export async function customerWorkspace(customerId: string) {
  const w = await get<any>('SELECT * FROM workspaces WHERE customer_id = ? ORDER BY created_at, id LIMIT 1', customerId);
  if (w) return w;
  const k = await get<any>('SELECT id, name, created_by, manager_id FROM customers WHERE id = ?', customerId);
  if (!k) throw new HttpError(404, 'Không tìm thấy khách hàng');
  const owner = k.manager_id || k.created_by || (await get<any>("SELECT id FROM users WHERE role = 'admin' AND disabled = 0 ORDER BY created_at, id LIMIT 1"))?.id;
  const id = `w_cust_${hash(k.id, 16)}`, t = now();
  await run("INSERT OR IGNORE INTO workspaces(id, name, about, owner_id, visibility, created_at, updated_at, customer_id) VALUES(?,?,?,?,'private',?,?,?)", id, k.name, '', owner, t, t, k.id);
  return get<any>('SELECT * FROM workspaces WHERE id = ?', id);
}

/** Make the board the project's: its customer and service are the project's from now on. */
export async function linkBoard(boardId: string, projectId: string, by: string | null) {
  const p = await get<any>('SELECT * FROM task_projects WHERE id = ?', projectId), svc = await serviceOf(projectId);
  await run('UPDATE boards SET project_id = ?, customer_id = ?, updated_at = ? WHERE id = ?', projectId, p?.customer_id || null, now(), boardId);
  await saveBoardServices(boardId, svc ? [svc.id] : [], by || p?.created_by || '');
}

/** The board of a customer's service: its own, or made the first time in the customer's workspace with the workflow's
 *  columns, named after the service. A project of no customer has none (its tasks stay on their makers' boards). */
export async function serviceBoard(projectId: string) {
  const found = await boardOfProject(projectId);
  if (found) return found;
  const p = await get<any>('SELECT * FROM task_projects WHERE id = ?', projectId);
  if (!p?.customer_id) return null;
  const ws = await customerWorkspace(p.customer_id), svc = await serviceOf(p.id);
  const id = `b_svc_${hash(p.id, 16)}`, t = now();
  const pos = ((await get<any>('SELECT MAX(pos) n FROM boards'))?.n || 0) + 1;
  const made = await run('INSERT OR IGNORE INTO boards(id, name, bg, created_by, pos, created_at, updated_at, private, customer_id, workspace_id, project_id, start_at) VALUES(?,?,?,?,?,?,?,1,?,?,?,?)',
    id, svc?.name || p.name, 'ocean', p.created_by || ws.owner_id, pos, t, t, p.customer_id, ws.id, p.id, t);
  if (made.changes) for (const [i, l] of FLOW_COLUMNS.entries()) await run('INSERT OR IGNORE INTO board_lists(id, board_id, name, pos, created_at, color) VALUES(?,?,?,?,?,?)', listId(id, l), id, l, i + 1, t, listColor(l));
  await linkBoard(id, p.id, p.created_by);
  await syncBoardPeople(id);
  await syncBoardGrants(id);
  return get<any>('SELECT * FROM boards WHERE id = ?', id);
}

/** A project's service changed (from the board or the project): its board's service follows, and the board's name too if
 *  it was the old service's. Never to a service the customer already has under another project. */
export async function checkServiceFree(projectId: string, serviceId: string) {
  const p = await get<any>('SELECT * FROM task_projects WHERE id = ?', projectId);
  if (!p?.customer_id) return;
  const other = await projectOf(p.customer_id, serviceId);
  if (other && other.id !== projectId) {
    const b = await boardOfProject(other.id);
    throw new HttpError(409, `Khách hàng này đã có dịch vụ ${(await get<any>('SELECT name FROM services WHERE id = ?', serviceId))?.name || ''}${b ? ` (board “${b.name}”)` : ''}: mỗi dịch vụ của một khách chỉ có một board`);
  }
}
export async function projectServiceChanged(projectId: string, oldName: string | null, by: string) {
  const b = await boardOfProject(projectId), svc = await serviceOf(projectId);
  if (!b || !svc) return;
  await saveBoardServices(b.id, [svc.id], by);
  if (oldName && b.name === oldName) await run('UPDATE boards SET name = ? WHERE id = ?', svc.name, b.id);
  const p = await get<any>('SELECT name FROM task_projects WHERE id = ?', projectId);
  if (oldName && p?.name === oldName) await run('UPDATE task_projects SET name = ? WHERE id = ?', svc.name, projectId);
}

/** A project's customer changed: its board goes with it, to the new customer's workspace. */
export async function moveProjectBoard(projectId: string) {
  const p = await get<any>('SELECT * FROM task_projects WHERE id = ?', projectId), b = await boardOfProject(projectId);
  if (!p || !b || !p.customer_id) return;
  const ws = b.workspace_id ? await get<any>('SELECT customer_id FROM workspaces WHERE id = ?', b.workspace_id) : null;
  const target = ws?.customer_id === p.customer_id ? b.workspace_id : (await customerWorkspace(p.customer_id)).id;
  await run('UPDATE boards SET customer_id = ?, workspace_id = ?, updated_at = ? WHERE id = ?', p.customer_id, target, now(), b.id);
  await syncBoardPeople(b.id);
  await syncBoardGrants(b.id);
  if (b.workspace_id && b.workspace_id !== target) await syncWorkspacePeople(b.workspace_id);
}

export const WS_AUTO = 'project';
/** Whoever a customer's service board took in (its project's people) sees the board's workspace too, to find the board
 *  there, and stops when no board of the workspace holds them. People added to the workspace by hand stay as they are. */
export async function syncWorkspacePeople(workspaceId: string) {
  const w = await get<any>('SELECT id, owner_id FROM workspaces WHERE id = ?', workspaceId);
  if (!w) return;
  const want = new Set((await all<any>("SELECT DISTINCT m.user_id FROM board_members m JOIN boards b ON b.id = m.board_id WHERE b.workspace_id = ? AND m.added_by = 'project'", w.id)).map((r) => r.user_id as string));
  for (const r of await all<any>('SELECT DISTINCT created_by user_id FROM boards WHERE workspace_id = ? AND created_by IS NOT NULL', w.id)) want.add(r.user_id);
  want.delete(w.owner_id);
  const have = new Map((await all<any>('SELECT user_id, added_by FROM workspace_members WHERE workspace_id = ?', w.id)).map((r) => [r.user_id as string, r.added_by as string | null]));
  for (const user of want) if (!have.has(user)) await run("INSERT INTO workspace_members(workspace_id, user_id, role, added_by, created_at) VALUES(?,?,'observer',?,?)", w.id, user, WS_AUTO, now());
  for (const [user, by] of have) if (by === WS_AUTO && !want.has(user)) await run('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?', w.id, user);
}

/** Every task of the project is a card on its board: one elsewhere moves there (in the column of its step), with its
 *  customer the project's; the labels of its old board stay behind. */
export async function gatherProjectCards(projectId: string) {
  const b = await boardOfProject(projectId);
  if (!b) return 0;
  const p = await get<any>('SELECT customer_id FROM task_projects WHERE id = ?', projectId);
  const cards = await all<any>(`SELECT c.*, t.status, t.stage, t.done_at task_done FROM task_board_links l JOIN board_cards c ON c.id = l.card_id JOIN tasks t ON t.id = l.task_id
    WHERE t.project_id = ? AND c.board_id <> ?`, projectId, b.id);
  if (!cards.length) return 0;
  const lists = await all<any>('SELECT * FROM board_lists WHERE board_id = ? AND archived = 0 ORDER BY pos', b.id);
  const { columnFor } = await import('./tasklinks'), { columnStage } = await import('./flow-columns');
  const from = new Set<string>();
  for (const c of cards) {
    const list = columnFor(lists, c.status || '') || lists.find((l) => c.stage && columnStage(l.name) === c.stage) || lists[0];
    if (!list) continue;
    const pos = ((await get<any>('SELECT MAX(pos) n FROM board_cards WHERE list_id = ?', list.id))?.n || 0) + 1;
    await run('UPDATE board_cards SET board_id = ?, list_id = ?, pos = ?, project_card_id = NULL, customer_id = ?, updated_at = ? WHERE id = ?', b.id, list.id, pos, p?.customer_id || null, now(), c.id);
    await run('DELETE FROM card_labels WHERE card_id = ?', c.id);
    await run('UPDATE board_activity SET board_id = ? WHERE card_id = ?', b.id, c.id);
    from.add(c.board_id);
  }
  for (const id of from) { await syncBoardPeople(id); await syncBoardGrants(id); }
  await syncBoardPeople(b.id); await syncBoardGrants(b.id);
  return cards.length;
}

/** Once, the boards there were before: (1) a workspace of no customer whose boards are all for one customer is that
 *  customer's; (2) a board of one service, for a customer, is that customer × service's board (the project made if the
 *  customer did not have the service yet); (3) every project of a customer gets its board, in the customer's workspace
 *  (one made if it had none), and the tasks of each project move onto its board; the project cards that stood for the
 *  projects on the old customer boards are archived. What cannot be told (a board of no service, a workspace of no
 *  customer) is left for its people to choose, on the board itself. */
export async function migrateServiceBoards() {
  if (await getSetting('service_boards_v1', false)) return;
  for (const w of await all<any>('SELECT id FROM workspaces WHERE customer_id IS NULL')) {
    const ks = await all<any>('SELECT DISTINCT customer_id FROM boards WHERE workspace_id = ?', w.id);
    if (ks.length === 1 && ks[0].customer_id) await run('UPDATE workspaces SET customer_id = ? WHERE id = ?', ks[0].customer_id, w.id);
  }
  const touched = new Set<string>();
  for (const b of await all<any>("SELECT b.*, w.customer_id ws_customer FROM boards b LEFT JOIN workspaces w ON w.id = b.workspace_id WHERE b.project_id IS NULL AND b.id NOT LIKE 'b_tasks_%' ORDER BY b.created_at")) {
    const svcs = await all<any>('SELECT bs.service_id FROM board_services bs JOIN services s ON s.id = bs.service_id AND s.deleted_at IS NULL WHERE bs.board_id = ?', b.id);
    const customer = b.ws_customer || b.customer_id;
    if (svcs.length !== 1 || !customer || (b.ws_customer && b.customer_id && b.ws_customer !== b.customer_id)) continue;
    let p = await projectOf(customer, svcs[0].service_id);
    if (!p) {
      const svc = await get<any>('SELECT name FROM services WHERE id = ?', svcs[0].service_id), id = uid('tj_');
      await run('INSERT INTO task_projects(id, name, customer_id, created_by, created_at) VALUES(?,?,?,?,?)', id, svc.name, customer, b.created_by, now());
      await run('INSERT OR IGNORE INTO project_services(project_id, service_id, added_by, created_at) VALUES(?,?,?,?)', id, svcs[0].service_id, b.created_by, now());
      p = { id };
    }
    if (await boardOfProject(p.id)) continue;
    await linkBoard(b.id, p.id, b.created_by);
    touched.add(b.id);
  }
  for (const p of await all<any>('SELECT id FROM task_projects WHERE customer_id IS NOT NULL ORDER BY created_at')) {
    if (!await serviceOf(p.id)) continue;
    const b = await serviceBoard(p.id);
    if (!b) continue;
    touched.add(b.id);
    await gatherProjectCards(p.id);
    await run("UPDATE board_cards SET archived = 1, updated_at = ? WHERE card_kind = 'project' AND work_project_id = ? AND archived = 0", now(), p.id);
  }
  for (const id of touched) { await syncBoardPeople(id); await syncBoardGrants(id); }
  for (const w of await all<any>('SELECT id FROM workspaces')) await syncWorkspacePeople(w.id);
  await setSetting('service_boards_v1', true);
}
