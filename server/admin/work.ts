// Công việc in Quản trị: every task the account's tasks.view scope reaches (a task is reached through the people on it:
// assignees, its creator, followers, its card's members), with its name, status, dates, project and people but never
// its description or result; its priority and change history. And the lists the Tasks page goes by: statuses (order,
// colour, on or off), categories (the tasks' labels), priorities and templates. Looking changes nothing.
import { all, get, run, uid, now, setSetting } from '../db';
import { HttpError, json, readJson, type Router } from '../http';
import { historyOf } from '../audit';
import { scopeUsers } from '../rbac';
import { stateOf } from '../tasks';
import { statusKey } from '../taskimport';
import { syncTaskToCard } from '../tasklinks';
import { flowSettings, restatus, settleStages, stageOf } from '../task-flow';
import { normalizeAllBoards } from '../board-flow';
import { FLOW_STAGES, flowConfig } from '../../shared/task-flow';
import { need, reach, text, color, exists, page, sendCsv, csvDate, changed, logAction, registerDict, dictName, matcher, type Ctx } from './common';

/** New tasks start in this status (server/tasks.ts), so it can be neither renamed nor turned off. */
const DEFAULT_STATUS = 'Chưa thực hiện';
export const STATE_LABEL: Record<string, string> = { todo: 'Chưa làm', doing: 'Đang làm', review: 'Đang đánh giá', paused: 'Tạm dừng', overdue: 'Quá hạn', done: 'Hoàn thành', done_late: 'Hoàn thành muộn', cancelled: 'Đã huỷ', other: 'Khác' };

/** Every task (but the placeholders made for missing parents) with the people on it. */
export async function taskRows() {
  const tasks = await all<any>(`SELECT t.id, t.title, t.status, t.stage, t.revision, t.submitted_at, t.start_at, t.due_at, t.done_at, t.created_at, t.updated_at, t.parent_id, t.project_id, t.priority_id, t.campaign_id, t.external_id,
    j.name project_name, j.customer_id, j.team_id project_dept, cu.name customer_name, ca.name campaign_name, pr.name priority_name, pr.color priority_color, pr.pos priority_pos, cp.user_id creator_user, cp.name creator_name, pa.title parent_title,
    (SELECT COUNT(*) FROM tasks x WHERE x.parent_id = t.id) children
    FROM tasks t LEFT JOIN task_projects j ON j.id = t.project_id LEFT JOIN customers cu ON cu.id = j.customer_id LEFT JOIN task_campaigns ca ON ca.id = t.campaign_id
    LEFT JOIN task_priorities pr ON pr.id = t.priority_id LEFT JOIN task_people cp ON cp.id = t.created_by LEFT JOIN tasks pa ON pa.id = t.parent_id WHERE t.stub = 0`);
  const many = <T,>(rows: any[], key: string, val: (r: any) => T) => { const m = new Map<string, T[]>(); for (const r of rows) m.set(r[key], [...(m.get(r[key]) || []), val(r)]); return m; };
  const assignees = many(await all<any>('SELECT a.task_id, p.id, p.name, p.user_id, u.name user_name, u.team_role FROM task_assignees a JOIN task_people p ON p.id = a.person_id LEFT JOIN users u ON u.id = p.user_id'), 'task_id',
    (r) => ({ id: r.id as string, name: (r.user_name || r.name) as string, userId: (r.user_id || null) as string | null, departmentId: (r.team_role || null) as string | null }));
  const followers = many(await all<any>('SELECT task_id, user_id FROM task_followers'), 'task_id', (r) => r.user_id as string);
  const onCard = many(await all<any>('SELECT l.task_id, m.user_id FROM task_board_links l JOIN card_members m ON m.card_id = l.card_id'), 'task_id', (r) => r.user_id as string);
  const labels = many(await all<any>('SELECT ll.task_id, l.name FROM task_label_links ll JOIN task_labels l ON l.id = ll.label_id'), 'task_id', (r) => r.name as string);
  return tasks.map((t) => {
    const who = assignees.get(t.id) || [];
    const people = new Set([...who.map((a) => a.userId), t.creator_user, ...(followers.get(t.id) || []), ...(onCard.get(t.id) || [])].filter(Boolean) as string[]);
    return {
      id: t.id, title: t.title, status: t.status, state: stateOf(t), stage: stageOf(t, who.length > 0), revision: Number(t.revision) || 0, submittedAt: (t.submitted_at ?? null) as number | null, category: statusKey(t.status), startAt: t.start_at ?? null, dueAt: t.due_at ?? null, doneAt: t.done_at ?? null, createdAt: t.created_at, updatedAt: t.updated_at,
      externalId: t.external_id || null, project: t.project_id ? { id: t.project_id, name: t.project_name || '', departmentId: (t.project_dept || null) as string | null } : null, customer: t.customer_id ? { id: t.customer_id, name: t.customer_name || '' } : null,
      campaign: t.campaign_id ? { id: t.campaign_id, name: t.campaign_name || '' } : null, parent: t.parent_id ? { id: t.parent_id, title: t.parent_title || '' } : null, children: Number(t.children) || 0,
      priority: t.priority_id ? { id: t.priority_id, name: t.priority_name || '', color: t.priority_color || '#94a3b8', pos: Number(t.priority_pos) || 0 } : null,
      creator: t.creator_name ? { name: t.creator_name as string, userId: (t.creator_user || null) as string | null } : null,
      assignees: who, labels: labels.get(t.id) || [], people: [...people], cardMembers: onCard.get(t.id) || [],
    };
  });
}
export type TaskRow = Awaited<ReturnType<typeof taskRows>>[number];
/** The tasks this scope reaches: those with someone it reaches on them. */
export const inReach = (rows: TaskRow[], ids: Set<string> | null) => (ids ? rows.filter((t) => t.people.some((p) => ids.has(p))) : rows);
const late = (t: TaskRow) => t.state === 'overdue';

