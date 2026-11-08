// Who is on a board besides its owner, and what being on it opens.
// - Shared by hand, at a level, like Google Drive (Người xem, Người nhận xét, Người chỉnh sửa, Quản lý): they see all
//   of it, so its customer and every project on it are opened to them (view for viewers and commenters, edit
//   otherwise). What a board opened (`via_board`) closes again when they leave it or the project leaves it, unless
//   another board shared with them holds it or they have tasks in it.
// - Put there by a project (board_members.added_by 'project'): the people of the projects whose card is on the board
//   (their members, makers and the people its tasks are given to) edit it, its viewers comment. They see only the
//   cards of their own projects; a customer's manager manages the customer's own board.
import { createHash } from 'node:crypto';
import { all, get, run, now } from './db';

export const AUTO = 'project';
type BoardLevel = 'viewer' | 'observer' | 'normal' | 'admin';
const RANK: Record<string, number> = { viewer: 1, observer: 2, normal: 3, admin: 4 };
/** The board every customer has, for its projects made outside a board. */
export const customerBoardId = (customerId: string) => `b_cust_${createHash('sha256').update(customerId).digest('hex').slice(0, 16)}`;

/** The projects on a board: of its project cards and of the tasks on its cards. */
async function boardProjects(boardId: string) {
  return all<any>(`SELECT id, customer_id, created_by FROM task_projects WHERE id IN (
    SELECT work_project_id FROM board_cards WHERE board_id = ? AND card_kind = 'project'
    UNION SELECT t.project_id FROM board_cards c JOIN task_board_links l ON l.card_id = c.id JOIN tasks t ON t.id = l.task_id WHERE c.board_id = ?)`, boardId, boardId);
}

/** The people of the projects whose card is on the board join it, and leave it when they leave those projects. */
export async function syncBoardPeople(boardId: string) {
  const b = await get<any>('SELECT id, created_by, customer_id FROM boards WHERE id = ?', boardId);
  if (!b) return;
  const projects = JSON.stringify((await all<any>("SELECT DISTINCT work_project_id id FROM board_cards WHERE board_id = ? AND card_kind = 'project' AND work_project_id IS NOT NULL", b.id)).map((r) => r.id));
  const want = new Map<string, BoardLevel>();
  const put = (user: string | null, level: BoardLevel) => { if (user && (RANK[want.get(user) || ''] || 0) < RANK[level]) want.set(user, level); };
  // Members a shared board opened the project to are on that board, not this one.
  for (const m of await all<any>('SELECT user_id, role FROM task_project_members WHERE via_board IS NULL AND project_id IN (SELECT value FROM json_each(?))', projects)) put(m.user_id, m.role === 'observer' ? 'observer' : 'normal');
  for (const p of await all<any>('SELECT created_by FROM task_projects WHERE id IN (SELECT value FROM json_each(?))', projects)) put(p.created_by, 'normal');
  for (const r of await all<any>('SELECT DISTINCT tp.user_id FROM tasks t JOIN task_assignees a ON a.task_id = t.id JOIN task_people tp ON tp.id = a.person_id WHERE t.project_id IN (SELECT value FROM json_each(?))', projects)) put(r.user_id, 'normal');
  if (b.customer_id && b.id === customerBoardId(b.customer_id)) put((await get<any>('SELECT manager_id FROM customers WHERE id = ?', b.customer_id))?.manager_id || null, 'admin');
  const active = new Set((await all<any>('SELECT id FROM users WHERE disabled = 0 AND id IN (SELECT value FROM json_each(?))', JSON.stringify([...want.keys()]))).map((r) => r.id));
  want.delete(b.created_by);
  const have = new Map((await all<any>('SELECT user_id, role, added_by FROM board_members WHERE board_id = ?', b.id)).map((r) => [r.user_id, r]));
  for (const [user, level] of want) {
    if (!active.has(user)) continue;
    const row = have.get(user);
    if (!row) await run('INSERT INTO board_members(board_id, user_id, role, added_by, created_at) VALUES(?,?,?,?,?)', b.id, user, level, AUTO, now());
    else if (row.added_by === AUTO && row.role !== level) await run('UPDATE board_members SET role = ? WHERE board_id = ? AND user_id = ?', level, b.id, user);
  }
  for (const [user, row] of have) if (row.added_by === AUTO && (!want.has(user) || !active.has(user))) {
    await run('DELETE FROM board_members WHERE board_id = ? AND user_id = ?', b.id, user);
    await run('DELETE FROM card_members WHERE user_id = ? AND card_id IN (SELECT id FROM board_cards WHERE board_id = ?)', user, b.id);
  }
}

/** Open a customer or project to someone the board is shared with: added for the board, never lowered if they had it
 *  another way (a board's own grant follows its level). */
