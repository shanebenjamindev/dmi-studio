import {requireProject} from './project-access';
import {notificationSnapshot,queueTaskNotifications} from './notifications';
// A linked task and card share their public working fields. Results stay on the task.
import { all, get, run, now } from './db';
import { HttpError } from './http';
import { statusKey } from './taskimport';

export async function assertLinkedTaskEditable(cardId: string, userId: string) {
  const link = await get<any>('SELECT t.* FROM task_board_links l JOIN tasks t ON t.id=l.task_id WHERE l.card_id=?', cardId);
  if (!link) return;
  // As on the task's own page: its project's managers and members change it (followers and viewers only look); outside
  // projects, whoever edits the card on its board (the caller checked that) does.
  if(link.project_id)await requireProject(userId,link.project_id,'normal');
}

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

export async function syncTaskToCard(taskId: string) {
  const t = await get<any>('SELECT t.*, l.card_id FROM tasks t JOIN task_board_links l ON l.task_id=t.id WHERE t.id=?', taskId);
  if (!t) return;
  await run('UPDATE board_cards SET title=?, description=?, description_by=?, start_at=?, due_at=?, done=?, updated_at=? WHERE id=?',
    t.title, t.description || '', t.description_by ?? null, t.start_at, t.due_at, ['done', 'done_late'].includes(statusKey(t.status)) ? 1 : 0, now(), t.card_id);
  const card=await get<any>('SELECT board_id,list_id FROM board_cards WHERE id=?',t.card_id);
  const lists=await all<any>('SELECT id,name FROM board_lists WHERE board_id=? AND archived=0 ORDER BY pos',card.board_id);
  const target=lists.find(l=>l.name===t.status) || lists.find(l=>statusKey(l.name)!=='other' && statusKey(l.name)===statusKey(t.status));
  if(target && target.id!==card.list_id) {
    const pos=(await get<any>('SELECT MAX(pos) n FROM board_cards WHERE list_id=?',target.id))?.n || 0;
    await run('UPDATE board_cards SET list_id=?,pos=? WHERE id=?',target.id,pos+1,t.card_id);
  }
  await run('UPDATE boards SET updated_at=? WHERE id=(SELECT board_id FROM board_cards WHERE id=?)', now(), t.card_id);
}

export async function syncCardToTask(cardId: string, moved = false, actorId?: string) {
  const c = await get<any>('SELECT c.*, l.task_id, t.status task_status, t.done_at task_done FROM board_cards c JOIN task_board_links l ON l.card_id=c.id JOIN tasks t ON t.id=l.task_id WHERE c.id=?', cardId);
  if (!c) return;
  const beforeNotification=await notificationSnapshot(c.task_id);
  const wasDone = ['done', 'done_late'].includes(statusKey(c.task_status));
  const column=moved ? await get<any>('SELECT name FROM board_lists WHERE id=?',c.list_id) : null;
  const completed=column ? ['done','done_late'].includes(statusKey(column.name)) : !!c.done;
  const doneAt = completed ? c.task_done || now() : null;
  const status = column ? column.name : c.done ? (c.due_at && doneAt > c.due_at ? 'Hoàn thành muộn' : 'Hoàn thành') : wasDone ? 'Chưa thực hiện' : c.task_status;
  if(moved) await run('UPDATE board_cards SET done=? WHERE id=?',completed?1:0,cardId);
  await run('UPDATE tasks SET title=?, description=?, description_by=?, start_at=?, due_at=?, status=?, done_at=?, updated_at=? WHERE id=?',
    c.title, c.description || '', c.description_by ?? null, c.start_at, c.due_at, status, doneAt, now(), c.task_id);
  if(!moved) await syncTaskToCard(c.task_id);
  await queueTaskNotifications(c.task_id,beforeNotification,actorId).catch(()=>console.error('Không xếp được thông báo công việc'));
}
