// Shared lifecycle of a Workspace card and its linked work records.
import { all, get, run, now } from './db';
import { HttpError } from './http';
import { requireProject } from './project-access';

export async function assertTaskDelete(taskId: string, user: {id:string;role:string}) {
  const task = await get<any>('SELECT * FROM tasks WHERE id=?',taskId);
  if (!task) return;
  if (task.project_id) await requireProject(user.id,task.project_id,'normal');
  if (user.role !== 'admin' && !await get('SELECT 1 FROM task_people WHERE id=? AND user_id=?',task.created_by,user.id)) throw new HttpError(403,'Chỉ người tạo hoặc quản trị viên được xoá công việc liên kết');
}
export async function removeCardRecord(id: string) {
  await run('UPDATE board_cards SET project_card_id=NULL WHERE project_card_id=?',id);
  for (const table of ['card_labels','card_members','card_checklists','checklist_items','card_comments','card_attachments','task_board_links']) await run(`DELETE FROM ${table} WHERE card_id=?`,id);
  await run('DELETE FROM board_cards WHERE id=?',id);
}
export async function removeTaskRecord(id: string) {
  const cards = await all<any>('SELECT c.id,c.board_id FROM task_board_links l JOIN board_cards c ON c.id=l.card_id WHERE l.task_id=?',id);
  for (const card of cards) {
    await removeCardRecord(card.id);
    await run('UPDATE boards SET updated_at=? WHERE id=?',now(),card.board_id);
  }
  await run('UPDATE tasks SET parent_id=NULL WHERE parent_id=?',id);
  for (const table of ['task_assignees','task_followers','task_label_links','task_board_links']) await run(`DELETE FROM ${table} WHERE task_id=?`,id);
  await run('DELETE FROM tasks WHERE id=?',id);
}
export async function removeProjectRecord(id: string) {
  for (const card of await all<any>('SELECT id, board_id FROM board_cards WHERE work_project_id=?',id)) {
    await removeCardRecord(card.id);
    await run('UPDATE boards SET updated_at=? WHERE id=?',now(),card.board_id);
  }
  await run('UPDATE tasks SET project_id=NULL,campaign_id=NULL WHERE project_id=?',id);
  await run('UPDATE reports SET project_id=NULL WHERE project_id=?',id);
  await run('DELETE FROM task_campaigns WHERE project_id=?',id);
  await run('DELETE FROM task_project_members WHERE project_id=?',id);
  await run('DELETE FROM task_projects WHERE id=?',id);
}
export async function syncProjectCards(id: string) {
  await run('UPDATE board_cards SET title=(SELECT name FROM task_projects WHERE id=?),customer_id=(SELECT customer_id FROM task_projects WHERE id=?),updated_at=? WHERE work_project_id=?',id,id,now(),id);
  for (const card of await all<any>('SELECT DISTINCT board_id FROM board_cards WHERE work_project_id=?', id)) {
    await run('UPDATE boards SET updated_at=? WHERE id=?', now(), card.board_id);
  }
}
