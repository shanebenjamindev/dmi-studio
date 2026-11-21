import { removeTaskRecord, removeBrandServiceRecord, syncBrandServiceCards } from './work-sync';
import { reactionsOf, dropReactions } from './comment-reactions';
import { grantAccess, brandServiceLevels, requireBrandService } from './project-access';
import { customerLevel, customerLevels, requireCustomer } from './customer-access';
import { notificationSnapshot, notifyPeople, queueTaskNotifications } from './notifications';
import { ensureDefaultBrand } from './brands';
// Công việc: the team's tasks, imported from their task app's export or created directly into tables of their own:
// tasks (any depth of parent -> children), brand_services (Customer -> Brand -> Brand Service), people and labels.
import { Router, HttpError, json, readJson } from './http';
import { assigneeUsers, placeTaskCard, projectCustomerChanged, projectHome, renameProjectBoard, routeTaskToWorkspace, shareTaskCard, syncAllTasksToWorkspace, syncProjectBoardMembers } from './taskworkspace';
import { TASK_MASTER } from '../shared/task-master';
import { RICH_MAX, RICH_TOO_LONG } from '../shared/rich';
import { brandServiceStage, isHold } from '../shared/projects';
import { brandServiceCatalogMap, ensureFallbackCatalogService, oneService, saveBrandServiceCatalog, saveTaskServices, serviceIds, taskServices } from './project-services';
/** A brand_service is one catalog service of its brand (Khách → Nhãn hàng → Dịch vụ → Công việc). */
const ONE_SERVICE = 'Chỉ chọn một dịch vụ';
/** A description or result as written (formatted text is never cut, which would break it): too long is refused. */
const richIn = (x: unknown) => { const v = String(x ?? ''); if (v.length > RICH_MAX) throw new HttpError(413, RICH_TOO_LONG); return v; };
import type { Req } from './http';
import { all, get, getSetting, run, uid, now } from './db';
import { currentUser, deptLevel } from './auth';
import { mustBoard, mustCard, mustList, boardLevelForUser, levels as boardLevels } from './boards';
import { syncTaskToCard, taskDescriptionWriter, mayWriteDescription, assertDescriptionWriter, nextDescriptionWriter } from './tasklinks';
import { readTaskExport, readTaskSheet, statusKey, normName, type TaskRow } from './taskimport';
import { matcher } from './admin/common';
import { applyFlow, flowDetail, flowSettings, settleStages, stageOf, statusBlocked } from './task-flow';
import { isFlowFilter, flowMatch } from '../shared/flow-filter';
import { handOver, lastAdded } from './task-assign';
import { brandServiceFor, checkServiceFree, projectOf, serviceOf } from './service-boards';

const me = async (req: Req) => (await currentUser(req))!;
/** The names in the task data linked to this account. */
const myPeople = async (userId: string) => (await all<any>('SELECT id FROM task_people WHERE user_id = ?', userId)).map((r) => r.id as string);
/** What a task's status means now: not finished past its deadline is late, whatever the app said then. */
export function stateOf(t: { status: string; due_at: number | null; done_at: number | null }) {
  const k = statusKey(t.status);
  if (['todo', 'doing', 'paused', 'other'].includes(k) && !t.done_at && t.due_at && t.due_at < now()) return 'overdue';
  return k;
}
/** The statuses a task can be set to here (the app's words), until Quản trị › Công việc › Trạng thái has a list. */
const STATUSES = ['Chưa thực hiện', 'Đang thực hiện', 'Đang đánh giá', 'Tạm dừng', 'Hoàn thành', 'Hoàn thành muộn', 'Đã huỷ'];
/** The active statuses, in the order set in Quản trị. */
export async function taskStatuses(): Promise<string[]> {
  const rows = await all<any>('SELECT name FROM task_statuses WHERE active = 1 ORDER BY pos');
  return rows.length ? rows.map((r) => r.name as string) : STATUSES;
}

// ------------------------------------------------------------------ import
/** `links`: the account each name in the sheet is (null: none), as the importer chose it; remembered on the name for the
 *  next imports. Names left out keep what they had. */
export async function importTasks(text: string, userId: string, sourceName = '', links: Record<string, string | null> = {}) {
  let parsed: ReturnType<typeof readTaskExport>, sheet: ReturnType<typeof readTaskSheet>;
  try { sheet = readTaskSheet(text); parsed = sheet.titleColumn >= 0 ? readTaskExport(text) : { rows: [], skipped: 0, columns: [], sourceRows: [] }; } catch (e: any) { throw new HttpError(400, e.message); }
  const { rows, skipped } = parsed;
  if (!sheet.rows.length) throw new HttpError(400, 'File chưa có dòng dữ liệu');
  if (rows.length > 5000) throw new HttpError(400, 'Mỗi lần nhập tối đa 5.000 công việc');
  if (sheet.rows.length > 20000) throw new HttpError(400, 'Mỗi file tối đa 20.000 dòng bao gồm dòng nhóm và dòng trống');
  // Small, bounded parts also fit D1's row-size limit; the sheet never needs one giant database row.
  const parts: { start: number; rows: string[][]; taskIds: (string | null)[] }[] = [];
  let part = { start: 0, rows: [] as string[][], taskIds: [] as (string | null)[] }, bytes = 0;
  if (Buffer.byteLength(JSON.stringify(sheet.headers)) > 128000) throw new HttpError(400, 'Dòng tiêu đề quá lớn');
  for (const [i, row] of sheet.rows.entries()) {
    const length = Buffer.byteLength(JSON.stringify(row));
    if (length > 512000) throw new HttpError(400, `Dòng ${i + 2} quá lớn để lưu bảng`);
    if (part.rows.length && (part.rows.length >= 50 || bytes + length > 512000)) { parts.push(part); part = { start: i, rows: [], taskIds: [] }; bytes = 0; }
    part.rows.push(row); part.taskIds.push(null); bytes += length;
  }
  if (part.rows.length) parts.push(part);
  const t0 = now(), importId = uid('ti_');
  const count = { created: 0, updated: 0, parents: 0, stubs: 0, people: 0, linked: 0, projects: 0, labels: 0 };

  // Imported names work on their own; a name is an employee's account only when the importer says so (never by
  // matching names), and stays linked for the next imports.
  const people = new Map((await all<any>('SELECT id, name, user_id FROM task_people')).map((p) => [normName(p.name), { id: p.id as string, userId: (p.user_id || null) as string | null }]));
  const person = async (name: string) => {
    const k = normName(name);
    if (!k) return null;
    if (!people.has(k)) {
      const id = uid('tp_');
      await run('INSERT INTO task_people(id, name, user_id, created_at) VALUES(?,?,?,?)', id, name.trim(), null, t0);
      people.set(k, { id, userId: null }); count.people++;
    }
    return people.get(k)!.id;
  };
  for (const [name, account] of Object.entries(links)) {
    const id = await person(name), p = id && people.get(normName(name));
    if (!p || p.userId === account) continue;
    await run('UPDATE task_people SET user_id = ? WHERE id = ?', account, id);
    p.userId = account; if (account) count.linked++;
  }
  const allowedImportCustomers=await customerLevels(userId),allowedImportProjects=await brandServiceLevels(userId);
  const customers = (await all<any>('SELECT id, name FROM customers')).filter(c=>allowedImportCustomers.has(c.id)).map((c) => ({ id: c.id as string, k: normName(c.name) })).filter((c) => c.k.length >= 4);
  const projects = new Map((await all<any>('SELECT bs.id, bs.name, br.customer_id FROM brand_services bs LEFT JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL')).filter(p=>allowedImportProjects.has(p.id)&&(!p.customer_id||allowedImportCustomers.has(p.customer_id))).map((p) => [normName(p.name), p.id as string]));
  const catalogByName = new Map((await all<any>('SELECT id, name FROM service_catalog WHERE deleted_at IS NULL')).map((s) => [normName(s.name), s.id as string]));
  const project = async (name: string) => {
    const k = normName(name);
    if (!k) return null;
    if (!projects.has(k)) {
      // "MASTER | AutoPro DFW" belongs to the customer AutoPro DFW (the longest customer name inside it).
      const c = customers.filter((x) => k.includes(x.k)).sort((a, b) => b.k.length - a.k.length)[0];
      const brand = c ? await ensureDefaultBrand(c.id, userId) : null;
      const matchedCatId = catalogByName.get(k);
      const catId = matchedCatId && (!brand || !(await brandServiceFor(brand.id, matchedCatId)))
        ? matchedCatId
        : await ensureFallbackCatalogService(userId);
      const id = uid('tj_');
      const userRow = await get<any>('SELECT team_role FROM users WHERE id=?', userId);
      await run('INSERT INTO brand_services(id, brand_id, catalog_service_id, name, created_by, team_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)',
        id, brand?.id || null, catId, name.trim(), userId, userRow?.team_role || null, t0, t0);
      projects.set(k, id); count.projects++;
    }
    return projects.get(k)!;
  };
  const labels = new Map((await all<any>('SELECT id, name FROM task_labels')).map((l) => [normName(l.name), l.id as string]));
  const label = async (name: string) => {
    const k = normName(name);
    if (!labels.has(k)) { const id = uid('tl_'); await run('INSERT INTO task_labels(id, name) VALUES(?,?)', id, name.trim()); labels.set(k, id); count.labels++; }
    return labels.get(k)!;
  };

  // Tasks: the app's ID says which one a row is (without one: the same title in the same brand_service).
  const byTitle = new Map<string, { id: string; project: string | null }[]>();
  for (const t of await all<any>('SELECT id, title, brand_service_id FROM tasks')) {
    const k = normName(t.title);
    byTitle.set(k, [...(byTitle.get(k) || []), { id: t.id, project: t.brand_service_id }]);
  }
  const done: { row: TaskRow; id: string; project: string | null }[] = [], granted = new Set<string>();
  for (const row of rows) {
    const projectId = await project(row.project), createdBy = await person(row.createdBy);
    const old = row.externalId
      ? await get<any>('SELECT id FROM tasks WHERE external_id = ?', row.externalId)
      : await get<any>("SELECT id FROM tasks WHERE external_id IS NULL AND title = ? AND COALESCE(brand_service_id, '') = ?", row.title, projectId || '');
    const fields = [row.title, row.status, row.startAt, row.dueAt, row.doneAt, projectId, row.description, row.result, createdBy, row.sourceUpdatedAt, importId] as const;
    let id: string;
    if (old) {
      const oldProject=(await get<any>('SELECT brand_service_id FROM tasks WHERE id=?',old.id))?.brand_service_id;if(oldProject)await requireBrandService(userId,oldProject,'normal');
      const customer=(await get<any>('SELECT br.customer_id FROM tasks t JOIN brand_services bs ON bs.id=t.brand_service_id LEFT JOIN brands br ON br.id=bs.brand_id AND br.deleted_at IS NULL WHERE t.id=?',old.id))?.customer_id;
      if(customer)await requireCustomer(userId,customer,'normal');
      id = old.id;
      // The source app's status is the task's again: its stage is read anew from it (settleStages, below).
      await run('UPDATE tasks SET title=?, status=?, start_at=?, due_at=?, done_at=?, brand_service_id=?, description=?, result=?, created_by=?, source_updated_at=?, import_id=?, stub=0, stage=NULL, updated_at=? WHERE id=?', ...fields, t0, id);
      count.updated++;
    } else {
      id = uid('tk_');
      await run('INSERT INTO tasks(id, external_id, title, status, start_at, due_at, done_at, brand_service_id, description, result, created_by, source_updated_at, import_id, stub, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)',
        id, row.externalId || null, ...fields, t0, t0);
      count.created++;
      const k = normName(row.title);
      byTitle.set(k, [...(byTitle.get(k) || []), { id, project: projectId }]);
    }
    // One person does it, the last one the row names (server/task-assign.ts); those named before them follow it.
    const named: { p: string; account: string | null }[] = [];
    for (const name of row.assignees) { const p = await person(name); if (p) named.push({ p, account: people.get(normName(name))!.userId || null }); }
    const doer = named.at(-1);
    for (const { account } of named.slice(0, -1)) if (account) await run('INSERT OR IGNORE INTO task_followers(task_id, user_id) VALUES(?,?)', id, account);
    await handOver(id, doer?.p ?? null);
    // As when a task is assigned by hand: an employee opens the brand_service of the work given to them.
    for (const { account } of named) {
      const grant = `${account}|${projectId}`;
      if (account && projectId && !granted.has(grant)) { granted.add(grant); await grantAccess(account, userId, { brandServiceId: projectId }, account === doer?.account ? 'normal' : 'observer'); }
    }
    await run('DELETE FROM task_label_links WHERE task_id = ?', id);
    for (const name of row.labels) await run('INSERT OR IGNORE INTO task_label_links(task_id, label_id) VALUES(?,?)', id, await label(name));
    done.push({ row, id, project: projectId });
  }

  // Parents, once every row is in: by the app's ID, else by title (same brand_service first); a parent the export leaves out
  // is kept as a placeholder task so its children stay together. Never under itself or one of its own children.
  for (const { row, id, project: projectId } of done) {
    if (!row.parent) { await run('UPDATE tasks SET parent_id = NULL WHERE id = ?', id); continue; }
    let parent = /^\d+$/.test(row.parent) ? (await get<any>('SELECT id FROM tasks WHERE external_id = ?', row.parent))?.id as string | undefined : undefined;
    if (!parent) {
      const same = byTitle.get(normName(row.parent)) || [];
      parent = (same.find((x) => x.project === projectId) || same[0])?.id;
    }
    if (!parent) {
      parent = uid('tk_');
      await run("INSERT INTO tasks(id, external_id, title, status, brand_service_id, import_id, stub, created_at, updated_at) VALUES(?,NULL,?,'',?,?,1,?,?)", parent, row.parent, projectId, importId, t0, t0);
      byTitle.set(normName(row.parent), [{ id: parent, project: projectId }]);
      count.stubs++;
    }
    let up: string | null = parent, loop = false;
    for (let n = 0; up && n < 50; n++) { if (up === id) { loop = true; break; } up = (await get<any>('SELECT parent_id FROM tasks WHERE id = ?', up))?.parent_id || null; }
    if (loop) continue;
    await run('UPDATE tasks SET parent_id = ? WHERE id = ?', parent, id);
    count.parents++;
  }
  for (const x of done) { await routeTaskToWorkspace(x.id,userId); }
  await run('INSERT INTO task_imports(id, user_id, rows, created, updated, created_at) VALUES(?,?,?,?,?,?)', importId, userId, rows.length, count.created, count.updated, t0);
  const ids = new Map(parsed.sourceRows.map((sourceRow, i) => [sourceRow, done[i].id]));
  for (const [i, p] of parts.entries()) {
    p.taskIds = p.rows.map((_, row) => ids.get(p.start + row) || null);
    await run('INSERT INTO task_import_sheet_parts(import_id,part,data) VALUES(?,?,?)', importId, i, JSON.stringify(p));
  }
  const name = sourceName.trim().slice(0,255) || `Bảng đã nhập ${new Date(t0).toISOString().slice(0,10)}`;
  await run('INSERT INTO task_import_sheets(import_id,name,headers,row_count,parts,title_column) VALUES(?,?,?,?,?,?)', importId, name, JSON.stringify(sheet.headers), sheet.rows.length, parts.length, sheet.titleColumn);
  await settleStages();
  return { rows: rows.length, skipped, ...count, importId, sourceName: name, sheetRows: sheet.rows.length, sheetColumns: sheet.headers.length };
}

