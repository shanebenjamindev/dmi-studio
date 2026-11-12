// A task's review workflow (shared/task-flow.ts): the moves between stages, who may make each, the rounds of review
// with what was handed in and the feedback, and the reminders for overdue work and reviews left waiting. The task's
// status follows its stage, so boards, lists and the Dashboard keep reading statuses as before.
import { all, get, run, now, uid, getSetting } from './db';
import { HttpError } from './http';
import { statusKey, normName } from './taskimport';
import { notifyPeople } from './notifications';
import { grantAccess } from './project-access';
import { DEFAULT_FLOW, FLOW_OUTCOMES, FLOW_STAGES, OUTCOME_STAGE, flowConfig, isClosedStage, isFlowStage, type FlowAction, type FlowConfig, type FlowStage } from '../shared/task-flow';

const REVIEWING = /danh gia|duyet|review/;
const link = (taskId: string) => `#tasks/${taskId}/page`;
const users = async (sql: string, ...args: any[]) => (await all<any>(sql, ...args)).map((r) => r.user_id as string).filter(Boolean);
const assigneeIds = (taskId: string) => users('SELECT DISTINCT p.user_id FROM task_assignees a JOIN task_people p ON p.id=a.person_id WHERE a.task_id=? AND p.user_id IS NOT NULL', taskId);
const creatorId = async (t: any): Promise<string | null> => (await get<any>('SELECT user_id FROM task_people WHERE id=?', t.created_by))?.user_id ?? null;
const nameOf = async (userId: string | null) => userId ? (await get<any>('SELECT id,name FROM users WHERE id=?', userId)) ?? null : null;

/** The workflow as set in Quản trị › Công việc › Quy trình công việc (the defaults until it is). */
export async function flowSettings(): Promise<FlowConfig> {
  return flowConfig(await getSetting('task_flow', null));
}
/** Its stage: the one it was moved to, or (a task not yet in the workflow) the one its status, people and finishing
 *  mean: a stage's own status first, then what the status's name means. */
export function stageOf(t: { stage?: string | null; status: string; done_at?: number | null }, assigned: boolean, cfg: FlowConfig = DEFAULT_FLOW): FlowStage {
  if (isFlowStage(t.stage)) return t.stage;
  const own = (['completed', 'rejected', 'review', 'execution', 'account'] as FlowStage[]).find((k) => cfg.stages[k].status === t.status);
  if (own) return own === 'account' && assigned ? 'execution' : own;
  const key = statusKey(t.status);
  if (key === 'done' || key === 'done_late' || (t.done_at && key !== 'cancelled')) return 'completed';
  if (key === 'cancelled') return 'rejected';
  if (REVIEWING.test(normName(t.status))) return 'review';
  return key === 'todo' && !assigned ? 'account' : 'execution';
}
/** Who grades it: the one chosen, else whoever made it (the Account). */
export async function reviewerOf(t: any): Promise<string | null> {
  return t.reviewer_id || await creatorId(t);
}

/** Why a status cannot be set by hand on a task in the workflow (null: it can): a closed one is reopened first, and only
 *  a review finishes or rejects an open one. Tasks from before the workflow keep their statuses free. */
export function statusBlocked(t: { stage?: string | null; status: string }, next: string, cfg: FlowConfig = DEFAULT_FLOW): string | null {
  if (!isFlowStage(t.stage) || next === t.status) return null;
  if (isClosedStage(t.stage)) return 'Công việc đã đóng (PASS hoặc FAIL). Người duyệt hoặc Admin bấm Mở lại để làm tiếp.';
  if (['done', 'done_late', 'cancelled'].includes(statusKey(next)) || next === cfg.stages.completed.status || next === cfg.stages.rejected.status) return 'Công việc đi theo quy trình duyệt: bấm Nộp duyệt, người duyệt chấm PASS để hoàn thành hoặc FAIL để từ chối.';
  return null;
}

/** The status a stage gives: the one set for it in Quản trị (finished after its deadline: the done-late status, if
 *  there is one); a status no longer in the list falls back to one of the same meaning. On a board, a review column of
 *  its own. */
