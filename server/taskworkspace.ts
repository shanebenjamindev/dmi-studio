// Tasks on Workspace: each brand_service task routes to its dedicated service board (in the customer's workspace);
// tasks outside services route onto their maker's personal board.
import { createHash } from 'node:crypto';
import { all, get, getSetting, setSetting, run, now } from './db';
import { USER_SQL, deptLevel } from './auth';
import { taskBoardCategory, type TaskBoardCategory } from '../shared/task-routing';
import { boardLevelForUser } from './boards';
import { columnFor, syncTaskToCard } from './tasklinks';
import { statusKey } from './taskimport';
import { FLOW_COLUMNS, columnStage, listColor } from './flow-columns';
import { isFlowStage } from '../shared/task-flow';
import { brandServiceLevels } from './project-access';
import { customerBoardId, syncBoardGrants, syncBoardPeople, syncProjectBoards } from './board-people';
import { boardOfProject, gatherProjectCards, moveProjectBoard, serviceBoard } from './service-boards';
import { boardDisplayName } from './project-services';

const CATEGORIES: [TaskBoardCategory, string, string][] = [
  ['media', 'Media Execute', 'ocean'],
  ['content', 'Content / Script', 'sunset'],
  ['ads', 'Ads / Performance', 'grape'],
  ['website', 'Website', 'forest'],
  ['account', 'Account / Sale', 'sky'],
  ['general', 'Việc chung', 'slate'],
];

/** The board of an unclassified brand_service (no brand/customer): its own. */
export const projectBoardId = (brandServiceId: string) => `b_proj_${createHash('sha256').update(brandServiceId).digest('hex').slice(0, 16)}`;

/** A renamed brand_service's board takes the updated display name if not customized. */
export async function renameProjectBoard(brandServiceId: string, name: string, old?: string) {
  await run('UPDATE boards SET name=? WHERE id=?', name, projectBoardId(brandServiceId));
  const nextTitle = await boardDisplayName(brandServiceId, name);
  if (old) {
    await run('UPDATE boards SET name=? WHERE brand_service_id=? AND (name=? OR name LIKE ?)', nextTitle, brandServiceId, old, `% · ${old}`);
  }
}

const HOME_LISTS = FLOW_COLUMNS;
async function makeBoard(id: string, name: string, owner: string | null, customerId: string | null) {
  owner ||= (await get<any>("SELECT id FROM users WHERE role='admin' AND disabled=0 ORDER BY created_at,id LIMIT 1"))?.id || null;
  const t = now();
  const made = await run('INSERT OR IGNORE INTO boards(id,name,bg,created_by,pos,created_at,updated_at,private,customer_id) VALUES(?,?,?,?,?,?,?,1,?)', id, name, 'ocean', owner, 90, t, t, customerId);
  if (made.changes) for (const [i, l] of HOME_LISTS.entries()) await run('INSERT INTO board_lists(id,board_id,name,pos,created_at,color) VALUES(?,?,?,?,?,?)', listId(id, l), id, l, i + 1, t, listColor(l));
  return get<any>('SELECT * FROM boards WHERE id=?', id);
}

/** The customer's own board, made the first time. */
export async function customerBoard(customerId: string) {
  const k = await get<any>('SELECT id,name,created_by,manager_id FROM customers WHERE id=?', customerId);
  return k ? makeBoard(customerBoardId(k.id), k.name, k.created_by || k.manager_id, k.id) : null;
}

/** Where a brand_service lives on Workspace: its service board in the customer's workspace. */
export async function projectHome(brandServiceId: string) {
  const board = await serviceBoard(brandServiceId);
  return board ? { board, card: null as any } : null;
}

/** Sync board/card customer ownership when a brand_service moves across brands/customers. */
export async function projectCustomerChanged(brandServiceId: string) {
  const bs = await get<any>(
    'SELECT bs.*, br.customer_id FROM brand_services bs LEFT JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL WHERE bs.id=?',
    brandServiceId
  );
  if (!bs) return;
  await run(
    'UPDATE board_cards SET customer_id=?, updated_at=? WHERE brand_service_id=? OR id IN (SELECT l.card_id FROM task_board_links l JOIN tasks t ON t.id=l.task_id WHERE t.brand_service_id=?)',
    bs.customer_id || null,
    now(),
    bs.id,
    bs.id
  );
  if (await boardOfProject(bs.id)) await moveProjectBoard(bs.id);
  else if (bs.customer_id) { await serviceBoard(bs.id); await gatherProjectCards(bs.id); }
  await syncProjectBoards(bs.id);
}

export const syncProjectBoardMembers = (brandServiceId: string) => syncProjectBoards(brandServiceId);

