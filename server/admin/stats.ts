// Thống kê: numbers computed on request from the records themselves (tasks, customers, accounts, sign-ins and the action
// log), over the people the account's stats.view scope reaches, narrowed by department, person and task status, in
// periods of a day, week, month, quarter or year (Vietnam time). Nothing is stored or estimated. A task belongs to a
// period by its due date (by when it was added when it has none); it counts as done in the period it was finished.
import { all, now } from '../db';
import { HttpError, json, type Req, type Router } from '../http';
import { need, reach, inSet, sendCsv, logAction, oneOf, type Ctx } from './common';
import { taskRows, inReach, STATE_LABEL, type TaskRow } from './work';
import {customerStatuses} from '../customer-statuses';
import { customerRows } from './customers';
import { staffRows } from './staff';

const PERIODS = ['day', 'week', 'month', 'quarter', 'year'] as const;
type Period = (typeof PERIODS)[number];
const VIEWS = ['overview', 'activity', 'customers', 'tasks', 'staff', 'performance'] as const;
type View = (typeof VIEWS)[number];
const VN = 7 * 3600e3, DAY = 86400e3;

/** The period a moment falls in, as a sortable key (a week starts on Monday). */
export function bucketKey(t: number, p: Period) {
  const d = new Date(t + VN), y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (p === 'day') return d.toISOString().slice(0, 10);
  if (p === 'week') return new Date(Date.UTC(y, m, d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
  if (p === 'month') return `${y}-${String(m + 1).padStart(2, '0')}`;
  if (p === 'quarter') return `${y}-Q${Math.floor(m / 3) + 1}`;
  return String(y);
}
/** Every period from `from` to `to`, in order (at most 400). */
export function bucketsBetween(from: number, to: number, p: Period) {
  const keys: string[] = [];
  for (let t = from; t < to && keys.length < 400; t += p === 'day' ? DAY : p === 'week' ? 7 * DAY : 27 * DAY) { const k = bucketKey(t, p); if (keys[keys.length - 1] !== k) keys.push(k); }
  const last = bucketKey(to - 1, p);
  if (keys[keys.length - 1] !== last && keys.length < 400) keys.push(last);
  return keys;
}
/** With no dates given: the last 30 days, 12 weeks, 12 months, 8 quarters or 5 years, up to now. */
function range(req: Req, p: Period): [number, number] {
  const to = Number(req.query.get('to')) || now(), span = { day: 30 * DAY, week: 84 * DAY, month: 365 * DAY, quarter: 730 * DAY, year: 5 * 365 * DAY }[p];
  const from = Number(req.query.get('from')) || to - span;
  if (from >= to || to - from > 20 * 365 * DAY) throw new HttpError(400, 'Khoảng thời gian không hợp lệ');
  return [from, to];
}
const count = <T,>(rows: T[], key: (r: T) => string | null | undefined) => { const m = new Map<string, number>(); for (const r of rows) { const k = key(r); if (k) m.set(k, (m.get(k) || 0) + 1); } return m; };
const dist = (m: Map<string, number>, label: (k: string) => string = (k) => k, color?: (k: string) => string | undefined, top = 0) => {
  const rows = [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, label: label(k), value: n, color: color?.(k) }));
  return top && rows.length > top ? [...rows.slice(0, top), { key: '_other', label: 'Khác', value: rows.slice(top).reduce((a, r) => a + r.value, 0), color: undefined }] : rows;
};
const series = (keys: string[], ...lines: [string, Map<string, number>][]) => ({ keys, lines: lines.map(([name, m]) => ({ name, values: keys.map((k) => m.get(k) || 0) })) });
const isDone = (t: TaskRow) => t.state === 'done' || t.state === 'done_late';
const isOpen = (t: TaskRow) => !isDone(t) && t.state !== 'cancelled';
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