// ------------------------------------------------------------------ reading
/** People and labels of every task, by task. `customers`: the asker's customer levels, when the caller has them. */
async function links(req:Req,customers?:Awaited<ReturnType<typeof customerLevels>>) {
  const user=await me(req);
  // Independent reads, all at once (each is a round trip to D1).
  const [people,labels,following,level,boards,cards,pLevels,onCards]=await Promise.all([
    // A name linked to an employee shows as that employee.
    all<any>('SELECT a.task_id, p.id, COALESCE(u.name, p.name) name, p.user_id, u.avatar_at FROM task_assignees a JOIN task_people p ON p.id = a.person_id LEFT JOIN users u ON u.id = p.user_id ORDER BY 3'),
    all<any>('SELECT k.task_id, l.name FROM task_label_links k JOIN task_labels l ON l.id = k.label_id ORDER BY l.name'),
    all<any>('SELECT f.task_id, u.id, u.name, u.avatar_at FROM task_followers f JOIN users u ON u.id = f.user_id WHERE u.disabled = 0 ORDER BY u.name'),
    boardLevels(user),
    all<any>('SELECT * FROM boards'),
    all<any>('SELECT x.task_id,c.id cardId,c.board_id boardId,b.name boardName,l.id listId,l.name listName FROM task_board_links x JOIN board_cards c ON c.id=x.card_id JOIN boards b ON b.id=c.board_id JOIN board_lists l ON l.id=c.list_id'),
    brandServiceLevels(user.id,customers),
    all<any>('SELECT l.task_id, u.id, u.name, u.avatar_at FROM task_board_links l JOIN card_members m ON m.card_id = l.card_id JOIN users u ON u.id = m.user_id WHERE u.disabled = 0 ORDER BY u.name'),
  ]);
  const who = new Map<string, { id: string; name: string; userId: string | null; avatarAt?: number | null }[]>(), tags = new Map<string, string[]>();
  for (const r of people) who.set(r.task_id, [...(who.get(r.task_id) || []), { id: r.id, name: r.name, userId: r.user_id || null, avatarAt: r.avatar_at ?? null }]);
  for (const r of labels) tags.set(r.task_id, [...(tags.get(r.task_id) || []), r.name]);
  const followers = new Map<string, { id: string; name: string; avatarAt?: number | null }[]>();
  for (const r of following) followers.set(r.task_id, [...(followers.get(r.task_id) || []), { id: r.id, name: r.name, avatarAt: r.avatar_at ?? null }]);
  const onCard = new Map<string, { id: string; name: string; userId: string; avatarAt?: number | null }[]>();
  for (const r of onCards) onCard.set(r.task_id, [...(onCard.get(r.task_id) || []), { id: `card:${r.id}`, name: r.name, userId: r.id, avatarAt: r.avatar_at ?? null }]);
  const allowed=new Set(boards.filter((b)=>level(b)).map((b)=>b.id as string));
  const boardLinks=new Map<string,{cardId:string;boardId:string;boardName:string;listId:string;listName:string}>(),linkedTasks=new Set<string>();
  for(const row of cards){
    linkedTasks.add(row.task_id);
    if(allowed.has(row.boardId)){const{task_id,...link}=row;boardLinks.set(task_id,link);}
  }
  return { who, tags, followers, onCard, boardLinks, linkedTasks, user, pLevels, flow: await flowSettings() };
}
const TASK_SQL = `SELECT t.*, j.name service_name, j.brand_id, j.catalog_service_id, br.name brand_name, br.customer_id, cu.name customer_name, sc.name catalog_service_name,
  c.name creator_name, c.user_id creator_user_id, p.title parent_title,
  (SELECT COUNT(*) FROM tasks x WHERE x.parent_id = t.id) children
  FROM tasks t
  LEFT JOIN brand_services j ON j.id = t.brand_service_id
  LEFT JOIN brands br ON br.id = j.brand_id AND br.deleted_at IS NULL
  LEFT JOIN customers cu ON cu.id = br.customer_id
  LEFT JOIN service_catalog sc ON sc.id = j.catalog_service_id
  LEFT JOIN task_people c ON c.id = t.created_by
  LEFT JOIN tasks p ON p.id = t.parent_id`;
function taskOut(t: any, l: Awaited<ReturnType<typeof links>>) {
  const bsName = t.catalog_service_id && t.catalog_service_id !== 'sv_general' ? (t.catalog_service_name || t.service_name || '') : (t.service_name || t.catalog_service_name || '');
  const brandService = t.brand_service_id
    ? {
        id: t.brand_service_id,
        name: bsName,
        brandId: t.brand_id || null,
        brandName: t.brand_name || null,
        customerId: t.customer_id || null,
        catalogServiceId: t.catalog_service_id || null,
      }
    : null;
  return {
    id: t.id, externalId: t.external_id || null, title: t.title, status: t.status, state: stateOf(t), stage: stageOf(t, l.who.has(t.id), l.flow), startAt: t.start_at ?? null, dueAt: t.due_at ?? null, doneAt: t.done_at ?? null,
    brandService,
    /** @deprecated Dùng brandService. */
    project: brandService,
    brand: t.brand_id ? { id: t.brand_id, name: t.brand_name || '' } : null,
    customer: t.customer_id ? { id: t.customer_id, name: t.customer_name || '' } : null,
    campaign: null,
    parent: t.parent_id ? { id: t.parent_id, title: t.parent_title || '' } : null, children: Number(t.children) || 0,
    createdBy: t.created_by ? { id: t.created_by, name: t.creator_name || '', userId: t.creator_user_id || null } : null, assignees: l.who.get(t.id) || [],
    // The people on its card who are not given the task (a card linked by hand keeps its own people): it is their work too.
    cardPeople: (l.onCard.get(t.id) || []).filter((p) => !(l.who.get(t.id) || []).some((a) => a.userId === p.userId)), followers: l.followers.get(t.id) || [], labels: l.tags.get(t.id) || [],
    boardLink:l.boardLinks.get(t.id)||null,hasBoardLink:l.linkedTasks.has(t.id),
    canDelete: l.user.role === 'admin' || (t.creator_user_id != null && t.creator_user_id === l.user.id) || (t.brand_service_id ? l.pLevels.get(t.brand_service_id) === 'admin' : false),
    sourceUpdatedAt: t.source_updated_at ?? null, stub: !!t.stub, updatedAt: t.updated_at, createdAt: t.created_at,
    // The review workflow's own facts, for the overview: rounds sent back (REDO) and when it was last handed in.
    revision: Number(t.revision) || 0, submittedAt: t.submitted_at ?? null,
  };
}
/** May this account see a task's result and change it: admins, the task's own people, its brand_service's managers and
 *  members (its followers and viewers only look) and, for a task outside services, whoever edits its card on a board:
 *  the task and its card are one piece of work, so both sides follow the same rule. */
async function mine(req: Req, t: any) {
  const u = await me(req);
  if (u.role === 'admin' || t.reviewer_id === u.id) return true;
  if (t.brand_service_id) { if (['admin', 'normal'].includes((await brandServiceLevels(u.id)).get(t.brand_service_id) || '')) return true; }
  else {
    const board = await get<any>('SELECT b.* FROM task_board_links l JOIN board_cards c ON c.id = l.card_id JOIN boards b ON b.id = c.board_id WHERE l.task_id = ?', t.id);
    if (board && ['admin', 'normal'].includes(await boardLevelForUser(u, board) || '')) return true;
  }
  const ids = await myPeople(u.id);
  if (!ids.length) return false;
  if (ids.includes(t.created_by)) return true;
  return !!(await get('SELECT 1 FROM task_assignees WHERE task_id = ? AND person_id IN (' + ids.map(() => '?').join(',') + ')', t.id, ...ids));
}

async function taskPersonForUser(userId: string) {
  const user = await get<any>('SELECT id,name FROM users WHERE id=? AND disabled=0',userId);
  if (!user) throw new HttpError(400,'Không tìm thấy tài khoản đang hoạt động');
  const existing = await get<any>('SELECT id FROM task_people WHERE user_id=? ORDER BY created_at,id LIMIT 1',userId);
  if (existing) return existing.id as string;
  const id=uid('tp_');
  await run('INSERT INTO task_people(id,name,user_id,created_at) VALUES(?,?,?,?)',id,user.name,user.id,now());
  return id;
}