export async function statusFor(stage: FlowStage, t: any, doneAt: number | null, cfg: FlowConfig) {
  const statuses = (await all<any>('SELECT name FROM task_statuses WHERE active = 1 ORDER BY pos')).map((r) => r.name as string);
  const byKey = (key: string, fallback: string) => statuses.find((n) => statusKey(n) === key) || fallback;
  const set = statuses.includes(cfg.stages[stage].status) ? cfg.stages[stage].status : null;
  if (stage === 'account') return set || byKey('todo', 'Chưa thực hiện');
  if (stage === 'execution') return set || byKey('doing', 'Đang thực hiện');
  if (stage === 'rejected') return set || byKey('cancelled', 'Đã huỷ');
  if (stage === 'completed') {
    const done = set || byKey('done', 'Hoàn thành');
    return t.due_at && doneAt! > t.due_at && statusKey(done) === 'done' ? byKey('done_late', done) : done;
  }
  const lists = (await all<any>('SELECT bl.name FROM task_board_links l JOIN board_cards c ON c.id=l.card_id JOIN board_lists bl ON bl.board_id=c.board_id WHERE l.task_id=? AND bl.archived=0 ORDER BY bl.pos', t.id)).map((r) => r.name as string);
  return (set && lists.includes(set) ? set : lists.find((n) => REVIEWING.test(normName(n)))) || set || statuses.find((n) => REVIEWING.test(normName(n))) || 'Đang đánh giá';
}

async function log(taskId: string, userId: string, action: string, data: object) {
  await run('INSERT INTO task_activity(id,task_id,user_id,action,data,created_at) VALUES(?,?,?,?,?,?)', uid('ac_'), taskId, userId, 'flow.' + action, JSON.stringify(data), now());
}
const text = (v: unknown, max: number, what: string) => {
  const s = String(v ?? '').trim();
  if (s.length > max) throw new HttpError(400, `${what} tối đa ${max.toLocaleString('vi-VN')} ký tự`);
  return s;
};

/** Make one move. `canEdit`: the account may change the task (its people, project members, admins). */
export async function applyFlow(t: any, actor: { id: string; role: string }, canEdit: boolean, action: FlowAction, b: any = {}) {
  const cfg = await flowSettings(), assigned = await assigneeIds(t.id), hasPeople = assigned.length > 0 || !!(await get('SELECT 1 FROM task_assignees WHERE task_id=?', t.id));
  const stage = stageOf(t, hasPeople, cfg), reviewer = await reviewerOf(t), admin = actor.role === 'admin';
  const mayReview = admin || actor.id === reviewer;
  const at = now();
  const pending = await get<any>('SELECT * FROM task_reviews WHERE task_id=? AND outcome IS NULL ORDER BY round DESC LIMIT 1', t.id);
  const move = async (to: FlowStage, extra: Record<string, any> = {}) => {
    const doneAt = to === 'completed' ? t.done_at || at : null;
    const fields = { stage: to, status: await statusFor(to, t, doneAt, cfg), done_at: doneAt, updated_at: at, ...extra };
    await run(`UPDATE tasks SET ${Object.keys(fields).map((k) => `${k}=?`).join(',')} WHERE id=?`, ...Object.values(fields), t.id);
  };
  const need = (ok: boolean, message: string, code = 403) => { if (!ok) throw new HttpError(code, message); };
  switch (action) {
    case 'reviewer': {
      need(canEdit || admin, 'Chỉ người tạo, người được giao, thành viên dự án hoặc Admin đổi được người duyệt');
      need(!isClosedStage(stage), 'Công việc đã đóng; mở lại trước khi đổi người duyệt', 409);
      const id = b.reviewerId ? String(b.reviewerId) : null;
      if (id && !await get('SELECT 1 FROM users WHERE id=? AND disabled=0', id)) throw new HttpError(400, 'Người duyệt phải là tài khoản đang hoạt động');
      await run('UPDATE tasks SET reviewer_id=?,updated_at=? WHERE id=?', id, at, t.id);
      // The reviewer reads the work: they join its project if they were not in it.
      if (id && t.project_id) await grantAccess(id, actor.id, { projectId: t.project_id }, 'normal');
      await log(t.id, actor.id, 'reviewer', { reviewer: (await nameOf(id))?.name || null });
      const next = await reviewerOf({ ...t, reviewer_id: id });
      if (stage === 'review' && next) await notifyPeople([next], actor.id, { title: 'Công việc chờ bạn duyệt', body: t.title, link: link(t.id) });
      return;
    }
    case 'start':
      need(canEdit, 'Chỉ người tạo, thành viên dự án hoặc Admin giao được việc');
      need(stage === 'account', 'Công việc đã được giao', 409);
      need(hasPeople, 'Hãy giao việc cho ít nhất một người trước', 400);
      await move('execution');
      await log(t.id, actor.id, 'start', {});
      await notifyPeople(assigned, actor.id, { title: 'Bạn được giao công việc', body: t.title, link: link(t.id) });
      return;
    case 'submit': {
      need(canEdit, 'Chỉ người được giao, người tạo, thành viên dự án hoặc Admin nộp được công việc');
      need(stage === 'execution', stage === 'account' ? 'Hãy giao việc trước khi nộp duyệt' : stage === 'review' ? 'Công việc đang chờ duyệt' : 'Công việc đã đóng; mở lại trước khi nộp', 409);
      const note = text(b.note, 2000, 'Ghi chú khi nộp');
      const round = Number((await get<any>('SELECT MAX(round) n FROM task_reviews WHERE task_id=?', t.id))?.n || 0) + 1;
      // What was handed in is kept as it was, so a later redo does not change what this round was graded on.
      await run('INSERT INTO task_reviews(id,task_id,round,submitted_by,submitted_at,note,result) VALUES(?,?,?,?,?,?,?)', uid('rv_'), t.id, round, actor.id, at, note || null, t.result || null);
      await move('review', { submitted_at: at });
      await log(t.id, actor.id, 'submit', { round });
      if (reviewer) await notifyPeople([reviewer], actor.id, { title: round > 1 ? `Công việc nộp lại lần ${round}, chờ bạn duyệt` : 'Công việc chờ bạn duyệt', body: t.title, link: link(t.id) });
      return;
    }
    case 'pass': case 'redo': case 'fail': {
      need(stage === 'review', 'Công việc chưa được nộp duyệt', 409);
      need(mayReview, 'Chỉ người duyệt của công việc hoặc Admin chấm được kết quả');
      need(admin || pending?.submitted_by !== actor.id, 'Bạn đã nộp bài này nên không tự duyệt được; hãy chọn người duyệt khác hoặc nhờ Admin');
      const feedback = text(b.feedback, 4000, 'Nhận xét');
      if (action !== 'pass' && !feedback) throw new HttpError(400, action === 'redo' ? 'Hãy ghi rõ cần sửa gì để người thực hiện làm lại' : 'Hãy ghi lý do không đạt');
      if (pending) await run('UPDATE task_reviews SET reviewer_id=?,reviewed_at=?,outcome=?,feedback=? WHERE id=?', actor.id, at, action, feedback || null, pending.id);
      else await run('INSERT INTO task_reviews(id,task_id,round,submitted_by,submitted_at,reviewer_id,reviewed_at,outcome,feedback) VALUES(?,?,?,?,?,?,?,?,?)', uid('rv_'), t.id, 1, null, t.submitted_at || at, actor.id, at, action, feedback || null);
      await move(OUTCOME_STAGE[action], { reviewed_at: at, ...(action === 'redo' ? { revision: Number(t.revision || 0) + 1 } : {}) });
      await log(t.id, actor.id, action, { round: pending?.round || 1 });
      const code = FLOW_OUTCOMES.find((o) => o.key === action)!.code;
      const told = action === 'redo' ? assigned : [...assigned, ...await users('SELECT user_id FROM task_followers WHERE task_id=?', t.id), await creatorId(t)];
      await notifyPeople(told.filter(Boolean) as string[], actor.id, { title: action === 'pass' ? `Công việc đã được duyệt (${code})` : action === 'redo' ? `Công việc cần làm lại (${code})` : `Công việc không đạt (${code})`, body: t.title, link: link(t.id) });
      return;
    }
    case 'reopen':
      need(isClosedStage(stage), 'Công việc chưa đóng', 409);
      need(mayReview, 'Chỉ người duyệt của công việc hoặc Admin mở lại được công việc đã đóng');
      await move('execution');
      await log(t.id, actor.id, 'reopen', { from: stage, reason: text(b.reason, 1000, 'Lý do mở lại') || null });
      await notifyPeople(assigned, actor.id, { title: 'Công việc được mở lại', body: t.title, link: link(t.id) });
      return;
    default:
      throw new HttpError(400, 'Thao tác không hợp lệ');
  }
}