/** The accounts the numbers cover: the scope's, narrowed to a department, a team, and/or a person within it. */
async function people(c: Ctx, req: Req) {
  const scope = await reach(c), dept = req.query.get('dept'), team = req.query.get('team'), user = req.query.get('user');
  let ids: Set<string> | null = scope;
  if (dept) {
    const inDept = new Set((await all<any>('SELECT id FROM users WHERE team_role = ?', dept)).map((r) => r.id));
    ids = new Set([...inDept].filter((id) => !ids || ids.has(id)));
  }
  if (team) {
    const inTeam = new Set((await all<any>('SELECT user_id FROM team_members WHERE team_id = ?', team)).map((r) => r.user_id));
    ids = new Set([...inTeam].filter((id) => !ids || ids.has(id)));
  }
  if (user) { if (scope && !scope.has(user)) throw new HttpError(403, 'Người này nằm ngoài phạm vi của bạn'); ids = new Set(ids && !ids.has(user) ? [] : [user]); }
  return ids;
}

async function compute(c: Ctx, req: Req) {
  const view = oneOf(req.query.get('view') || 'overview', VIEWS, 'Trang thống kê') as View, period = oneOf(req.query.get('period') || 'day', PERIODS, 'Chu kỳ') as Period;
  const [from, to] = range(req, period), keys = bucketsBetween(from, to, period), ids = await people(c, req), state = req.query.get('status') || '';
  const inRange = (t: number | null | undefined) => !!t && t >= from && t < to;
  const by = <T,>(rows: T[], at: (r: T) => number | null | undefined) => count(rows.filter((r) => inRange(at(r))), (r) => bucketKey(at(r)!, period));
  const taskFilter = (t: TaskRow) => !state || (state === 'open' ? isOpen(t) : state === 'done' ? isDone(t) : t.state === state);
  const base = { view, period, from, to, keys };

  if (view === 'overview' || view === 'tasks' || view === 'performance') {
    const tasks = inReach(await taskRows(), ids).filter(taskFilter);
    const when = (t: TaskRow) => t.dueAt ?? t.createdAt, inPeriod = tasks.filter((t) => inRange(when(t))), done = tasks.filter((t) => isDone(t) && inRange(t.doneAt));
    const onTime = done.filter((t) => t.state === 'done').length, overdueNow = tasks.filter((t) => t.state === 'overdue').length;
    if (view === 'performance') {
      const staff = (await staffRows(ids)).filter((s) => !s.disabled || tasks.some((t) => t.assignees.some((a) => a.userId === s.id)));
      const actions = count(await all<any>(`SELECT user_id FROM audit_logs WHERE kind = 'action' AND created_at >= ? AND created_at < ? AND ${inSet('user_id', ids)[0]}`, from, to, ...inSet('user_id', ids)[1]), (r) => r.user_id);
      const rows = staff.map((s) => {
        const mine = tasks.filter((t) => t.assignees.some((a) => a.userId === s.id) || t.cardMembers.includes(s.id));
        const d = mine.filter((t) => isDone(t) && inRange(t.doneAt)), ok = d.filter((t) => t.state === 'done').length;
        return { id: s.id, name: s.name, department: s.department?.name || null, assigned: mine.filter((t) => inRange(when(t))).length, done: d.length, onTime: ok, late: d.length - ok,
          overdue: mine.filter((t) => t.state === 'overdue').length, open: mine.filter(isOpen).length, onTimeRate: pct(ok, d.length), actions: actions.get(s.id) || 0 };
      }).sort((a, b) => b.done - a.done || b.assigned - a.assigned || a.name.localeCompare(b.name, 'vi'));
      return { ...base, kpis: { people: rows.length, done: done.length, onTimeRate: pct(onTime, done.length), overdue: overdueNow }, rows,
        chart: rows.filter((r) => r.done || r.assigned).slice(0, 12).map((r) => ({ key: r.id, label: r.name, values: [r.onTime, r.late] })) };
    }
    const kpis = { inPeriod: inPeriod.length, done: done.length, onTimeRate: pct(onTime, done.length), overdue: overdueNow, open: tasks.filter(isOpen).length };
    const byState = dist(count(inPeriod, (t) => t.state), (k) => STATE_LABEL[k] || k);
    if (view === 'tasks') {
      const labels = new Map<string, number>(); for (const t of inPeriod) for (const l of t.labels) labels.set(l, (labels.get(l) || 0) + 1);
      return { ...base, kpis, trend: series(keys, ['Đến hạn', by(tasks, when)], ['Hoàn thành', by(tasks.filter(isDone), (t) => t.doneAt)]), byState,
        byPriority: dist(count(inPeriod, (t) => t.priority?.name || 'Chưa đặt'), undefined, (k) => inPeriod.find((t) => t.priority?.name === k)?.priority?.color),
        byProject: dist(count(inPeriod, (t) => t.project?.name || 'Không thuộc dự án'), undefined, undefined, 10), byLabel: dist(labels, undefined, undefined, 10) };
    }
    const staff = await staffRows(ids), customers = (await customerRows(ids)).filter((x) => !x.archivedAt);
    const logins = await all<any>(`SELECT COUNT(*) n FROM login_logs WHERE ok = 1 AND created_at >= ? AND created_at < ? AND ${inSet('user_id', ids)[0]}`, from, to, ...inSet('user_id', ids)[1]);
    const depts = new Map<string, { open: number; overdue: number }>();
    for (const t of tasks.filter(isOpen)) for (const dpt of new Set(t.assignees.map((a) => a.departmentId || '_none'))) {
      const v = depts.get(dpt) || { open: 0, overdue: 0 }; if (t.state === 'overdue') v.overdue++; else v.open++; depts.set(dpt, v);
    }
    const names = new Map(staff.filter((s) => s.department).map((s) => [s.department!.id, s.department!.name]));
    return { ...base, kpis: { ...kpis, staff: staff.filter((s) => !s.disabled).length, customers: customers.length, newCustomers: customers.filter((x) => inRange(x.createdAt)).length, logins: Number(logins[0]?.n || 0) },
      trend: series(keys, ['Đến hạn', by(tasks, when)], ['Hoàn thành', by(tasks.filter(isDone), (t) => t.doneAt)]), newCustomers: series(keys, ['Khách hàng mới', by(customers, (x) => x.createdAt)]), byState,
      byDept: [...depts].map(([k, v]) => ({ key: k, label: k === '_none' ? 'Chưa có phòng ban' : names.get(k) || 'Phòng ban khác', values: [v.open, v.overdue] })).sort((a, b) => b.values[0] + b.values[1] - a.values[0] - a.values[1]).slice(0, 12) };
  }
  if (view === 'customers') {
    const statuses=new Map((await customerStatuses()).map(s=>[s.id,s]));
    const rows = await customerRows(ids), live = rows.filter((x) => !x.archivedAt);
    return { ...base, kpis: { total: live.length, new: live.filter((x) => inRange(x.createdAt)).length, archived: rows.length - live.length, withManager: pct(live.filter((x) => x.manager).length, live.length) },
      trend: series(keys, ['Khách hàng mới', by(rows, (x) => x.createdAt)]),
      byCategory: dist(count(live, (x) => x.category?.name || 'Chưa phân loại'), undefined, (k) => live.find((x) => x.category?.name === k)?.category?.color),
      bySource: dist(count(live, (x) => x.source?.name || 'Chưa rõ nguồn'), undefined, (k) => live.find((x) => x.source?.name === k)?.source?.color),
      byStatus: dist(count(live, (x) => x.status || 'none'), (k) => (k === 'none' ? 'Chưa đặt' : statuses.get(k)?.name || k), (k)=>statuses.get(k)?.color),
      byManager: dist(count(live, (x) => x.manager?.name || 'Chưa có người phụ trách'), undefined, undefined, 10),
      byNeed: dist(count(live.flatMap((x) => (x.needs.length ? x.needs : [{ id: '', name: 'Chưa có nhu cầu' }])), (n) => n.name), undefined, undefined, 10) };
  }
  if (view === 'staff') {
    const staff = await staffRows(ids), active = staff.filter((s) => !s.disabled), t = now();
    const recency = (s: (typeof staff)[number]) => (!s.lastLogin ? 'Chưa đăng nhập' : t - s.lastLogin <= 7 * DAY ? 'Trong 7 ngày' : t - s.lastLogin <= 30 * DAY ? '8–30 ngày' : 'Hơn 30 ngày');
    const levels: Record<string, string> = { admin: 'Quản lý phòng', normal: 'Thành viên', observer: 'Chỉ xem' };
    return { ...base, kpis: { total: staff.length, active: active.length, locked: staff.length - active.length, never: active.filter((s) => !s.lastLogin).length, recent: active.filter((s) => s.lastLogin && t - s.lastLogin <= 7 * DAY).length },
      trend: series(keys, ['Nhân viên mới', by(staff, (s) => s.createdAt)]),
      byDept: dist(count(active, (s) => s.department?.name || 'Chưa có phòng ban'), undefined, (k) => active.find((s) => s.department?.name === k)?.department?.color),
      byLevel: dist(count(active, (s) => (s.superAdmin ? 'Super Admin' : s.position ? levels[s.position.level] || s.position.level : 'Chưa có chức vụ'))),
      byRole: dist(count(active.flatMap((s) => (s.roles.length ? s.roles : [{ name: 'Member' }])), (r) => r.name)),
      byRecency: ['Trong 7 ngày', '8–30 ngày', 'Hơn 30 ngày', 'Chưa đăng nhập'].map((k) => ({ key: k, label: k, value: active.filter((s) => recency(s) === k).length })) };
  }
  // activity
  const [cond, args] = inSet('user_id', ids);
  const logins = await all<any>(`SELECT user_id, ok, created_at FROM login_logs WHERE created_at >= ? AND created_at < ? AND ${cond}`, from, to, ...args);
  const actions = await all<any>(`SELECT user_id, user_name, kind, action, created_at FROM audit_logs WHERE kind IN ('action', 'data', 'permission') AND created_at >= ? AND created_at < ? AND ${cond}`, from, to, ...args);
  const acts = actions.filter((a) => a.kind === 'action'), names = new Map(acts.map((a) => [a.user_id, a.user_name]));
  const since = Number((await all<any>('SELECT MIN(created_at) n FROM audit_logs'))[0]?.n) || null;
  return { ...base, since, kpis: { logins: logins.filter((l) => l.ok).length, failed: logins.filter((l) => !l.ok).length, actions: acts.length, changes: actions.filter((a) => a.kind !== 'action').length,
      activeUsers: new Set([...logins.filter((l) => l.ok).map((l) => l.user_id), ...acts.map((a) => a.user_id)].filter(Boolean)).size },
    trend: series(keys, ['Đăng nhập', by(logins.filter((l) => l.ok), (l) => l.created_at)], ['Thao tác', by(acts, (a) => a.created_at)]),
    topUsers: dist(count(acts, (a) => a.user_id), (k) => names.get(k) || 'Không rõ', undefined, 10), byAction: dist(count(acts, (a) => a.action.replace(/^Bị từ chối: .*/, 'Bị từ chối')), undefined, undefined, 8) };
}

