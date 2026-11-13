import {removeTaskRecord,removeProjectRecord,syncProjectCards} from './work-sync';
import {grantAccess,projectLevels,requireProject} from './project-access';
import {customerLevel,customerLevels,requireCustomer} from './customer-access';
import {notificationSnapshot,notifyPeople,queueTaskNotifications} from './notifications';
// Công việc: the team's tasks, imported from their task app's export (pasted or as a file; see taskimport.ts) into
// tables of their own: tasks (any depth of parent → children, the app's ID kept so importing again updates them),
// projects (linked to a customer of the same name), people (who made a task, who does it; each name linked to a DMI
// Studio account, which is what "Công việc của tôi" goes by) and labels. Everyone signed in reads the list; a task's
// result (it can hold logins) shows to admins and the task's own people, who edit it. Public fields sync with linked cards. Admins import
// and link names to accounts; anyone may claim their own name when no one has it yet.
import { Router, HttpError, json, readJson } from './http';
import { assigneeUsers, placeTaskCard, projectCustomerChanged, projectHome, renameProjectBoard, routeTaskToWorkspace, shareTaskCard, syncAllTasksToWorkspace, syncProjectBoardMembers } from './taskworkspace';
import { TASK_MASTER } from '../shared/task-master';
import { RICH_MAX, RICH_TOO_LONG } from '../shared/rich';
import { isHold, projectStage } from '../shared/projects';
import { oneService, projectServices, saveProjectServices, saveTaskServices, serviceIds, settleCustomerServices, taskServices } from './project-services';
/** A project is one service of its customer (Khách → Dịch vụ → Công việc). */
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
  const allowedImportCustomers=await customerLevels(userId),allowedImportProjects=await projectLevels(userId);
  const customers = (await all<any>('SELECT id, name FROM customers')).filter(c=>allowedImportCustomers.has(c.id)).map((c) => ({ id: c.id as string, k: normName(c.name) })).filter((c) => c.k.length >= 4);
  const projects = new Map((await all<any>('SELECT id, name,customer_id FROM task_projects')).filter(p=>allowedImportProjects.has(p.id)&&(!p.customer_id||allowedImportCustomers.has(p.customer_id))).map((p) => [normName(p.name), p.id as string]));
  const project = async (name: string) => {
    const k = normName(name);
    if (!k) return null;
    if (!projects.has(k)) {
      // "MASTER | AutoPro DFW" belongs to the customer AutoPro DFW (the longest customer name inside it).
      const c = customers.filter((x) => k.includes(x.k)).sort((a, b) => b.k.length - a.k.length)[0];
      const id = uid('tj_');
      await run('INSERT INTO task_projects(id, name, customer_id, created_at) VALUES(?,?,?,?)', id, name.trim(), c?.id || null, t0);
      await run('UPDATE task_projects SET created_by=?,team_id=(SELECT team_role FROM users WHERE id=?) WHERE id=?',userId,userId,id);
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

  // Tasks: the app's ID says which one a row is (without one: the same title in the same project).
  const byTitle = new Map<string, { id: string; project: string | null }[]>();
  for (const t of await all<any>('SELECT id, title, project_id FROM tasks')) {
    const k = normName(t.title);
    byTitle.set(k, [...(byTitle.get(k) || []), { id: t.id, project: t.project_id }]);
  }
  const done: { row: TaskRow; id: string; project: string | null }[] = [], granted = new Set<string>();
  for (const row of rows) {
    const projectId = await project(row.project), createdBy = await person(row.createdBy);
    const old = row.externalId
      ? await get<any>('SELECT id FROM tasks WHERE external_id = ?', row.externalId)
      : await get<any>("SELECT id FROM tasks WHERE external_id IS NULL AND title = ? AND COALESCE(project_id, '') = ?", row.title, projectId || '');
    const fields = [row.title, row.status, row.startAt, row.dueAt, row.doneAt, projectId, row.description, row.result, createdBy, row.sourceUpdatedAt, importId] as const;
    let id: string;
    if (old) {
      const oldProject=(await get<any>('SELECT project_id FROM tasks WHERE id=?',old.id))?.project_id;if(oldProject)await requireProject(userId,oldProject,'normal');
      const customer=(await get<any>('SELECT p.customer_id FROM tasks t JOIN task_projects p ON p.id=t.project_id WHERE t.id=?',old.id))?.customer_id;
      if(customer)await requireCustomer(userId,customer,'normal');
      id = old.id;
      // The source app's status is the task's again: its stage is read anew from it (settleStages, below).
      await run('UPDATE tasks SET title=?, status=?, start_at=?, due_at=?, done_at=?, project_id=?, description=?, result=?, created_by=?, source_updated_at=?, import_id=?, stub=0, stage=NULL, updated_at=? WHERE id=?', ...fields, t0, id);
      count.updated++;
    } else {
      id = uid('tk_');
      await run('INSERT INTO tasks(id, external_id, title, status, start_at, due_at, done_at, project_id, description, result, created_by, source_updated_at, import_id, stub, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)',
        id, row.externalId || null, ...fields, t0, t0);
      count.created++;
      const k = normName(row.title);
      byTitle.set(k, [...(byTitle.get(k) || []), { id, project: projectId }]);
    }
    await run('DELETE FROM task_assignees WHERE task_id = ?', id);
    for (const name of row.assignees) {
      const p = await person(name);
      if (!p) continue;
      await run('INSERT OR IGNORE INTO task_assignees(task_id, person_id) VALUES(?,?)', id, p);
      // As when a task is assigned by hand: an employee opens the project of the work given to them.
      const account = people.get(normName(name))!.userId, grant = `${account}|${projectId}`;
      if (account && projectId && !granted.has(grant)) { granted.add(grant); await grantAccess(account, userId, { projectId }, 'normal'); }
    }
    await run('DELETE FROM task_label_links WHERE task_id = ?', id);
    for (const name of row.labels) await run('INSERT OR IGNORE INTO task_label_links(task_id, label_id) VALUES(?,?)', id, await label(name));
    done.push({ row, id, project: projectId });
  }

  // Parents, once every row is in: by the app's ID, else by title (same project first); a parent the export leaves out
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
      await run("INSERT INTO tasks(id, external_id, title, status, project_id, import_id, stub, created_at, updated_at) VALUES(?,NULL,?,'',?,?,1,?,?)", parent, row.parent, projectId, importId, t0, t0);
      byTitle.set(normName(row.parent), [{ id: parent, project: projectId }]);
      count.stubs++;
    }
    let up: string | null = parent, loop = false;
    for (let n = 0; up && n < 50; n++) { if (up === id) { loop = true; break; } up = (await get<any>('SELECT parent_id FROM tasks WHERE id = ?', up))?.parent_id || null; }
    if (loop) continue;
    await run('UPDATE tasks SET parent_id = ? WHERE id = ?', parent, id);
    count.parents++;
  }
  for (const x of done) { if(x.project) { const campaign=await defaultCampaign(x.project); await run('UPDATE tasks SET campaign_id=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM task_campaigns c WHERE c.id=tasks.campaign_id AND c.project_id=tasks.project_id)',campaign,x.id); } await routeTaskToWorkspace(x.id,userId); }
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
    projectLevels(user.id,customers),
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
const TASK_SQL = `SELECT t.*, j.name project_name, j.customer_id, (SELECT name FROM task_campaigns WHERE id=t.campaign_id) campaign_name, c.name creator_name, c.user_id creator_user_id, p.title parent_title,
  (SELECT COUNT(*) FROM tasks x WHERE x.parent_id = t.id) children
  FROM tasks t LEFT JOIN task_projects j ON j.id = t.project_id LEFT JOIN task_people c ON c.id = t.created_by LEFT JOIN tasks p ON p.id = t.parent_id`;