/** The workflow as the task's page shows it to this account. `own`: they see its results (rounds keep the ones handed in). */
export async function flowDetail(t: any, viewer: { id: string; role: string }, canEdit: boolean, own: boolean) {
  const cfg = await flowSettings(), hasPeople = !!(await get('SELECT 1 FROM task_assignees WHERE task_id=?', t.id));
  const stage = stageOf(t, hasPeople, cfg), reviewer = await reviewerOf(t), admin = viewer.role === 'admin', mayReview = admin || viewer.id === reviewer;
  const rows = await all<any>('SELECT r.*, s.name submitter, v.name reviewer_name FROM task_reviews r LEFT JOIN users s ON s.id=r.submitted_by LEFT JOIN users v ON v.id=r.reviewer_id WHERE r.task_id=? ORDER BY r.round DESC, r.submitted_at DESC', t.id);
  const pending = rows.find((r) => !r.outcome);
  return {
    stage, stages: FLOW_STAGES.map((s) => ({ key: s.key, code: s.code, name: cfg.stages[s.key].name })), recorded: isFlowStage(t.stage), reviewer: await nameOf(reviewer), reviewerChosen: !!t.reviewer_id,
    revision: Number(t.revision || 0), submittedAt: t.submitted_at ?? null, reviewedAt: t.reviewed_at ?? null,
    can: {
      start: canEdit && stage === 'account' && hasPeople, submit: canEdit && stage === 'execution',
      review: stage === 'review' && mayReview && (admin || pending?.submitted_by !== viewer.id),
      reopen: isClosedStage(stage) && mayReview, reviewer: (canEdit || admin) && !isClosedStage(stage),
    },
    rounds: rows.map((r) => ({
      id: r.id, round: r.round, submittedBy: r.submitted_by ? { id: r.submitted_by, name: r.submitter || 'Thành viên' } : null, submittedAt: r.submitted_at,
      note: r.note || '', result: own ? r.result || '' : null, resultHidden: !own && !!r.result,
      outcome: r.outcome || null, reviewer: r.reviewer_id ? { id: r.reviewer_id, name: r.reviewer_name || 'Thành viên' } : null, reviewedAt: r.reviewed_at ?? null, feedback: r.feedback || '',
    })),
  };
}