async function listFor(board: any, task: any) {
  const status = task.status || 'Chưa thực hiện';
  const lists = await all<any>('SELECT * FROM board_lists WHERE board_id=? AND archived=0 ORDER BY pos', board.id);
  const named = (...n: string[]) => n.map((x) => lists.find((l) => l.name === x)).find(Boolean);
  const found =
    columnFor(lists, status) ||
    (isFlowStage(task.stage) ? lists.find((l) => columnStage(l.name) === task.stage) : undefined) ||
    (task.done_at ? named('Đã giao', 'Đã báo cáo') : /đánh giá|duyệt/i.test(status) ? named('Chờ duyệt') : statusKey(status) === 'todo' ? lists[0] : undefined);
  if (found) return found;
  const id = listId(board.id, status);
  await run('INSERT OR IGNORE INTO board_lists(id,board_id,name,pos,created_at,color) VALUES(?,?,?,?,?,?)', id, board.id, status, (lists.at(-1)?.pos || 0) + 1, now(), listColor(status));
  return get<any>('SELECT * FROM board_lists WHERE id=?', id);
}

/** Place a linked task's card onto its brand_service's board. */
export async function placeTaskCard(taskId: string) {
  const card = await get<any>('SELECT c.* FROM task_board_links l JOIN board_cards c ON c.id=l.card_id WHERE l.task_id=?', taskId);
  const task = await get<any>(
    'SELECT t.*, br.customer_id FROM tasks t LEFT JOIN brand_services bs ON bs.id=t.brand_service_id LEFT JOIN brands br ON br.id=bs.brand_id AND br.deleted_at IS NULL WHERE t.id=?',
    taskId
  );
  if (!card || !task?.brand_service_id) return;
  const home = await projectHome(task.brand_service_id);
  if (!home) return;
  if (card.board_id !== home.board.id) {
    const targetList = await listFor(home.board, task);
    const pos = ((await get<any>('SELECT MAX(pos) n FROM board_cards WHERE list_id=?', targetList.id))?.n || 0) + 1;
    const from = card.board_id;
    await run('UPDATE board_cards SET board_id=?,list_id=?,pos=?,service_card_id=NULL,customer_id=?,updated_at=? WHERE id=?', home.board.id, targetList.id, pos + 1, task.customer_id || null, now(), card.id);
    await run('DELETE FROM card_labels WHERE card_id=?', card.id);
    await run('UPDATE board_activity SET board_id=? WHERE card_id=?', home.board.id, card.id);
    await run('UPDATE boards SET updated_at=? WHERE id IN (?,?)', now(), home.board.id, from);
    await syncBoardPeople(from);
    await syncBoardGrants(from);
  }
  await shareTaskCard(taskId);
}

const listId = (board: string, status: string) => `l_task_${createHash('sha256').update(`${board}|${status}`).digest('hex').slice(0, 24)}`;

export async function routeTaskToWorkspace(taskId: string, userId: string, options: { includeParents?: boolean } = {}) {
  const task = await get<any>(
    'SELECT t.*, bs.name service_name, br.customer_id service_customer_id FROM tasks t LEFT JOIN brand_services bs ON bs.id=t.brand_service_id LEFT JOIN brands br ON br.id=bs.brand_id AND br.deleted_at IS NULL WHERE t.id=?',
    taskId
  );
  if (!task || (task.stub && !options.includeParents)) return false;
  if (task.brand_service_id && !(await brandServiceLevels(userId)).has(task.brand_service_id)) return false;
  const user = await get<any>(`${USER_SQL} WHERE u.id=? AND u.disabled=0`, userId);
  if (!user) return false;
  const linked = await get<any>('SELECT c.* FROM task_board_links l JOIN board_cards c ON c.id=l.card_id WHERE l.task_id=?', taskId);
  if (linked) {
    const board = await get<any>('SELECT * FROM boards WHERE id=?', linked.board_id);
    const level = board ? await boardLevelForUser(user, board) : null;
    if (level === 'normal' || level === 'admin') await syncTaskToCard(taskId);
    await placeTaskCard(taskId);
    return false;
  }
  if (!(await getSetting('task_workspace_auto', true))) return false;
  if (user.role !== 'admin' && deptLevel(user) === 'observer') return false;

  let board: any = null, parentCardId: string | null = null;
  const customerId = task.service_customer_id || null;

  if (task.brand_service_id) {
    const home = await projectHome(task.brand_service_id);
    if (home) board = home.board;
  } else if (customerId) {
    const custCard = await get<any>("SELECT id, board_id FROM board_cards WHERE card_kind='customer' AND customer_id=? AND archived=0 ORDER BY created_at LIMIT 1", customerId);
    if (custCard) {
      board = await get<any>('SELECT * FROM boards WHERE id=?', custCard.board_id);
      parentCardId = custCard.id;
    }
  }

  if (!board) board = await ownBoard(task, user, userId);
  const list = await listFor(board, task);
  const cardId = `k_task_${taskId}`, time = now();
  const pos = ((await get<any>('SELECT MAX(pos) n FROM board_cards WHERE list_id=?', list.id))?.n || 0) + 1;
  await run(
    "INSERT OR IGNORE INTO board_cards(id,board_id,list_id,title,pos,created_by,created_at,updated_at,card_kind,service_card_id,customer_id) VALUES(?,?,?,?,?,?,?,?,'task',?,?)",
    cardId,
    board.id,
    list.id,
    task.title,
    pos,
    userId,
    time,
    time,
    parentCardId,
    customerId
  );
  const result = await run('INSERT OR IGNORE INTO task_board_links(task_id,card_id) VALUES(?,?)', taskId, cardId);
  if (!result.changes) { await run('DELETE FROM board_cards WHERE id=? AND id NOT IN (SELECT card_id FROM task_board_links)', cardId); return false; }
  await run('UPDATE boards SET updated_at=? WHERE id=?', time, board.id);
  await syncTaskToCard(taskId);
  await shareTaskCard(taskId);
  return true;
}

