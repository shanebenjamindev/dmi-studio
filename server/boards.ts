import {grantAccess,requireProject} from './project-access';
import {customerLevels,customerAccessSql,requireCustomer,visibleCardIds} from './customer-access';
// Workspace: boards of lists of cards, working like Trello: cards have labels, members, start and due dates, a "done"
// mark, a cover colour, a description, checklists, link attachments, comments and an activity history; cards and lists
// can be archived and restored. Each company role (Media Execute, Account / Sale, Content / Script, Ads / Performance,
// or one an admin adds) has its own board with columns made for its work, besides the boards everyone shares; a role
// also sets which tool pages its people open (Media Execute: Drive and Trình dựng).
//
// Who may do what, like Trello. Boards live in a workspace: the company's or one a person makes for themselves,
// private until they share it with others. In the company's, admins see every board and each department (company
// role) sees only its own boards; a company board with no role is seen by admins and the people added to it. In a
// person's workspace a board is seen by the whole workspace or only by the people added to it (private). People
// added to a board see it whatever its visibility, at the level they were given. Levels: 'admin' (settings, members,
// delete), 'normal' (edit everything on it) and 'observer' (view and comment).
import { Router, HttpError, json, readJson } from './http';
import type { Req } from './http';
import { all, get, run, uid, now } from './db';
import { assertLinkedTaskEditable, syncCardToTask, cardDescriptionWriter, mayWriteDescription, assertDescriptionWriter, nextDescriptionWriter } from './tasklinks';
import { notifyPeople } from './notifications';
import { currentUser, PAGES, pagesOf, deptLevel, USER_SQL, type Level } from './auth';
import { customerFile, clientCustomers } from './workspace';

