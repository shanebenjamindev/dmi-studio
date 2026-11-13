import {requireProject} from './project-access';
import {notificationSnapshot,queueTaskNotifications} from './notifications';
// A linked task and card share their public working fields. Results stay on the task.
import { all, get, run, now } from './db';
import { HttpError } from './http';
import { statusKey } from './taskimport';
import { applyFlow, flowSettings, statusBlocked } from './task-flow';
import { columnStage, isOverdueColumn } from './flow-columns';
import { isFlowStage, type FlowAction } from '../shared/task-flow';

export async function assertLinkedTaskEditable(cardId: string, userId: string) {
  const link = await get<any>('SELECT t.* FROM task_board_links l JOIN tasks t ON t.id=l.task_id WHERE l.card_id=?', cardId);
  if (!link) return;
  // As on the task's own page: its project's managers and members change it (followers and viewers only look); outside
  // projects, whoever edits the card on its board (the caller checked that) does.
  if(link.project_id)await requireProject(userId,link.project_id,'normal');
}

/** A card move or tick (`listId`, `done`) its task's review workflow does not allow: a closed task stays where it is
 *  until it is reopened, and only a review finishes an open one (server/task-flow.ts). A move to the column of the next
 *  step is that step's move, made by `actor`: ACCOUNT → EXECUTION gives the work out, EXECUTION → REVIEW hands it in,
 *  REVIEW → COMPLETED passes it. REDO and FAIL need feedback, so they are made on the task. */
export async function assertCardFlow(cardId: string, b: { listId?: unknown; done?: unknown }, actor?: { id: string; role: string }) {
  const t = await get<any>('SELECT t.*, c.list_id, c.done FROM task_board_links l JOIN tasks t ON t.id=l.task_id JOIN board_cards c ON c.id=l.card_id WHERE l.card_id=?', cardId);
  if (!t) return;
  const list = b.listId !== undefined && b.listId !== t.list_id ? await get<any>('SELECT name FROM board_lists WHERE id=?', String(b.listId)) : null;
  const to = list && isFlowStage(t.stage) ? columnStage(list.name) : null;
  if (to && to !== t.stage) {
    const action = DRAG_MOVE[`${t.stage}>${to}`];
    if (!action || !actor) throw new HttpError(409, t.stage === 'completed' || t.stage === 'rejected' ? 'Công việc đã đóng (PASS hoặc FAIL). Người duyệt hoặc Admin bấm Mở lại để làm tiếp.'
      : t.stage === 'review' ? 'REDO và FAIL cần nhận xét: mở công việc để chấm.' : 'Công việc đi theo quy trình ACCOUNT → EXECUTION → REVIEW: kéo sang bước kế tiếp.');
    await applyFlow(t, actor, true, action);
    return;
  }
  const next = list ? list.name : b.done !== undefined && !!b.done !== !!t.done ? (b.done ? 'Hoàn thành' : 'Đang thực hiện') : null;
  const blocked = next && statusBlocked(t, next, await flowSettings());
  if (blocked) throw new HttpError(409, blocked);
}
const DRAG_MOVE: Record<string, FlowAction> = { 'account>execution': 'start', 'execution>review': 'submit', 'review>completed': 'pass' };

/** Who wrote a task's description (from before writers were kept: whoever made the task). */
export async function taskDescriptionWriter(t: any): Promise<string | null> {
  return t.description_by ?? (await get<any>('SELECT user_id FROM task_people WHERE id=?', t.created_by))?.user_id ?? null;
}
/** Who wrote a card's description: on a card linked to a task, the task's writer, as they share the one text. */
export async function cardDescriptionWriter(c: any): Promise<string | null> {
  const t = await get<any>('SELECT t.* FROM task_board_links l JOIN tasks t ON t.id=l.task_id WHERE l.card_id=?', c.id);
  return t ? taskDescriptionWriter(t) : c.description_by ?? c.created_by ?? null;
}
/** A written description is changed only by whoever wrote it (and admins); an empty one by anyone who edits the work. */
export function mayWriteDescription(user: { id: string; role: string }, current: unknown, writer: string | null) {
  return !String(current || '').trim() || !writer || writer === user.id || user.role === 'admin';
}
/** Its writer after a change: whoever fills an empty one; nobody once it is emptied; otherwise unchanged. */
export function nextDescriptionWriter(user: { id: string }, current: unknown, next: unknown, writer: string | null) {
  return !String(next || '').trim() ? null : String(current || '').trim() ? writer ?? user.id : user.id;
}
export async function assertDescriptionWriter(user: { id: string; role: string }, current: unknown, writer: string | null) {
  if (!mayWriteDescription(user, current, writer)) throw new HttpError(403, 'Chỉ người viết mô tả mới sửa được mô tả');
}

/** The column a task of this status goes to: one of that name, else one meaning the same (Cần làm for Chưa thực hiện,
 *  Xong for Hoàn thành; done late goes with done); a status of a board's own workflow needs a column of its name. */
export function columnFor<L extends { name: string }>(lists: L[], status: string): L | undefined {
  const key = statusKey(status), same = (k: string) => lists.find((l) => statusKey(l.name) === k);
  return lists.find((l) => l.name === status) || (key !== 'other' ? same(key) : undefined) || (key === 'done_late' ? same('done') : undefined);
}
/** The task status a column stands for: one with a common meaning (to do, doing, done, paused, cancelled) gives the
 *  task status of that meaning (done after its due date: done late), so tasks keep the statuses of their own workflow;
 *  a column of a board's own (Chờ duyệt, Cần sửa…) is the status itself. */