export function registerStats(api: Router) {
  api.get('/api/admin/stats', async (req, res) => json(res, 200, await compute(await need(req, 'stats.view'), req)));
  api.get('/api/admin/stats/export', async (req, res) => {
    const c = await need(req, 'stats.export'), s: any = await compute(await need(req, 'stats.view'), req);
    const rows: (string | number | null)[][] = [['Thống kê', s.view], ['Chu kỳ', s.period], ['Từ', new Date(s.from + VN).toISOString().slice(0, 10)], ['Đến', new Date(s.to - 1 + VN).toISOString().slice(0, 10)], []];
    rows.push(['Chỉ số', 'Giá trị'], ...Object.entries(s.kpis).map(([k, v]) => [k, v as number]), []);
    if (s.rows) rows.push(['Nhân viên', 'Phòng ban', 'Được giao trong kỳ', 'Hoàn thành', 'Đúng hạn', 'Trễ hạn', 'Đang quá hạn', 'Đang làm', 'Tỉ lệ đúng hạn (%)', 'Thao tác'],
      ...s.rows.map((r: any) => [r.name, r.department, r.assigned, r.done, r.onTime, r.late, r.overdue, r.open, r.onTimeRate, r.actions]), []);
    if (s.trend) rows.push(['Kỳ', ...s.trend.lines.map((l: any) => l.name)], ...s.trend.keys.map((k: string, i: number) => [k, ...s.trend.lines.map((l: any) => l.values[i])]), []);
    for (const [k, v] of Object.entries(s)) if (Array.isArray(v) && k.startsWith('by') || k === 'topUsers') rows.push([k, 'Số lượng'], ...(v as any[]).map((d) => [d.label, d.value ?? (d.values || []).join(' / ')]), []);
    await logAction(c, `Xuất báo cáo thống kê (${s.view}, CSV)`, `${s.period}`, 'stats');
    sendCsv(res, `thong-ke-${s.view}.csv`, rows);
  });
}