/** Board backgrounds and label / cover colours (drawn by the web app). */
export const BGS = ['ocean', 'forest', 'sunset', 'grape', 'berry', 'slate', 'sky', 'lime', 'rose', 'night'];
const COLORS = ['green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'lime', 'pink', 'black'];
const BASIC = ['Cần làm', 'Đang làm', 'Xong'];
/** The roles made the first time, with the columns of their board. */
const STARTER = [
  { name: 'Media Execute', color: '#0b7df2', pages: ['workspace', 'editor'], bg: 'ocean', lists: ['Cần dựng', 'Đang dựng', 'Chờ duyệt', 'Cần sửa', 'Đã giao'] },
  { name: 'Account / Sale', color: '#16a34a', pages: [], bg: 'forest', lists: ['Khách mới', 'Đang trao đổi', 'Chờ brief', 'Đã gửi yêu cầu', 'Hoàn tất'] },
  { name: 'Content / Script', color: '#f59e0b', pages: [], bg: 'sunset', lists: ['Cần viết', 'Đang viết', 'Chờ duyệt', 'Cần sửa', 'Đã xong'] },
  { name: 'Ads / Performance', color: '#8b5cf6', pages: ['ads'], bg: 'grape', lists: ['Chuẩn bị', 'Đang setup', 'Đang chạy', 'Tối ưu', 'Đã báo cáo'] },
];

const text = (x: any, max: number, what: string) => {
  const s = String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  if (!s) throw new HttpError(400, `Hãy nhập ${what}`);
  return s;
};
const long = (x: any, max: number) => String(x ?? '').replace(/\r/g, '').slice(0, max);
const color = (x: any) => (/^#[0-9a-f]{6}$/i.test(String(x)) ? String(x).toLowerCase() : '#64748b');
const pagesIn = (x: any) => (Array.isArray(x) ? x : []).filter((p: any) => (PAGES as string[]).includes(p));
const time = (x: any) => (x === null || x === '' || x === undefined ? null : Number.isFinite(Number(x)) ? Math.round(Number(x)) : null);

/** The six empty labels a new board starts with, like Trello's. */
async function defaultLabels(boardId: string) {
  for (const [i, c] of COLORS.slice(0, 6).entries()) await run('INSERT INTO board_labels(id, board_id, name, color, pos) VALUES(?,?,?,?,?)', uid('lb_'), boardId, '', c, i + 1);
}
async function newBoard(name: string, bg: string, roleId: string | null, by: string | null, lists: string[], workspaceId: string | null = null, priv = false) {
  by ||= (await get<any>("SELECT id FROM users WHERE role='admin' AND disabled=0 ORDER BY created_at,id LIMIT 1"))?.id || null;
  if(!by)throw new HttpError(400,'Board cần có chủ sở hữu');
  const id = uid('b_'), t = now();
  const pos = ((await get<any>('SELECT MAX(pos) m FROM boards'))?.m || 0) + 1;
  await run('INSERT INTO boards(id, name, bg, role_id, created_by, pos, created_at, updated_at, workspace_id, private) VALUES(?,?,?,?,?,?,?,?,?,?)', id, name, bg, roleId, by, pos, t, t, workspaceId, 1);
  for (const [i, l] of lists.entries()) await run('INSERT INTO board_lists(id, board_id, name, pos, created_at) VALUES(?,?,?,?,?)', uid('l_'), id, l, i + 1, t);
  await defaultLabels(id);
  return id;
}
/** A department's usual roles: its head (admin), staff (member) and interns (view only); people already in it become staff. */
async function defaultPositions(dept: string) {
  for (const [i, [name, level]] of ([['Trưởng phòng', 'admin'], ['Nhân viên', 'normal'], ['Thực tập sinh', 'observer']] as const).entries()) {
    const id = uid('dr_');
    await run('INSERT INTO dept_roles(id, team_role_id, name, level, pos, created_at) VALUES(?,?,?,?,?,?)', id, dept, name, level, i + 1, now());
    if (level === 'normal') await run('UPDATE users SET dept_role = ? WHERE team_role = ? AND dept_role IS NULL', id, dept);
  }
}
let seeded: Promise<void> | null = null;
/** The first time: the starter departments, each with its board and roles, and one more board; departments made
 *  before roles existed get their roles. */
function seed() {
  return (seeded ??= (async () => {
    if (!(await get<any>('SELECT COUNT(*) n FROM team_roles'))?.n) {
      for (const [i, r] of STARTER.entries()) {
        const id = uid('tr_');
        await run('INSERT INTO team_roles(id, name, color, pages, pos, created_at) VALUES(?,?,?,?,?,?)', id, r.name, r.color, JSON.stringify(r.pages), i + 1, now());
        await newBoard(r.name, r.bg, id, null, r.lists);
      }
      if (!(await get('SELECT id FROM boards WHERE role_id IS NULL'))) await newBoard('Việc chung', 'slate', null, null, BASIC);
    }
    for (const r of await all<any>('SELECT id FROM team_roles WHERE id NOT IN (SELECT team_role_id FROM dept_roles)')) await defaultPositions(r.id);
  })().catch((e) => { seeded = null; throw e; }));
}

const roleOut = (r: any, members = 0) => ({ id: r.id, name: r.name, color: r.color, pages: pagesIn(JSON.parse(r.pages || '[]')), members });
const me = async (req: Req) => (await currentUser(req))!;

// ---------------------------------------------------------------- who may do what
export type { Level };
const LEVELS: Level[] = ['observer', 'normal', 'admin'];
const rank = (l: Level | null | undefined) => (l ? LEVELS.indexOf(l) + 1 : 0);
const levelIn = (x: any): Level => (LEVELS.includes(x) ? x : 'normal');
/** The company's workspace: boards with no workspace_id. */
export const COMPANY = 'company';
/** A person's level in a workspace (`ws` null: the company's, where everyone is; a view-only role there only views). */
function wsLevel(u: any, ws: any | null, mine?: Level): Level | null {
  if (!ws) return u.role === 'admin' ? 'admin' : deptLevel(u) === 'observer' ? 'observer' : 'normal';
  if (ws.owner_id === u.id) return 'admin';
  // A workspace is private (its people only) unless its owner lets the whole company view it.
  return mine || (ws.visibility === 'company' ? 'observer' : null);
}
/** A person's level on a board: workspace admins (company admins in the company's) administer all of it; then what
 *  they were given on the board; the board's maker administers it; then its department (company) or its workspace
 *  (a person's, unless private) edits it. */
function boardLevel(u: any, b: any, _ws: any | null, _wsMine?: Level, mine?: Level): Level | null {
  if(b.created_by===u.id)return 'admin';
  return mine||null;
}

export async function boardLevelForUser(u: any, b: any) {
  const ws = b.workspace_id ? await get<any>('SELECT * FROM workspaces WHERE id = ?', b.workspace_id) : null;
  if (b.workspace_id && !ws) return null;
  const wm = ws ? (await get<any>('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?', ws.id, u.id))?.role : undefined;
  const bm = (await get<any>('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?', b.id, u.id))?.role;
  return boardLevel(u, b, ws, wm, bm);
}
/** One person's level on every board at once (board list, search). */
async function levels(u: any) {
  const spaces = new Map((await all<any>('SELECT * FROM workspaces')).map((w) => [w.id, w]));
  const wm = new Map((await all<any>('SELECT workspace_id, role FROM workspace_members WHERE user_id = ?', u.id)).map((r) => [r.workspace_id, r.role]));
  const bm = new Map((await all<any>('SELECT board_id, role FROM board_members WHERE user_id = ?', u.id)).map((r) => [r.board_id, r.role]));
  return (b: any) => (b.workspace_id && !spaces.has(b.workspace_id) ? null : boardLevel(u, b, b.workspace_id ? spaces.get(b.workspace_id) : null, wm.get(b.workspace_id), bm.get(b.id)));
}
const DENIED: Record<Level, string> = { observer: 'Không tìm thấy board', normal: 'Bạn chỉ có quyền xem board này', admin: 'Chỉ quản trị board mới làm được việc này' };
/** The board if this account may do `need` on it ('observer': see it, 'normal': change it, 'admin': its settings); `level` is theirs. */
export async function mustBoard(req: Req, id: string, need: Level = 'normal') {
  const b = await get<any>('SELECT * FROM boards WHERE id = ?', id);
  const level = b ? await boardLevelForUser(await me(req), b) : null;
  if (!level) throw new HttpError(404, 'Không tìm thấy board');
  if (rank(level) < rank(need)) throw new HttpError(403, DENIED[need]);
  b.level = level;
  return b;
}
export async function mustList(req: Req, id: string, need: Level = 'normal') {
  const l = await get<any>('SELECT * FROM board_lists WHERE id = ?', id);
  if (!l) throw new HttpError(404, 'Không tìm thấy danh sách');
  await mustBoard(req, l.board_id, need);
  return l;
}
export async function mustCard(req: Req, id: string, need: Level = 'normal') {
  const linkedProject=await get<any>('SELECT t.project_id FROM task_board_links l JOIN tasks t ON t.id=l.task_id WHERE l.card_id=?',id);if(linkedProject?.project_id)await requireProject((await currentUser(req))!.id,linkedProject.project_id,need==='observer'?'observer':'normal');
  const c = await get<any>('SELECT * FROM board_cards WHERE id = ?', id);
  if (!c) throw new HttpError(404, 'Không tìm thấy thẻ');
  c.level = (await mustBoard(req, c.board_id, need)).level;
  const customer=(await get<any>('SELECT p.customer_id FROM task_board_links l JOIN tasks t ON t.id=l.task_id JOIN task_projects p ON p.id=t.project_id WHERE l.card_id=?',c.id))?.customer_id;
  for(const id of new Set([c.customer_id,customer].filter(Boolean)))await requireCustomer((await me(req)).id,String(id),need==='observer'?'observer':'normal');
  return c;
}
/** Only whoever made a card, or a company admin, archives or deletes it (cards from before makers were kept: the board's
 *  admins). */
const isOwner = (c: { created_by: string | null }, u: any, level: Level) => u.role === 'admin' || (c.created_by ? c.created_by === u.id : level === 'admin');
function ownCard(c: any, u: any) {
  if (!isOwner(c, u, c.level)) throw new HttpError(403, 'Chỉ người tạo thẻ hoặc quản trị viên mới lưu trữ hay xoá được thẻ này');
}
/** A row of a card's part (checklist, item, comment, attachment) with the card it belongs to, checked. */
async function mustPart(req: Req, table: string, id: string, need: Level = 'normal') {
  const x = await get<any>(`SELECT * FROM ${table} WHERE id = ?`, id);
  if (!x) throw new HttpError(404, 'Không tìm thấy');
  return { x, card: await mustCard(req, x.card_id, need) };
}
/** A workspace this account may do `need` in (the company's is not a row: see COMPANY). */
async function mustWorkspace(req: Req, id: string, need: Level = 'observer') {
  const w = await get<any>('SELECT * FROM workspaces WHERE id = ?', id), u = await me(req);
  const level = w ? wsLevel(u, w, (await get<any>('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?', w.id, u.id))?.role) : null;
  if (!level) throw new HttpError(404, 'Không tìm thấy workspace');
  if (rank(level) < rank(need)) throw new HttpError(403, need === 'admin' ? 'Chỉ quản trị workspace mới làm được việc này' : 'Bạn chỉ có quyền xem workspace này');
  w.level = level;
  return w;
}
/** Everyone in the company, for the "add people" pickers. */
const people = () => all<any>('SELECT id, name, email FROM users WHERE disabled = 0 ORDER BY name COLLATE NOCASE');
const touch = (boardId: string) => run('UPDATE boards SET updated_at = ? WHERE id = ?', now(), boardId);
/** Note what happened on a board (shown in its activity and on the card). */
const log = (boardId: string, cardId: string | null, userId: string, action: string, data: any = {}) =>
  run('INSERT INTO board_activity(id, board_id, card_id, user_id, action, data, created_at) VALUES(?,?,?,?,?,?,?)', uid('ac_'), boardId, cardId, userId, action, JSON.stringify(data), now());
/** Put item `id` at `index` among `rows` (ordered siblings) and number them 1, 2, 3… */
async function place(table: 'board_lists' | 'board_cards' | 'inbox_cards', rows: { id: string }[], id: string, index: number, extra?: { list_id: string }) {
  const order = rows.map((r) => r.id).filter((x) => x !== id);
  order.splice(Math.max(0, Math.min(order.length, Math.round(index))), 0, id);
  for (const [i, x] of order.entries()) {
    if (x === id && extra) await run(`UPDATE ${table} SET pos = ?, list_id = ? WHERE id = ?`, i + 1, extra.list_id, x);
    else await run(`UPDATE ${table} SET pos = ? WHERE id = ?`, i + 1, x);
  }
}
/** Boards with the background this account chose for each (`my_bg`), which only it sees. */
const BOARDS_SQL = 'SELECT b.*, (SELECT x.bg FROM board_backgrounds x WHERE x.board_id = b.id AND x.user_id = ?) my_bg FROM boards b';
const bgOf = (b: any) => b.my_bg || b.bg;
const boardOut = (b: any, starred: boolean, cards = 0, level: Level | null = b.level || null) => ({
  id: b.id, name: b.name, bg: bgOf(b), sharedBg: b.bg, roleId: b.role_id || null, workspaceId: b.workspace_id || COMPANY, private: true,
  createdBy: b.created_by || null, starred, cards, updatedAt: b.updated_at, level,
});
/** Everyone who sees the board (who can be put on its cards), with their level; `added`: given it on the board itself. */
async function membersOf(b: any) {
  const ws = b.workspace_id ? await get<any>('SELECT * FROM workspaces WHERE id = ?', b.workspace_id) : null;
  const wm = new Map<string, Level>(ws ? (await all<any>('SELECT user_id, role FROM workspace_members WHERE workspace_id = ?', ws.id)).map((r) => [r.user_id, r.role]) : []);
  const bm = new Map<string, Level>((await all<any>('SELECT user_id, role FROM board_members WHERE board_id = ?', b.id)).map((r) => [r.user_id, r.role]));
  const out: { id: string; name: string; email: string; level: Level; added: boolean }[] = [];
  for (const u of await all<any>(`${USER_SQL} WHERE u.disabled = 0 ORDER BY u.name COLLATE NOCASE`)) {
    const level = boardLevel(u, b, ws, wm.get(u.id), bm.get(u.id));
    if (level) out.push({ id: u.id, name: u.name, email: u.email, level, added: bm.has(u.id) });
  }
  return out;
}
/** Delete boards with everything on them. */
async function dropBoards(where: string, ...args: any[]) {
  for (const b of await all<any>(`SELECT id FROM boards WHERE ${where}`, ...args)) {
    await dropCards('board_id = ?', b.id);
    for (const t of ['board_lists', 'board_stars', 'board_backgrounds', 'board_labels', 'board_activity', 'board_members']) await run(`DELETE FROM ${t} WHERE board_id = ?`, b.id);
    await run('DELETE FROM boards WHERE id = ?', b.id);
  }
}
const IN_BOARD = 'card_id IN (SELECT id FROM board_cards WHERE board_id = ?)';
/** The front of a board's cards: what the card shows on the board (labels, members, dates, counts). */
async function fronts(boardId: string, archived = 0,userId?:string) {
  const visible=userId?await visibleCardIds(userId):null;
  const cards=(await all<any>('SELECT * FROM board_cards WHERE board_id = ? AND archived = ? ORDER BY pos',boardId,archived)).filter(c=>!visible||visible.has(c.id));
  const group = async (sql: string) => { const m = new Map<string, any[]>(); for (const r of await all<any>(sql, boardId)) { if (!m.has(r.card_id)) m.set(r.card_id, []); m.get(r.card_id)!.push(r); } return m; };
  const labels = await group(`SELECT card_id, label_id FROM card_labels WHERE ${IN_BOARD}`);
  const members = await group(`SELECT card_id, user_id FROM card_members WHERE ${IN_BOARD}`);
  const comments = await group(`SELECT card_id, COUNT(*) n FROM card_comments WHERE ${IN_BOARD} GROUP BY card_id`);
  const files = await group(`SELECT card_id, COUNT(*) n FROM card_attachments WHERE ${IN_BOARD} GROUP BY card_id`);
  const checks = await group(`SELECT card_id, COUNT(*) n, SUM(done) d FROM checklist_items WHERE ${IN_BOARD} GROUP BY card_id`);
  const names = new Map((await all<any>('SELECT id, name FROM customers WHERE id IN (SELECT customer_id FROM board_cards WHERE board_id = ?)', boardId)).map((r) => [r.id, r.name]));
  return cards.map((c) => ({
    id: c.id, listId: c.list_id, title: c.title, cover: c.cover || null, startAt: c.start_at ?? null, dueAt: c.due_at ?? null, done: !!c.done, desc: !!(c.description || '').trim(),
    labels: (labels.get(c.id) || []).map((r) => r.label_id), members: (members.get(c.id) || []).map((r) => r.user_id),
    comments: comments.get(c.id)?.[0]?.n || 0, attachments: files.get(c.id)?.[0]?.n || 0,
    checks: checks.has(c.id) ? [Number(checks.get(c.id)![0].d) || 0, checks.get(c.id)![0].n] : null, createdAt: c.created_at, createdBy: c.created_by || null,
    customerId: c.customer_id || null, customerName: c.customer_id ? names.get(c.customer_id) || null : null,
  }));
}
/** A card's attachment: a link, or a video of its customer's folder (`key`, with the customer it came from). */
const attachmentOut = (a: any) => ({ id: a.id, name: a.name, url: a.url, createdAt: a.created_at, userId: a.user_id, customerId: a.customer_id || null, key: a.file_key || null });
/** Everything about one card (its back). */
/** `canEditDescription`: may `u` change its description (only its writer once written, see tasklinks). */
async function cardOut(c: any, u: any) {
  const checklists = await all<any>('SELECT * FROM card_checklists WHERE card_id = ? ORDER BY pos', c.id);
  const items = await all<any>('SELECT * FROM checklist_items WHERE card_id = ? ORDER BY pos', c.id);
  const list = await get<any>('SELECT name FROM board_lists WHERE id = ?', c.list_id);
  const customer = c.customer_id ? await get<any>('SELECT id, name FROM customers WHERE id = ?', c.customer_id) : null;
  return {
    id: c.id, boardId: c.board_id, listId: c.list_id, listName: list?.name || '', title: c.title, description: c.description || '', cover: c.cover || null,
    startAt: c.start_at ?? null, dueAt: c.due_at ?? null, done: !!c.done, archived: !!c.archived, createdAt: c.created_at, createdBy: c.created_by || null,
    customerId: customer?.id || null, customerName: customer?.name || null,
    labels: (await all<any>('SELECT label_id FROM card_labels WHERE card_id = ?', c.id)).map((r) => r.label_id),
    members: (await all<any>('SELECT user_id FROM card_members WHERE card_id = ?', c.id)).map((r) => r.user_id),
    checklists: checklists.map((k) => ({ id: k.id, title: k.title, items: items.filter((i) => i.checklist_id === k.id).map((i) => ({ id: i.id, text: i.text, done: !!i.done })) })),
    attachments: (await all<any>('SELECT * FROM card_attachments WHERE card_id = ? ORDER BY created_at DESC', c.id)).map(attachmentOut),
    comments: (await all<any>('SELECT k.*, u.name FROM card_comments k LEFT JOIN users u ON u.id = k.user_id WHERE k.card_id = ? ORDER BY k.created_at DESC', c.id))
      .map((k) => ({ id: k.id, userId: k.user_id, userName: k.name || 'Ai đó', text: k.text, createdAt: k.created_at, edited: k.updated_at > k.created_at })),
    linkedTask: (await get<any>('SELECT task_id id FROM task_board_links WHERE card_id=?', c.id)) || null,
    canEditDescription: c.level !== 'observer' && mayWriteDescription(u, c.description, await cardDescriptionWriter(c)),
    activity: await activityOf('card_id', c.id, 50),
  };
}
async function activityOf(by: 'board_id' | 'card_id', id: string, limit: number) {
  return (await all<any>(`SELECT a.*, u.name, c.title FROM board_activity a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN board_cards c ON c.id = a.card_id WHERE a.${by} = ? ORDER BY a.created_at DESC LIMIT ${limit}`, id))
    .map((a) => ({ id: a.id, cardId: a.card_id, cardTitle: a.title || '', userId: a.user_id, userName: a.name || 'Ai đó', action: a.action, data: JSON.parse(a.data || '{}'), createdAt: a.created_at }));
}
/** Delete cards with everything on them. */
async function dropCards(where: string, ...args: any[]) {
  const ids = (await all<any>(`SELECT id FROM board_cards WHERE ${where}`, ...args)).map((r) => r.id);
  for (const id of ids) {
    for (const t of ['card_labels', 'card_members', 'card_checklists', 'checklist_items', 'card_comments', 'card_attachments']) await run(`DELETE FROM ${t} WHERE card_id = ?`, id);
    await run('DELETE FROM task_board_links WHERE card_id = ?', id);
    await run('DELETE FROM board_cards WHERE id = ?', id);
  }
}

export function registerBoards(api: Router) {
  // ---------------------------------------------------------------- departments and their roles (changes: admins only, see auth.ts)
  // A department (stored as a "team role") has its own board and tool pages; each person in it has one of its roles,
  // whose level says what they may do in the department: admin, member or view only.
  api.get('/api/roles', async (_req, res) => {
    await seed();
    const n = new Map((await all<any>('SELECT team_role, COUNT(*) n FROM users WHERE team_role IS NOT NULL GROUP BY team_role')).map((r) => [r.team_role, r.n]));
    const used = new Map((await all<any>('SELECT dept_role, COUNT(*) n FROM users WHERE dept_role IS NOT NULL GROUP BY dept_role')).map((r) => [r.dept_role, Number(r.n)]));
    const positions = await all<any>('SELECT * FROM dept_roles ORDER BY pos');
    json(res, 200, (await all<any>('SELECT * FROM team_roles ORDER BY pos')).map((r) => ({
      ...roleOut(r, n.get(r.id) || 0),
      positions: positions.filter((p) => p.team_role_id === r.id).map((p) => ({ id: p.id, name: p.name, level: levelIn(p.level), members: used.get(p.id) || 0 })),
    })));
  });
  // A new department comes with its own board (three basic columns) and its three usual roles.
  api.post('/api/roles', async (req, res) => {
    await seed();
    const b = await readJson(req);
    const id = uid('tr_'), name = text(b.name, 60, 'tên phòng ban');
    const pos = ((await get<any>('SELECT MAX(pos) m FROM team_roles'))?.m || 0) + 1;
    await run('INSERT INTO team_roles(id, name, color, pages, pos, created_at) VALUES(?,?,?,?,?,?)', id, name, color(b.color), JSON.stringify(pagesIn(b.pages)), pos, now());
    await defaultPositions(id);
    await newBoard(name, BGS[Math.floor(Math.random() * BGS.length)], id, (await me(req)).id, BASIC);
    json(res, 201, roleOut(await get('SELECT * FROM team_roles WHERE id = ?', id)));
  });
  api.put('/api/roles/:id', async (req, res) => {
    const r = await get<any>('SELECT * FROM team_roles WHERE id = ?', req.params.id);
    if (!r) throw new HttpError(404, 'Không tìm thấy phòng ban');
    const b = await readJson(req);
    await run('UPDATE team_roles SET name = ?, color = ?, pages = ? WHERE id = ?', b.name !== undefined ? text(b.name, 60, 'tên phòng ban') : r.name,
      b.color !== undefined ? color(b.color) : r.color, b.pages !== undefined ? JSON.stringify(pagesIn(b.pages)) : r.pages, r.id);
    json(res, 200, roleOut(await get('SELECT * FROM team_roles WHERE id = ?', r.id)));
  });
  // Its people keep their accounts (in no department); its boards stay, for admins and the people added to them.
  api.delete('/api/roles/:id', async (req, res) => {
    await run('UPDATE users SET team_role = NULL, dept_role = NULL WHERE team_role = ?', req.params.id);
    await run('UPDATE boards SET role_id = NULL WHERE role_id = ?', req.params.id);
    await run('DELETE FROM dept_roles WHERE team_role_id = ?', req.params.id);
    await run('DELETE FROM team_roles WHERE id = ?', req.params.id);
    json(res, 200, { ok: true });
  });
  // The roles of a department: a name (Trưởng phòng, Editor…) and a level.
  api.post('/api/roles/:id/positions', async (req, res) => {
    const r = await get<any>('SELECT id FROM team_roles WHERE id = ?', req.params.id);
    if (!r) throw new HttpError(404, 'Không tìm thấy phòng ban');
    const b = await readJson(req), id = uid('dr_');
    const pos = ((await get<any>('SELECT MAX(pos) m FROM dept_roles WHERE team_role_id = ?', r.id))?.m || 0) + 1;
    await run('INSERT INTO dept_roles(id, team_role_id, name, level, pos, created_at) VALUES(?,?,?,?,?,?)', id, r.id, text(b.name, 60, 'tên role'), levelIn(b.level), pos, now());
    json(res, 201, { id, name: text(b.name, 60, 'tên role'), level: levelIn(b.level), members: 0 });
  });
  api.put('/api/positions/:id', async (req, res) => {
    const p = await get<any>('SELECT * FROM dept_roles WHERE id = ?', req.params.id);
    if (!p) throw new HttpError(404, 'Không tìm thấy role');
    const b = await readJson(req);
    await run('UPDATE dept_roles SET name = ?, level = ? WHERE id = ?', b.name !== undefined ? text(b.name, 60, 'tên role') : p.name, b.level !== undefined ? levelIn(b.level) : p.level, p.id);
    json(res, 200, { ok: true });
  });
  // Its people stay in the department, at the member level until given another role.
  api.delete('/api/positions/:id', async (req, res) => {
    await run('UPDATE users SET dept_role = NULL WHERE dept_role = ?', req.params.id);
    await run('DELETE FROM dept_roles WHERE id = ?', req.params.id);
    json(res, 200, { ok: true });
  });

  // ---------------------------------------------------------------- workspaces
  // The company's (everyone; managed in Quản trị) and the ones people make, private until shared with others.
  const wsOut = (w: any, level: Level, members: number) => ({
    id: w.id, name: w.name, about: w.about || '', kind: 'personal', visibility: w.visibility === 'company' ? 'company' : 'private', ownerId: w.owner_id, level, members,
  });
  const visibilityIn = (x: any) => (x === 'company' ? 'company' : 'private');
  api.get('/api/workspaces', async (req, res) => {
    const u = await me(req);
    const mine = new Map((await all<any>('SELECT workspace_id, role FROM workspace_members WHERE user_id = ?', u.id)).map((r) => [r.workspace_id, r.role]));
    const count = new Map((await all<any>('SELECT workspace_id, COUNT(*) n FROM workspace_members GROUP BY workspace_id')).map((r) => [r.workspace_id, Number(r.n)]));
    const everyone = Number((await get<any>('SELECT COUNT(*) n FROM users WHERE disabled = 0'))?.n || 0);
    const out: any[] = [{ id: COMPANY, name: 'Detailers Movement', about: '', kind: 'company', visibility: 'company', ownerId: null, level: wsLevel(u, null), members: everyone }];
    for (const w of await all<any>('SELECT * FROM workspaces ORDER BY created_at')) {
      const level = wsLevel(u, w, mine.get(w.id));
      if (level) out.push(wsOut(w, level, (count.get(w.id) || 0) + 1));
    }
    json(res, 200, out);
  });
  api.post('/api/workspaces', async (req, res) => {
    const u = await me(req), b = await readJson(req), id = uid('w_'), t = now();
    // Private unless asked otherwise: only its owner sees it until they invite people.
    await run('INSERT INTO workspaces(id, name, about, owner_id, visibility, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', id, text(b.name, 80, 'tên workspace'), long(b.about, 2000), u.id, visibilityIn(b.visibility), t, t);
    json(res, 201, wsOut(await get('SELECT * FROM workspaces WHERE id = ?', id), 'admin', 1));
  });
  api.put('/api/workspaces/:id', async (req, res) => {
    const w = await mustWorkspace(req, req.params.id, 'admin'), b = await readJson(req);
    await run('UPDATE workspaces SET name = ?, about = ?, visibility = ?, updated_at = ? WHERE id = ?', b.name !== undefined ? text(b.name, 80, 'tên workspace') : w.name,
      b.about !== undefined ? long(b.about, 2000) : w.about, b.visibility !== undefined ? visibilityIn(b.visibility) : w.visibility || 'private', now(), w.id);
    json(res, 200, { ok: true });
  });
  // Only its owner deletes a workspace, with every board in it.
  api.delete('/api/workspaces/:id', async (req, res) => {
    const w = await mustWorkspace(req, req.params.id, 'admin');
    if (w.owner_id !== (await me(req)).id) throw new HttpError(403, 'Chỉ người tạo workspace mới xoá được');
    for(const board of await all<any>('SELECT * FROM boards WHERE workspace_id=?',w.id))if(await boardLevelForUser(await me(req),board)!=='admin')throw new HttpError(403,'Workspace còn board cá nhân bạn không quản lý; không thể xoá');
    await dropBoards('workspace_id = ?', w.id);
    await run('DELETE FROM workspace_members WHERE workspace_id = ?', w.id);
    await run('DELETE FROM workspaces WHERE id = ?', w.id);
    json(res, 200, { ok: true });
  });
  async function wsMembers(w: any) {
    const levelOfUser = new Map((await all<any>('SELECT user_id, role FROM workspace_members WHERE workspace_id = ?', w.id)).map((r) => [r.user_id, r.role]));
    return (await all<any>('SELECT id, name, email FROM users WHERE disabled = 0 ORDER BY name COLLATE NOCASE'))
      .filter((u) => u.id === w.owner_id || levelOfUser.has(u.id))
      .map((u) => ({ ...u, level: u.id === w.owner_id ? 'admin' : levelOfUser.get(u.id), owner: u.id === w.owner_id }));
  }
  // The company's workspace lists everyone (who is in it is managed in Quản trị).
  api.get('/api/workspaces/:id/members', async (req, res) => {
    if (req.params.id === COMPANY) {
      const users = await all<any>(`${USER_SQL} WHERE u.disabled = 0 ORDER BY u.name COLLATE NOCASE`);
      return json(res, 200, { members: users.map((u) => ({ id: u.id, name: u.name, email: u.email, level: wsLevel(u, null), owner: false })), people: [] });
    }
    json(res, 200, { members: await wsMembers(await mustWorkspace(req, req.params.id)), people: await people() });
  });
  api.put('/api/workspaces/:id/members/:userId', async (req, res) => {
    const w = await mustWorkspace(req, req.params.id, 'admin'), u = await me(req), level = levelIn((await readJson(req)).level);
    const who = await get<any>('SELECT id FROM users WHERE id = ? AND disabled = 0', req.params.userId);
    if (!who) throw new HttpError(404, 'Không tìm thấy người này');
    if (who.id === w.owner_id) throw new HttpError(400, 'Người tạo workspace luôn là quản trị');
    await run('INSERT INTO workspace_members(workspace_id, user_id, role, added_by, created_at) VALUES(?,?,?,?,?) ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role',
      w.id, who.id, level, u.id, now());
    json(res, 200, { members: await wsMembers(w) });
  });
  // Admins take people out; anyone may leave (the owner stays).
  api.delete('/api/workspaces/:id/members/:userId', async (req, res) => {
    const self = req.params.userId === (await me(req)).id;
    const w = await mustWorkspace(req, req.params.id, self ? 'observer' : 'admin');
    if (req.params.userId === w.owner_id) throw new HttpError(400, 'Người tạo workspace không rời được; hãy xoá workspace nếu không dùng nữa');
    await run('DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?', w.id, req.params.userId);
    json(res, 200, { members: self ? [] : await wsMembers(w) });
  });

  // ---------------------------------------------------------------- boards
  api.get('/api/boards', async (req, res) => {
    await seed();
    const u = await me(req), level = await levels(u);
    const stars = new Set((await all<any>('SELECT board_id FROM board_stars WHERE user_id = ?', u.id)).map((r) => r.board_id));
    const rows = await all<any>('SELECT b.*, (SELECT COUNT(*) FROM board_cards c WHERE c.board_id = b.id AND c.archived = 0) cards, (SELECT x.bg FROM board_backgrounds x WHERE x.board_id = b.id AND x.user_id = ?) my_bg FROM boards b ORDER BY b.pos', u.id);
    json(res, 200, rows.map((b) => [b, level(b)] as const).filter(([, l]) => l).map(([b, l]) => boardOut(b, stars.has(b.id), b.cards, l)));
  });
  /** A workspace boards may go to: the company's (null) or one this account edits in. */
  const workspaceFor = async (req: Req, id: any) => (id && id !== COMPANY ? (await mustWorkspace(req, String(id), 'normal')).id as string : null);
  /** A role a board may be kept for: any for company admins, else the person's own. */
  async function checkRole(req: Req, roleId: string) {
    const u = await me(req);
    if (!(await get('SELECT id FROM team_roles WHERE id = ?', roleId))) throw new HttpError(404, 'Không tìm thấy role');
    if (u.role !== 'admin' && roleId !== u.team_role) throw new HttpError(403, 'Bạn chỉ chọn được role của mình');
  }
  const ROLE_IN_COMPANY = 'Board theo role chỉ có trong workspace của công ty';
  // In the company's workspace or one of this account's; seen by the workspace, one role (company only) or only its members.
  api.post('/api/boards', async (req, res) => {
    const u = await me(req), b = await readJson(req);
    const roleId = b.roleId ? String(b.roleId) : null, ws = await workspaceFor(req, b.workspaceId);
    if (!ws && wsLevel(u, null) === 'observer') throw new HttpError(403, 'Role của bạn trong phòng chỉ được xem, không tạo được board');
    if (roleId) { if (ws) throw new HttpError(400, ROLE_IN_COMPANY); await checkRole(req, roleId); }
    const id = await newBoard(text(b.name, 80, 'tên board'), BGS.includes(b.bg) ? b.bg : 'ocean', roleId, u.id,
      Array.isArray(b.lists) && b.lists.length ? b.lists.slice(0, 20).map((x: any) => text(x, 80, 'tên danh sách')) : BASIC, ws, !!b.private && !roleId);
    json(res, 201, boardOut(await get('SELECT * FROM boards WHERE id = ?', id), false, 0, 'admin'));
  });
  api.get('/api/boards/:id', async (req, res) => {
    const b = await mustBoard(req, req.params.id, 'observer'), u = await me(req);
    if (!(await get('SELECT id FROM board_labels WHERE board_id = ?', b.id))) await defaultLabels(b.id); // boards made before labels existed
    const lists = await all<any>('SELECT id, name FROM board_lists WHERE board_id = ? AND archived = 0 ORDER BY pos', b.id);
    const cards = await fronts(b.id,0,(await me(req)).id);
    const starred = !!(await get('SELECT 1 x FROM board_stars WHERE user_id = ? AND board_id = ?', u.id, b.id));
    b.my_bg = (await get<any>('SELECT bg FROM board_backgrounds WHERE user_id = ? AND board_id = ?', u.id, b.id))?.bg;
    json(res, 200, {
      ...boardOut(b, starred, cards.length), about: b.about || '',
      labels: await all<any>('SELECT id, name, color FROM board_labels WHERE board_id = ? ORDER BY pos', b.id),
      members: await membersOf(b),
      lists: lists.map((l) => ({ id: l.id, name: l.name, cards: cards.filter((c) => c.listId === l.id) })),
    });
  });
  // Name, background and description: whoever edits the board. Who sees it (role, private, workspace): its admins.
  api.put('/api/boards/:id', async (req, res) => {
    const bd = await mustBoard(req, req.params.id), b = await readJson(req);
    let roleId = bd.role_id, priv = 1, ws = bd.workspace_id || null;
    if (b.roleId !== undefined || b.private !== undefined || b.workspaceId !== undefined) {
      if (bd.level !== 'admin') throw new HttpError(403, DENIED.admin);
      if (b.roleId !== undefined) roleId = b.roleId ? String(b.roleId) : null;
      priv = 1;
      if (b.workspaceId !== undefined && (b.workspaceId || COMPANY) !== (bd.workspace_id || COMPANY)) ws = await workspaceFor(req, b.workspaceId);
      if (roleId && ws) throw new HttpError(400, ROLE_IN_COMPANY);
      if (roleId && roleId !== bd.role_id) await checkRole(req, roleId);
      priv = 1;
    }
    await run('UPDATE boards SET name = ?, bg = ?, role_id = ?, private = ?, workspace_id = ?, about = ?, updated_at = ? WHERE id = ?', b.name !== undefined ? text(b.name, 80, 'tên board') : bd.name,
      b.bg !== undefined && BGS.includes(b.bg) ? b.bg : bd.bg, roleId, priv, ws, b.about !== undefined ? long(b.about, 4000) : bd.about, now(), bd.id);
    json(res, 200, { ok: true });
  });
  // Its admins: the workspace's admins, whoever made it, and people made admin on it.
  api.delete('/api/boards/:id', async (req, res) => {
    const b = await mustBoard(req, req.params.id, 'admin');
    await dropBoards('id = ?', b.id);
    json(res, 200, { ok: true });
  });
  api.put('/api/boards/:id/star', async (req, res) => {
    const b = await mustBoard(req, req.params.id, 'observer'), u = await me(req);
    if ((await readJson(req)).on) await run('INSERT OR IGNORE INTO board_stars(user_id, board_id) VALUES(?,?)', u.id, b.id);
    else await run('DELETE FROM board_stars WHERE user_id = ? AND board_id = ?', u.id, b.id);
    json(res, 200, { ok: true });
  });
  // A background only this account sees; none (null) goes back to the board's own.
  api.put('/api/boards/:id/background', async (req, res) => {
    const b = await mustBoard(req, req.params.id, 'observer'), u = await me(req), bg = (await readJson(req)).bg;
    if (bg === null) await run('DELETE FROM board_backgrounds WHERE user_id = ? AND board_id = ?', u.id, b.id);
    else if (BGS.includes(bg)) await run('INSERT INTO board_backgrounds(user_id, board_id, bg) VALUES(?,?,?) ON CONFLICT(user_id, board_id) DO UPDATE SET bg = excluded.bg', u.id, b.id, bg);
    else throw new HttpError(400, 'Hình nền không hợp lệ');
    json(res, 200, { ok: true });
  });
  // People given a level on the board itself, on top of who sees it through its workspace or role.
  api.get('/api/boards/:id/members', async (req, res) => {
    const b = await mustBoard(req, req.params.id, 'observer');
    json(res, 200, { members: await membersOf(b), people: await people() });
  });
  api.put('/api/boards/:id/members/:userId', async (req, res) => {
    const b = await mustBoard(req, req.params.id, 'admin'), u = await me(req), level = levelIn((await readJson(req)).level);
    const who = await get<any>('SELECT id, name FROM users WHERE id = ? AND disabled = 0', req.params.userId);
    if (!who) throw new HttpError(404, 'Không tìm thấy người này');
    if(who.id===b.created_by&&level!=='admin')throw new HttpError(400,'Chủ board luôn có quyền quản lý');
    const had = await get('SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?', b.id, who.id);
    await run('INSERT INTO board_members(board_id, user_id, role, added_by, created_at) VALUES(?,?,?,?,?) ON CONFLICT(board_id, user_id) DO UPDATE SET role = excluded.role',
      b.id, who.id, level, u.id, now());
    await log(b.id, null, u.id, 'board.member', { name: who.name, level });
    if (!had) await notifyPeople([who.id], u.id, { title: 'Bạn được thêm vào board', body: b.name, link: `#boards/${b.id}` });
    json(res, 200, { members: await membersOf(b) });
  });
  // Admins take people off the board; anyone may leave it.
  api.delete('/api/boards/:id/members/:userId', async (req, res) => {
    const u = await me(req), self = req.params.userId === u.id;
    const b = await mustBoard(req, req.params.id, self ? 'observer' : 'admin');
    const who = await get<any>(`${USER_SQL} WHERE u.id = ?`, req.params.userId);
    if(req.params.userId===b.created_by)throw new HttpError(400,'Không thể gỡ chủ board khỏi board');
    await run('DELETE FROM board_members WHERE board_id = ? AND user_id = ?', b.id, req.params.userId);
    // Someone who no longer sees the board comes off its cards too.
    if (who && !(await boardLevelForUser(who, b))) await run('DELETE FROM card_members WHERE user_id = ? AND card_id IN (SELECT id FROM board_cards WHERE board_id = ?)', who.id, b.id);
    await log(b.id, null, u.id, 'board.member', { name: who?.name || '', level: null, self });
    json(res, 200, { members: await membersOf(b) });
  });
  api.get('/api/boards/:id/activity',async(req,res)=>{const b=await mustBoard(req,req.params.id,'observer'),visible=await visibleCardIds((await me(req)).id);json(res,200,(await activityOf('board_id',b.id,100)).filter(a=>!a.cardId||visible.has(a.cardId)));});
  api.get('/api/boards/:id/archived', async (req, res) => {
    const b = await mustBoard(req, req.params.id, 'observer');
    const names = new Map((await all<any>('SELECT id, name FROM board_lists WHERE board_id = ?', b.id)).map((l) => [l.id, l.name]));
    json(res, 200, {
      cards: (await fronts(b.id,1,(await me(req)).id)).map((c) => ({ ...c, listName: names.get(c.listId) || '' })),
      lists: await all<any>('SELECT id, name FROM board_lists WHERE board_id = ? AND archived = 1 ORDER BY pos', b.id),
    });
  });
  // Labels of a board (name may be empty: a colour only).
  api.post('/api/boards/:id/labels', async (req, res) => {
    const b = await mustBoard(req, req.params.id), x = await readJson(req);
    const id = uid('lb_'), pos = ((await get<any>('SELECT MAX(pos) m FROM board_labels WHERE board_id = ?', b.id))?.m || 0) + 1;
    await run('INSERT INTO board_labels(id, board_id, name, color, pos) VALUES(?,?,?,?,?)', id, b.id, long(x.name, 60).trim(), COLORS.includes(x.color) ? x.color : 'green', pos);
    json(res, 201, { id, name: long(x.name, 60).trim(), color: COLORS.includes(x.color) ? x.color : 'green' });
  });
  api.put('/api/labels/:id', async (req, res) => {
    const l = await get<any>('SELECT * FROM board_labels WHERE id = ?', req.params.id);
    if (!l) throw new HttpError(404, 'Không tìm thấy nhãn');
    await mustBoard(req, l.board_id);
    const x = await readJson(req);
    await run('UPDATE board_labels SET name = ?, color = ? WHERE id = ?', x.name !== undefined ? long(x.name, 60).trim() : l.name, x.color !== undefined && COLORS.includes(x.color) ? x.color : l.color, l.id);
    json(res, 200, { ok: true });
  });
  api.delete('/api/labels/:id', async (req, res) => {
    const l = await get<any>('SELECT * FROM board_labels WHERE id = ?', req.params.id);
    if (!l) throw new HttpError(404, 'Không tìm thấy nhãn');
    await mustBoard(req, l.board_id);
    await run('DELETE FROM card_labels WHERE label_id = ?', l.id);
    await run('DELETE FROM board_labels WHERE id = ?', l.id);
    json(res, 200, { ok: true });
  });

  // ---------------------------------------------------------------- lists (`index`: the place to move to)
  api.post('/api/boards/:id/lists', async (req, res) => {
    const b = await mustBoard(req, req.params.id), name = text((await readJson(req)).name, 80, 'tên danh sách');
    const id = uid('l_'), pos = ((await get<any>('SELECT MAX(pos) m FROM board_lists WHERE board_id = ?', b.id))?.m || 0) + 1;
    await run('INSERT INTO board_lists(id, board_id, name, pos, created_at) VALUES(?,?,?,?,?)', id, b.id, name, pos, now());
    await log(b.id, null, (await me(req)).id, 'list.add', { name });
    await touch(b.id);
    json(res, 201, { id, name, cards: [] });
  });
  // Rename, move (`index`), archive or restore (`archived`).
  api.put('/api/lists/:id', async (req, res) => {
    const l = await mustList(req, req.params.id), b = await readJson(req), u = await me(req);
    if (b.name !== undefined) {
      const cards=await all<any>('SELECT id FROM board_cards WHERE list_id=?',l.id);
      for(const c of cards) await assertLinkedTaskEditable(c.id,u.id);
      await run('UPDATE board_lists SET name = ? WHERE id = ?',text(b.name,80,'tên danh sách'),l.id);
      for(const c of cards) await syncCardToTask(c.id,true,u.id);
    }
    if (b.index !== undefined) await place('board_lists', await all<any>('SELECT id FROM board_lists WHERE board_id = ? AND archived = 0 ORDER BY pos', l.board_id), l.id, Number(b.index) || 0);
    if (b.archived !== undefined) {
      await run('UPDATE board_lists SET archived = ? WHERE id = ?', b.archived ? 1 : 0, l.id);
      await log(l.board_id, null, u.id, b.archived ? 'list.archive' : 'list.restore', { name: l.name });
    }
    await touch(l.board_id);
    json(res, 200, { ok: true });
  });
  // Deleting a list takes its cards: board admins, and only when every card in it is theirs.
  api.delete('/api/lists/:id', async (req, res) => {
    const l = await mustList(req, req.params.id, 'admin'), u = await me(req);
    if ((await all<any>('SELECT created_by FROM board_cards WHERE list_id = ?', l.id)).some((c) => !isOwner(c, u, 'admin')))
      throw new HttpError(403, 'Danh sách còn thẻ của người khác; chỉ người tạo thẻ mới xoá được thẻ của họ');
    await dropCards('list_id = ?', l.id);
    await run('DELETE FROM board_lists WHERE id = ?', l.id);
    await touch(l.board_id);
    json(res, 200, { ok: true });
  });
  // Order a list's cards: newest or oldest first, by name, or by due date (no date last).
  api.post('/api/lists/:id/sort', async (req, res) => {
    const l = await mustList(req, req.params.id), by = String((await readJson(req)).by);
    const cards = await all<any>('SELECT id, title, created_at, due_at FROM board_cards WHERE list_id = ? AND archived = 0', l.id);
    const cmp: Record<string, (a: any, b: any) => number> = {
      newest: (a, b) => b.created_at - a.created_at, oldest: (a, b) => a.created_at - b.created_at,
      name: (a, b) => a.title.localeCompare(b.title, 'vi', { numeric: true }), due: (a, b) => (a.due_at ?? Infinity) - (b.due_at ?? Infinity),
    };
    if (!cmp[by]) throw new HttpError(400, 'Cách sắp xếp không hợp lệ');
    for (const [i, c] of cards.sort(cmp[by]).entries()) await run('UPDATE board_cards SET pos = ? WHERE id = ?', i + 1, c.id);
    await touch(l.board_id);
    json(res, 200, { ok: true });
  });
  // Every card of the list to the end of another list of the same board.
  api.post('/api/lists/:id/move-cards', async (req, res) => {
    const l = await mustList(req, req.params.id), to = await mustList(req, String((await readJson(req)).to));
    if (to.board_id !== l.board_id) throw new HttpError(400, 'Chỉ chuyển trong cùng một board');
    const base = (await get<any>('SELECT MAX(pos) m FROM board_cards WHERE list_id = ?', to.id))?.m || 0;
    const cards=await all<any>('SELECT id FROM board_cards WHERE list_id = ? ORDER BY pos',l.id);
    const u=await me(req);
    for(const c of cards) await assertLinkedTaskEditable(c.id,u.id);
    for (const [i,c] of cards.entries()) {
      await run('UPDATE board_cards SET list_id = ?, pos = ? WHERE id = ?',to.id,base+i+1,c.id);
      if(to.id!==l.id) await syncCardToTask(c.id,true,u.id);
    }
    await touch(l.board_id);
    json(res, 200, { ok: true });
  });
  // Each card stays with whoever made it: this archives the asker's own cards in the list and leaves the others.
  api.post('/api/lists/:id/archive-cards', async (req, res) => {
    const l = await mustList(req, req.params.id), u = await me(req), level = (await mustBoard(req, l.board_id)).level;
    const cards = await all<any>('SELECT id, created_by FROM board_cards WHERE list_id = ? AND archived = 0', l.id);
    const mine = cards.filter((c) => isOwner(c, u, level));
    for (const c of mine) await run('UPDATE board_cards SET archived = 1 WHERE id = ?', c.id);
    if (mine.length) await log(l.board_id, null, u.id, 'list.archive-cards', { name: l.name, n: mine.length });
    await touch(l.board_id);
    json(res, 200, { archived: mine.map((c) => c.id), kept: cards.length - mine.length });
  });
  // A copy of the list (with its cards' titles, labels and dates) right after it.
  api.post('/api/lists/:id/copy', async (req, res) => {
    const l = await mustList(req, req.params.id), name = text((await readJson(req)).name || l.name, 80, 'tên danh sách'), t = now();
    const id = uid('l_');
    await run('INSERT INTO board_lists(id, board_id, name, pos, created_at) VALUES(?,?,?,?,?)', id, l.board_id, name, l.pos + 0.5, t);
    for (const c of await all<any>('SELECT * FROM board_cards WHERE list_id = ? AND archived = 0 ORDER BY pos', l.id)) {
      const cid = uid('k_');
      await run('INSERT INTO board_cards(id, board_id, list_id, title, pos, created_by, created_at, updated_at, description, start_at, due_at, done, cover, customer_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        cid, c.board_id, id, c.title, c.pos, (await me(req)).id, t, t, c.description, c.start_at, c.due_at, c.done, c.cover, c.customer_id);
      for (const x of await all<any>('SELECT label_id FROM card_labels WHERE card_id = ?', c.id)) await run('INSERT OR IGNORE INTO card_labels(card_id, label_id) VALUES(?,?)', cid, x.label_id);
    }
    await place('board_lists', await all<any>('SELECT id FROM board_lists WHERE board_id = ? AND archived = 0 ORDER BY pos', l.board_id), id, (await all<any>('SELECT id FROM board_lists WHERE board_id = ? AND archived = 0 AND pos <= ? ORDER BY pos', l.board_id, l.pos)).length);
    await touch(l.board_id);
    json(res, 201, { id });
  });

  // ---------------------------------------------------------------- cards
  api.post('/api/lists/:id/cards', async (req, res) => {
    const l = await mustList(req, req.params.id), b = await readJson(req), title = text(b.title, 500, 'tên thẻ'), u = await me(req);
    const id = uid('k_'), t = now();
    const pos = b.top ? ((await get<any>('SELECT MIN(pos) m FROM board_cards WHERE list_id = ?', l.id))?.m ?? 1) - 1 : ((await get<any>('SELECT MAX(pos) m FROM board_cards WHERE list_id = ?', l.id))?.m || 0) + 1;
    await run('INSERT INTO board_cards(id, board_id, list_id, title, pos, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)', id, l.board_id, l.id, title, pos, u.id, t, t);
    await log(l.board_id, id, u.id, 'card.add', { list: l.name });
    await touch(l.board_id);
    json(res, 201, (await fronts(l.board_id,0,(await me(req)).id)).find((c) => c.id === id));
  });
  api.get('/api/cards/:id', async (req, res) => json(res, 200, await cardOut(await mustCard(req, req.params.id, 'observer'), await me(req))));
  // Any of: title, description, startAt, dueAt (ms or null), done, cover (colour or null), archived, customerId (the
  // customer the task is for, or null); or a move to `listId` (same board) at `index`.
  api.put('/api/cards/:id', async (req, res) => {
    const c = await mustCard(req, req.params.id), b = await readJson(req), u = await me(req);
    if (['title', 'description', 'startAt', 'dueAt', 'done', 'listId'].some((k) => b[k] !== undefined)) await assertLinkedTaskEditable(c.id, u.id);
    const set: [string, any][] = [], news: string[] = [];
    if (b.title !== undefined) set.push(['title', text(b.title, 500, 'tên thẻ')]);
    if (b.description !== undefined && long(b.description, 20000) !== (c.description || '')) {
      const writer = await cardDescriptionWriter(c), next = long(b.description, 20000);
      await assertDescriptionWriter(u, c.description, writer);
      set.push(['description', next], ['description_by', nextDescriptionWriter(u, c.description, next, writer)]);
    }
    if (b.startAt !== undefined) set.push(['start_at', time(b.startAt)]);
    if (b.dueAt !== undefined) { set.push(['due_at', time(b.dueAt)]); if (time(b.dueAt) !== c.due_at) { await log(c.board_id, c.id, u.id, 'card.due', { due: time(b.dueAt) }); news.push('due'); } }
    if (b.done !== undefined && !!b.done !== !!c.done) { set.push(['done', b.done ? 1 : 0]); await log(c.board_id, c.id, u.id, 'card.done', { done: !!b.done }); news.push(b.done ? 'done' : 'undone'); }
    if (b.cover !== undefined) set.push(['cover', COLORS.includes(b.cover) ? b.cover : null]);
    if (b.customerId !== undefined && (b.customerId || null) !== (c.customer_id || null)) {
      const k = b.customerId ? await get<any>('SELECT id, name FROM customers WHERE id = ?', String(b.customerId)) : null;
      if(k)await requireCustomer(u.id,k.id,'normal');
      if (b.customerId && !k) throw new HttpError(404, 'Không tìm thấy khách hàng');
      set.push(['customer_id', k?.id || null]); await log(c.board_id, c.id, u.id, 'card.customer', { name: k?.name || '' });
    }
    if (b.archived !== undefined && !!b.archived !== !!c.archived) {
      if (b.archived) ownCard(c, u);
      set.push(['archived', b.archived ? 1 : 0]); await log(c.board_id, c.id, u.id, b.archived ? 'card.archive' : 'card.restore');
    }
    if (set.length) await run(`UPDATE board_cards SET ${set.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...set.map(([, v]) => v), now(), c.id);
    if (b.listId !== undefined || b.index !== undefined) {
      const to = b.listId ? await mustList(req, String(b.listId)) : await get<any>('SELECT * FROM board_lists WHERE id = ?', c.list_id);
      if (to.board_id !== c.board_id) throw new HttpError(400, 'Chỉ chuyển thẻ trong cùng một board');
      const rows = await all<any>('SELECT id FROM board_cards WHERE list_id = ? AND archived = 0 ORDER BY pos', to.id);
      await place('board_cards', rows, c.id, b.index !== undefined ? Number(b.index) || 0 : rows.length, { list_id: to.id });
      if (to.id !== c.list_id) { await log(c.board_id, c.id, u.id, 'card.move', { from: (await get<any>('SELECT name FROM board_lists WHERE id = ?', c.list_id))?.name || '', to: to.name }); news.push('move:' + to.name); }
    }
    await touch(c.board_id);
    if (news.length) {
      // The card's members hear about a move, a new due date or completion; people of a linked task hear it from the task.
      const link = await get<any>('SELECT task_id FROM task_board_links WHERE card_id = ?', c.id);
      const told = new Set(link ? (await all<any>('SELECT p.user_id FROM task_assignees a JOIN task_people p ON p.id = a.person_id WHERE a.task_id = ? AND p.user_id IS NOT NULL UNION SELECT user_id FROM task_followers WHERE task_id = ?', link.task_id, link.task_id)).map((r) => r.user_id) : []);
      const move = news.find((x) => x.startsWith('move:'));
      const title = news.length > 1 ? 'Thẻ của bạn được cập nhật' : move ? 'Thẻ của bạn được chuyển danh sách' : news[0] === 'due' ? 'Thẻ của bạn được đổi hạn' : news[0] === 'done' ? 'Thẻ của bạn đã hoàn thành' : 'Thẻ của bạn được mở lại';
      await notifyPeople((await all<any>('SELECT user_id FROM card_members WHERE card_id = ?', c.id)).map((r) => r.user_id).filter((id) => !told.has(id)), u.id,
        { title, body: move ? `${c.title} → ${move.slice(5)}` : c.title, link: `#boards/${c.board_id}/c/${c.id}`, cardId: c.id });
    }
    if (['title', 'description', 'startAt', 'dueAt', 'done', 'listId'].some((k) => b[k] !== undefined)) await syncCardToTask(c.id, b.listId !== undefined && b.listId !== c.list_id, u.id);
    json(res, 200, await cardOut({ ...await get<any>('SELECT * FROM board_cards WHERE id = ?', c.id), level: c.level }, u));
  });
  api.delete('/api/cards/:id', async (req, res) => {
    const c = await mustCard(req, req.params.id);
    ownCard(c, await me(req));
    await dropCards('id = ?', c.id);
    await touch(c.board_id);
    json(res, 200, { ok: true });
  });
  // A copy right after the card: title, description, dates, cover, labels and checklists.
  api.post('/api/cards/:id/copy', async (req, res) => {
    const c = await mustCard(req, req.params.id), u = await me(req), t = now(), id = uid('k_');
    const title = text((await readJson(req)).title || c.title, 500, 'tên thẻ');
    await run('INSERT INTO board_cards(id, board_id, list_id, title, pos, created_by, created_at, updated_at, description, start_at, due_at, done, cover, customer_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, c.board_id, c.list_id, title, c.pos + 0.5, u.id, t, t, c.description, c.start_at, c.due_at, 0, c.cover, c.customer_id);
    for (const x of await all<any>('SELECT label_id FROM card_labels WHERE card_id = ?', c.id)) await run('INSERT OR IGNORE INTO card_labels(card_id, label_id) VALUES(?,?)', id, x.label_id);
    for (const k of await all<any>('SELECT * FROM card_checklists WHERE card_id = ? ORDER BY pos', c.id)) {
      const kid = uid('cl_');
      await run('INSERT INTO card_checklists(id, card_id, title, pos) VALUES(?,?,?,?)', kid, id, k.title, k.pos);
      for (const i of await all<any>('SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY pos', k.id)) await run('INSERT INTO checklist_items(id, checklist_id, card_id, text, done, pos) VALUES(?,?,?,?,?,?)', uid('ci_'), kid, id, i.text, 0, i.pos);
    }
    await place('board_cards', await all<any>('SELECT id FROM board_cards WHERE list_id = ? AND archived = 0 ORDER BY pos', c.list_id), id, (await all<any>('SELECT id FROM board_cards WHERE list_id = ? AND archived = 0 AND pos <= ?', c.list_id, c.pos)).length);
    await log(c.board_id, id, u.id, 'card.copy', { from: c.title });
    await touch(c.board_id);
    json(res, 201, { id });
  });
  api.put('/api/cards/:id/labels', async (req, res) => {
    const c = await mustCard(req, req.params.id), b = await readJson(req);
    const l = await get<any>('SELECT id FROM board_labels WHERE id = ? AND board_id = ?', String(b.labelId), c.board_id);
    if (!l) throw new HttpError(404, 'Không tìm thấy nhãn');
    if (b.on) await run('INSERT OR IGNORE INTO card_labels(card_id, label_id) VALUES(?,?)', c.id, l.id);
    else await run('DELETE FROM card_labels WHERE card_id = ? AND label_id = ?', c.id, l.id);
    await touch(c.board_id);
    json(res, 200, { ok: true });
  });
  api.put('/api/cards/:id/members', async (req, res) => {
    const c = await mustCard(req, req.params.id), b = await readJson(req), u = await me(req);
    const board = await get<any>('SELECT * FROM boards WHERE id = ?', c.board_id);
    let who = (await membersOf(board)).find((m) => m.id === String(b.userId));
    if (b.on) {
      // Anyone on the team can be put on a card: someone not on the board yet joins it, and the card's customer and
      // project open to them as a member (their level can be changed afterwards in those members dialogs).
      const person = who || await get<any>('SELECT id, name FROM users WHERE id = ? AND disabled = 0', String(b.userId));
      if (!person) throw new HttpError(404, 'Không tìm thấy nhân viên');
      const task = await get<any>('SELECT t.project_id FROM task_board_links l JOIN tasks t ON t.id = l.task_id WHERE l.card_id = ?', c.id);
      await grantAccess(person.id, u.id, { customerId: c.customer_id, projectId: task?.project_id }, 'normal');
      if (!(await visibleCardIds(person.id)).has(c.id)) throw new HttpError(400, `${person.name} chưa xem được thẻ này.`);
      if (!who) {
        await run('INSERT INTO board_members(board_id, user_id, role, added_by, created_at) VALUES(?,?,?,?,?) ON CONFLICT(board_id, user_id) DO NOTHING', board.id, person.id, 'normal', u.id, now());
        await log(board.id, null, u.id, 'board.member', { name: person.name, level: 'normal' });
        who = (await membersOf(board)).find((m) => m.id === person.id);
      }
    }
    if (!who) throw new HttpError(404, 'Người này không xem được board');
    if (b.on && (await run('INSERT OR IGNORE INTO card_members(card_id, user_id) VALUES(?,?)', c.id, who.id)).changes)
      await notifyPeople([who.id], u.id, { title: 'Bạn được thêm vào thẻ', body: `${c.title} · ${board.name}`, link: `#boards/${board.id}/c/${c.id}`, cardId: c.id });
    else await run('DELETE FROM card_members WHERE card_id = ? AND user_id = ?', c.id, who.id);
    await log(c.board_id, c.id, u.id, 'card.member', { name: who.name, on: !!b.on, self: who.id === u.id });
    await touch(c.board_id);
    json(res, 200, { ok: true });
  });

  // ---------------------------------------------------------------- checklists, comments, attachments
  api.post('/api/cards/:id/checklists', async (req, res) => {
    const c = await mustCard(req, req.params.id), title = text((await readJson(req)).title || 'Việc cần làm', 200, 'tên checklist');
    const id = uid('cl_'), pos = ((await get<any>('SELECT MAX(pos) m FROM card_checklists WHERE card_id = ?', c.id))?.m || 0) + 1;
    await run('INSERT INTO card_checklists(id, card_id, title, pos) VALUES(?,?,?,?)', id, c.id, title, pos);
    await touch(c.board_id);
    json(res, 201, { id, title, items: [] });
  });
  api.put('/api/checklists/:id', async (req, res) => {
    const { x, card } = await mustPart(req, 'card_checklists', req.params.id);
    await run('UPDATE card_checklists SET title = ? WHERE id = ?', text((await readJson(req)).title, 200, 'tên checklist'), x.id);
    await touch(card.board_id);
    json(res, 200, { ok: true });
  });
  api.delete('/api/checklists/:id', async (req, res) => {
    const { x, card } = await mustPart(req, 'card_checklists', req.params.id);
    await run('DELETE FROM checklist_items WHERE checklist_id = ?', x.id);
    await run('DELETE FROM card_checklists WHERE id = ?', x.id);
    await touch(card.board_id);
    json(res, 200, { ok: true });
  });
  api.post('/api/checklists/:id/items', async (req, res) => {
    const { x, card } = await mustPart(req, 'card_checklists', req.params.id);
    const t = text((await readJson(req)).text, 500, 'nội dung'), id = uid('ci_');
    const pos = ((await get<any>('SELECT MAX(pos) m FROM checklist_items WHERE checklist_id = ?', x.id))?.m || 0) + 1;
    await run('INSERT INTO checklist_items(id, checklist_id, card_id, text, done, pos) VALUES(?,?,?,?,?,?)', id, x.id, card.id, t, 0, pos);
    await touch(card.board_id);
    json(res, 201, { id, text: t, done: false });
  });
  api.put('/api/items/:id', async (req, res) => {
    const { x, card } = await mustPart(req, 'checklist_items', req.params.id), b = await readJson(req);
    if (b.text !== undefined) await run('UPDATE checklist_items SET text = ? WHERE id = ?', text(b.text, 500, 'nội dung'), x.id);
    if (b.done !== undefined && !!b.done !== !!x.done) {
      await run('UPDATE checklist_items SET done = ? WHERE id = ?', b.done ? 1 : 0, x.id);
      if (b.done) await log(card.board_id, card.id, (await me(req)).id, 'item.done', { text: x.text });
    }
    await touch(card.board_id);
    json(res, 200, { ok: true });
  });
  api.delete('/api/items/:id', async (req, res) => {
    const { x, card } = await mustPart(req, 'checklist_items', req.params.id);
    await run('DELETE FROM checklist_items WHERE id = ?', x.id);
    await touch(card.board_id);
    json(res, 200, { ok: true });
  });
  // Observers too may comment, like on Trello.
  api.post('/api/cards/:id/comments', async (req, res) => {
    const c = await mustCard(req, req.params.id, 'observer'), u = await me(req), t = long((await readJson(req)).text, 10000).trim(), id = uid('cm_');
    if (!t) throw new HttpError(400, 'Hãy nhập bình luận');
    await run('INSERT INTO card_comments(id, card_id, board_id, user_id, text, created_at, updated_at) VALUES(?,?,?,?,?,?,?)', id, c.id, c.board_id, u.id, t, now(), now());
    await touch(c.board_id);
    await notifyPeople((await all<any>('SELECT user_id FROM card_members WHERE card_id = ?', c.id)).map((r) => r.user_id), u.id,
      { title: 'Bình luận mới trên thẻ của bạn', body: `${u.name} · ${c.title}`, link: `#boards/${c.board_id}/c/${c.id}`, cardId: c.id, commentId: id });
    json(res, 201, { id });
  });
  // The author edits a comment; the author or a board admin deletes it.
  api.put('/api/comments/:id', async (req, res) => {
    const { x, card } = await mustPart(req, 'card_comments', req.params.id, 'observer'), u = await me(req);
    if (x.user_id !== u.id) throw new HttpError(403, 'Chỉ người viết mới sửa được bình luận');
    const t = long((await readJson(req)).text, 10000).trim();
    if (!t) throw new HttpError(400, 'Hãy nhập bình luận');
    await run('UPDATE card_comments SET text = ?, updated_at = ? WHERE id = ?', t, now(), x.id);
    await touch(card.board_id);
    json(res, 200, { ok: true });
  });
  api.delete('/api/comments/:id', async (req, res) => {
    const { x, card } = await mustPart(req, 'card_comments', req.params.id, 'observer'), u = await me(req);
    if (x.user_id !== u.id && card.level !== 'admin') throw new HttpError(403, 'Chỉ người viết hoặc quản trị board mới xoá được bình luận');
    await run('DELETE FROM card_comments WHERE id = ?', x.id);
    await touch(card.board_id);
    json(res, 200, { ok: true });
  });
  // A link (a Drive file or folder, a sheet, any page) on the card.
  api.post('/api/cards/:id/attachments', async (req, res) => {
    const c = await mustCard(req, req.params.id), u = await me(req), b = await readJson(req);
    const url = String(b.url || '').trim();
    try { if (!/^https?:$/.test(new URL(url).protocol)) throw 0; } catch { throw new HttpError(400, 'Hãy dán một đường link (http… hoặc https…)'); }
    const name = long(b.name, 200).trim() || url.replace(/^https?:\/\//, '').slice(0, 80);
    const id = uid('at_');
    await run('INSERT INTO card_attachments(id, card_id, user_id, name, url, created_at) VALUES(?,?,?,?,?,?)', id, c.id, u.id, name, url.slice(0, 2000), now());
    await log(c.board_id, c.id, u.id, 'attach', { name });
    await touch(c.board_id);
    json(res, 201, { id });
  });
  api.delete('/api/attachments/:id', async (req, res) => {
    const { x, card } = await mustPart(req, 'card_attachments', req.params.id);
    await run('DELETE FROM card_attachments WHERE id = ?', x.id);
    await touch(card.board_id);
    json(res, 200, { ok: true });
  });
  // Videos of the card's customer (keys of files in its folder), for those who open customers' folders (Drive page).
  api.post('/api/cards/:id/videos', async (req, res) => {
    const c = await mustCard(req, req.params.id), u = await me(req), keys = (await readJson(req)).keys;
    if (u.role !== 'admin' && !(await pagesOf(u)).includes('workspace')) throw new HttpError(403, 'Bạn chưa được cấp quyền vào Drive của khách hàng');
    if (!c.customer_id) throw new HttpError(400, 'Hãy chọn khách hàng cho thẻ trước');
    if (!Array.isArray(keys) || !keys.length || keys.length > 50) throw new HttpError(400, 'Hãy chọn video');
    const have = new Set((await all<any>('SELECT file_key FROM card_attachments WHERE card_id = ? AND customer_id = ?', c.id, c.customer_id)).map((r) => r.file_key));
    let added = 0;
    for (const key of new Set(keys.map(String))) {
      if (have.has(key)) continue;
      const f = await customerFile(c.customer_id, key);
      await run('INSERT INTO card_attachments(id, card_id, user_id, name, url, created_at, customer_id, file_key) VALUES(?,?,?,?,?,?,?,?)', uid('at_'), c.id, u.id, f.name.slice(0, 200), f.url, now(), c.customer_id, key);
      await log(c.board_id, c.id, u.id, 'attach', { name: f.name });
      added++;
    }
    if (added) await touch(c.board_id);
    json(res, 201, { added });
  });

  // ---------------------------------------------------------------- each person's inbox and planner, like Trello's
  // The inbox: things to do jotted down before they go on a board; dragged onto a list, one becomes a card there.
  const inboxOut = (x: any) => ({ id: x.id, title: x.title, done: !!x.done, createdAt: x.created_at });
  async function myItem(req: Req) {
    const x = await get<any>('SELECT * FROM inbox_cards WHERE id = ? AND user_id = ?', req.params.id, (await me(req)).id);
    if (!x) throw new HttpError(404, 'Không tìm thấy thẻ trong Inbox');
    return x;
  }
  api.get('/api/inbox', async (req, res) => json(res, 200, (await all<any>('SELECT * FROM inbox_cards WHERE user_id = ? ORDER BY pos', (await me(req)).id)).map(inboxOut)));
  api.post('/api/inbox', async (req, res) => {
    const u = await me(req), b = await readJson(req), title = text(b.title, 500, 'tên thẻ'), t = now(), id = uid('ib_');
    const edge = (await get<any>(`SELECT ${b.top ? 'MIN' : 'MAX'}(pos) p FROM inbox_cards WHERE user_id = ?`, u.id))?.p ?? 0;
    await run('INSERT INTO inbox_cards(id, user_id, title, pos, done, created_at, updated_at) VALUES(?,?,?,?,0,?,?)', id, u.id, title, edge + (b.top ? -1 : 1), t, t);
    json(res, 201, inboxOut(await get('SELECT * FROM inbox_cards WHERE id = ?', id)));
  });
  // Any of: title, done, index (its place in the inbox).
  api.put('/api/inbox/:id', async (req, res) => {
    const x = await myItem(req), b = await readJson(req);
    if (b.title !== undefined) await run('UPDATE inbox_cards SET title = ?, updated_at = ? WHERE id = ?', text(b.title, 500, 'tên thẻ'), now(), x.id);
    if (b.done !== undefined) await run('UPDATE inbox_cards SET done = ?, updated_at = ? WHERE id = ?', b.done ? 1 : 0, now(), x.id);
    if (b.index !== undefined) await place('inbox_cards', await all<any>('SELECT id FROM inbox_cards WHERE user_id = ? ORDER BY pos', x.user_id), x.id, Number(b.index) || 0);
    json(res, 200, inboxOut(await get('SELECT * FROM inbox_cards WHERE id = ?', x.id)));
  });
  api.delete('/api/inbox/:id', async (req, res) => {
    await run('DELETE FROM inbox_cards WHERE id = ?', (await myItem(req)).id);
    json(res, 200, { ok: true });
  });
  // Onto a board: the item becomes a card of `listId` at `index`, made by this person (who must be able to edit the board).
  api.post('/api/inbox/:id/to-list', async (req, res) => {
    const x = await myItem(req), b = await readJson(req), l = await mustList(req, String(b.listId || '')), u = await me(req), t = now(), id = uid('k_');
    await run('INSERT INTO board_cards(id, board_id, list_id, title, pos, created_by, created_at, updated_at, done) VALUES(?,?,?,?,?,?,?,?,?)', id, l.board_id, l.id, x.title, 0, u.id, t, t, x.done);
    const rows = await all<any>('SELECT id FROM board_cards WHERE list_id = ? AND archived = 0 ORDER BY pos', l.id);
    await place('board_cards', rows, id, b.index !== undefined ? Number(b.index) || 0 : rows.length - 1);
    await run('DELETE FROM inbox_cards WHERE id = ?', x.id);
    await log(l.board_id, id, u.id, 'card.add', { list: l.name });
    await touch(l.board_id);
    json(res, 201, (await fronts(l.board_id,0,(await me(req)).id)).find((c) => c.id === id));
  });
  // The planner: this person's cards (made by them or with them on it) with a start or due date in [from, to), on the
  // boards they see.
  api.get('/api/planner', async (req, res) => {
    const u = await me(req), level = await levels(u);
    const from = Number(req.query.get('from')) || 0, to = Number(req.query.get('to')) || 0;
    if (!from || to <= from || to - from > 62 * 864e5) throw new HttpError(400, 'Khoảng ngày không hợp lệ');
    const boards = new Map((await all<any>(BOARDS_SQL, u.id)).map((b) => [b.id, b] as const).filter(([, b]) => (b.level = level(b))));
    const rows = await all<any>(`SELECT c.id, c.title, c.board_id, c.due_at, c.start_at, c.done, l.name list FROM board_cards c JOIN board_lists l ON l.id = c.list_id
      WHERE c.archived = 0 AND l.archived = 0 AND (c.created_by = ? OR c.id IN (SELECT card_id FROM card_members WHERE user_id = ?))
      AND ((c.due_at >= ? AND c.due_at < ?) OR (c.start_at >= ? AND c.start_at < ?)) ORDER BY COALESCE(c.due_at, c.start_at)`, u.id, u.id, from, to, from, to);
    const visible=await visibleCardIds(u.id);
    json(res, 200, rows.filter((c) => boards.has(c.board_id)&&visible.has(c.id)).map((c) => {
      const b = boards.get(c.board_id);
      return { id: c.id, title: c.title, boardId: b.id, boardName: b.name, boardBg: bgOf(b), listName: c.list, dueAt: c.due_at ?? null, startAt: c.start_at ?? null, done: !!c.done, canEdit: b.level !== 'observer' };
    }));
  });

  // ---------------------------------------------------------------- customers' tasks
  /** The customers a card can be for (names only: anyone who edits cards picks one). */
  api.get('/api/boards-customers',async(req,res)=>{const u=await me(req);json(res,200,await all(`SELECT c.id,c.name FROM customers c WHERE ${customerAccessSql()} ORDER BY c.name`,u.id,u.id,u.id));});
  // The overview on the Drive page: every card for a customer on the boards this account sees, with its videos.
  api.get('/api/customer-tasks', async (req, res) => {
    const u = await me(req), level = await levels(u);
    const visible=await visibleCardIds(u.id);
    const boards = new Map((await all<any>(BOARDS_SQL, u.id)).filter((b) => level(b)).map((b) => [b.id, b]));
    const cards = (await all<any>(`SELECT c.id, c.title, c.board_id, c.customer_id, c.done, c.due_at, c.updated_at, l.name list FROM board_cards c JOIN board_lists l ON l.id = c.list_id
      WHERE c.customer_id IS NOT NULL AND c.archived = 0 AND l.archived = 0 ORDER BY c.updated_at DESC`)).filter((c) => boards.has(c.board_id)&&visible.has(c.id));
    const ids = new Set(cards.map((c) => c.id)), videos = new Map<string, any[]>();
    for (const a of await all<any>('SELECT * FROM card_attachments WHERE file_key IS NOT NULL ORDER BY created_at')) {
      if (!ids.has(a.card_id)) continue;
      if (!videos.has(a.card_id)) videos.set(a.card_id, []);
      videos.get(a.card_id)!.push(attachmentOut(a));
    }
    json(res, 200, cards.map((c) => {
      const b = boards.get(c.board_id);
      return { id: c.id, title: c.title, customerId: c.customer_id, boardId: b.id, boardName: b.name, boardBg: bgOf(b), listName: c.list, done: !!c.done, dueAt: c.due_at ?? null, updatedAt: c.updated_at, videos: videos.get(c.id) || [] };
    }));
  });

  // ---------------------------------------------------------------- search (the boards and cards this account sees)
  api.get('/api/boards-search', async (req, res) => {
    const u = await me(req), q = String(req.query.get('q') || '').trim().toLowerCase();
    if (q.length < 2) return json(res, 200, { boards: [], cards: [] });
    const level = await levels(u);
    const visible=await visibleCardIds(u.id);
    const boards = (await all<any>(BOARDS_SQL, u.id)).filter((b) => (b.level = level(b)));
    const ids = new Set(boards.map((b) => b.id)), names = new Map(boards.map((b) => [b.id, b]));
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const cards = (await all<any>(`SELECT c.id, c.title, c.board_id, l.name list FROM board_cards c JOIN board_lists l ON l.id = c.list_id
      WHERE c.archived = 0 AND (lower(c.title) LIKE ? ESCAPE '\\' OR lower(COALESCE(c.description, '')) LIKE ? ESCAPE '\\') ORDER BY c.updated_at DESC LIMIT 60`, like, like))
      .filter((c) => ids.has(c.board_id)&&visible.has(c.id)).slice(0, 20);
    json(res, 200, {
      boards: boards.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 8).map((b) => boardOut(b, false)),
      cards: cards.map((c) => ({ id: c.id, title: c.title, boardId: c.board_id, boardName: names.get(c.board_id)?.name || '', boardBg: bgOf(names.get(c.board_id) || { bg: 'ocean' }), listName: c.list })),
    });
  });
}