async function tasksFor(c: Ctx, q: URLSearchParams) {
  const hit = matcher(q.get('q'));
  let team: Set<string> | null = null;
  if (q.get('team')) team = new Set((await all<any>('SELECT user_id FROM team_members WHERE team_id = ?', String(q.get('team')))).map((r) => r.user_id));
  const from = Number(q.get('from')) || 0, to = Number(q.get('to')) || 0;
  return inReach(await taskRows(), await reach(c))
    .filter((t) => hit(t.id, t.title, t.project?.name, t.customer?.name, t.campaign?.name, t.labels.join(' '), t.externalId, t.status, STATE_LABEL[t.state], t.state, t.priority?.name, t.creator?.name, t.parent?.title, t.assignees.map((a) => a.name).join(' ')))
    .filter((t) => !q.get('state') || (q.get('state') === 'open' ? !['done', 'done_late', 'cancelled'].includes(t.state) : q.get('state') === 'done' ? ['done', 'done_late'].includes(t.state) : t.state === q.get('state')))
    .filter((t) => !q.get('status') || t.status === q.get('status'))
    .filter((t) => !q.get('priority') || (q.get('priority') === 'none' ? !t.priority : t.priority?.id === q.get('priority')))
    .filter((t) => !q.get('project') || t.project?.id === q.get('project'))
    .filter((t) => !q.get('dept') || t.project?.departmentId === q.get('dept') || t.assignees.some((a) => a.departmentId === q.get('dept')))
    .filter((t) => !team || t.assignees.some((a) => a.userId && team!.has(a.userId)) || t.cardMembers.some((m) => team!.has(m)))
    .filter((t) => !q.get('user') || t.assignees.some((a) => a.userId === q.get('user')) || t.cardMembers.includes(String(q.get('user'))))
    .filter((t) => !q.get('label') || t.labels.includes(String(q.get('label'))))
    .filter((t) => q.get('overdue') !== '1' || late(t))
    // The span of days on its due date, or (`dateField`) when it was made or last changed.
    .filter((t) => { const d = q.get('dateField') === 'created' ? t.createdAt : q.get('dateField') === 'updated' ? t.updatedAt : t.dueAt; return (!from || (d ?? 0) >= from) && (!to || (d ?? Infinity) < to); });
}
const strip = ({ people, cardMembers, ...t }: TaskRow) => t;