async function open(table: 'customer_members' | 'task_project_members', key: string, id: string, user: string, level: 'normal' | 'observer', boardId: string, by: string | null) {
  const row = await get<any>(`SELECT role, via_board FROM ${table} WHERE ${key} = ? AND user_id = ?`, id, user);
  if (!row) {
    if (table === 'customer_members') await run('INSERT INTO customer_members(customer_id, user_id, role, added_by, created_at, via_board) VALUES(?,?,?,?,?,?)', id, user, level, by, now(), boardId);
    else await run('INSERT INTO task_project_members(project_id, user_id, role, follows, via_board) VALUES(?,?,?,0,?)', id, user, level, boardId);
  } else if (row.via_board === boardId) {
    if (row.role !== level) await run(`UPDATE ${table} SET role = ? WHERE ${key} = ? AND user_id = ?`, level, id, user);
  } else if (RANK[row.role] < RANK[level]) {
    // Raised by this board: it is this board's to keep from now on.
    await run(`UPDATE ${table} SET role = ?, via_board = CASE WHEN via_board IS NULL THEN NULL ELSE ? END WHERE ${key} = ? AND user_id = ?`, level, boardId, id, user);
  }
}
const SHARED = "COALESCE(m.added_by, '') <> 'project'";
/** Another board shared with `user` holding the project. */
const otherProjectBoard = async (project: string, user: string, boardId: string) => (await get<any>(`SELECT m.board_id FROM board_members m WHERE m.user_id = ? AND m.board_id <> ? AND ${SHARED} AND (
  EXISTS (SELECT 1 FROM board_cards c WHERE c.board_id = m.board_id AND c.card_kind = 'project' AND c.work_project_id = ?)
  OR EXISTS (SELECT 1 FROM board_cards c JOIN task_board_links l ON l.card_id = c.id JOIN tasks t ON t.id = l.task_id WHERE c.board_id = m.board_id AND t.project_id = ?)) LIMIT 1`, user, boardId, project, project))?.board_id || null;
/** Another board shared with `user` of the customer or holding one of its projects. */
const otherCustomerBoard = async (customer: string, user: string, boardId: string) => (await get<any>(`SELECT m.board_id FROM board_members m JOIN boards b ON b.id = m.board_id WHERE m.user_id = ? AND m.board_id <> ? AND ${SHARED} AND (
  b.customer_id = ? OR EXISTS (SELECT 1 FROM board_cards c JOIN task_projects p ON p.id = c.work_project_id WHERE c.board_id = m.board_id AND p.customer_id = ?)) LIMIT 1`, user, boardId, customer, customer))?.board_id || null;

/** What sharing the board opens: its customer and its projects to everyone it is shared with, at their level; what it
 *  opened before and no longer should is closed (see the top of the file). */
export async function syncBoardGrants(boardId: string) {
  const b = await get<any>('SELECT id, customer_id, created_by FROM boards WHERE id = ?', boardId);
  const projects = b ? await boardProjects(b.id) : [];
  const shared = b ? await all<any>(`SELECT m.user_id, m.role, m.added_by FROM board_members m JOIN users u ON u.id = m.user_id WHERE m.board_id = ? AND u.disabled = 0 AND ${SHARED}`, b.id) : [];
  const customers = new Set<string>([b?.customer_id, ...projects.map((p) => p.customer_id)].filter(Boolean));
  const want = new Map<string, 'normal' | 'observer'>(shared.map((m) => [m.user_id, RANK[m.role] >= RANK.normal ? 'normal' : 'observer']));
  // A customer's maker and manager have it already.
  const owners = new Map((await all<any>('SELECT id, created_by, manager_id FROM customers WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify([...customers]))).map((k) => [k.id, [k.created_by, k.manager_id]]));
  for (const m of shared) {
    const level = want.get(m.user_id)!;
    for (const c of customers) if (!owners.get(c)?.includes(m.user_id)) await open('customer_members', 'customer_id', c, m.user_id, level, boardId, m.added_by);
    for (const p of projects) if (p.created_by !== m.user_id) await open('task_project_members', 'project_id', p.id, m.user_id, level, boardId, m.added_by);
  }
  const ids = new Set(projects.map((p) => p.id));
  for (const r of await all<any>('SELECT project_id id, user_id FROM task_project_members WHERE via_board = ?', boardId)) {
    if (want.has(r.user_id) && ids.has(r.id)) continue;
    const other = await otherProjectBoard(r.id, r.user_id, boardId);
    const works = await get('SELECT 1 FROM tasks t JOIN task_assignees a ON a.task_id = t.id JOIN task_people tp ON tp.id = a.person_id WHERE t.project_id = ? AND tp.user_id = ? LIMIT 1', r.id, r.user_id);
    if (other || works) await run('UPDATE task_project_members SET via_board = ? WHERE project_id = ? AND user_id = ?', other, r.id, r.user_id);
    else await run('DELETE FROM task_project_members WHERE project_id = ? AND user_id = ?', r.id, r.user_id);
  }
  for (const r of await all<any>('SELECT customer_id id, user_id FROM customer_members WHERE via_board = ?', boardId)) {
    if (want.has(r.user_id) && customers.has(r.id)) continue;
    const other = await otherCustomerBoard(r.id, r.user_id, boardId);
    // Still in one of the customer's projects: they keep seeing the customer.
    const inProject = await get('SELECT 1 FROM task_project_members pm JOIN task_projects p ON p.id = pm.project_id WHERE pm.user_id = ? AND p.customer_id = ? LIMIT 1', r.user_id, r.id);
    if (other || inProject) await run('UPDATE customer_members SET via_board = ? WHERE customer_id = ? AND user_id = ?', other, r.id, r.user_id);
    else await run('DELETE FROM customer_members WHERE customer_id = ? AND user_id = ?', r.id, r.user_id);
  }
}

/** Both, for every board holding the project (its people or tasks changed). */
export async function syncProjectBoards(projectId: string) {
  for (const r of await all<any>("SELECT DISTINCT board_id FROM board_cards WHERE card_kind = 'project' AND work_project_id = ?", projectId)) {
    await syncBoardPeople(r.board_id);
    await syncBoardGrants(r.board_id);
  }
}