async function canDelete(req: Req, t: any) {
  const u = await me(req);
  if (u.role === 'admin') return true;
  if (await get('SELECT 1 FROM task_people WHERE id=? AND user_id=?', t.created_by, u.id)) return true;
  if (t.brand_service_id) {
    const level = (await brandServiceLevels(u.id)).get(t.brand_service_id);
    if (level === 'admin') return true;
  }
  return false;
}
async function writable(req: Req) {
  const t = await get<any>('SELECT * FROM tasks WHERE id=?', req.params.id);
  if (!t) throw new HttpError(404, 'Không tìm thấy công việc');
  if (!await mine(req, t)) throw new HttpError(403, 'Chỉ người được giao, người tạo, thành viên dịch vụ hoặc quản trị viên mới sửa được công việc này');
  return t;
}
async function taskInput(b: any, old?: any,userId?:string) {
  const title = String(b.title ?? old?.title ?? '').replace(/\s+/g, ' ').trim();
  if (!title || title.length > 500) throw new HttpError(400, 'Tên công việc cần có từ 1 đến 500 ký tự');
  const status = b.status === undefined ? old?.status || 'Chưa thực hiện' : String(b.status);
  if (b.status !== undefined && !(await taskStatuses()).includes(status) && !(old && await get('SELECT 1 FROM task_board_links l JOIN board_cards c ON c.id=l.card_id JOIN board_lists bl ON bl.board_id=c.board_id WHERE l.task_id=? AND bl.archived=0 AND bl.name=?',old.id,status))) throw new HttpError(400, 'Trạng thái không hợp lệ');
  const date = (v: any) => { if (v === null) return null; if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 8640000000000000) throw new HttpError(400, 'Ngày không hợp lệ'); return v; };
  const start = b.startAt === undefined ? old?.start_at ?? null : date(b.startAt);
  const due = b.dueAt === undefined ? old?.due_at ?? null : date(b.dueAt);
  if (start !== null && due !== null && start > due) throw new HttpError(400, 'Thời hạn phải sau ngày bắt đầu');
  const rawProject = b.brandServiceId !== undefined ? b.brandServiceId : b.projectId;
  let project = b.brandServiceId === undefined && b.projectId === undefined ? old?.brand_service_id ?? null : rawProject || null;
  if (!project && (b.brandId || b.customerId)) {
    let cid = b.customerId ? String(b.customerId) : '';
    const bid = b.brandId ? String(b.brandId) : null;
    if (!cid && bid) {
      const br = await get<any>('SELECT customer_id FROM brands WHERE id = ? AND deleted_at IS NULL', bid);
      if (!br) throw new HttpError(404, 'Không tìm thấy nhãn hàng');
      cid = br.customer_id;
    }
    if (cid) {
      const resolved = await projectForService({ id: userId || '' }, cid, '', { brandId: bid });
      project = resolved.id;
    }
  }
  if (project && !await get('SELECT 1 FROM brand_services WHERE id=?', String(project))) throw new HttpError(400, 'Không tìm thấy dịch vụ');
  if(project&&userId&&project!==old?.brand_service_id){await requireBrandService(userId,String(project),'normal');const p=await get<any>('SELECT br.customer_id FROM brand_services bs LEFT JOIN brands br ON br.id=bs.brand_id AND br.deleted_at IS NULL WHERE bs.id=?',project);if(p?.customer_id)await requireCustomer(userId,p.customer_id,'normal');}
  const parent = b.parentId === undefined ? old?.parent_id ?? null : b.parentId || null;
  if (parent) {
    let at: string | null = String(parent), count = 0;
    while (at) {
      if (at === old?.id || count++ > 1000) throw new HttpError(400, 'Công việc cha tạo thành vòng lặp');
      const row: any = await get('SELECT parent_id, brand_service_id FROM tasks WHERE id=?', at);
      if (!row) throw new HttpError(400, 'Không tìm thấy công việc cha');
      if(row.brand_service_id&&userId)await requireBrandService(userId,row.brand_service_id,'normal');
      at = row.parent_id;
    }
  }
  let people: string[] | undefined;
  if (b.assigneeIds !== undefined) {
    if (!Array.isArray(b.assigneeIds) || b.assigneeIds.length > 20 || b.assigneeIds.some((x: any) => typeof x !== 'string')) throw new HttpError(400, 'Người được giao không hợp lệ');
    people = [...new Set<string>(b.assigneeIds)];
    for (const id of people) if (!await get('SELECT 1 FROM task_people WHERE id=?', id)) throw new HttpError(400, 'Không tìm thấy người được giao');
  }
  let userIds: string[] | undefined;
  if (b.assigneeUserIds !== undefined) {
    if (!Array.isArray(b.assigneeUserIds) || b.assigneeUserIds.length > 20 || b.assigneeUserIds.some((x:any)=>typeof x!=='string')) throw new HttpError(400,'Danh sách tài khoản được giao không hợp lệ');
    userIds=[...new Set<string>(b.assigneeUserIds)];
    for (const id of userIds) if (!await get('SELECT 1 FROM users WHERE id=? AND disabled=0',id)) throw new HttpError(400,'Người được giao phải là tài khoản đang hoạt động');
    if ((people?.length||0)+userIds.length>20) throw new HttpError(400,'Mỗi công việc tối đa 20 người được giao');
  }
  // One person does a task (the last one added: server/task-assign.ts), and whoever gives it out does not give it to
  // themselves (a choice already made stays).
  if (people !== undefined || userIds !== undefined) {
    const before = old ? await all<any>('SELECT p.id, p.user_id FROM task_assignees a JOIN task_people p ON p.id=a.person_id WHERE a.task_id=?', old.id) : [];
    const nextPeople = people ?? before.filter((r) => !r.user_id).map((r) => r.id), nextUsers = userIds ?? before.filter((r) => r.user_id).map((r) => r.user_id);
    const selfPeople = userId ? (await all<any>('SELECT id FROM task_people WHERE user_id=?', userId)).map((r) => r.id) : [];
    const selfNew = !!userId && (nextUsers.includes(userId) && !before.some((r) => r.user_id === userId) || nextPeople.some((id) => selfPeople.includes(id) && !before.some((r) => r.id === id)));
    if (selfNew) throw new HttpError(400, 'Không tự giao việc cho mình: hãy chọn người khác');
  }
  let followers: string[] | undefined;
  if (b.followerUserIds !== undefined) {
    if (!Array.isArray(b.followerUserIds) || b.followerUserIds.length > 50 || b.followerUserIds.some((x:any)=>typeof x!=='string')) throw new HttpError(400,'Danh sách người theo dõi không hợp lệ');
    followers=[...new Set<string>(b.followerUserIds)];
    for (const id of followers) if (!await get('SELECT 1 FROM users WHERE id=? AND disabled=0',id)) throw new HttpError(400,'Người theo dõi phải là tài khoản đang hoạt động');
    // Nor do they make themselves a follower (one already following, e.g. after handing it over, stays).
    if (userId && followers.includes(userId) && !(old && await get('SELECT 1 FROM task_followers WHERE task_id=? AND user_id=?', old.id, userId)))
      throw new HttpError(400, 'Không tự thêm mình làm người theo dõi: hãy chọn người khác');
  }
  let labels: string[] | undefined;
  if (b.labels !== undefined) {
    if (!Array.isArray(b.labels) || b.labels.length > 20 || b.labels.some((x: any) => typeof x !== 'string' || x.length > 100)) throw new HttpError(400, 'Nhãn không hợp lệ');
    labels = [...new Set<string>(b.labels.map((x: string) => x.trim()).filter(Boolean))];
  }
  const finished = ['done', 'done_late'].includes(statusKey(status)), done = finished ? old?.done_at || now() : null;
  // Choosing "Hoàn thành muộn" is kept as chosen; any other finished status turns late by itself past the deadline.
  const keptLate = b.status !== undefined && statusKey(status) === 'done_late';
  return { title, status: finished ? (keptLate ? status : due && done! > due ? 'Hoàn thành muộn' : 'Hoàn thành') : status, start, due, done, project, parent,
    description: richIn(b.description ?? old?.description), result: richIn(b.result ?? old?.result), people, userIds, followers, labels };
}
async function saveLinks(id: string, input: Awaited<ReturnType<typeof taskInput>>, by?: string) {
  if (input.followers !== undefined) {
    // Followers see the task: view access to its brand_service (and customer) when they had none.
    if (by && input.project) for (const userId of input.followers) await grantAccess(userId, by, { brandServiceId: input.project }, 'observer');
    await run('DELETE FROM task_followers WHERE task_id=?', id);
    for (const userId of input.followers) await run('INSERT INTO task_followers(task_id,user_id) VALUES(?,?)', id, userId);
  }
  // After the followers, so whoever is handed off stays among them.
  if (input.people !== undefined || input.userIds !== undefined) {
    const named = [...(input.people || [])];
    for (const userId of input.userIds || []) named.push(await taskPersonForUser(userId));
    const doer = lastAdded(named, (await all<any>('SELECT person_id FROM task_assignees WHERE task_id=?', id)).map((r) => r.person_id));
    // The person given the task can work on it: they become a member of its brand_service (and customer) if they were not.
    const userId = doer ? (await get<any>('SELECT user_id FROM task_people WHERE id=?', doer))?.user_id : null;
    if (by && input.project && userId) await grantAccess(userId, by, { brandServiceId: input.project }, 'normal');
    await handOver(id, doer);
  }
  if (input.labels !== undefined) {
    await run('DELETE FROM task_label_links WHERE task_id=?', id);
    for (const name of input.labels) {
      await run('INSERT OR IGNORE INTO task_labels(id,name) VALUES(?,?)', uid('tl_'), name);
      const label: any = await get('SELECT id FROM task_labels WHERE name=?', name);
      await run('INSERT INTO task_label_links(task_id,label_id) VALUES(?,?)', id, label.id);
    }
  }
}

/** A new task is followed by its brand_service's followers, and a new subtask by its parent's, as far as they can see it;
 *  never by whoever made it. */
async function inheritFollowers(id: string, project: string | null, parent: string | null, maker: string) {
  const ids = new Set<string>();
  if (project) for (const r of await all<any>("SELECT user_id FROM brand_service_members WHERE brand_service_id=? AND role='observer' AND follows=1", project)) ids.add(r.user_id);
  if (parent) for (const r of await all<any>('SELECT user_id FROM task_followers WHERE task_id=?', parent)) ids.add(r.user_id);
  ids.delete(maker);
  for (const userId of ids) if (!project || (await brandServiceLevels(userId)).has(project)) await run('INSERT OR IGNORE INTO task_followers(task_id,user_id) SELECT ?,id FROM users WHERE id=? AND disabled=0', id, userId);
}

/** The brand_service behind a brand (or customer)'s service: the existing one carrying that catalog service on the target brand
 *  (or oldest across customer's active brands when no brandId), else a new one created on that brand (or default brand).
 *  When `serviceId` is omitted/empty, uses the general fallback container (`sv_general`) so tasks can follow a customer/brand directly without requiring a service. */
