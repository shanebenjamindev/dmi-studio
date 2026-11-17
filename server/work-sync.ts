// Shared lifecycle of a Workspace card and its linked work records.
import { all, get, run, now } from './db';
import { HttpError } from './http';
import { requireBrandService } from './project-access';

export async function assertTaskDelete(taskId: string, user: { id: string; role: string }) {
  const task = await get<any>('SELECT * FROM tasks WHERE id=?', taskId);
  if (!task) return;
  if (task.brand_service_id) await requireBrandService(user.id, task.brand_service_id, 'normal');
  if (user.role !== 'admin' && !(await get('SELECT 1 FROM task_people WHERE id=? AND user_id=?', task.created_by, user.id))) {
    throw new HttpError(403, 'Chỉ người tạo hoặc quản trị viên được xoá công việc liên kết');
  }
}

export async function removeCardRecord(id: string) {
  await run('UPDATE board_cards SET service_card_id=NULL WHERE service_card_id=?', id);
  for (const table of ['card_labels', 'card_members', 'card_checklists', 'checklist_items', 'card_comments', 'card_attachments', 'task_board_links']) {
    await run(`DELETE FROM ${table} WHERE card_id=?`, id);
  }
  await run('DELETE FROM board_cards WHERE id=?', id);
}

export async function removeTaskRecord(id: string) {
  const cards = await all<any>('SELECT c.id,c.board_id FROM task_board_links l JOIN board_cards c ON c.id=l.card_id WHERE l.task_id=?', id);
  for (const card of cards) {
    await removeCardRecord(card.id);
    await run('UPDATE boards SET updated_at=? WHERE id=?', now(), card.board_id);
  }
  await run('UPDATE tasks SET parent_id=NULL WHERE parent_id=?', id);
  for (const table of ['task_assignees', 'task_followers', 'task_label_links', 'task_board_links', 'task_services', 'task_reviews', 'task_reminders']) {
    await run(`DELETE FROM ${table} WHERE task_id=?`, id);
  }
  await run('DELETE FROM tasks WHERE id=?', id);
}

export async function removeBrandServiceRecord(id: string) {
  for (const card of await all<any>('SELECT id, board_id FROM board_cards WHERE brand_service_id=?', id)) {
    await removeCardRecord(card.id);
    await run('UPDATE boards SET updated_at=? WHERE id=?', now(), card.board_id);
  }
  await run('UPDATE tasks SET brand_service_id=NULL WHERE brand_service_id=?', id);
  await run('UPDATE reports SET brand_service_id=NULL WHERE brand_service_id=?', id);
  await run('UPDATE boards SET brand_service_id=NULL WHERE brand_service_id=?', id);
  await run('DELETE FROM brand_service_members WHERE brand_service_id=?', id);
  await run('DELETE FROM brand_services WHERE id=?', id);
}

/** @deprecated Dùng removeBrandServiceRecord. */
export const removeProjectRecord = removeBrandServiceRecord;

export async function syncBrandServiceCards(id: string) {
  await run(
    `UPDATE board_cards
     SET title=(SELECT name FROM brand_services WHERE id=?),
         customer_id=(SELECT br.customer_id FROM brand_services bs LEFT JOIN brands br ON br.id=bs.brand_id WHERE bs.id=?),
         updated_at=?
     WHERE brand_service_id=?`,
    id,
    id,
    now(),
    id
  );
  for (const card of await all<any>('SELECT DISTINCT board_id FROM board_cards WHERE brand_service_id=?', id)) {
    await run('UPDATE boards SET updated_at=? WHERE id=?', now(), card.board_id);
  }
}

/** @deprecated Dùng syncBrandServiceCards. */
export const syncProjectCards = syncBrandServiceCards;