/** Remind people, once a day each, from the hour set (Vietnam time): whoever does a task past its deadline (its Account
 *  when no one does it yet), and a reviewer whose review has waited the hours set. Reminders stop after the days set. */
export async function remindTasks(at = now()) {
  const cfg = await flowSettings(), local = new Date(at + 7 * 3600e3);
  if (local.getUTCHours() < cfg.remindHour) return { sent: 0 };
  const day = local.toISOString().slice(0, 10), span = cfg.remindDays * 864e5, after = cfg.reviewRemindHours * 3600e3;
  await run('DELETE FROM task_reminders WHERE day < ?', new Date(at + 7 * 3600e3 - 30 * 864e5).toISOString().slice(0, 10));
  let sent = 0;
  const remind = async (t: any, userIds: (string | null)[], kind: string, title: string) => {
    for (const userId of new Set(userIds.filter(Boolean) as string[])) {
      if (!(await run('INSERT OR IGNORE INTO task_reminders(task_id,user_id,kind,day) VALUES(?,?,?,?)', t.id, userId, kind, day)).changes) continue;
      await notifyPeople([userId], null, { title, body: t.title, link: link(t.id) });
      sent++;
    }
  };
  const late = await all<any>("SELECT * FROM tasks WHERE stub=0 AND done_at IS NULL AND due_at IS NOT NULL AND due_at < ? AND due_at > ? AND (stage IS NULL OR stage IN ('account','execution')) ORDER BY due_at LIMIT 500", at, at - span);
  for (const t of late) {
    if (!isFlowStage(t.stage) && !['account', 'execution'].includes(stageOf(t, true, cfg))) continue;
    const people = await assigneeIds(t.id);
    await remind(t, people.length ? people : [await creatorId(t)], 'overdue', 'Công việc đã quá hạn');
  }
  const waiting = await all<any>("SELECT * FROM tasks WHERE stage='review' AND submitted_at < ? AND submitted_at > ? ORDER BY submitted_at LIMIT 500", at - after, at - after - span);
  for (const t of waiting) await remind(t, [await reviewerOf(t)], 'review', 'Công việc đang chờ bạn duyệt');
  return { sent };
}

/** Every task not yet in the workflow (from before it, imported, or made from a board card) takes the stage its status,
 *  finishing and people mean, so the workflow and its rules hold for all the data. A task taken as waiting for review
 *  counts as handed in when it last changed. A few thousand at a time; the cron does the rest. */
export async function settleStages() {
  const cfg = await flowSettings();
  const rows = await all<any>('SELECT t.id, t.status, t.done_at, EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.id) assigned FROM tasks t WHERE t.stage IS NULL AND t.stub=0 LIMIT 5000');
  const by = new Map<FlowStage, string[]>();
  for (const t of rows) { const s = stageOf(t, !!t.assigned, cfg); by.set(s, [...(by.get(s) || []), t.id]); }
  for (const [stage, ids] of by) for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    await run(`UPDATE tasks SET stage=?, submitted_at=CASE WHEN ?='review' THEN COALESCE(submitted_at, updated_at) ELSE submitted_at END WHERE stage IS NULL AND id IN (${part.map(() => '?').join(',')})`, stage, stage, ...part);
  }
  return rows.length;
}
/** A status taken off the list: each of its tasks takes the status of its stage (one outside the workflow: `fallback`). */
export async function restatus(taskIds: string[], fallback: string) {
  const cfg = await flowSettings();
  for (const id of taskIds) {
    const t = await get<any>('SELECT * FROM tasks WHERE id=?', id);
    if (!t) continue;
    const status = isFlowStage(t.stage) ? await statusFor(t.stage, t, t.done_at, cfg) : fallback;
    await run('UPDATE tasks SET status=?, done_at=?, updated_at=? WHERE id=?', status, t.stage === 'completed' ? t.done_at : null, now(), id);
  }
}