async function columnStatus(name: string, doneAt: number | null, due: number | null) {
  const key = statusKey(name);
  if (key === 'other' || key === 'overdue') return name;
  const want = key === 'done' && due && doneAt && doneAt > due ? 'done_late' : key;
  const statuses = (await all<any>('SELECT name FROM task_statuses WHERE active = 1 ORDER BY pos')).map((r) => r.name as string);
  return statuses.find((n) => statusKey(n) === want) || name;
}
export async function syncTaskToCard(taskId: string) {
  const t = await get<any>('SELECT t.*, l.card_id FROM tasks t JOIN task_board_links l ON l.task_id=t.id WHERE t.id=?', taskId);
  if (!t) return;
  await run('UPDATE board_cards SET title=?, description=?, description_by=?, start_at=?, due_at=?, done=?, updated_at=? WHERE id=?',
    t.title, t.description || '', t.description_by ?? null, t.start_at, t.due_at, ['done', 'done_late'].includes(statusKey(t.status)) ? 1 : 0, now(), t.card_id);
  const card=await get<any>('SELECT board_id,list_id FROM board_cards WHERE id=?',t.card_id);
  if (!card) return;
  await run('UPDATE board_cards SET project_card_id=(SELECT id FROM board_cards WHERE board_id=? AND work_project_id=? AND card_kind=\'project\' ORDER BY created_at LIMIT 1) WHERE id=?',card.board_id,t.project_id,t.card_id);
  const lists=await all<any>('SELECT id,name FROM board_lists WHERE board_id=? AND archived=0 ORDER BY pos',card.board_id);
  // A task in the review workflow: a column of its step — the one its card sits in if it is one (Cần sửa and Đang dựng
  // are both EXECUTION: the card stays where its people put it), or one of no step (Tạm dừng, Chờ phản hồi) it was put
  // in. Any other task: the column of its status.
  const here=lists.find((l)=>l.id===card.list_id);
  const settled=isFlowStage(t.stage)&&!!here&&!isOverdueColumn(here.name)&&[t.stage,null].includes(columnStage(here.name));
  // A task in the workflow sits in a column of its step (or of no step named as its status, like Tạm dừng), whatever else
  // its status says (a status set before the workflow, say).
  const target=isFlowStage(t.stage)
    ? (settled?here:lists.find((l)=>l.name===t.status&&[t.stage,null].includes(columnStage(l.name)))||lists.find((l)=>columnStage(l.name)===t.stage)||columnFor(lists,t.status))
    : lists.find((l)=>l.name===t.status)||columnFor(lists,t.status);
  if(target && target.id!==card.list_id) {
    const pos=(await get<any>('SELECT MAX(pos) n FROM board_cards WHERE list_id=?',target.id))?.n || 0;
    await run('UPDATE board_cards SET list_id=?,pos=? WHERE id=?',target.id,pos+1,t.card_id);
  }
  await run('UPDATE boards SET updated_at=? WHERE id=(SELECT board_id FROM board_cards WHERE id=?)', now(), t.card_id);
}

export async function syncCardToTask(cardId: string, moved = false, actorId?: string) {
  const c = await get<any>('SELECT c.*, l.task_id, t.status task_status, t.done_at task_done, t.stage task_stage FROM board_cards c JOIN task_board_links l ON l.card_id=c.id JOIN tasks t ON t.id=l.task_id WHERE c.id=?', cardId);
  if (!c) return;
  const beforeNotification=await notificationSnapshot(c.task_id);
  const wasDone = ['done', 'done_late'].includes(statusKey(c.task_status));
  const into=moved ? await get<any>('SELECT name FROM board_lists WHERE id=?',c.list_id) : null;
  // Quá hạn is the due date's, not a status: a card dropped in such a column keeps its task's status and goes back.
  const column=into && !isOverdueColumn(into.name) ? into : null;
  if (into && !column) moved = false;
  // A column of a step gives a task in the workflow no status of its own: the move (assertCardFlow) set it already.
  const stepped = !!column && isFlowStage(c.task_stage) && !!columnStage(column.name);
  const completed = stepped ? c.task_stage === 'completed' : c.done ? true : (column ? ['done', 'done_late'].includes(statusKey(column.name)) : false);
  const doneAt = completed ? c.task_done || now() : null;
  let status = stepped ? c.task_status : column ? await columnStatus(column.name, doneAt, c.due_at) : c.done ? (c.due_at && doneAt > c.due_at ? 'Hoàn thành muộn' : 'Hoàn thành') : wasDone ? 'Chưa thực hiện' : c.task_status;
  // A change the review workflow does not allow (a column renamed, say; one of another step than the task's) leaves the
  // task's status as it was; its card goes back.
  const kept = stepped ? columnStage(column!.name) !== c.task_stage : !!statusBlocked({ stage: c.task_stage, status: c.task_status }, status, await flowSettings());
  if (kept) status = c.task_status;
  if(moved && !kept) await run('UPDATE board_cards SET done=? WHERE id=?',completed?1:0,cardId);
  await run('UPDATE tasks SET title=?, description=?, description_by=?, start_at=?, due_at=?, status=?, done_at=?, updated_at=? WHERE id=?',
    c.title, c.description || '', c.description_by ?? null, c.start_at, c.due_at, status, kept ? c.task_done : doneAt, now(), c.task_id);
  if(!moved || kept) await syncTaskToCard(c.task_id);
  await queueTaskNotifications(c.task_id,beforeNotification,actorId).catch(()=>console.error('Không xếp được thông báo công việc'));
}