export function registerWork(api: Router) {
  api.get('/api/admin/tasks', async (req, res) => {
    const c = await need(req, 'tasks.view'), rows = await tasksFor(c, req.query);
    const out = page(req, rows, { dueAt: (t) => t.dueAt, title: (t) => t.title, status: (t) => t.status, priority: (t) => (t.priority ? -t.priority.pos : null), updatedAt: (t) => t.updatedAt, createdAt: (t) => t.createdAt });
    json(res, 200, { ...out, items: out.items.map(strip), counts: { total: rows.length, open: rows.filter((t) => !['done', 'done_late', 'cancelled'].includes(t.state)).length, overdue: rows.filter(late).length, done: rows.filter((t) => ['done', 'done_late'].includes(t.state)).length } });
  });
  api.get('/api/admin/tasks/export', async (req, res) => {
    const c = await need(req, 'tasks.export'), rows = (await tasksFor(await need(req, 'tasks.view'), req.query)).sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
    await logAction(c, 'Xuất danh sách công việc (CSV)', `${rows.length} công việc`, 'task');
    sendCsv(res, 'cong-viec.csv', [['Mã', 'Tên công việc', 'Trạng thái', 'Tình trạng', 'Ưu tiên', 'Dịch vụ', 'Khách hàng', 'Chiến dịch', 'Người làm', 'Nhãn', 'Bắt đầu', 'Thời hạn', 'Hoàn thành', 'Cập nhật'],
      ...rows.map((t) => [t.externalId || t.id, t.title, t.status, STATE_LABEL[t.state] || t.state, t.priority?.name, t.project?.name, t.customer?.name, t.campaign?.name, t.assignees.map((a) => a.name).join('; '), t.labels.join('; '), csvDate(t.startAt), csvDate(t.dueAt), csvDate(t.doneAt), csvDate(t.updatedAt)])]);
  });
  api.get('/api/admin/tasks/:id', async (req, res) => {
    const c = await need(req, 'tasks.view'), all_ = inReach(await taskRows(), await reach(c)), t = all_.find((x) => x.id === req.params.id);
    if (!t) throw new HttpError(404, 'Không tìm thấy công việc trong phạm vi của bạn');
    json(res, 200, {
      ...strip(t), canSetPriority: c.access.perms.has('tasks.update') && inReach([t], await scopeUsers(c.user.id, c.access.perms.get('tasks.update')!)).length > 0,
      subtasks: all_.filter((x) => x.parent?.id === t.id).map((x) => ({ id: x.id, title: x.title, status: x.status, state: x.state, category: x.category, dueAt: x.dueAt })),
      history: (await historyOf('task', t.id)).map((h) => ({ action: h.action, by: h.user_name, before: h.old_data ? JSON.parse(h.old_data) : null, after: h.new_data ? JSON.parse(h.new_data) : null, at: h.created_at })),
    });
  });
  api.put('/api/admin/tasks/:id/priority', async (req, res) => {
    const c = await need(req, 'tasks.update'), t = inReach(await taskRows(), await reach(c)).find((x) => x.id === req.params.id);
    if (!t) throw new HttpError(404, 'Không tìm thấy công việc trong phạm vi của bạn');
    const id = await exists('task_priorities', (await readJson(req)).priorityId, 'mức ưu tiên');
    await run('UPDATE tasks SET priority_id = ?, updated_at = ? WHERE id = ?', id, now(), t.id);
    await changed(c, { action: 'Đặt mức ưu tiên công việc', type: 'task', id: t.id, label: t.title, before: { priority: t.priority?.name || null }, after: { priority: await dictName('task_priorities', id) } });
    json(res, 200, { ok: true });
  });

  // ---------------------------------------------------------------- statuses: what tasks.status holds, by name
  const statusOut = (r: any, used: Map<string, number>) => ({ id: r.id, name: r.name, color: r.color, pos: r.pos, active: !!r.active, used: used.get(r.name) || 0, category: statusKey(r.name), locked: r.name === DEFAULT_STATUS });
  const usedStatuses = async () => new Map((await all<any>('SELECT status, COUNT(*) n FROM tasks WHERE stub = 0 GROUP BY status')).map((r) => [r.status as string, Number(r.n)]));
  const mustStatus = async (id: string) => { const r = await get<any>('SELECT * FROM task_statuses WHERE id = ?', id); if (!r) throw new HttpError(404, 'Không tìm thấy trạng thái'); return r; };
  const uniqueStatus = async (name: string, id = '') => { if (await get('SELECT 1 FROM task_statuses WHERE name = ? COLLATE NOCASE AND id <> ?', name, id)) throw new HttpError(409, `Đã có trạng thái “${name}”`); };
  api.get('/api/admin/task-statuses', async (req, res) => {
    await need(req, 'tasks.view');
    const used = await usedStatuses(), rows = await all<any>('SELECT * FROM task_statuses ORDER BY pos');
    const listed = new Set(rows.map((r) => r.name));
    // Statuses imported tasks carry that the list does not have yet.
    const unlisted = [...used].filter(([name]) => name && !listed.has(name)).map(([name, n]) => ({ name, used: n, category: statusKey(name) }));
    json(res, 200, { statuses: rows.map((r) => statusOut(r, used)), unlisted });
  });
  api.post('/api/admin/task-statuses', async (req, res) => {
    const c = await need(req, 'tasks.manage'), b = await readJson(req), name = text(b.name, 60, 'tên trạng thái');
    await uniqueStatus(name);
    const id = uid('ts_'), pos = Number((await get<any>('SELECT MAX(pos) m FROM task_statuses'))?.m || 0) + 1;
    await run('INSERT INTO task_statuses(id, name, color, pos, active, created_at, updated_at) VALUES(?,?,?,?,1,?,?)', id, name, color(b.color), pos, now(), now());
    await changed(c, { action: 'Thêm trạng thái công việc', type: 'task_status', id, label: name, after: { name, color: color(b.color) } });
    json(res, 201, statusOut(await mustStatus(id), await usedStatuses()));
  });
  // A new name follows into every task (and template) that has the old one.
  api.put('/api/admin/task-statuses/:id', async (req, res) => {
    const c = await need(req, 'tasks.manage'), r = await mustStatus(req.params.id), b = await readJson(req);
    const name = b.name !== undefined ? text(b.name, 60, 'tên trạng thái') : r.name, active = b.active !== undefined ? (b.active ? 1 : 0) : r.active;
    if (r.name === DEFAULT_STATUS && (name !== r.name || !active)) throw new HttpError(400, `“${DEFAULT_STATUS}” là trạng thái của công việc mới, không đổi tên hay tắt được`);
    if (name !== r.name) await uniqueStatus(name, r.id);
    const next = { name, color: b.color !== undefined ? color(b.color, r.color) : r.color, active };
    await run('UPDATE task_statuses SET name = ?, color = ?, active = ?, updated_at = ? WHERE id = ?', next.name, next.color, next.active, now(), r.id);
    let moved = 0;
    if (name !== r.name) {
      moved = (await run('UPDATE tasks SET status = ? WHERE status = ?', name, r.name)).changes;
      await run('UPDATE task_templates SET status = ? WHERE status = ?', name, r.name);
      // A stage of the review workflow that gave the old name gives the new one.
      const flow = await flowSettings();
      if (FLOW_STAGES.some((x) => flow.stages[x.key].status === r.name)) { for (const x of FLOW_STAGES) if (flow.stages[x.key].status === r.name) flow.stages[x.key].status = name; await setSetting('task_flow', flow); }
    }
    await changed(c, { action: 'Sửa trạng thái công việc', type: 'task_status', id: r.id, label: name, before: { name: r.name, color: r.color, active: r.active }, after: { ...next, ...(moved ? { tasksRenamed: moved } : {}) } });
    json(res, 200, statusOut(await mustStatus(r.id), await usedStatuses()));
  });
  api.delete('/api/admin/task-statuses/:id', async (req, res) => {
    const c = await need(req, 'tasks.manage'), r = await mustStatus(req.params.id), n = (await usedStatuses()).get(r.name) || 0;
    if (r.name === DEFAULT_STATUS) throw new HttpError(400, `“${DEFAULT_STATUS}” là trạng thái của công việc mới, không xoá được`);
    const flow = await flowSettings(), stage = FLOW_STAGES.find((x) => flow.stages[x.key].status === r.name);
    if (stage) throw new HttpError(409, `“${r.name}” là trạng thái của bước ${stage.code} trong quy trình; chọn trạng thái khác cho bước đó trước`);
    await run('UPDATE task_templates SET status = NULL WHERE status = ?', r.name);
    await run('DELETE FROM task_statuses WHERE id = ?', r.id);
    // Its tasks take the status of their stage in the review workflow.
    if (n) {
      const affected = await all<any>('SELECT id FROM tasks WHERE status = ?', r.name);
      await restatus(affected.map((t) => t.id), DEFAULT_STATUS);
      for (const t of affected) await syncTaskToCard(t.id);
    }
    await changed(c, { action: 'Xoá trạng thái công việc', type: 'task_status', id: r.id, label: r.name, before: { name: r.name, ...(n ? { tasksReset: n } : {}) } });
    json(res, 200, { ok: true, tasksReset: n });
  });
  api.post('/api/admin/task-statuses/clear-unlisted', async (req, res) => {
    const c = await need(req, 'tasks.manage'), b = await readJson(req), name = text(b.name, 60, 'tên trạng thái');
    if (name === DEFAULT_STATUS) throw new HttpError(400, `“${DEFAULT_STATUS}” là trạng thái của công việc mới, không xoá được`);
    const affected = await all<any>('SELECT id FROM tasks WHERE status = ?', name);
    await restatus(affected.map((t) => t.id), DEFAULT_STATUS);
    for (const t of affected) await syncTaskToCard(t.id);
    await run('UPDATE task_templates SET status = NULL WHERE status = ?', name);
    await changed(c, { action: 'Xoá trạng thái công việc chưa liệt kê', type: 'task_status', id: '', label: name, before: { name, tasksReset: affected.length } });
    json(res, 200, { ok: true, tasksReset: affected.length });
  });
  api.post('/api/admin/task-statuses/order', async (req, res) => {
    const c = await need(req, 'tasks.manage'), b = await readJson(req);
    if (!Array.isArray(b.ids) || b.ids.length > 200 || b.ids.some((x: unknown) => typeof x !== 'string')) throw new HttpError(400, 'Thứ tự không hợp lệ');
    const before = (await all<any>('SELECT name FROM task_statuses ORDER BY pos')).map((r) => r.name).join(' → ');
    for (const [i, id] of (b.ids as string[]).entries()) await run('UPDATE task_statuses SET pos = ?, updated_at = ? WHERE id = ?', i + 1, now(), id);
    const after = (await all<any>('SELECT name FROM task_statuses ORDER BY pos')).map((r) => r.name).join(' → ');
    await changed(c, { action: 'Sắp xếp quy trình công việc', type: 'task_status', id: '', label: 'Quy trình', before: { order: before }, after: { order: after } });
    json(res, 200, { ok: true });
  });

  // ---------------------------------------------------------------- the review workflow (shared/task-flow.ts)
  const flowOut = async () => ({
    config: await flowSettings(),
    stages: Object.fromEntries((await all<any>('SELECT stage, COUNT(*) n FROM tasks WHERE stub = 0 AND stage IS NOT NULL GROUP BY stage')).map((r) => [r.stage, Number(r.n)])),
    pending: Number((await get<any>('SELECT COUNT(*) n FROM tasks WHERE stub = 0 AND stage IS NULL'))?.n || 0),
  });
  api.get('/api/admin/task-flow', async (req, res) => { await need(req, 'tasks.view'); json(res, 200, await flowOut()); });
  // Each stage's name and status, and the reminders. Tasks in a stage whose status changes take the new one.
  api.put('/api/admin/task-flow', async (req, res) => {
    const c = await need(req, 'tasks.manage'), before = await flowSettings(), next = flowConfig(await readJson(req));
    const active = new Set((await all<any>('SELECT name FROM task_statuses WHERE active = 1')).map((r) => r.name as string));
    for (const x of FLOW_STAGES) if (!active.has(next.stages[x.key].status)) throw new HttpError(400, `Trạng thái “${next.stages[x.key].status}” của bước ${x.code} không có trong danh sách đang dùng`);
    if (new Set(FLOW_STAGES.map((x) => next.stages[x.key].status)).size < FLOW_STAGES.length) throw new HttpError(400, 'Mỗi bước cần một trạng thái riêng');
    await setSetting('task_flow', next);
    let moved = 0;
    for (const x of FLOW_STAGES) {
      const from = before.stages[x.key].status, to = next.stages[x.key].status;
      if (from === to) continue;
      const ids = (await all<any>('SELECT id FROM tasks WHERE stage = ? AND status = ?', x.key, from)).map((r) => r.id as string);
      moved += (await run('UPDATE tasks SET status = ?, updated_at = ? WHERE stage = ? AND status = ?', to, now(), x.key, from)).changes;
      for (const id of ids) await syncTaskToCard(id);
    }
    await changed(c, { action: 'Sửa quy trình duyệt công việc', type: 'task_flow', id: '', label: 'Quy trình duyệt', before, after: { ...next, ...(moved ? { tasksMoved: moved } : {}) } });
    json(res, 200, await flowOut());
  });
  // Every task not yet in the workflow joins it now (the cron also does it every ten minutes).
  api.post('/api/admin/task-flow/apply', async (req, res) => {
    const c = await need(req, 'tasks.manage');
    let applied = 0;
    for (let n = await settleStages(), i = 0; n && i < 20; n = await settleStages(), i++) applied += n;
    await changed(c, { action: 'Áp dụng quy trình duyệt cho công việc hiện có', type: 'task_flow', id: '', label: 'Quy trình duyệt', after: { applied } });
    json(res, 200, { ...await flowOut(), applied });
  });
  // Every board's columns made to follow the workflow now (the cron did it once already; this does it again).
  api.post('/api/admin/task-flow/boards', async (req, res) => {
    const c = await need(req, 'tasks.manage');
    const r = await normalizeAllBoards(true);
    await changed(c, { action: 'Chuẩn hoá cột board theo quy trình', type: 'task_flow', id: '', label: 'Quy trình duyệt', after: r });
    json(res, 200, r);
  });

  // ---------------------------------------------------------------- categories: the tasks' labels
  const labelOut = (r: any, used: Map<string, number>) => ({ id: r.id, name: r.name, color: r.color || '#64748b', used: used.get(r.id) || 0 });
  const usedLabels = async () => new Map((await all<any>('SELECT label_id, COUNT(*) n FROM task_label_links GROUP BY label_id')).map((r) => [r.label_id as string, Number(r.n)]));
  const mustLabel = async (id: string) => { const r = await get<any>('SELECT * FROM task_labels WHERE id = ?', id); if (!r) throw new HttpError(404, 'Không tìm thấy danh mục'); return r; };
  api.get('/api/admin/task-labels', async (req, res) => {
    await need(req, 'tasks.view');
    const used = await usedLabels();
    json(res, 200, (await all<any>('SELECT * FROM task_labels ORDER BY name COLLATE NOCASE')).map((r) => labelOut(r, used)));
  });
  api.post('/api/admin/task-labels', async (req, res) => {
    const c = await need(req, 'tasks.manage'), b = await readJson(req), name = text(b.name, 100, 'tên danh mục');
    if (await get('SELECT 1 FROM task_labels WHERE name = ? COLLATE NOCASE', name)) throw new HttpError(409, `Đã có danh mục “${name}”`);
    const id = uid('tl_');
    await run('INSERT INTO task_labels(id, name, color) VALUES(?,?,?)', id, name, color(b.color));
    await changed(c, { action: 'Thêm danh mục công việc', type: 'task_label', id, label: name, after: { name } });
    json(res, 201, labelOut(await mustLabel(id), new Map()));
  });
  api.put('/api/admin/task-labels/:id', async (req, res) => {
    const c = await need(req, 'tasks.manage'), r = await mustLabel(req.params.id), b = await readJson(req);
    const name = b.name !== undefined ? text(b.name, 100, 'tên danh mục') : r.name;
    if (name !== r.name && await get('SELECT 1 FROM task_labels WHERE name = ? COLLATE NOCASE AND id <> ?', name, r.id)) throw new HttpError(409, `Đã có danh mục “${name}”`);
    const col = b.color !== undefined ? color(b.color) : r.color;
    await run('UPDATE task_labels SET name = ?, color = ? WHERE id = ?', name, col, r.id);
    await changed(c, { action: 'Sửa danh mục công việc', type: 'task_label', id: r.id, label: name, before: { name: r.name, color: r.color }, after: { name, color: col } });
    json(res, 200, labelOut(await mustLabel(r.id), await usedLabels()));
  });
  // Taken off every task that has it (the page says how many first).
  api.delete('/api/admin/task-labels/:id', async (req, res) => {
    const c = await need(req, 'tasks.manage'), r = await mustLabel(req.params.id), n = (await usedLabels()).get(r.id) || 0;
    await run('DELETE FROM task_label_links WHERE label_id = ?', r.id);
    await run('DELETE FROM task_labels WHERE id = ?', r.id);
    await changed(c, { action: 'Xoá danh mục công việc', type: 'task_label', id: r.id, label: r.name, before: { name: r.name, tasks: n } });
    json(res, 200, { ok: true });
  });

  registerDict(api, { path: 'task-priorities', table: 'task_priorities', type: 'task_priority', label: 'mức ưu tiên', view: 'tasks.view', manage: 'tasks.manage',
    usedIn: [{ table: 'tasks', column: 'priority_id' }, { table: 'task_templates', column: 'priority_id', where: 'deleted_at IS NULL' }] });

  // ---------------------------------------------------------------- templates (applied on the Tasks API, with the user's own rights)
  const tplOut = (r: any) => ({ id: r.id, name: r.name, about: r.about, title: r.title, checklist: JSON.parse(r.checklist || '[]'), status: r.status || null, priorityId: r.priority_id || null,
    labels: JSON.parse(r.labels || '[]'), dueDays: r.due_days ?? null, createdBy: r.created_name || null, updatedBy: r.updated_name || null, createdAt: r.created_at, updatedAt: r.updated_at });
  const TPL_SQL = 'SELECT t.*, a.name created_name, b.name updated_name FROM task_templates t LEFT JOIN users a ON a.id = t.created_by LEFT JOIN users b ON b.id = t.updated_by WHERE t.deleted_at IS NULL';
  const mustTpl = async (id: string) => { const r = await get<any>(`${TPL_SQL} AND t.id = ?`, id); if (!r) throw new HttpError(404, 'Không tìm thấy mẫu'); return r; };
  async function tplFields(b: any) {
    if (!Array.isArray(b.checklist) || b.checklist.length > 50 || b.checklist.some((x: unknown) => typeof x !== 'string' || x.length > 300)) throw new HttpError(400, 'Checklist tối đa 50 mục, mỗi mục 300 ký tự');
    if (!Array.isArray(b.labels) || b.labels.length > 20 || b.labels.some((x: unknown) => typeof x !== 'string' || x.length > 100)) throw new HttpError(400, 'Nhãn không hợp lệ');
    const status = b.status ? String(b.status) : null;
    if (status && !(await get('SELECT 1 FROM task_statuses WHERE name = ? AND active = 1', status))) throw new HttpError(400, 'Trạng thái không có trong danh sách');
    const due = b.dueDays === null || b.dueDays === undefined || b.dueDays === '' ? null : Math.round(Number(b.dueDays));
    if (due !== null && (!Number.isFinite(due) || due < 0 || due > 365)) throw new HttpError(400, 'Số ngày đến hạn từ 0 đến 365');
    return { name: text(b.name, 80, 'tên mẫu'), about: text(b.about, 1000, 'mô tả', false), title: text(b.title, 500, 'tên công việc'), checklist: (b.checklist as string[]).map((x) => x.trim()).filter(Boolean),
      status, priority: await exists('task_priorities', b.priorityId, 'mức ưu tiên'), labels: [...new Set((b.labels as string[]).map((x) => x.trim()).filter(Boolean))], due };
  }
  const tplSnap = (f: Awaited<ReturnType<typeof tplFields>>) => ({ name: f.name, title: f.title, checklist: f.checklist.length, status: f.status, labels: f.labels.join(', '), dueDays: f.due });
  api.get('/api/admin/task-templates', async (req, res) => { await need(req, 'tasks.view'); json(res, 200, (await all<any>(`${TPL_SQL} ORDER BY t.name`)).map(tplOut)); });
  api.post('/api/admin/task-templates', async (req, res) => {
    const c = await need(req, 'tasks.manage'), f = await tplFields(await readJson(req)), id = uid('tt_');
    await run('INSERT INTO task_templates(id, name, about, title, checklist, status, priority_id, labels, due_days, created_by, updated_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, f.name, f.about, f.title, JSON.stringify(f.checklist), f.status, f.priority, JSON.stringify(f.labels), f.due, c.user.id, c.user.id, now(), now());
    await changed(c, { action: 'Tạo mẫu công việc', type: 'task_template', id, label: f.name, after: tplSnap(f) });
    json(res, 201, tplOut(await mustTpl(id)));
  });
  api.put('/api/admin/task-templates/:id', async (req, res) => {
    const c = await need(req, 'tasks.manage'), r = await mustTpl(req.params.id), old = tplOut(r), f = await tplFields({ ...old, ...(await readJson(req)) });
    await run('UPDATE task_templates SET name = ?, about = ?, title = ?, checklist = ?, status = ?, priority_id = ?, labels = ?, due_days = ?, updated_by = ?, updated_at = ? WHERE id = ?',
      f.name, f.about, f.title, JSON.stringify(f.checklist), f.status, f.priority, JSON.stringify(f.labels), f.due, c.user.id, now(), r.id);
    await changed(c, { action: 'Sửa mẫu công việc', type: 'task_template', id: r.id, label: f.name, before: { name: old.name, title: old.title, checklist: old.checklist.length, status: old.status, labels: old.labels.join(', '), dueDays: old.dueDays }, after: tplSnap(f) });
    json(res, 200, tplOut(await mustTpl(r.id)));
  });
  api.delete('/api/admin/task-templates/:id', async (req, res) => {
    const c = await need(req, 'tasks.manage'), r = await mustTpl(req.params.id);
    await run('UPDATE task_templates SET deleted_at = ?, updated_by = ? WHERE id = ?', now(), c.user.id, r.id);
    await changed(c, { action: 'Xoá mẫu công việc', type: 'task_template', id: r.id, label: r.name, before: { name: r.name } });
    json(res, 200, { ok: true });
  });
}