export async function projectForService(user:{id:string;team_role?:string|null},customerId:string,serviceId?:string|null,{home=true,brandId}:{home?:boolean;brandId?:string|null}={}){
  if(!customerId)throw new HttpError(400,'Cần chọn khách hàng');
  await requireCustomer(user.id,customerId,'normal');
  let svc: any = null;
  if (serviceId) {
    svc = await get<any>('SELECT id,name FROM service_catalog WHERE id=? AND deleted_at IS NULL', serviceId);
    if (!svc) throw new HttpError(404, 'Không tìm thấy dịch vụ trong danh mục');
  } else {
    const fallbackId = await ensureFallbackCatalogService(user.id);
    svc = await get<any>('SELECT id,name FROM service_catalog WHERE id=?', fallbackId) || { id: fallbackId, name: 'Công việc chung' };
  }
  const effectiveServiceId = svc.id as string;
  let targetBrandId: string;
  if (brandId) {
    const br = await get<any>('SELECT id FROM brands WHERE id=? AND customer_id=? AND deleted_at IS NULL', brandId, customerId);
    if (!br) throw new HttpError(404, 'Không tìm thấy nhãn hàng thuộc khách hàng này');
    targetBrandId = br.id;
    const found = await brandServiceFor(targetBrandId, effectiveServiceId);
    if (found) return { id: found.id as string, name: found.name as string, brandId: targetBrandId, catalogServiceId: effectiveServiceId, created: false };
  } else {
    const found = await projectOf(customerId, effectiveServiceId);
    if (found) return { id: found.id as string, name: found.name as string, brandId: found.brand_id as string, catalogServiceId: effectiveServiceId, created: false };
    const defBrand = await ensureDefaultBrand(customerId, user.id);
    targetBrandId = defBrand.id;
  }
  const id=uid('tj_'), t=now();
  await run('INSERT INTO brand_services(id,brand_id,catalog_service_id,name,created_by,team_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',id,targetBrandId,svc.id,svc.name,user.id,user.team_role||null,t,t);
  // Its board at once (server/service-boards.ts), unless the caller is making the board itself.
  if(home)await projectHome(id);
  return{id,name:svc.name as string,brandId:targetBrandId,catalogServiceId:svc.id as string,created:true};
}

