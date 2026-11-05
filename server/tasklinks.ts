import {requireProject} from './project-access';
import {notificationSnapshot,queueTaskNotifications} from './notifications';
// A linked task and card share their public working fields. Results stay on the task.
import { all, get, run, now } from './db';
import { HttpError } from './http';
import { statusKey } from './taskimport';

export async function assertLinkedTaskEditable(cardId: string, userId: string) {
  const link = await get<any>('SELECT t.* FROM task_board_links l JOIN tasks t ON t.id=l.task_id WHERE l.card_id=?', cardId);
  if (!link) return;
  if(link.project_id)await requireProject(userId,link.project_id,'normal');
  const user = await get<any>('SELECT role FROM users WHERE id=?', userId);
  if (user?.role === 'admin') return;
  const own = await get(`SELECT 1 FROM task_people p WHERE p.user_id=? AND (p.id=? OR p.id IN (SELECT person_id FROM task_assignees WHERE task_id=?))`, userId, link.created_by, link.id);
  if (!own) throw new HttpError(403, 'Thẻ liên kết với công việc: chỉ người tạo, người được giao hoặc quản trị viên được sửa nội dung đồng bộ.');
}

export async function syncTaskToCard(taskId: string) {
  const t = await get<any>('SELECT t.*, l.card_id FROM tasks t JOIN task_board_links l ON l.task_id=t.id WHERE t.id=?', taskId);
  if (!t) return;
  await run('UPDATE board_cards SET title=?, description=?, start_at=?, due_at=?, done=?, updated_at=? WHERE id=?',
    t.title, t.description || '', t.start_at, t.due_at, ['done', 'done_late'].includes(statusKey(t.status)) ? 1 : 0, now(), t.card_id);
  const card=await get<any>('SELECT board_id,list_id FROM board_cards WHERE id=?',t.card_id);
  const lists=await all<any>('SELECT id,name FROM board_lists WHERE board_id=? AND archived=0 ORDER BY pos',card.board_id);
  const target=lists.find(l=>l.name===t.status) || lists.find(l=>statusKey(l.name)!=='other' && statusKey(l.name)===statusKey(t.status));
  if(target && target.id!==card.list_id) {
    const pos=(await get<any>('SELECT MAX(pos) n FROM board_cards WHERE list_id=?',target.id))?.n || 0;
    await run('UPDATE board_cards SET list_id=?,pos=? WHERE id=?',target.id,pos+1,t.card_id);
  }
  await run('UPDATE boards SET updated_at=? WHERE id=(SELECT board_id FROM board_cards WHERE id=?)', now(), t.card_id);
}

export async function syncCardToTask(cardId: string, moved = false) {
  const c = await get<any>('SELECT c.*, l.task_id, t.status task_status, t.done_at task_done FROM board_cards c JOIN task_board_links l ON l.card_id=c.id JOIN tasks t ON t.id=l.task_id WHERE c.id=?', cardId);
  if (!c) return;
  const beforeNotification=await notificationSnapshot(c.task_id);
  const wasDone = ['done', 'done_late'].includes(statusKey(c.task_status));
  const column=moved ? await get<any>('SELECT name FROM board_lists WHERE id=?',c.list_id) : null;
  const completed=column ? ['done','done_late'].includes(statusKey(column.name)) : !!c.done;
  const doneAt = completed ? c.task_done || now() : null;
  const status = column ? column.name : c.done ? (c.due_at && doneAt > c.due_at ? 'Hoàn thành muộn' : 'Hoàn thành') : wasDone ? 'Chưa thực hiện' : c.task_status;
  if(moved) await run('UPDATE board_cards SET done=? WHERE id=?',completed?1:0,cardId);
  await run('UPDATE tasks SET title=?, description=?, start_at=?, due_at=?, status=?, done_at=?, updated_at=? WHERE id=?',
    c.title, c.description || '', c.start_at, c.due_at, status, doneAt, now(), c.task_id);
  if(!moved) await syncTaskToCard(c.task_id);
  await queueTaskNotifications(c.task_id,beforeNotification).catch(()=>console.error('Không xếp được thông báo công việc'));
}