function taskOut(t: any, l: Awaited<ReturnType<typeof links>>) {
  return {
    id: t.id, externalId: t.external_id || null, title: t.title, status: t.status, state: stateOf(t), stage: stageOf(t, l.who.has(t.id), l.flow), startAt: t.start_at ?? null, dueAt: t.due_at ?? null, doneAt: t.done_at ?? null,
    project: t.project_id ? { id: t.project_id, name: t.project_name || '', customerId: t.customer_id || null } : null,
    campaign: t.campaign_id ? { id:t.campaign_id,name:t.campaign_name || '',projectId:t.project_id } : null,
    parent: t.parent_id ? { id: t.parent_id, title: t.parent_title || '' } : null, children: Number(t.children) || 0,
    createdBy: t.created_by ? { id: t.created_by, name: t.creator_name || '' } : null, assignees: l.who.get(t.id) || [],
    // The people on its card who are not given the task (a card linked by hand keeps its own people): it is their work too.
    cardPeople: (l.onCard.get(t.id) || []).filter((p) => !(l.who.get(t.id) || []).some((a) => a.userId === p.userId)), followers: l.followers.get(t.id) || [], labels: l.tags.get(t.id) || [],
    boardLink:l.boardLinks.get(t.id)||null,hasBoardLink:l.linkedTasks.has(t.id),
    canDelete: l.user.role === 'admin' || (t.creator_user_id != null && t.creator_user_id === l.user.id) || (t.project_id ? l.pLevels.get(t.project_id) === 'admin' : false),
    sourceUpdatedAt: t.source_updated_at ?? null, stub: !!t.stub, updatedAt: t.updated_at, createdAt: t.created_at,
    // The review workflow's own facts, for the overview: rounds sent back (REDO) and when it was last handed in.
    revision: Number(t.revision) || 0, submittedAt: t.submitted_at ?? null,
  };
}
/** May this account see a task's result and change it: admins, the task's own people, its project's managers and
 *  members (its followers and viewers only look) and, for a task outside projects, whoever edits its card on a board:
 *  the task and its card are one piece of work, so both sides follow the same rule. */