async function ownBoard(task: any, user: any, userId: string) {
  const category = taskBoardCategory(task.title, task.service_name || '');
  const [_, name, bg] = CATEGORIES.find((c) => c[0] === category)!;
  const mapping = await getSetting<Record<string, string>>('task_workspace_boards', {});
  const key = `${userId}:${category}`;
  let board = mapping[key]?.startsWith('b_tasks_') ? await get<any>('SELECT * FROM boards WHERE id=?', mapping[key]) : null;
  if (board) { const level = await boardLevelForUser(user, board); if (level !== 'normal' && level !== 'admin') board = null; }
  board ||= await get<any>("SELECT * FROM boards WHERE id LIKE 'b_tasks_%' AND name=? AND created_by=? AND workspace_id IS NULL ORDER BY created_at LIMIT 1", name, userId);
  if (!board) {
    const id = `b_tasks_${category}_${createHash('sha256').update(userId).digest('hex').slice(0, 12)}`, time = now();
    await run('INSERT OR IGNORE INTO boards(id,name,bg,created_by,pos,created_at,updated_at,private) VALUES(?,?,?,?,?,?,?,1)', id, name, bg, userId, 100, time, time);
    board = await get<any>('SELECT * FROM boards WHERE id=?', id);
  }
  mapping[key] = board.id;
  await setSetting('task_workspace_boards', mapping);
  return board;
}

export const assigneeUsers = async (taskId: string) =>
  (await all<any>('SELECT DISTINCT p.user_id FROM task_assignees a JOIN task_people p ON p.id=a.person_id JOIN users u ON u.id=p.user_id WHERE a.task_id=? AND u.disabled=0', taskId)).map((r) => r.user_id as string);

export async function shareTaskCard(taskId: string, before: string[] = []) {
  const card = await get<any>('SELECT c.id FROM task_board_links l JOIN board_cards c ON c.id=l.card_id WHERE l.task_id=? AND c.id=?', taskId, `k_task_${taskId}`);
  if (!card) return;
  const now_ = await assigneeUsers(taskId);
  for (const id of before.filter((x) => !now_.includes(x))) await run('DELETE FROM card_members WHERE card_id=? AND user_id=?', card.id, id);
  for (const id of now_) await run('INSERT OR IGNORE INTO card_members(card_id,user_id) VALUES(?,?)', card.id, id);
  const bsId = (await get<any>('SELECT brand_service_id FROM tasks WHERE id=?', taskId))?.brand_service_id;
  if (bsId) await syncProjectBoards(bsId);
}

export async function syncAllTasksToWorkspace(userId: string) {
  await setSetting('task_workspace_auto', true);
  const allowed = await brandServiceLevels(userId);
  const tasks = (await all<any>('SELECT id,brand_service_id FROM tasks ORDER BY created_at,id')).filter((t) => !t.brand_service_id || allowed.has(t.brand_service_id));
  let created = 0;
  for (const task of tasks) if (await routeTaskToWorkspace(task.id, userId, { includeParents: true })) created++;
  const linked = Number((await get<any>('SELECT COUNT(*) n FROM task_board_links WHERE task_id IN (SELECT value FROM json_each(?))', JSON.stringify(tasks.map((t) => t.id))))?.n || 0);
  return { total: tasks.length, created, linked, remaining: tasks.length - linked };
}