async function canManageProject(user:any,id:string){return (await requireBrandService(user.id,id,'admin'))==='admin';}
export function registerTasks(api: Router) {
  const brandServiceRows = async (userId: string, q?: URLSearchParams) => {
    const allowedCustomers = await customerLevels(userId);
    const allowedProjects = await brandServiceLevels(userId);
    const visibleRows = (
      await all<any>(
        `SELECT bs.*, br.name brand_name, br.customer_id, cu.name customer_name, sc.name catalog_name,
           b.id board_id
         FROM brand_services bs
         LEFT JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL
         LEFT JOIN customers cu ON cu.id = br.customer_id
         LEFT JOIN service_catalog sc ON sc.id = bs.catalog_service_id
         LEFT JOIN boards b ON b.brand_service_id = bs.id
         ORDER BY bs.name COLLATE NOCASE`
      )
    ).filter((r) => allowedProjects.has(r.id) && (!r.customer_id || allowedCustomers.has(r.customer_id)));

    const ids = new Set(visibleRows.map((r) => r.id as string));
    const stats = new Map<string, { total: number; completed: number; overdue: number; live: number; started: number; touched: number }>();
    for (const r of await all<any>('SELECT brand_service_id, status, due_at, done_at, updated_at FROM tasks WHERE brand_service_id IS NOT NULL AND stub = 0')) {
      if (!ids.has(r.brand_service_id)) continue;
      const s = stats.get(r.brand_service_id) || { total: 0, completed: 0, overdue: 0, live: 0, started: 0, touched: 0 };
      s.total++;
      if (Number(r.updated_at || 0) > s.touched) s.touched = Number(r.updated_at || 0);
      const st = stateOf(r);
      if (st !== 'cancelled') s.live++;
      if (st === 'done' || st === 'done_late') s.completed++;
      else if (st === 'overdue') s.overdue++;
      if (!['todo', 'cancelled'].includes(st) && !(st === 'overdue' && statusKey(r.status) === 'todo')) s.started++;
      stats.set(r.brand_service_id, s);
    }
    const assignees = new Map<string, { id: string; name: string; userId: string | null; avatarAt?: number | null }[]>();
    for (const r of await all<any>(
      'SELECT DISTINCT t.brand_service_id, p.id, COALESCE(u.name, p.name) name, p.user_id, u.avatar_at FROM tasks t JOIN task_assignees a ON a.task_id = t.id JOIN task_people p ON p.id = a.person_id LEFT JOIN users u ON u.id = p.user_id WHERE t.brand_service_id IS NOT NULL ORDER BY 3'
    )) {
      if (!ids.has(r.brand_service_id)) continue;
      assignees.set(r.brand_service_id, [...(assignees.get(r.brand_service_id) || []), { id: r.id, name: r.name, userId: r.user_id || null, avatarAt: r.avatar_at ?? null }]);
    }
    const catMap = await brandServiceCatalogMap([...ids]);
    const custFilter = q?.get('customerId') || q?.get('customer') || '';
    const brandFilter = q?.get('brandId') || q?.get('brand') || '';
    const catFilter = q?.get('catalogServiceId') || q?.get('serviceId') || q?.get('service') || '';
    const stageFilter = q?.get('stage') || '';
    const hit = q ? matcher(q.get('q')) : () => true;

    return visibleRows
      .map((j) => {
        const st = stats.get(j.id);
        const displayName = j.catalog_service_id && j.catalog_service_id !== 'sv_general' ? j.catalog_name || j.name : j.name || j.catalog_name || '';
        const stage = brandServiceStage({ tasks: st?.live || 0, started: st?.started || 0, done: st?.completed || 0 }, j.hold);
        return {
          id: j.id,
          name: displayName,
          brandId: j.brand_id || null,
          brandName: j.brand_name || null,
          customerId: j.customer_id || null,
          customerName: j.customer_name || null,
          catalogServiceId: j.catalog_service_id || null,
          catalogServiceName: j.catalog_name || null,
          teamId: j.team_id || null,
          createdBy: j.created_by,
          createdAt: j.created_at ?? null,
          updatedAt: Math.max(j.created_at || 0, j.updated_at || 0, st?.touched || 0) || null,
          level: allowedProjects.get(j.id),
          boardId: j.board_id || null,
          tasks: st?.total || 0,
          completed: st?.completed || 0,
          overdue: st?.overdue || 0,
          hold: j.hold || null,
          services: catMap.get(j.id) || [],
          stage,
          assignees: assignees.get(j.id) || [],
        };
      })
      .filter((r) => (!custFilter || r.customerId === custFilter) && (!brandFilter || r.brandId === brandFilter) && (!catFilter || r.catalogServiceId === catFilter) && (!stageFilter || r.stage === stageFilter))
      .filter((r) => hit(r.name, r.brandName, r.customerName, r.catalogServiceName));
  };

  api.get('/api/brand-services', async (req, res) => {
    const user = await me(req);
    json(res, 200, await brandServiceRows(user.id, req.query));
  });

  const handleCreateBrandService = async (req: Req, res: any) => {
    const user = await me(req), body = await readJson(req);
    const services =
      body.catalogServiceId !== undefined
        ? (body.catalogServiceId ? await oneService([String(body.catalogServiceId)], ONE_SERVICE) : [])
        : body.services !== undefined
          ? await oneService(body.services, ONE_SERVICE)
          : null;

    let brand: any = null;
    if (body.brandId) {
      brand = await get<any>('SELECT * FROM brands WHERE id = ? AND deleted_at IS NULL', String(body.brandId));
      if (!brand) throw new HttpError(404, 'Không tìm thấy nhãn hàng');
      await requireCustomer(user.id, brand.customer_id, 'admin');
    } else if (body.customerId) {
      const cid = String(body.customerId);
      await requireCustomer(user.id, cid, 'admin');
      brand = await ensureDefaultBrand(cid, user.id);
    } else {
      throw new HttpError(400, 'Hãy chọn nhãn hàng hoặc khách hàng của dịch vụ');
    }

    const catId = services?.length ? services[0] : await ensureFallbackCatalogService(user.id);
    const name = services?.length
      ? (await get<any>('SELECT name FROM service_catalog WHERE id = ?', catId))?.name || ''
      : String(body.name || '').trim();
    if (!name || name.length > 200) throw new HttpError(400, 'Hãy chọn dịch vụ');
    if (services?.length && (await brandServiceFor(brand.id, catId))) throw new HttpError(409, 'Nhãn hàng này đã có dịch vụ này');

    const teamId = body.teamId !== undefined ? (body.teamId ? String(body.teamId) : null) : user.team_role || null;
    if (teamId && !(await get('SELECT id FROM team_roles WHERE id = ?', teamId))) throw new HttpError(400, 'Phòng ban không tồn tại');
    const id = uid('tj_'), t = now();
    await run(
      'INSERT INTO brand_services(id, brand_id, catalog_service_id, name, created_by, team_id, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)',
      id,
      brand.id,
      catId,
      name,
      user.id,
      teamId,
      t,
      t
    );
    await projectHome(id);
    json(res, 201, { id, name, brandId: brand.id, customerId: brand.customer_id, catalogServiceId: catId, teamId });
  };

  const handleForService = async (req: Req, res: any) => {
    const user = await me(req), b = await readJson(req);
    const serviceId = String(b.catalogServiceId || b.serviceId || '');
    const brandId = b.brandId ? String(b.brandId) : null;
    let customerId = b.customerId ? String(b.customerId) : '';
    if (!customerId && brandId) {
      const br = await get<any>('SELECT customer_id FROM brands WHERE id = ? AND deleted_at IS NULL', brandId);
      if (!br) throw new HttpError(404, 'Không tìm thấy nhãn hàng');
      customerId = br.customer_id;
    }
    const r = await projectForService(user, customerId, serviceId, { brandId });
    json(res, r.created ? 201 : 200, r);
  };

  const handleUpdateBrandService = async (req: Req, res: any) => {
    const user = await me(req), id = req.params.project;
    await requireBrandService(user.id, id, 'admin');
    const current = await get<any>(
      `SELECT bs.*, br.customer_id FROM brand_services bs LEFT JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL WHERE bs.id = ?`,
      id
    );
    if (!current) throw new HttpError(404, 'Không tìm thấy dịch vụ');
    const body = await readJson(req);
    if (body.name !== undefined) {
      const name = String(body.name || '').trim();
      if (!name || name.length > 200) throw new HttpError(400, 'Tên dịch vụ không hợp lệ (tối đa 200 ký tự)');
      await run('UPDATE brand_services SET name = ?, updated_at = ? WHERE id = ?', name, now(), id);
      await renameProjectBoard(id, name, current.name);
    }
    let customerChanged = false;
    let targetBrandId = current.brand_id || null;
    if (body.brandId !== undefined) {
      const bid = body.brandId ? String(body.brandId) : null;
      if (!bid) throw new HttpError(400, 'Dịch vụ phải thuộc một nhãn hàng');
      const br = await get<any>('SELECT * FROM brands WHERE id = ? AND deleted_at IS NULL', bid);
      if (!br) throw new HttpError(404, 'Không tìm thấy nhãn hàng');
      await requireCustomer(user.id, br.customer_id, 'admin');
      if (current.catalog_service_id && current.catalog_service_id !== 'sv_general') {
        const clash = await brandServiceFor(bid, current.catalog_service_id);
        if (clash && clash.id !== id) throw new HttpError(409, 'Nhãn hàng đó đã có dịch vụ này');
      }
      customerChanged = br.customer_id !== (current.customer_id || null);
      targetBrandId = bid;
      await run('UPDATE brand_services SET brand_id = ?, updated_at = ? WHERE id = ?', bid, now(), id);
    } else if (body.customerId !== undefined) {
      const cid = body.customerId ? String(body.customerId) : null;
      if (!cid) throw new HttpError(400, 'Dịch vụ phải thuộc một khách hàng');
      await requireCustomer(user.id, cid, 'admin');
      const svc = await serviceOf(id), other = svc ? await projectOf(cid, svc.id) : null;
      if (other && other.id !== id && other.brand_id === (await ensureDefaultBrand(cid, user.id)).id) {
        throw new HttpError(409, `Khách hàng đó đã có dịch vụ ${svc!.name}: mỗi dịch vụ của một nhãn hàng chỉ có một board`);
      }
      const defBrand = await ensureDefaultBrand(cid, user.id);
      customerChanged = cid !== (current.customer_id || null);
      targetBrandId = defBrand.id;
      await run('UPDATE brand_services SET brand_id = ?, updated_at = ? WHERE id = ?', defBrand.id, now(), id);
    }
    const nextCatIds =
      body.catalogServiceId !== undefined
        ? (body.catalogServiceId ? await oneService([String(body.catalogServiceId)], ONE_SERVICE) : [])
        : body.services !== undefined
          ? await oneService(body.services, ONE_SERVICE)
          : null;
    if (nextCatIds !== null) {
      if (nextCatIds[0]) await checkServiceFree(id, nextCatIds[0]);
      await saveBrandServiceCatalog(id, nextCatIds, user.id);
    }
    if (body.hold !== undefined) {
      if (body.hold !== null && !isHold(body.hold)) throw new HttpError(400, 'Trạng thái dịch vụ không hợp lệ');
      await run('UPDATE brand_services SET hold = ?, updated_at = ? WHERE id = ?', body.hold, now(), id);
    }
    if (body.teamId !== undefined) {
      const tid = body.teamId ? String(body.teamId) : null;
      if (tid && !(await get('SELECT id FROM team_roles WHERE id = ?', tid))) throw new HttpError(400, 'Phòng ban không tồn tại');
      await run('UPDATE brand_services SET team_id = ?, updated_at = ? WHERE id = ?', tid, now(), id);
    }
    await syncBrandServiceCards(id);
    if (customerChanged || (targetBrandId && targetBrandId !== current.brand_id)) await projectCustomerChanged(id);
    const updated = await get<any>(
      `SELECT bs.*, br.customer_id FROM brand_services bs LEFT JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL WHERE bs.id = ?`,
      id
    );
    json(res, 200, {
      ok: true,
      id,
      name: updated.name,
      brandId: updated.brand_id || null,
      customerId: updated.customer_id || null,
      catalogServiceId: updated.catalog_service_id || null,
      teamId: updated.team_id || null,
    });
  };

  const handleDeleteBrandService = async (req: Req, res: any) => {
    const user = await me(req), id = req.params.project;
    await requireBrandService(user.id, id, 'admin');
    await removeBrandServiceRecord(id);
    json(res, 200, { ok: true });
  };

  const handleBulkDeleteBrandServices = async (req: Req, res: any) => {
    const user = await me(req), b = await readJson(req);
    const ids = Array.isArray(b.ids) ? [...new Set<string>(b.ids.filter((id: unknown) => typeof id === 'string' && id))] : [];
    if (!ids.length || ids.length > 200) throw new HttpError(400, 'Hãy chọn từ 1 đến 200 dịch vụ để xoá');
    const levels = await brandServiceLevels(user.id);
    let deleted = 0;
    for (const id of ids) {
      if (levels.get(id) !== 'admin' && user.role !== 'admin') continue;
      await removeBrandServiceRecord(id);
      deleted++;
    }
    json(res, 200, { ok: true, deleted });
  };

  const handleGetBrandServiceMembers = async (req: Req, res: any) => {
    const user = await me(req), id = req.params.project, level = await requireBrandService(user.id, id);
    const p = await get<any>(
      `SELECT bs.*, br.customer_id FROM brand_services bs LEFT JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL WHERE bs.id = ?`,
      id
    );
    const members = await all<any>(
      `SELECT u.id,u.name,CASE WHEN u.id=? THEN 'admin' WHEN m.role='observer' AND m.follows=0 THEN 'viewer' ELSE m.role END level FROM users u LEFT JOIN brand_service_members m ON m.user_id=u.id AND m.brand_service_id=? WHERE u.id=? OR m.user_id IS NOT NULL ORDER BY u.name`,
      p.created_by,
      id,
      p.created_by
    );
    json(res, 200, {
      ownerId: p.created_by,
      teamId: p.team_id,
      brandId: p.brand_id || null,
      customerId: p.customer_id || null,
      level,
      members,
      teams: await all('SELECT id,name FROM team_roles ORDER BY pos'),
      people: level === 'admin' ? await all('SELECT id,name,team_role teamId FROM users WHERE disabled=0 ORDER BY name') : [],
    });
  };

  const handlePutBrandServiceTeam = async (req: Req, res: any) => {
    const user = await me(req), id = req.params.project;
    await requireBrandService(user.id, id, 'admin');
    const body = await readJson(req), team = body.teamId ? String(body.teamId) : null;
    if (team && !(await get('SELECT id FROM team_roles WHERE id = ?', team))) throw new HttpError(400, 'Team không tồn tại');
    await run('UPDATE brand_services SET team_id = ?, updated_at = ? WHERE id = ?', team, now(), id);
    json(res, 200, { ok: true });
  };

  const handlePutBrandServiceMember = async (req: Req, res: any) => {
    const user = await me(req), id = req.params.project;
    await requireBrandService(user.id, id, 'admin');
    const p = await get<any>(
      `SELECT bs.*, br.customer_id FROM brand_services bs LEFT JOIN brands br ON br.id = bs.brand_id AND br.deleted_at IS NULL WHERE bs.id = ?`,
      id
    );
    const body = await readJson(req), want = body.level || 'normal';
    if (!['admin', 'normal', 'observer', 'viewer'].includes(want)) throw new HttpError(400, 'Quyền không hợp lệ');
    const role = want === 'viewer' ? 'observer' : want, follows = want === 'observer' ? 1 : 0;
    if (!(await get('SELECT id FROM users WHERE id = ? AND disabled = 0', req.params.userId))) throw new HttpError(404, 'Không tìm thấy nhân viên');
    if (req.params.userId === p.created_by) throw new HttpError(400, 'Không thể thay đổi quyền chủ dịch vụ');
    if (p.customer_id) await grantAccess(req.params.userId, user.id, { customerId: p.customer_id }, role === 'normal' || role === 'admin' ? 'normal' : 'observer');
    const had = await get('SELECT 1 FROM brand_service_members WHERE brand_service_id = ? AND user_id = ?', id, req.params.userId);
    await run(
      'INSERT INTO brand_service_members(brand_service_id,user_id,role,follows) VALUES(?,?,?,?) ON CONFLICT(brand_service_id,user_id) DO UPDATE SET role=excluded.role,follows=excluded.follows',
      id,
      req.params.userId,
      role,
      follows
    );
    if (!had) await notifyPeople([req.params.userId], user.id, { title: 'Bạn được thêm vào dịch vụ', body: p.name, link: `#projects/${id}` });
    await syncProjectBoardMembers(id);
    json(res, 200, { ok: true });
  };

  const handleDeleteBrandServiceMember = async (req: Req, res: any) => {
    const user = await me(req), id = req.params.project;
    await requireBrandService(user.id, id, 'admin');
    const p = await get<any>('SELECT created_by FROM brand_services WHERE id = ?', id);
    if (p.created_by === req.params.userId) throw new HttpError(400, 'Không thể gỡ chủ dịch vụ');
    await run('DELETE FROM brand_service_members WHERE brand_service_id = ? AND user_id = ?', id, req.params.userId);
    await syncProjectBoardMembers(id);
    json(res, 200, { ok: true });
  };

  api.post('/api/brand-services', handleCreateBrandService);
  api.post('/api/brand-services/for-service', handleForService);
  api.put('/api/brand-services/:project', handleUpdateBrandService);
  api.delete('/api/brand-services/:project', handleDeleteBrandService);
  api.post('/api/brand-services/bulk-delete', handleBulkDeleteBrandServices);
  api.get('/api/brand-services/:project/members', handleGetBrandServiceMembers);
  api.put('/api/brand-services/:project/team', handlePutBrandServiceTeam);
  api.put('/api/brand-services/:project/members/:userId', handlePutBrandServiceMember);
  api.delete('/api/brand-services/:project/members/:userId', handleDeleteBrandServiceMember);

  /** @deprecated Dùng /api/brand-services* */
  api.post('/api/task-projects', (req, res) => { res.setHeader('Deprecation', 'true'); return handleCreateBrandService(req, res); });
  /** @deprecated Dùng /api/brand-services/for-service */
  api.post('/api/task-projects/for-service', (req, res) => { res.setHeader('Deprecation', 'true'); return handleForService(req, res); });
  /** @deprecated Dùng PUT /api/brand-services/:id */
  api.put('/api/task-projects/:project', (req, res) => { res.setHeader('Deprecation', 'true'); return handleUpdateBrandService(req, res); });
  /** @deprecated Dùng DELETE /api/brand-services/:id */
  api.delete('/api/task-projects/:project', (req, res) => { res.setHeader('Deprecation', 'true'); return handleDeleteBrandService(req, res); });
  /** @deprecated Dùng POST /api/brand-services/bulk-delete */
  api.post('/api/task-projects/bulk-delete', (req, res) => { res.setHeader('Deprecation', 'true'); return handleBulkDeleteBrandServices(req, res); });
  /** @deprecated Dùng GET /api/brand-services/:id/members */
  api.get('/api/task-projects/:project/members', (req, res) => { res.setHeader('Deprecation', 'true'); return handleGetBrandServiceMembers(req, res); });
  /** @deprecated Dùng PUT /api/brand-services/:id/team */
  api.put('/api/task-projects/:project/team', (req, res) => { res.setHeader('Deprecation', 'true'); return handlePutBrandServiceTeam(req, res); });
  /** @deprecated Dùng PUT /api/brand-services/:id/members/:userId */
  api.put('/api/task-projects/:project/members/:userId', (req, res) => { res.setHeader('Deprecation', 'true'); return handlePutBrandServiceMember(req, res); });
  /** @deprecated Dùng DELETE /api/brand-services/:id/members/:userId */
  api.delete('/api/task-projects/:project/members/:userId', (req, res) => { res.setHeader('Deprecation', 'true'); return handleDeleteBrandServiceMember(req, res); });

  /** @deprecated Chiến dịch đã chuyển thành Nhãn công việc (task_labels). */
  api.get('/api/task-projects/:project/campaigns', async (req, res) => {
    res.setHeader('Deprecation', 'true');
    if (!(await get('SELECT id FROM brand_services WHERE id = ?', req.params.project))) throw new HttpError(404, 'Không tìm thấy dịch vụ');
    json(res, 200, []);
  });
  const removedCampaign = (_req: Req, res: any) => {
    res.setHeader('Deprecation', 'true');
    throw new HttpError(410, 'Chiến dịch đã được chuyển thành Nhãn công việc');
  };
  api.post('/api/task-projects/:project/campaigns', removedCampaign);
  api.put('/api/task-projects/:project/campaigns/:id', removedCampaign);
  api.delete('/api/task-projects/:project/campaigns/:id', removedCampaign);

  api.post('/api/tasks/master', async (req, res) => {
    const u = await me(req);
    if (u.role !== 'admin') throw new HttpError(403, 'Chỉ quản trị viên được áp dụng luồng master');
    const b = await readJson(req);
    const projectId = String(b.brandServiceId || b.projectId || '');
    if (!(await get('SELECT id FROM brand_services WHERE id = ?', projectId))) throw new HttpError(404, 'Hãy chọn dịch vụ có sẵn');
    if (!Array.isArray(b.keys) || !b.keys.length || b.keys.length > TASK_MASTER.length || b.keys.some((key: unknown) => !TASK_MASTER.some((item) => item.key === key))) throw new HttpError(400, 'Nhóm công việc không hợp lệ');
    const input = await taskInput({ title: 'Master', brandServiceId: projectId, assigneeIds: b.assigneeIds || [], assigneeUserIds: b.assigneeUserIds || [], startAt: b.startAt ?? null, dueAt: b.dueAt ?? null }, undefined, u.id);
    const creator = await taskPersonForUser(u.id), at = now();
    let created = 0, kept = 0;
    const ids: string[] = [];
    for (const item of TASK_MASTER.filter((item) => b.keys.includes(item.key))) {
      const id = `tk_master_${projectId}_${item.key}`;
      const result = await run('INSERT OR IGNORE INTO tasks(id,title,status,start_at,due_at,brand_service_id,created_by,stub,created_at,updated_at) VALUES(?,?,?,?,?,?,?,0,?,?)', id, item.title, 'Chưa thực hiện', input.start, input.due, projectId, creator, at, at);
      if (result.changes) { await saveLinks(id, input, u.id); await routeTaskToWorkspace(id, u.id); created++; } else kept++;
      ids.push(id);
    }
    json(res, 200, { created, kept, ids });
  });
  // The list: the account's own (assigned to the names linked to it) or everyone's, with filters.
  api.post('/api/tasks/sync-board',async(req,res)=>{
    const user=await me(req);
    if(user.role!=='admin')throw new HttpError(403,'Chỉ quản trị viên được đồng bộ tất cả công việc');
    json(res,200,await syncAllTasksToWorkspace(user.id));
  });
  // Everyone lists their own work; a department's head also lists the department's (`scope=team`), a company admin any
  // department's (`team=<id>`). Every task at once (`scope=all`) is only a project's list, on the project's page.
  api.get('/api/tasks', async (req, res) => {
    const u = await me(req), q = req.query;
    const project = String(q.get('brandService') || q.get('brandServiceId') || q.get('project') || '') || null;
    const brandFilter = String(q.get('brand') || q.get('brandId') || '') || null;
    const customerFilter = String(q.get('customer') || q.get('customerId') || '') || null;
    const serviceFilter = String(q.get('service') || q.get('catalogServiceId') || '') || null;
    const scope = q.get('scope') === 'all' && (project || brandFilter || customerFilter || serviceFilter || u.role === 'admin') ? 'all' : q.get('scope') === 'team' ? 'team' : 'mine';
    let team = new Set<string>();
    if (scope === 'team') {
      const requested = String(q.get('team') || '');
      const myLeaderTeams = new Set((await all<any>("SELECT team_id FROM team_members WHERE user_id = ? AND role = 'leader'", u.id)).map((r) => r.team_id as string));
      const isDeptHead = deptLevel(u) === 'admin' && !!u.team_role;
      let target = requested;
      if (!target) target = u.role === 'admin' || isDeptHead ? (u.team_role || [...myLeaderTeams][0] || '') : ([...myLeaderTeams][0] || '');
      if (!target) throw new HttpError(403, 'Chỉ trưởng phòng, trưởng nhóm hoặc quản trị viên xem được công việc của team');
      const workTeam = await get<any>('SELECT id, department_id FROM teams WHERE id = ? AND deleted_at IS NULL', target);
      if (workTeam) {
        if (u.role !== 'admin' && !myLeaderTeams.has(workTeam.id) && !(isDeptHead && workTeam.department_id === u.team_role)) {
          throw new HttpError(403, 'Chỉ trưởng nhóm, trưởng phòng hoặc quản trị viên xem được công việc của nhóm này');
        }
        team = new Set((await all<any>('SELECT m.user_id FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? AND u.disabled = 0', workTeam.id)).map((r) => r.user_id as string));
      } else {
        // A department head always sees their own department, whichever one they ask for.
        if (u.role !== 'admin' && isDeptHead) target = u.team_role!;
        if (u.role !== 'admin' && !(isDeptHead && target === u.team_role)) {
          throw new HttpError(403, 'Chỉ trưởng phòng hoặc quản trị viên xem được công việc của team');
        }
        team = new Set((await all<any>('SELECT id FROM users WHERE team_role = ? AND disabled = 0', target)).map((r) => r.id as string));
      }
    }
    const [ids, allowedCustomers] = await Promise.all([myPeople(u.id), customerLevels(u.id)]), l = await links(req,allowedCustomers), allowedProjects=l.pLevels;
    // A task and its card are one piece of work: the card's members are the task's people too.
    const onCard = new Map<string, string[]>();
    for (const r of await all<any>('SELECT l.task_id, m.user_id FROM task_board_links l JOIN card_members m ON m.card_id = l.card_id')) onCard.set(r.task_id, [...(onCard.get(r.task_id) || []), r.user_id]);
    const mine = (t: ReturnType<typeof taskOut>) => t.assignees.some((a) => ids.includes(a.id)) || !!onCard.get(t.id)?.includes(u.id) || t.followers.some((f) => f.id === u.id);
    // Within "mine", one relation only: given to me (or on my card), made by me, followed by me, or graded by me (the
    // reviewer chosen, else whoever made it: reviewerOf in task-flow.ts).
    const rel = String(q.get('rel') || '');
    const related = (t: ReturnType<typeof taskOut>) => rel === 'review' ? true : rel === 'assigned' ? t.assignees.some((a) => ids.includes(a.id)) || !!onCard.get(t.id)?.includes(u.id)
      : rel === 'created' ? !!t.createdBy && ids.includes(t.createdBy.id) : rel === 'following' ? t.followers.some((f) => f.id === u.id) : rel === 'all' ? (mine(t) || (!!t.createdBy && ids.includes(t.createdBy.id))) : mine(t);
    const ofTeam = (t: ReturnType<typeof taskOut>) => t.assignees.some((a) => !!a.userId && team.has(a.userId)) || !!onCard.get(t.id)?.some((id) => team.has(id));
    const person = scope === 'mine' ? null : String(q.get('person') || '') || null;
    const state = String(q.get('state') || ''), hit = matcher(q.get('q'));
    const svc = await taskServices();
    const rows = (await all<any>(`${TASK_SQL}${project ? ' WHERE t.brand_service_id = ?' : ''} ORDER BY COALESCE(t.due_at, t.created_at) DESC`, ...(project ? [project] : [])))
      .filter(t=>(!t.brand_service_id||allowedProjects.has(t.brand_service_id))&&(!t.customer_id||allowedCustomers.has(t.customer_id)))
      .filter((t) => scope !== 'mine' || rel !== 'review' || (t.reviewer_id || t.creator_user_id) === u.id)
      .map((t) => ({ ...taskOut(t, l), services: svc.get(t.id) || [] }))
      // Who lists a task is decided by its brand_service, customer and the team asked for, not by the board its card is on.
      .filter((t) => (scope === 'all' || (scope === 'team' ? ofTeam(t) : related(t))) && (!person || t.assignees.some((a) => a.id === person)))
      .filter((t) => !brandFilter || t.brand?.id === brandFilter)
      .filter((t) => !customerFilter || t.customer?.id === customerFilter)
      .filter((t) => !serviceFilter || t.brandService?.catalogServiceId === serviceFilter || t.services.some((s) => s.id === serviceFilter))
      .filter((t) => { const e = q.get('employee'); return !e || t.assignees.some((a) => a.userId === e) || !!onCard.get(t.id)?.includes(e); })
      .filter((t) => !q.get('label') || t.labels.includes(String(q.get('label'))))
      .filter((t) => !state || (isFlowFilter(state) ? flowMatch(t, state) : state === 'open' ? !['done', 'done_late', 'cancelled'].includes(t.state) : state === 'done' ? ['done', 'done_late'].includes(t.state) : t.state === state))
      .filter((t) => hit(t.id, t.title, t.brandService?.name, t.brand?.name, t.customer?.name, t.labels.join(' '), t.services.map((x) => x.name).join(' '), t.externalId, t.status, t.state === 'overdue' ? 'Quá hạn' : '', t.createdBy?.name, t.assignees.map((a) => a.name).join(' ')));
    json(res, 200, { tasks: rows, linked: ids.length > 0 });
  });
  // People (with their accounts and counts), brands, brandServices and labels, for filters and linking names to accounts.
  api.get('/api/tasks/meta', async (req, res) => {
    const u = await me(req);
    const allowedCustomers = await customerLevels(u.id);
    const visibleBrands = (
      await all<any>(
        `SELECT br.id, br.name, br.customer_id, c.name customer_name, br.logo, br.pos
         FROM brands br
         JOIN customers c ON c.id = br.customer_id
         WHERE br.deleted_at IS NULL AND c.archived_at IS NULL
         ORDER BY c.name COLLATE NOCASE, br.pos, br.name COLLATE NOCASE`
      )
    )
      .filter((b) => allowedCustomers.has(b.customer_id))
      .map((b) => ({ id: b.id, name: b.name, customerId: b.customer_id, customerName: b.customer_name, logo: b.logo || null, pos: Number(b.pos || 0) }));
    const brandServices = await brandServiceRows(u.id);
    const counts = new Map((await all<any>('SELECT person_id, COUNT(*) n FROM task_assignees GROUP BY person_id')).map((r) => [r.person_id, Number(r.n)]));
    json(res, 200, {
      people: (await all<any>('SELECT p.*, u.name user_name, u.avatar_at FROM task_people p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.name COLLATE NOCASE'))
        .map((p) => ({ id: p.id, name: p.name, userId: p.user_id || null, userName: p.user_name || null, avatarAt: p.avatar_at ?? null, tasks: counts.get(p.id) || 0 })),
      brands: visibleBrands,
      brandServices,
      /** @deprecated Dùng brandServices. */
      projects: brandServices,
      campaigns: [],
      teams:await all('SELECT id,name,color FROM team_roles ORDER BY pos'),
      workTeams: await (async () => {
        const mems = await all<any>('SELECT team_id, user_id, role FROM team_members');
        return (await all<any>('SELECT id, name, color, department_id departmentId FROM teams WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE')).map((t) => ({
          id: t.id, name: t.name, color: t.color, departmentId: t.departmentId || null,
          memberIds: mems.filter((m) => m.team_id === t.id).map((m) => m.user_id as string),
          leaderIds: mems.filter((m) => m.team_id === t.id && m.role === 'leader').map((m) => m.user_id as string),
        }));
      })(),
      mine: await myPeople(u.id), statuses: await taskStatuses(),
      users: await all<any>('SELECT id, name, email, team_role teamId FROM users WHERE disabled = 0 ORDER BY name COLLATE NOCASE'),
      labels: (await all<any>('SELECT id, name, color FROM task_labels ORDER BY name COLLATE NOCASE')).map((l) => ({ id: l.id, name: l.name, color: l.color || '#64748b' })),
      imports: (await all<any>('SELECT i.*, u.name user_name, s.name source_name FROM task_imports i LEFT JOIN users u ON u.id = i.user_id LEFT JOIN task_import_sheets s ON s.import_id=i.id WHERE i.user_id=? ORDER BY i.created_at DESC LIMIT 50',u.id))
        .map((i) => ({ id: i.id, rows: i.rows, created: i.created, updated: i.updated, at: i.created_at, by: i.user_name || '', sourceName: i.source_name || '', hasSheet: !!i.source_name })),
    });
  });
  // Original sheets can include arbitrary/private cells, so only importing admins read these snapshots.
  api.get('/api/tasks/imports/:id/sheet', async (req,res) => {
    if ((await me(req)).role !== 'admin') throw new HttpError(403, 'Chỉ quản trị viên xem được file sheet gốc');
    if(!await get('SELECT 1 FROM task_imports WHERE id=? AND user_id=?',req.params.id,(await me(req)).id))throw new HttpError(404,'Không tìm thấy file import');
    const sheet = await get<any>('SELECT * FROM task_import_sheets WHERE import_id=?', req.params.id);
    if (!sheet) throw new HttpError(404, 'File này chưa lưu bố cục cột; hãy import lại file để xem theo sheet');
    const page = Number(req.query.get('page') || 0);
    if (!Number.isInteger(page) || page < 0 || page >= sheet.parts) throw new HttpError(400, 'Trang không hợp lệ');
    const part = await get<any>('SELECT data FROM task_import_sheet_parts WHERE import_id=? AND part=?',req.params.id,page);
    if (!part) throw new HttpError(404,'Không tìm thấy phần dữ liệu của bảng');
    const data = JSON.parse(part.data);
    // A deleted task leaves its original source row, but no stale link to a missing task.
    const ids = data.taskIds.filter(Boolean);
    const existing = new Set(ids.length ? (await all<any>(`SELECT id FROM tasks WHERE id IN (${ids.map(()=>'?').join(',')})`,...ids)).map(t=>t.id) : []);
    json(res,200,{id:req.params.id,name:sheet.name,headers:JSON.parse(sheet.headers),titleColumn:sheet.title_column,total:sheet.row_count,page,pages:sheet.parts,...data,taskIds:data.taskIds.map((id:string|null)=>id&&existing.has(id)?id:null)});
  });
  api.get('/api/tasks/:id', async (req, res) => {
    const t = await get<any>(`${TASK_SQL} WHERE t.id = ?`, req.params.id);
    if (!t) throw new HttpError(404, 'Không tìm thấy công việc');
    const visibleCustomers=await customerLevels((await me(req)).id), l = await links(req,visibleCustomers), visibleProjects=l.pLevels, own = (!t.brand_service_id||visibleProjects.get(t.brand_service_id)!=='observer')&&await mine(req, t);
    const chain: { id: string; title: string }[] = [];
    for (let up = t.parent_id, n = 0; up && n < 20; n++) { const p = await get<any>('SELECT t.id,t.title,t.parent_id,t.brand_service_id,br.customer_id FROM tasks t LEFT JOIN brand_services bs ON bs.id=t.brand_service_id LEFT JOIN brands br ON br.id=bs.brand_id AND br.deleted_at IS NULL WHERE t.id=?',up); if (!p||p.brand_service_id&&!visibleProjects.has(p.brand_service_id)||p.customer_id&&!visibleCustomers.has(p.customer_id)) break; chain.unshift({ id: p.id, title: p.title }); up = p.parent_id; }
    // The whole branch under it: its subtasks, theirs and so on (each with its parent), as far as this account sees each one,
    // 20 levels and 500 tasks at most. D1 takes 100 values a query, so a level is read in parts.
    const kids: any[] = [], seen = new Set<string>([t.id]);
    for (let level: string[] = [t.id], n = 0; level.length && n < 20 && kids.length < 500; n++) {
      const next: any[] = [];
      for (let i = 0; i < level.length; i += 90) {
        const part = level.slice(i, i + 90);
        next.push(...await all<any>(`${TASK_SQL} WHERE t.parent_id IN (${part.map(() => '?').join(',')}) ORDER BY COALESCE(t.due_at, t.created_at), t.created_at`, ...part));
      }
      const shown = next.filter((x) => !seen.has(x.id) && (!x.brand_service_id || visibleProjects.has(x.brand_service_id)) && (!x.customer_id || visibleCustomers.has(x.customer_id))).slice(0, 500 - kids.length);
      for (const x of shown) { seen.add(x.id); kids.push(taskOut(x, l)); }
      level = shown.map((x) => x.id);
    }
    let boardLink: any = null;
    const linked = await get<any>('SELECT c.id cardId, c.board_id boardId, c.list_id listId, b.name boardName, l.name listName FROM task_board_links x JOIN board_cards c ON c.id=x.card_id JOIN boards b ON b.id=c.board_id JOIN board_lists l ON l.id=c.list_id WHERE x.task_id=?', t.id);
    if (linked) { try { await mustBoard(req, linked.boardId, 'viewer'); boardLink = linked; } catch (e) { if (!(e instanceof HttpError) || ![403,404].includes(e.status)) throw e; } }

    const commentRows = linked
      ? await all<any>('SELECT k.id, k.text, k.user_id userId, u.name userName, k.created_at createdAt, k.updated_at updatedAt, k.reply_to_id replyToId FROM card_comments k LEFT JOIN users u ON u.id = k.user_id WHERE k.card_id = ? ORDER BY k.created_at ASC', linked.cardId)
      : await all<any>('SELECT k.id, k.text, k.user_id userId, u.name userName, k.created_at createdAt, k.updated_at updatedAt, k.reply_to_id replyToId FROM task_comments k LEFT JOIN users u ON u.id = k.user_id WHERE k.task_id = ? ORDER BY k.created_at ASC', t.id);
    const reactions = await reactionsOf(commentRows.map((k) => k.id));
    const comments = commentRows.map((k) => ({ id: k.id, userId: k.userId, userName: k.userName || 'Thành viên', text: k.text, createdAt: k.createdAt, updatedAt: k.updatedAt, replyToId: k.replyToId || null, reactions: reactions.get(k.id) || [] }));

    // A linked task's history is its card's, with its review moves (kept on the task) among them.
    const activityRows = linked
      ? [...await all<any>("SELECT a.id, a.user_id userId, u.name userName, a.action, a.data, a.created_at at FROM board_activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.card_id = ? AND a.action != 'comment' ORDER BY a.created_at DESC LIMIT 50", linked.cardId),
         ...await all<any>("SELECT a.id, a.user_id userId, u.name userName, a.action, a.data, a.created_at at FROM task_activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.task_id = ? AND a.action LIKE 'flow.%' ORDER BY a.created_at DESC LIMIT 50", t.id)].sort((x, y) => y.at - x.at).slice(0, 50)
      : await all<any>("SELECT a.id, a.user_id userId, u.name userName, a.action, a.data, a.created_at at FROM task_activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.task_id = ? AND a.action != 'comment' ORDER BY a.created_at DESC LIMIT 50", t.id);
    const activity = activityRows.map((a) => {
      const d = typeof a.data === 'string' ? (JSON.parse(a.data || '{}') || {}) : (a.data || {});
      let text = 'đã cập nhật công việc';
      if (a.action === 'card.done') text = d.done ? 'đã đánh dấu hoàn thành' : 'đã mở lại công việc';
      else if (a.action === 'card.move') text = `đã chuyển sang ${d.to || ''}`;
      else if (a.action === 'card.add') text = 'đã tạo công việc';
      else if (a.action === 'card.due') text = d.due ? 'đã đặt hạn hoàn thành' : 'đã gỡ hạn';
      else if (a.action === 'card.member') text = d.on ? `đã giao việc cho ${d.name || ''}` : `đã gỡ ${d.name || ''}`;
      else if (a.action === 'task.update') text = 'đã cập nhật thông tin';
      else if (a.action === 'flow.start') text = 'đã giao việc, chuyển sang EXECUTION';
      else if (a.action === 'flow.submit') text = `đã nộp duyệt (lần ${d.round || 1})`;
      else if (a.action === 'flow.pass') text = `đã duyệt PASS (lần ${d.round || 1})`;
      else if (a.action === 'flow.redo') text = `đã trả về REDO (lần ${d.round || 1})`;
      else if (a.action === 'flow.fail') text = `đã chấm FAIL (lần ${d.round || 1})`;
      else if (a.action === 'flow.reopen') text = d.reason ? `đã mở lại công việc: ${d.reason}` : 'đã mở lại công việc';
      else if (a.action === 'flow.reviewer') text = d.reviewer ? `đã chọn ${d.reviewer} làm người duyệt` : 'đã để người tạo làm người duyệt';
      return { id: a.id, userId: a.userId, user: a.userName || 'Hệ thống', text, at: a.at, action: a.action };
    });

    json(res, 200, { ...taskOut(t, l), canDelete: own&&await canDelete(req,t), statuses: boardLink ? (await all<any>('SELECT name FROM board_lists WHERE board_id=? AND archived=0 ORDER BY pos',boardLink.boardId)).map(l=>l.name) : await taskStatuses(), boardLink, hasBoardLink: !!linked, description: t.description || '', result: own ? t.result || '' : null, resultHidden: !own && !!t.result, canEdit: own, canEditDescription: own && mayWriteDescription(await me(req), t.description, await taskDescriptionWriter(t)), path: chain, childTasks: kids, services: (await taskServices([t.id])).get(t.id) || [], flow: await flowDetail(t, await me(req), own, own), comments, activity });
  });
  api.post('/api/tasks', async (req, res) => {
    const u = await me(req), b = await readJson(req), input = await taskInput(b,undefined,u.id);
    const services = b.services !== undefined ? await serviceIds(b.services) : null;
    let creator: any = await get('SELECT id FROM task_people WHERE user_id=? ORDER BY created_at LIMIT 1', u.id);
    if (!creator) { creator = { id: uid('tp_') }; await run('INSERT INTO task_people(id,name,user_id,created_at) VALUES(?,?,?,?)', creator.id, u.name, u.id, now()); }
    // Given to someone when made, it starts in Execution; otherwise its Account gives it out first.
    const handedOut = !!(input.people?.length || input.userIds?.length);
    // Given to no one, it waits in ACCOUNT to be given out (never to its maker by default).
    const reviewer = b.reviewerUserId ? String(b.reviewerUserId) : null;
    if (reviewer && !await get('SELECT 1 FROM users WHERE id=? AND disabled=0', reviewer)) throw new HttpError(400, 'Người duyệt phải là tài khoản đang hoạt động');
    const id = uid('tk_'), at = now();
    await run('INSERT INTO tasks(id,title,status,start_at,due_at,done_at,brand_service_id,parent_id,description,result,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', id,input.title,input.status,input.start,input.due,input.done,input.project,input.parent,input.description,input.result,creator.id,at,at);
    await run('UPDATE tasks SET description_by=?,stage=?,reviewer_id=? WHERE id=?',input.description?.trim()?u.id:null,stageOf({status:input.status},handedOut,await flowSettings()),reviewer,id);
    await saveLinks(id,input,u.id);
    if (reviewer && input.project) await grantAccess(reviewer, u.id, { brandServiceId: input.project }, 'normal');
    if (services) await saveTaskServices(id, services, u.id);
    await inheritFollowers(id,input.project,input.parent,u.id);
    await routeTaskToWorkspace(id,u.id);
    await queueTaskNotifications(id,undefined,u.id).catch(()=>console.error('Không xếp được thông báo công việc'));
    json(res,201,{ id });
  });
  api.put('/api/tasks/:id', async (req, res) => {
    const t = await writable(req), b = await readJson(req), input = await taskInput(b,t,(await me(req)).id);
    const blocked = b.status !== undefined && statusBlocked(t, input.status, await flowSettings());
    if (blocked) throw new HttpError(409, blocked);
    const services = b.services !== undefined ? await serviceIds(b.services) : null;
    if ((input.description || '') !== (t.description || '')) {
      const u = await me(req), writer = await taskDescriptionWriter(t);
      await assertDescriptionWriter(u, t.description, writer);
      t.description_by = nextDescriptionWriter(u, t.description, input.description, writer);
    }
    const beforeNotification=await notificationSnapshot(t.id);
    // Whoever may change the task changes its card with it (writable): they are one piece of work.
    const linked = await get<any>('SELECT card_id FROM task_board_links WHERE task_id=?',t.id);
    await run('UPDATE tasks SET title=?,status=?,start_at=?,due_at=?,done_at=?,brand_service_id=?,parent_id=?,description=?,result=?,updated_at=? WHERE id=?', input.title,input.status,input.start,input.due,input.done,input.project,input.parent,input.description,input.result,now(),t.id);
    await run('UPDATE tasks SET description_by=? WHERE id=?',t.description_by ?? null,t.id);
    const assignedBefore=await assigneeUsers(t.id);
    await saveLinks(t.id,input,(await me(req)).id);
    if (services) await saveTaskServices(t.id, services, (await me(req)).id);
    // A task goes onto Workspace when it is made (or synced from the menu), not on a later edit: one taken off its card
    // stays off.
    if (linked && ['title','description','startAt','dueAt','status'].some((k) => b[k] !== undefined)) await syncTaskToCard(t.id);
    if (linked && (b.assigneeIds !== undefined || b.assigneeUserIds !== undefined)) await shareTaskCard(t.id,assignedBefore);
    // Moved to another brand_service: its card goes to that service's board.
    if (linked && (input.project || null) !== (t.brand_service_id || null)) await placeTaskCard(t.id);
    await queueTaskNotifications(t.id,beforeNotification,(await me(req)).id).catch(()=>console.error('Không xếp được thông báo công việc'));
    json(res,200,{ ok:true });
  });
  api.delete('/api/tasks/:id', async (req,res) => {
    const t = await writable(req);
    if (!await canDelete(req,t)) throw new HttpError(403,'Chỉ người tạo hoặc quản trị viên được xoá công việc');
    await removeTaskRecord(t.id);
    json(res,200,{ ok:true });
  });
  api.post('/api/tasks/bulk-delete', async (req, res) => {
    const b = await readJson(req);
    const ids = Array.isArray(b.ids) ? [...new Set<string>(b.ids.filter((id: unknown) => typeof id === 'string' && id))] : [];
    if (!ids.length || ids.length > 500) throw new HttpError(400, 'Hãy chọn từ 1 đến 500 công việc để xoá');
    let deleted = 0;
    for (const id of ids) {
      const t = await get<any>('SELECT * FROM tasks WHERE id=?', id);
      if (!t) continue;
      if (!await canDelete(req, t)) continue;
      await removeTaskRecord(t.id);
      deleted++;
    }
    json(res, 200, { ok: true, deleted });
  });
  api.post('/api/tasks/:id/card', async (req,res) => {
    const t = await writable(req), b = await readJson(req), u = await me(req);
    if (!!b.cardId === !!b.listId) throw new HttpError(400,'Chọn một thẻ có sẵn hoặc một danh sách để tạo thẻ');
    if (await get('SELECT 1 FROM task_board_links WHERE task_id=?',t.id)) throw new HttpError(409,'Công việc đã liên kết với thẻ');
    let card: any, created = false;
    if (b.cardId) {
      card = await mustCard(req,String(b.cardId));
      const existing = await get<any>('SELECT task_id FROM task_board_links WHERE card_id=?', card.id);
      if (existing && existing.task_id !== t.id) {
        const oldTask = await get<any>('SELECT * FROM tasks WHERE id=?', existing.task_id);
        if (oldTask && !oldTask.brand_service_id && !oldTask.parent_id) {
          if (!t.result && oldTask.result) await run('UPDATE tasks SET result=? WHERE id=?', oldTask.result, t.id);
          await run('DELETE FROM task_assignees WHERE task_id=?', oldTask.id);
          await run('DELETE FROM task_board_links WHERE card_id=?', card.id);
          await run('DELETE FROM tasks WHERE id=?', oldTask.id);
        } else {
          throw new HttpError(409,'Thẻ đã liên kết với công việc khác');
        }
      }
    } else {
      const list = await mustList(req,String(b.listId));
      if (list.archived) throw new HttpError(400,'Không tạo thẻ trong danh sách đã lưu trữ');
      card = {id:uid('k_'),board_id:list.board_id,list_id:list.id}; created = true;
      const pos = (await get<any>('SELECT MAX(pos) n FROM board_cards WHERE list_id=?',list.id))?.n || 0;
      await run('INSERT INTO board_cards(id,board_id,list_id,title,pos,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',card.id,card.board_id,card.list_id,t.title,pos+1,u.id,now(),now());
      // On a task's card are the people doing it, not whoever made the card.
      for (const id of await assigneeUsers(t.id)) await run('INSERT INTO card_members(card_id,user_id) VALUES(?,?)',card.id,id);
    }
    try { await run('INSERT INTO task_board_links(task_id,card_id) VALUES(?,?)',t.id,card.id); }
    catch { if (created) { await run('DELETE FROM card_members WHERE card_id=?',card.id); await run('DELETE FROM board_cards WHERE id=?',card.id); } throw new HttpError(409,'Công việc hoặc thẻ đã được liên kết; hãy tải lại'); }
    // A linked card's result is the task's: the card's own note joins it.
    if (card.result) { await run('UPDATE tasks SET result=? WHERE id=?',[t.result,card.result].filter(Boolean).join('\n\n').slice(0,20000),t.id); await run('UPDATE board_cards SET result=NULL WHERE id=?',card.id); }
    await syncTaskToCard(t.id);
    json(res,201,{cardId:card.id,boardId:card.board_id});
  });
  api.delete('/api/tasks/:id/card', async (req,res) => {
    const t = await writable(req);
    await run('DELETE FROM task_board_links WHERE task_id=?',t.id);
    json(res,200,{ ok:true });
  });
  // A move in its review workflow (shared/task-flow.ts): start, submit, pass, redo, fail, reopen, or a new reviewer.
  api.post('/api/tasks/:id/flow', async (req, res) => {
    const t = await get<any>('SELECT * FROM tasks WHERE id=?', req.params.id);
    if (!t) throw new HttpError(404, 'Không tìm thấy công việc');
    const u = await me(req), b = await readJson(req);
    const canEdit = (!t.brand_service_id || (await brandServiceLevels(u.id)).get(t.brand_service_id) !== 'observer') && await mine(req, t);
    await applyFlow(t, u, canEdit, String(b.action || '') as any, b);
    if (await get('SELECT 1 FROM task_board_links WHERE task_id=?', t.id)) await syncTaskToCard(t.id);
    json(res, 200, { ok: true });
  });
  // Importing (admins): the export as text, from a paste or a file read in the browser.
  api.post('/api/tasks/import', async (req, res) => {
    const u = await me(req);
    if (u.role !== 'admin') throw new HttpError(403, 'Chỉ quản trị viên mới nhập dữ liệu công việc');
    const body = await readJson(req), text = String(body.text || '');
    if (!text.trim()) throw new HttpError(400, 'Hãy dán dữ liệu hoặc chọn file');
    const links: Record<string, string | null> = {};
    const chosen = body.people && typeof body.people === 'object' && !Array.isArray(body.people) ? Object.entries(body.people) : [];
    if (chosen.length > 2000) throw new HttpError(400, 'Quá nhiều tên nhân viên');
    for (const [name, account] of chosen) {
      if (account !== null && !(await get('SELECT 1 FROM users WHERE id = ? AND disabled = 0', String(account)))) throw new HttpError(400, `Không tìm thấy tài khoản cho “${name}”`);
      links[name] = account === null ? null : String(account);
    }
    json(res, 200, await importTasks(text, u.id, String(body.sourceName || ''), links));
  });
  api.post('/api/task-people',async(req,res)=>{
    if((await me(req)).role!=='admin')throw new HttpError(403,'Chỉ quản trị viên được thêm nhân viên');
    const body=await readJson(req),userId=String(body.userId||'');
    if(userId){const id=await taskPersonForUser(userId);json(res,201,{id,userId});return;}
    const name=String(body.name||'').replace(/\s+/g,' ').trim();
    if(!name||name.length>120)throw new HttpError(400,'Tên nhân viên cần từ 1 đến 120 ký tự');
    const existing=(await all<any>('SELECT id,name FROM task_people WHERE user_id IS NULL')).find(p=>normName(p.name)===normName(name));
    const id=existing?.id||uid('tp_');
    if(!existing)await run('INSERT INTO task_people(id,name,user_id,created_at) VALUES(?,?,NULL,?)',id,name,now());
    json(res,201,{id,userId:null});
  });
  // Which account a name in the data is: admins set any; anyone claims a name no one has, or lets go of their own.
  api.put('/api/task-people/:id', async (req, res) => {
    const u = await me(req), p = await get<any>('SELECT * FROM task_people WHERE id = ?', req.params.id);
    if (!p) throw new HttpError(404, 'Không tìm thấy người này');
    const want = (await readJson(req)).userId ?? null;
    if (u.role !== 'admin' && !((want === u.id && !p.user_id) || (want === null && p.user_id === u.id))) throw new HttpError(403, 'Bạn chỉ chọn được tên của chính mình (tên chưa ai nhận)');
    if (want && !(await get('SELECT 1 FROM users WHERE id = ? AND disabled=0', String(want)))) throw new HttpError(404, 'Không tìm thấy tài khoản');
    await run('UPDATE task_people SET user_id = ? WHERE id = ?', want, p.id);
    json(res, 200, { ok: true });
  });

  api.post('/api/tasks/:id/comments', async (req, res) => {
    const u = await me(req), t = await get<any>('SELECT * FROM tasks WHERE id = ?', req.params.id);
    if (!t) throw new HttpError(404, 'Không tìm thấy công việc');
    const b = await readJson(req);
    const text = String(b.text || '').trim();
    if (!text) throw new HttpError(400, 'Hãy nhập bình luận');
    const replyToId = b.replyToId ? String(b.replyToId) : null;
    const commentId = uid('cm_');
    const nowTs = now();
    await run('INSERT INTO task_comments(id, task_id, user_id, text, reply_to_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', commentId, t.id, u.id, text, replyToId, nowTs, nowTs);

    const linked = await get<any>('SELECT card_id FROM task_board_links WHERE task_id = ?', t.id);
    if (linked) {
      const card = await get<any>('SELECT board_id FROM board_cards WHERE id = ?', linked.card_id);
      if (card) {
        await run('INSERT INTO card_comments(id, card_id, board_id, user_id, text, created_at, updated_at, reply_to_id) VALUES (?,?,?,?,?,?,?,?)', commentId, linked.card_id, card.board_id, u.id, text, nowTs, nowTs, replyToId).catch(() => {});
      }
    }
    await run('INSERT INTO task_activity(id, task_id, user_id, action, data, created_at) VALUES (?,?,?,?,?,?)', uid('ac_'), t.id, u.id, 'comment', JSON.stringify({ text }), nowTs).catch(() => {});

    // Notify @mentioned users (excluding the sender `u.id` — "trừ bản thân").
    const mentionedIds = new Set<string>(
      [...text.matchAll(/data-mention="([\w-]{1,64})"/g)].map((m) => m[1])
    );
    const allUsers = await all<any>('SELECT id, name FROM users WHERE disabled = 0 AND id != ?', u.id);
    for (const usr of allUsers) {
      if (usr.name && text.includes(`@${usr.name}`)) mentionedIds.add(usr.id);
    }
    mentionedIds.delete(u.id);
    if (mentionedIds.size > 0) {
      for (const targetId of mentionedIds) {
        if (t.brand_service_id) await grantAccess(targetId, u.id, { brandServiceId: t.brand_service_id }, 'observer').catch(() => {});
      }
      await notifyPeople([...mentionedIds], u.id, {
        title: 'Bạn được nhắc đến',
        body: `${u.name} · ${t.title}`,
        link: `#tasks/${t.id}`,
        commentId,
      }).catch(() => {});
    }

    json(res, 201, { id: commentId });
  });

  api.put('/api/tasks/comments/:id', async (req, res) => {
    const u = await me(req), b = await readJson(req), text = String(b.text || '').trim();
    if (!text) throw new HttpError(400, 'Hãy nhập nội dung bình luận');
    const row = await get<any>('SELECT * FROM task_comments WHERE id = ?', req.params.id);
    if (row) {
      if (row.user_id !== u.id && u.role !== 'admin') throw new HttpError(403, 'Chỉ người viết mới được sửa bình luận');
      await run('UPDATE task_comments SET text = ?, updated_at = ? WHERE id = ?', text, now(), row.id);
    }
    await run('UPDATE card_comments SET text = ?, updated_at = ? WHERE id = ?', text, now(), req.params.id).catch(() => {});
    json(res, 200, { ok: true });
  });

  api.delete('/api/tasks/comments/:id', async (req, res) => {
    const u = await me(req);
    const row = await get<any>('SELECT * FROM task_comments WHERE id = ?', req.params.id);
    if (row && row.user_id !== u.id && u.role !== 'admin') throw new HttpError(403, 'Chỉ người viết hoặc quản trị viên mới được xoá');
    await run('DELETE FROM task_comments WHERE id = ?', req.params.id);
    await run('DELETE FROM card_comments WHERE id = ?', req.params.id).catch(() => {});
    await dropReactions(req.params.id);
    json(res, 200, { ok: true });
  });
}