async function mine(req: Req, t: any) {
  const u = await me(req);
  if (u.role === 'admin' || t.reviewer_id === u.id) return true;
  if (t.project_id) { if (['admin', 'normal'].includes((await projectLevels(u.id)).get(t.project_id) || '')) return true; }
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
  if (t.project_id) {
    const level = (await projectLevels(u.id)).get(t.project_id);
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
async function defaultCampaign(project: string) {
  const id=`tc_existing_${project}`;
  await run('INSERT OR IGNORE INTO task_campaigns(id,project_id,name,created_at) VALUES(?,?,?,?)',id,project,'Công việc hiện có',now());
  return id;
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
  const project = b.projectId === undefined ? old?.project_id ?? null : b.projectId || null;
  if (project && !await get('SELECT 1 FROM task_projects WHERE id=?', String(project))) throw new HttpError(400, 'Không tìm thấy dịch vụ');
  if(project&&userId&&project!==old?.project_id){await requireProject(userId,String(project),'normal');const p=await get<any>('SELECT customer_id FROM task_projects WHERE id=?',project);if(p?.customer_id)await requireCustomer(userId,p.customer_id,'normal');}
  let campaign = b.campaignId === undefined && project === old?.project_id ? old?.campaign_id || null : b.campaignId || null;
  if (campaign && !await get('SELECT 1 FROM task_campaigns WHERE id=? AND project_id=?',String(campaign),project)) throw new HttpError(400,'Chiến dịch không thuộc dịch vụ đã chọn');
  const parent = b.parentId === undefined ? old?.parent_id ?? null : b.parentId || null;
  if (parent) {
    let at: string | null = String(parent), count = 0;
    while (at) {
      if (at === old?.id || count++ > 1000) throw new HttpError(400, 'Công việc cha tạo thành vòng lặp');
      const row: any = await get('SELECT parent_id,project_id FROM tasks WHERE id=?', at);
      if (!row) throw new HttpError(400, 'Không tìm thấy công việc cha');
      if(row.project_id&&userId)await requireProject(userId,row.project_id,'normal');
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
  let followers: string[] | undefined;
  if (b.followerUserIds !== undefined) {
    if (!Array.isArray(b.followerUserIds) || b.followerUserIds.length > 50 || b.followerUserIds.some((x:any)=>typeof x!=='string')) throw new HttpError(400,'Danh sách người theo dõi không hợp lệ');
    followers=[...new Set<string>(b.followerUserIds)];
    for (const id of followers) if (!await get('SELECT 1 FROM users WHERE id=? AND disabled=0',id)) throw new HttpError(400,'Người theo dõi phải là tài khoản đang hoạt động');
  }
  let labels: string[] | undefined;
  if (b.labels !== undefined) {
    if (!Array.isArray(b.labels) || b.labels.length > 20 || b.labels.some((x: any) => typeof x !== 'string' || x.length > 100)) throw new HttpError(400, 'Nhãn không hợp lệ');
    labels = [...new Set<string>(b.labels.map((x: string) => x.trim()).filter(Boolean))];
  }
  const finished = ['done', 'done_late'].includes(statusKey(status)), done = finished ? old?.done_at || now() : null;
  // Choosing "Hoàn thành muộn" is kept as chosen; any other finished status turns late by itself past the deadline.
  const keptLate = b.status !== undefined && statusKey(status) === 'done_late';
  if (!campaign && project) campaign = await defaultCampaign(String(project));
  return { title, status: finished ? (keptLate ? status : due && done! > due ? 'Hoàn thành muộn' : 'Hoàn thành') : status, start, due, done, project, campaign, parent,
    description: richIn(b.description ?? old?.description), result: richIn(b.result ?? old?.result), people, userIds, followers, labels };
}
async function saveLinks(id: string, input: Awaited<ReturnType<typeof taskInput>>, by?: string) {
  if (input.people !== undefined || input.userIds !== undefined) {
    const assigned = new Set(input.people || []);
    for (const userId of input.userIds || []) assigned.add(await taskPersonForUser(userId));
    // People given the task can work on it: they become members of its project (and customer) if they were not.
    if (by && input.project) for (const p of assigned) { const userId = (await get<any>('SELECT user_id FROM task_people WHERE id=?', p))?.user_id; if (userId) await grantAccess(userId, by, { projectId: input.project }, 'normal'); }
    await run('DELETE FROM task_assignees WHERE task_id=?', id);
    for (const p of assigned) await run('INSERT INTO task_assignees(task_id,person_id) VALUES(?,?)', id, p);
  }
  if (input.followers !== undefined) {
    // Followers see the task: view access to its project (and customer) when they had none.
    if (by && input.project) for (const userId of input.followers) await grantAccess(userId, by, { projectId: input.project }, 'observer');
    await run('DELETE FROM task_followers WHERE task_id=?', id);
    for (const userId of input.followers) await run('INSERT INTO task_followers(task_id,user_id) VALUES(?,?)', id, userId);
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

/** A new task is followed by its project's followers, and a new subtask by its parent's, as far as they can see it. */
async function inheritFollowers(id: string, project: string | null, parent: string | null) {
  const ids = new Set<string>();
  if (project) for (const r of await all<any>("SELECT user_id FROM task_project_members WHERE project_id=? AND role='observer' AND follows=1", project)) ids.add(r.user_id);
  if (parent) for (const r of await all<any>('SELECT user_id FROM task_followers WHERE task_id=?', parent)) ids.add(r.user_id);
  for (const userId of ids) if (!project || (await projectLevels(userId)).has(project)) await run('INSERT OR IGNORE INTO task_followers(task_id,user_id) SELECT ?,id FROM users WHERE id=? AND disabled=0', id, userId);
}

/** The project behind a customer's service: the oldest of the customer's projects carrying it, else a new one named
 *  after the service. Anyone who may work on the customer resolves it. */
export async function projectForService(user:{id:string;team_role?:string|null},customerId:string,serviceId:string){
  if(!customerId||!serviceId)throw new HttpError(400,'Cần chọn khách hàng và dịch vụ');
  await requireCustomer(user.id,customerId,'normal');
  const svc=await get<any>('SELECT id,name FROM services WHERE id=? AND deleted_at IS NULL',serviceId);
  if(!svc)throw new HttpError(404,'Không tìm thấy dịch vụ trong danh mục');
  const found=await get<any>('SELECT p.id,p.name FROM task_projects p JOIN project_services ps ON ps.project_id=p.id WHERE p.customer_id=? AND ps.service_id=? ORDER BY p.created_at ASC',customerId,serviceId);
  if(found)return{id:found.id as string,name:found.name as string,created:false};
  const id=uid('tj_');
  await run('INSERT INTO task_projects(id,name,customer_id,created_by,team_id,created_at) VALUES(?,?,?,?,?,?)',id,svc.name,customerId,user.id,user.team_role||null,now());
  await saveProjectServices(id,[svc.id],user.id);
  await run('DELETE FROM customer_needs WHERE customer_id=? AND service_id=?',customerId,svc.id);
  if(await getSetting('task_workspace_auto',true))await projectHome(id);
  return{id,name:svc.name as string,created:true};
}

async function canManageProject(user:any,id:string){return (await requireProject(user.id,id,'admin'))==='admin';}
export function registerTasks(api: Router) {
  api.post('/api/task-projects',async(req,res)=>{
    const user=await me(req),body=await readJson(req);
    // A project is one of its customer's services, called by the service's name (a name is only for one of no service).
    const services=body.services!==undefined?await oneService(body.services,ONE_SERVICE):null;
    const name=services?.length?(await get<any>('SELECT name FROM services WHERE id=?',services[0]))?.name||'':String(body.name||'').trim();
    if(!name||name.length>200)throw new HttpError(400,'Hãy chọn dịch vụ');
    const customerId=body.customerId?String(body.customerId):null;
    if(customerId)await requireCustomer(user.id,customerId,'admin');
    const teamId=body.teamId!==undefined?(body.teamId?String(body.teamId):null):user.team_role||null;
    if(teamId&&!await get('SELECT id FROM team_roles WHERE id=?',teamId))throw new HttpError(400,'Phòng ban không tồn tại');
    const id=uid('tj_');
    await run('INSERT INTO task_projects(id,name,customer_id,created_by,team_id,created_at) VALUES(?,?,?,?,?,?)',id,name,customerId,user.id,teamId,now());
    // The services chosen for it (the form offers its customer's as defaults), or else those still set on the customer.
    if(services){await saveProjectServices(id,services,user.id);if(customerId)await run('DELETE FROM customer_needs WHERE customer_id=?',customerId);}
    else if(customerId)await settleCustomerServices([customerId]);
    // On Workspace at once: a card on its customer's board (or its own board), where its tasks will go.
    if(await getSetting('task_workspace_auto',true))await projectHome(id);
    json(res,201,{id,name,customerId,teamId});
  });
  // Dịch vụ làm trục chính (Khách → Dịch vụ → Công việc): the project behind a customer's service, found or made on the
  // spot — one per customer × service, named after the service. Anyone who may work on the customer resolves it.
  api.post('/api/task-projects/for-service',async(req,res)=>{
    const user=await me(req),b=await readJson(req);
    const r=await projectForService(user,String(b.customerId||''),String(b.serviceId||''));
    json(res,r.created?201:200,r);
  });
  api.put('/api/task-projects/:project',async(req,res)=>{
    const user=await me(req),id=req.params.project;await requireProject(user.id,id,'admin');
    const body=await readJson(req);
    if(body.name!==undefined){
      const name=String(body.name||'').trim();
      if(!name||name.length>200)throw new HttpError(400,'Tên dịch vụ không hợp lệ (tối đa 200 ký tự)');
      await run('UPDATE task_projects SET name=? WHERE id=?',name,id);
      await renameProjectBoard(id,name);
    }
    let customerChanged=false;
    if(body.customerId!==undefined){
      const cid=body.customerId?String(body.customerId):null;
      if(cid)await requireCustomer(user.id,cid,'admin');
      customerChanged=cid!==((await get<any>('SELECT customer_id FROM task_projects WHERE id=?',id))?.customer_id||null);
      await run('UPDATE task_projects SET customer_id=? WHERE id=?',cid,id);
      if(cid)await settleCustomerServices([cid]);
    }
    // What the project is for: services of the catalogue (its customer's services are those of its projects).
    if(body.services!==undefined)await saveProjectServices(id,await oneService(body.services,ONE_SERVICE),user.id);
    // Put on hold or cancelled by its managers, or (null) back to following its tasks.
    if(body.hold!==undefined){
      if(body.hold!==null&&!isHold(body.hold))throw new HttpError(400,'Trạng thái dịch vụ không hợp lệ');
      await run('UPDATE task_projects SET hold=? WHERE id=?',body.hold,id);
    }
    if(body.teamId!==undefined){
      const tid=body.teamId?String(body.teamId):null;
      if(tid&&!await get('SELECT id FROM team_roles WHERE id=?',tid))throw new HttpError(400,'Phòng ban không tồn tại');
      await run('UPDATE task_projects SET team_id=? WHERE id=?',tid,id);
    }
    await syncProjectCards(id);
    if(customerChanged)await projectCustomerChanged(id);
    const updated=await get<any>('SELECT * FROM task_projects WHERE id=?',id);
    json(res,200,{ok:true,id,name:updated.name,customerId:updated.customer_id||null,teamId:updated.team_id||null});
  });
  const removeTaskProject = removeProjectRecord;
  api.delete('/api/task-projects/:project',async(req,res)=>{
    const user=await me(req),id=req.params.project;await requireProject(user.id,id,'admin');
    await removeTaskProject(id);
    json(res,200,{ok:true});
  });
  api.post('/api/task-projects/bulk-delete',async(req,res)=>{
    const user=await me(req),b=await readJson(req);
    const ids=Array.isArray(b.ids)?[...new Set<string>(b.ids.filter((id:unknown)=>typeof id==='string'&&id))]:[];
    if(!ids.length||ids.length>200)throw new HttpError(400,'Hãy chọn từ 1 đến 200 dịch vụ để xoá');
    const levels=await projectLevels(user.id);
    let deleted=0;
    for(const id of ids){
      if(levels.get(id)!=='admin'&&user.role!=='admin')continue;
      await removeTaskProject(id);
      deleted++;
    }
    json(res,200,{ok:true,deleted});
  });
  api.get('/api/task-projects/:project/members',async(req,res)=>{
    const user=await me(req),id=req.params.project,level=await requireProject(user.id,id);
    const p=await get<any>('SELECT * FROM task_projects WHERE id=?',id);
    const members=await all<any>(`SELECT u.id,u.name,CASE WHEN u.id=? THEN 'admin' WHEN m.role='observer' AND m.follows=0 THEN 'viewer' ELSE m.role END level FROM users u LEFT JOIN task_project_members m ON m.user_id=u.id AND m.project_id=? WHERE u.id=? OR m.user_id IS NOT NULL ORDER BY u.name`,p.created_by,id,p.created_by);
    json(res,200,{ownerId:p.created_by,teamId:p.team_id,level,members,teams:await all('SELECT id,name FROM team_roles ORDER BY pos'),people:level==='admin'?await all('SELECT id,name,team_role teamId FROM users WHERE disabled=0 ORDER BY name'):[]});
  });
  api.put('/api/task-projects/:project/team',async(req,res)=>{
    const user=await me(req),id=req.params.project;await requireProject(user.id,id,'admin');
    const body=await readJson(req),team=body.teamId?String(body.teamId):null;
    if(team&&!await get('SELECT id FROM team_roles WHERE id=?',team))throw new HttpError(400,'Team không tồn tại');
    await run('UPDATE task_projects SET team_id=? WHERE id=?',team,id);json(res,200,{ok:true});
  });
  api.put('/api/task-projects/:project/members/:userId',async(req,res)=>{
    const user=await me(req),id=req.params.project;await requireProject(user.id,id,'admin');
    const p=await get<any>('SELECT * FROM task_projects WHERE id=?',id),body=await readJson(req),want=body.level||'normal';
    // 'viewer' sees the project like a follower ('observer') without following each of its new tasks.
    if(!['admin','normal','observer','viewer'].includes(want))throw new HttpError(400,'Quyền không hợp lệ');
    const role=want==='viewer'?'observer':want,follows=want==='observer'?1:0;
    if(!await get('SELECT id FROM users WHERE id=? AND disabled=0',req.params.userId))throw new HttpError(404,'Không tìm thấy nhân viên');
    if(req.params.userId===p.created_by)throw new HttpError(400,'Không thể thay đổi quyền chủ dịch vụ');
    // A project of a customer is seen only by people of that customer: adding someone here opens the customer to them
    // (view for a follower or viewer, member otherwise).
    if(p.customer_id)await grantAccess(req.params.userId,user.id,{customerId:p.customer_id},role==='normal'||role==='admin'?'normal':'observer');
    const had=await get('SELECT 1 FROM task_project_members WHERE project_id=? AND user_id=?',id,req.params.userId);
    await run('INSERT INTO task_project_members(project_id,user_id,role,follows) VALUES(?,?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role,follows=excluded.follows',id,req.params.userId,role,follows);
    if(!had)await notifyPeople([req.params.userId],user.id,{title:'Bạn được thêm vào dịch vụ',body:p.name,link:`#projects/${id}`});
    await syncProjectBoardMembers(id);
    json(res,200,{ok:true});
  });
  api.delete('/api/task-projects/:project/members/:userId',async(req,res)=>{
    const user=await me(req),id=req.params.project;await requireProject(user.id,id,'admin');
    const p=await get<any>('SELECT created_by FROM task_projects WHERE id=?',id);if(p.created_by===req.params.userId)throw new HttpError(400,'Không thể gỡ chủ dịch vụ');
    await run('DELETE FROM task_project_members WHERE project_id=? AND user_id=?',id,req.params.userId);
    await syncProjectBoardMembers(id);
    json(res,200,{ok:true});
  });
  api.get('/api/task-projects/:project/campaigns',async(req,res)=>{
    if(!await get('SELECT id FROM task_projects WHERE id=?',req.params.project))throw new HttpError(404,'Không tìm thấy dịch vụ');
    json(res,200,(await all<any>('SELECT c.*, (SELECT COUNT(*) FROM tasks t WHERE t.campaign_id=c.id AND t.stub=0) tasks FROM task_campaigns c WHERE project_id=? ORDER BY created_at',req.params.project)).map(c=>({id:c.id,name:c.name,projectId:c.project_id,tasks:c.tasks})));
  });
  api.post('/api/task-projects/:project/campaigns',async(req,res)=>{
    const u=await me(req);if(!await canManageProject(u,req.params.project))throw new HttpError(403,'Chỉ quản trị viên được tạo chiến dịch');
    if(!await get('SELECT id FROM task_projects WHERE id=?',req.params.project))throw new HttpError(404,'Không tìm thấy dịch vụ');
    const b=await readJson(req),name=String(b.name||'').trim();if(!name||name.length>200)throw new HttpError(400,'Hãy nhập tên chiến dịch (tối đa 200 ký tự)');
    const id=uid('tc_');await run('INSERT INTO task_campaigns(id,project_id,name,created_at) VALUES(?,?,?,?)',id,req.params.project,name,now());json(res,201,{id,name,projectId:req.params.project,tasks:0});
  });
  api.put('/api/task-projects/:project/campaigns/:id',async(req,res)=>{
    const u=await me(req);if(!await canManageProject(u,req.params.project))throw new HttpError(403,'Chỉ quản trị viên được sửa chiến dịch');
    if(!await get('SELECT id FROM task_campaigns WHERE id=? AND project_id=?',req.params.id,req.params.project))throw new HttpError(404,'Không tìm thấy chiến dịch');
    const b=await readJson(req),name=String(b.name||'').trim();if(!name||name.length>200)throw new HttpError(400,'Tên chiến dịch không hợp lệ');await run('UPDATE task_campaigns SET name=? WHERE id=?',name,req.params.id);json(res,200,{ok:true});
  });
  api.delete('/api/task-projects/:project/campaigns/:id',async(req,res)=>{
    const u=await me(req);if(!await canManageProject(u,req.params.project))throw new HttpError(403,'Chỉ quản trị viên được xoá chiến dịch');
    if(await get('SELECT 1 FROM tasks WHERE campaign_id=?',req.params.id))throw new HttpError(409,'Chuyển công việc sang chiến dịch khác trước khi xoá');
    await run('DELETE FROM task_campaigns WHERE id=? AND project_id=?',req.params.id,req.params.project);json(res,200,{ok:true});
  });
  api.post('/api/tasks/master', async (req, res) => {
    const u = await me(req);
    if (u.role !== 'admin') throw new HttpError(403, 'Chỉ quản trị viên được áp dụng luồng master');
    const b = await readJson(req);
    const projectId = String(b.projectId || '');
    if (!await get('SELECT id FROM task_projects WHERE id=?', projectId)) throw new HttpError(404, 'Hãy chọn dịch vụ/chiến dịch có sẵn');
    if (!Array.isArray(b.keys) || !b.keys.length || b.keys.length > TASK_MASTER.length || b.keys.some((key: unknown) => !TASK_MASTER.some((item) => item.key === key))) throw new HttpError(400, 'Nhóm công việc không hợp lệ');
    const input = await taskInput({ title: 'Master', projectId, campaignId:b.campaignId, assigneeIds: b.assigneeIds || [], assigneeUserIds: b.assigneeUserIds || [], startAt: b.startAt ?? null, dueAt: b.dueAt ?? null },undefined,u.id);
    const creator = await taskPersonForUser(u.id), at = now();
    let created = 0, kept = 0;
    const ids: string[] = [];
    for (const item of TASK_MASTER.filter((item) => b.keys.includes(item.key))) {
      // Stable IDs make concurrent/repeated application safe without changing edited tasks.
      const legacy = await get<any>('SELECT id FROM tasks WHERE id=? AND campaign_id=?',`tk_master_${projectId}_${item.key}`,input.campaign);
      const id = legacy?.id || `tk_master_${input.campaign || projectId}_${item.key}`;
      const result = await run('INSERT OR IGNORE INTO tasks(id,title,status,start_at,due_at,project_id,created_by,stub,created_at,updated_at) VALUES(?,?,?,?,?,?,?,0,?,?)', id, item.title, 'Chưa thực hiện', input.start, input.due, projectId, creator, at, at);
      if (result.changes) { await run('UPDATE tasks SET campaign_id=? WHERE id=?',input.campaign,id); await saveLinks(id, input, u.id); await routeTaskToWorkspace(id,u.id); created++; } else kept++;
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
    const u = await me(req), q = req.query, project = String(q.get('project') || '') || null;
    const scope = q.get('scope') === 'all' && project ? 'all' : q.get('scope') === 'team' ? 'team' : 'mine';
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
    // Within "mine", one relation only: given to me (or on my card), made by me, or followed by me.
    const rel = String(q.get('rel') || '');
    const related = (t: ReturnType<typeof taskOut>) => rel === 'assigned' ? t.assignees.some((a) => ids.includes(a.id)) || !!onCard.get(t.id)?.includes(u.id)
      : rel === 'created' ? !!t.createdBy && ids.includes(t.createdBy.id) : rel === 'following' ? t.followers.some((f) => f.id === u.id) : mine(t);
    const ofTeam = (t: ReturnType<typeof taskOut>) => t.assignees.some((a) => !!a.userId && team.has(a.userId)) || !!onCard.get(t.id)?.some((id) => team.has(id));
    const person = scope === 'mine' ? null : String(q.get('person') || '') || null;
    const state = String(q.get('state') || ''), hit = matcher(q.get('q'));
    const svc = await taskServices();
    const rows = (await all<any>(`${TASK_SQL}${project ? ' WHERE t.project_id = ?' : ''} ORDER BY COALESCE(t.due_at, t.created_at) DESC`, ...(project ? [project] : [])))
      .filter(t=>(!t.project_id||allowedProjects.has(t.project_id))&&(!t.customer_id||allowedCustomers.has(t.customer_id)))
      .map((t) => ({ ...taskOut(t, l), services: svc.get(t.id) || [] }))
      // Who lists a task is decided by its project, customer and the team asked for, not by the board its card is on: a
      // new task's card sits on its maker's own board, which a department head may not see (the task then opens as its
      // page instead of its card).
      .filter((t) => (scope === 'all' || (scope === 'team' ? ofTeam(t) : related(t))) && (!person || t.assignees.some((a) => a.id === person)))
      .filter((t) => { const e = q.get('employee'); return !e || t.assignees.some((a) => a.userId === e) || !!onCard.get(t.id)?.includes(e); })
      .filter((t) => !q.get('campaign') || t.campaign?.id === q.get('campaign'))
      .filter((t) => !state || (isFlowFilter(state) ? flowMatch(t, state) : state === 'open' ? !['done', 'done_late', 'cancelled'].includes(t.state) : state === 'done' ? ['done', 'done_late'].includes(t.state) : t.state === state))
      .filter((t) => hit(t.id, t.title, t.project?.name, t.labels.join(' '), t.services.map((x) => x.name).join(' '), t.externalId, t.status, t.state === 'overdue' ? 'Quá hạn' : '', t.createdBy?.name, t.assignees.map((a) => a.name).join(' ')));
    json(res, 200, { tasks: rows, linked: ids.length > 0 });
  });
  // People (with their accounts and counts), projects and labels, for filters and linking names to accounts.
  api.get('/api/tasks/meta', async (req, res) => {
    const u = await me(req);
    const allowedCustomers=await customerLevels(u.id),allowedProjects=await projectLevels(u.id);
    const visibleProjects=(await all<any>('SELECT id,customer_id FROM task_projects')).filter(p=>allowedProjects.has(p.id)&&(!p.customer_id||allowedCustomers.has(p.customer_id)));
    const projectIds=new Set(visibleProjects.map(p=>p.id));
    const counts = new Map((await all<any>('SELECT person_id, COUNT(*) n FROM task_assignees GROUP BY person_id')).map((r) => [r.person_id, Number(r.n)]));
    // Its tasks' progress, and from it the project's own stage (cancelled tasks are not counted as work left).
    const projStats = new Map<string, { completed: number; overdue: number; live: number; started: number }>();
    for (const r of await all<any>('SELECT project_id, status, due_at, done_at FROM tasks WHERE project_id IS NOT NULL AND stub = 0')) {
      if (!projectIds.has(r.project_id)) continue;
      const s = projStats.get(r.project_id) || { completed: 0, overdue: 0, live: 0, started: 0 };
      const st = stateOf(r);
      if (st !== 'cancelled') s.live++;
      if (st === 'done' || st === 'done_late') s.completed++;
      else if (st === 'overdue') s.overdue++;
      if (!['todo', 'cancelled'].includes(st) && !(st === 'overdue' && statusKey(r.status) === 'todo')) s.started++;
      projStats.set(r.project_id, s);
    }
    const services = await projectServices([...projectIds]);
    const projAssignees = new Map<string, { id: string; name: string; userId: string | null; avatarAt?: number | null }[]>();
    for (const r of await all<any>('SELECT DISTINCT t.project_id, p.id, COALESCE(u.name, p.name) name, p.user_id, u.avatar_at FROM tasks t JOIN task_assignees a ON a.task_id = t.id JOIN task_people p ON p.id = a.person_id LEFT JOIN users u ON u.id = p.user_id WHERE t.project_id IS NOT NULL ORDER BY 3')) {
      if (!projectIds.has(r.project_id)) continue;
      projAssignees.set(r.project_id, [...(projAssignees.get(r.project_id) || []), { id: r.id, name: r.name, userId: r.user_id || null, avatarAt: r.avatar_at ?? null }]);
    }
    json(res, 200, {
      people: (await all<any>('SELECT p.*, u.name user_name, u.avatar_at FROM task_people p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.name COLLATE NOCASE'))
        .map((p) => ({ id: p.id, name: p.name, userId: p.user_id || null, userName: p.user_name || null, avatarAt: p.avatar_at ?? null, tasks: counts.get(p.id) || 0 })),
      projects: (await all<any>('SELECT j.*, c.name customer_name, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = j.id) n, (SELECT MAX(t.updated_at) FROM tasks t WHERE t.project_id = j.id) touched FROM task_projects j LEFT JOIN customers c ON c.id = j.customer_id ORDER BY j.name COLLATE NOCASE')).filter(j=>projectIds.has(j.id)).map((j) => {
        const st = projStats.get(j.id);
        return { id: j.id, name: j.name, customerId: j.customer_id || null, customerName: j.customer_name || null, teamId:j.team_id||null,createdBy:j.created_by,createdAt:j.created_at??null,updatedAt:Math.max(j.created_at||0,j.touched||0)||null,level:allowedProjects.get(j.id), tasks: Number(j.n), completed: st?.completed || 0, overdue: st?.overdue || 0, hold: j.hold || null, services: services.get(j.id) || [], stage: projectStage({ tasks: st?.live || 0, started: st?.started || 0, done: st?.completed || 0 }, j.hold), assignees: projAssignees.get(j.id) || [] };
      }),
      campaigns: (await all<any>('SELECT c.*, (SELECT COUNT(*) FROM tasks t WHERE t.campaign_id=c.id) tasks FROM task_campaigns c ORDER BY c.name')).filter(c=>projectIds.has(c.project_id)).map(c=>({id:c.id,name:c.name,projectId:c.project_id,tasks:c.tasks})),
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
    const visibleCustomers=await customerLevels((await me(req)).id), l = await links(req,visibleCustomers), visibleProjects=l.pLevels, own = (!t.project_id||visibleProjects.get(t.project_id)!=='observer')&&await mine(req, t);
    const chain: { id: string; title: string }[] = [];
    for (let up = t.parent_id, n = 0; up && n < 20; n++) { const p = await get<any>('SELECT t.id,t.title,t.parent_id,t.project_id,p.customer_id FROM tasks t LEFT JOIN task_projects p ON p.id=t.project_id WHERE t.id=?',up); if (!p||p.project_id&&!visibleProjects.has(p.project_id)||p.customer_id&&!visibleCustomers.has(p.customer_id)) break; chain.unshift({ id: p.id, title: p.title }); up = p.parent_id; }
    // The whole branch under it: its subtasks, theirs and so on (each with its parent), as far as this account sees each one,
    // 20 levels and 500 tasks at most. D1 takes 100 values a query, so a level is read in parts.
    const kids: any[] = [], seen = new Set<string>([t.id]);
    for (let level: string[] = [t.id], n = 0; level.length && n < 20 && kids.length < 500; n++) {
      const next: any[] = [];
      for (let i = 0; i < level.length; i += 90) {
        const part = level.slice(i, i + 90);
        next.push(...await all<any>(`${TASK_SQL} WHERE t.parent_id IN (${part.map(() => '?').join(',')}) ORDER BY COALESCE(t.due_at, t.created_at), t.created_at`, ...part));
      }
      const shown = next.filter((x) => !seen.has(x.id) && (!x.project_id || visibleProjects.has(x.project_id)) && (!x.customer_id || visibleCustomers.has(x.customer_id))).slice(0, 500 - kids.length);
      for (const x of shown) { seen.add(x.id); kids.push(taskOut(x, l)); }
      level = shown.map((x) => x.id);
    }
    let boardLink: any = null;
    const linked = await get<any>('SELECT c.id cardId, c.board_id boardId, c.list_id listId, b.name boardName, l.name listName FROM task_board_links x JOIN board_cards c ON c.id=x.card_id JOIN boards b ON b.id=c.board_id JOIN board_lists l ON l.id=c.list_id WHERE x.task_id=?', t.id);
    if (linked) { try { await mustBoard(req, linked.boardId, 'viewer'); boardLink = linked; } catch (e) { if (!(e instanceof HttpError) || ![403,404].includes(e.status)) throw e; } }

    const commentRows = linked
      ? await all<any>('SELECT k.id, k.text, k.user_id userId, u.name userName, k.created_at createdAt, k.updated_at updatedAt, k.reply_to_id replyToId FROM card_comments k LEFT JOIN users u ON u.id = k.user_id WHERE k.card_id = ? ORDER BY k.created_at ASC', linked.cardId)
      : await all<any>('SELECT k.id, k.text, k.user_id userId, u.name userName, k.created_at createdAt, k.updated_at updatedAt, k.reply_to_id replyToId FROM task_comments k LEFT JOIN users u ON u.id = k.user_id WHERE k.task_id = ? ORDER BY k.created_at ASC', t.id);
    const comments = commentRows.map((k) => ({ id: k.id, userId: k.userId, userName: k.userName || 'Thành viên', text: k.text, createdAt: k.createdAt, updatedAt: k.updatedAt, replyToId: k.replyToId || null }));

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
    if (input.people === undefined && input.userIds === undefined) input.people = [creator.id];
    const reviewer = b.reviewerUserId ? String(b.reviewerUserId) : null;
    if (reviewer && !await get('SELECT 1 FROM users WHERE id=? AND disabled=0', reviewer)) throw new HttpError(400, 'Người duyệt phải là tài khoản đang hoạt động');
    const id = uid('tk_'), at = now();
    await run('INSERT INTO tasks(id,title,status,start_at,due_at,done_at,project_id,parent_id,description,result,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', id,input.title,input.status,input.start,input.due,input.done,input.project,input.parent,input.description,input.result,creator.id,at,at);
    await run('UPDATE tasks SET campaign_id=?,description_by=?,stage=?,reviewer_id=? WHERE id=?',input.campaign,input.description?.trim()?u.id:null,stageOf({status:input.status},handedOut,await flowSettings()),reviewer,id);
    await saveLinks(id,input,u.id);
    if (reviewer && input.project) await grantAccess(reviewer, u.id, { projectId: input.project }, 'normal');
    if (services) await saveTaskServices(id, services, u.id);
    await inheritFollowers(id,input.project,input.parent);
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
    await run('UPDATE tasks SET title=?,status=?,start_at=?,due_at=?,done_at=?,project_id=?,parent_id=?,description=?,result=?,updated_at=? WHERE id=?', input.title,input.status,input.start,input.due,input.done,input.project,input.parent,input.description,input.result,now(),t.id);
    await run('UPDATE tasks SET campaign_id=?,description_by=? WHERE id=?',input.campaign,t.description_by ?? null,t.id);
    const assignedBefore=await assigneeUsers(t.id);
    await saveLinks(t.id,input,(await me(req)).id);
    if (services) await saveTaskServices(t.id, services, (await me(req)).id);
    // A task goes onto Workspace when it is made (or synced from the menu), not on a later edit: one taken off its card
    // stays off.
    if (linked && ['title','description','startAt','dueAt','status'].some((k) => b[k] !== undefined)) await syncTaskToCard(t.id);
    if (linked && (b.assigneeIds !== undefined || b.assigneeUserIds !== undefined)) await shareTaskCard(t.id,assignedBefore);
    // Moved to another project: its card goes to that project's board.
    if (linked && (input.project || null) !== (t.project_id || null)) await placeTaskCard(t.id);
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
        if (oldTask && !oldTask.project_id && !oldTask.parent_id) {
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
      await run('INSERT INTO card_members(card_id,user_id) VALUES(?,?)',card.id,u.id);
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
    const canEdit = (!t.project_id || (await projectLevels(u.id)).get(t.project_id) !== 'observer') && await mine(req, t);
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
    json(res, 200, { ok: true });
  });
}
