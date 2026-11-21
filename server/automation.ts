// Tự động hoá: runs the rules of Quản trị › Tự động hoá (shared/automation.ts). Task and customer triggers come from
// the places they change (automationTaskChanged, automationCustomerChanged, automationTaskComment); time triggers
// (overdue, due soon, schedule) and waiting steps from the minute tick (automationTick); a webhook from
// POST /api/automation/hooks/<secret>.
// A rule's steps run in order; an "if" walks its Đúng or Sai branch, then the steps after it; a "wait" stores where it
// stopped (automation_jobs) and the tick goes on from there with the record as it is then. Actions are API requests
// made as the person who saved the rule (callAs, as the Claude connector does), so a rule may do only what they may
// do, and its changes reach cards, boards and notifications the usual way. What a rule changes does not start other
// rules (no loops). Each run is logged (the last ones kept per rule) and each step counted (automation_stats).
import { AsyncLocalStorage } from 'node:async_hooks';
import { all, get, run, uid, now, getSetting, setSetting } from './db';
import { HttpError, json, readJson, type Router } from './http';
import { USER_SQL, type User } from './auth';
import { callAs } from './mcp';
import { notifyPeople } from './notifications';
import { need, may } from './admin/common';
import { cleanRule, cleanSettings, scopeOf, DEFAULT_SETTINGS, type Action, type AutomationSettings, type Condition, type Match, type Rule, type RuleInput, type Scope, type Trigger, type TriggerType } from '../shared/automation';
import { FLOW_STAGES } from '../shared/task-flow';

const KEEP_RUNS = 100, VN = 7 * 3600e3, MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
const auto = new AsyncLocalStorage<true>();
const taskLink = (id: string) => `#tasks/${id}/page`, customerLink = (id: string) => `#customers/${id}`;

type Row = { id: string; name: string; enabled: number; trigger: string; conditions: string; actions: string; layout: string | null; owner_id: string | null; runs: number; last_run_at: number | null; last_ok: number | null; created_at: number; updated_at: number };
type Parsed = RuleInput & { id: string; owner_id: string | null };
const parse = (r: Row): Parsed => {
  const lay = r.layout ? JSON.parse(r.layout) : {};
  return { id: r.id, owner_id: r.owner_id, name: r.name, enabled: !!r.enabled, trigger: JSON.parse(r.trigger), conditions: JSON.parse(r.conditions), actions: JSON.parse(r.actions), filterPos: lay.filter, match: lay.match || 'all', once: !!lay.once, workHoursOnly: !!lay.workHoursOnly };
};
/** The rule's options and the filter node's place, kept together (they are not run by themselves). */
const layoutOf = (i: RuleInput) => JSON.stringify({ filter: i.filterPos, match: i.match, once: i.once, workHoursOnly: i.workHoursOnly });
const rulesFor = async (type: TriggerType) => (await all<Row>('SELECT * FROM automation_rules WHERE enabled=1')).map(parse).filter((r) => r.trigger.type === type);
const anyRule = async () => !!(await get('SELECT 1 FROM automation_rules WHERE enabled=1 LIMIT 1'));

// ---------------------------------------------------------------- what a rule reads of its record
type TaskFacts = { kind: 'task'; id: string; title: string; stage: string | null; due: number | null; serviceId: string | null; service: string; customerId: string | null; customer: string; customerOwner: string | null; creator: string | null; reviewer: string | null; assignees: string[]; assigneeNames: string[]; followers: string[] };
type CustomerFacts = { kind: 'customer'; id: string; name: string; statusId: string | null; status: string; owner: string | null; ownerName: string; creator: string | null };
type Facts = TaskFacts | CustomerFacts;
async function taskFacts(taskId: string): Promise<TaskFacts | null> {
  const t = await get<any>(`SELECT t.id,t.title,t.stage,t.due_at,t.brand_service_id,t.reviewer_id,bs.name service_name,br.customer_id,cu.name customer_name,cu.manager_id customer_owner,c.user_id creator_user
    FROM tasks t LEFT JOIN brand_services bs ON bs.id=t.brand_service_id LEFT JOIN brands br ON br.id=bs.brand_id LEFT JOIN customers cu ON cu.id=br.customer_id LEFT JOIN task_people c ON c.id=t.created_by WHERE t.id=?`, taskId);
  if (!t) return null;
  const people = await all<any>('SELECT p.user_id, COALESCE(u.name,p.name) name FROM task_assignees a JOIN task_people p ON p.id=a.person_id LEFT JOIN users u ON u.id=p.user_id WHERE a.task_id=?', taskId);
  const followers = (await all<any>('SELECT user_id FROM task_followers WHERE task_id=?', taskId)).map((r) => r.user_id as string);
  return { kind: 'task', id: t.id, title: t.title, stage: t.stage || null, due: t.due_at ?? null, serviceId: t.brand_service_id || null, service: t.service_name || '', customerId: t.customer_id || null, customer: t.customer_name || '', customerOwner: t.customer_owner || null,
    creator: t.creator_user || null, reviewer: t.reviewer_id || t.creator_user || null, assignees: people.map((p) => p.user_id).filter(Boolean), assigneeNames: people.map((p) => p.name), followers };
}
async function customerFacts(id: string): Promise<CustomerFacts | null> {
  const c = await get<any>('SELECT c.id,c.name,c.status,c.manager_id,c.created_by,s.name status_name,u.name owner_name FROM customers c LEFT JOIN customer_statuses s ON s.id=c.status LEFT JOIN users u ON u.id=c.manager_id WHERE c.id=?', id);
  return c ? { kind: 'customer', id: c.id, name: c.name, statusId: c.status || null, status: c.status_name || '', owner: c.manager_id || null, ownerName: c.owner_name || '', creator: c.created_by || null } : null;
}
const factsOf = async (kind: Scope, id: string | null): Promise<Facts | null> => (!id ? null : kind === 'task' ? taskFacts(id) : kind === 'customer' ? customerFacts(id) : null);
const dayStartVN = (t: number) => Math.floor((t + VN) / DAY) * DAY - VN;

function meets(c: Condition, f: Facts | null, ctx: Ctx) {
  if (!f) return false;
  const empty = (v: unknown) => (Array.isArray(v) ? !v.length : !v);
  const value = (): unknown => {
    if (f.kind === 'task') {
      switch (c.field) {
        case 'customer': return f.customerId; case 'service': return f.serviceId; case 'assignee': return f.assignees; case 'stage': return f.stage;
        case 'title': return f.title; case 'comment': return ctx.comment || '';
        case 'due': { const n = now(), today = dayStartVN(n); return !f.due ? 'none' : f.due < n ? 'overdue' : f.due < today + DAY ? 'today' : f.due < n + 7 * DAY ? 'week' : 'later'; }
      }
    } else {
      switch (c.field) { case 'c_status': return f.statusId; case 'c_owner': return f.owner; case 'c_name': return f.name; }
    }
    return undefined;
  };
  const v = value();
  if (c.op === 'empty') return empty(v);
  if (c.op === 'filled') return !empty(v);
  const hit = c.op === 'contains' || (c.op === 'not' && (c.field === 'title' || c.field === 'comment' || c.field === 'c_name'))
    ? String(v || '').toLowerCase().includes(c.value.toLowerCase())
    : Array.isArray(v) ? v.includes(c.value) : v === c.value || (c.field === 'due' && c.value === 'week' && (v === 'today' || v === 'week'));
  return c.op === 'not' ? !hit : hit;
}
const passes = (list: Condition[], match: Match | undefined, f: Facts | null, ctx: Ctx) => !list.length || (match === 'any' ? list.some((c) => meets(c, f, ctx)) : list.every((c) => meets(c, f, ctx)));

// ---------------------------------------------------------------- working hours and leave (Cài đặt chung)
const settings = async (): Promise<AutomationSettings> => ({ ...DEFAULT_SETTINGS, ...(await getSetting('automation_settings', {})) });
const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const weekday = (t: number) => ((new Date(t + VN).getUTCDay() + 6) % 7) + 1;
function inWork(t: number, s: AutomationSettings) {
  const m = Math.floor(((t + VN) % DAY) / MIN);
  return s.days.includes(weekday(t)) && m >= minutes(s.start) && m < minutes(s.end);
}
/** The next moment (from t) inside working hours. */
function nextWork(t: number, s: AutomationSettings) {
  if (!s.days.length || inWork(t, s)) return t;
  for (let d = 0; d < 14; d++) {
    const open = dayStartVN(t) + d * DAY + minutes(s.start) * MIN;
    if (open > t && s.days.includes(weekday(open))) return open;
  }
  return t;
}
/** t plus a length of working time (only hours inside the working days and hours count). */
function addWork(t: number, ms: number, s: AutomationSettings) {
  if (!s.days.length || minutes(s.end) <= minutes(s.start)) return t + ms;
  let at = nextWork(t, s), left = ms;
  for (let i = 0; i < 400 && left > 0; i++) {
    const close = dayStartVN(at) + minutes(s.end) * MIN, step = Math.min(left, close - at);
    at += step; left -= step;
    if (left > 0) at = nextWork(close + MIN, s);
  }
  return at;
}
const vnDay = (t: number) => new Date(t + VN).toISOString().slice(0, 10);
const onLeave = (userId: string, s: AutomationSettings, t = now()) => s.leaves.some((l) => l.userId === userId && vnDay(t) >= l.from && vnDay(t) <= l.to);

/** Picks who gets it (Bizfly's chia đều / tỷ trọng): the first, in turn, by weight, or the one with fewest open tasks,
 *  leaving out those on leave. Turns and counts are kept per step. */
async function pick(a: Action, key: string): Promise<string> {
  const s = await settings(), everyone = a.userIds || [], people = everyone.filter((u) => !onLeave(u, s));
  if (!people.length) throw new Error('Mọi người được chọn đều đang nghỉ');
  if (a.mode === 'round_robin') {
    const n = Number(await getSetting(`arr:${key}`, 0)) || 0;
    for (let k = 0; k < everyone.length; k++) { const u = everyone[(n + k) % everyone.length]; if (people.includes(u)) { await setSetting(`arr:${key}`, (n + k + 1) % everyone.length); return u; } }
  }
  if (a.mode === 'weighted') {
    const counts: Record<string, number> = await getSetting(`aw:${key}`, {});
    const w = (u: string) => a.weights?.[everyone.indexOf(u)] || 1;
    const u = [...people].sort((x, y) => (counts[x] || 0) / w(x) - (counts[y] || 0) / w(y))[0];
    counts[u] = (counts[u] || 0) + 1; await setSetting(`aw:${key}`, counts);
    return u;
  }
  if (a.mode === 'least') {
    const load = new Map((await all<any>(`SELECT p.user_id, COUNT(*) n FROM task_assignees ta JOIN task_people p ON p.id=ta.person_id JOIN tasks t ON t.id=ta.task_id
      WHERE t.stage NOT IN ('completed','rejected') AND t.done_at IS NULL AND p.user_id IS NOT NULL GROUP BY p.user_id`)).map((r) => [r.user_id as string, Number(r.n)]));
    return [...people].sort((x, y) => (load.get(x) || 0) - (load.get(y) || 0))[0];
  }
  return people[0];
}

// ---------------------------------------------------------------- texts and actions
type Ctx = { rule: string; ruleId: string; facts: Facts | null; from?: string; to?: string; body?: any; comment?: string };
const stageName = (s?: string | null) => (s ? FLOW_STAGES.find((x) => x.key === s)?.code || s : '');
const fmt = (t: number | null) => (t ? new Date(t).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
/** A text with its {{…}} fields filled in. */
async function fill(text: string, c: Ctx) {
  const base = await getSetting('notification_site_url', process.env.PUBLIC_URL || ''), f = c.facts;
  const v: Record<string, string> = { rule: c.rule, from: f?.kind === 'customer' ? c.from || '' : stageName(c.from), to: f?.kind === 'customer' ? c.to || '' : stageName(c.to), comment: c.comment || '' };
  if (f?.kind === 'task') Object.assign(v, { 'task.title': f.title, 'task.link': `${base}/${taskLink(f.id)}`, 'task.due': fmt(f.due), 'task.stage': stageName(f.stage), customer: f.customer, service: f.service, assignee: f.assigneeNames.join(', ') });
  if (f?.kind === 'customer') Object.assign(v, { customer: f.name, 'customer.link': `${base}/${customerLink(f.id)}`, 'customer.status': f.status, 'customer.owner': f.ownerName });
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => {
    if (k.startsWith('body.')) { const x = k.slice(5).split('.').reduce((o: any, p) => (o == null ? o : o[p]), c.body); return x == null ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x); }
    return v[k] ?? '';
  });
}
/** 23:59 of that day in Vietnam. */
const endOfDayVN = (t: number) => dayStartVN(t) + DAY - MIN;
const userName = async (id: string) => (await get<any>('SELECT name FROM users WHERE id=?', id))?.name || id;

async function act(a: Action, key: string, call: ReturnType<typeof callAs>, owner: User, c: Ctx): Promise<string> {
  const f = c.facts, t = f?.kind === 'task' ? f : null, cu = f?.kind === 'customer' ? f : null;
  const task = (p = '') => { if (!t) throw new Error('Bước này cần một công việc'); return `/api/tasks/${t.id}${p}`; };
  switch (a.type) {
    case 'notify': {
      const who = new Set<string>();
      for (const k of a.to || []) {
        if (k === 'assignees') t?.assignees.forEach((x) => who.add(x)); else if (k === 'followers') t?.followers.forEach((x) => who.add(x));
        else if (k === 'creator') { const x = t?.creator || cu?.creator; if (x) who.add(x); } else if (k === 'reviewer') { if (t?.reviewer) who.add(t.reviewer); }
        else if (k === 'owner') { const x = t?.customerOwner || cu?.owner; if (x) who.add(x); } else who.add(k);
      }
      await notifyPeople(who, null, { title: await fill(a.text || '', c), body: await fill(a.body || t?.title || cu?.name || '', c), link: t ? taskLink(t.id) : cu ? customerLink(cu.id) : '#home' });
      return `Đã báo ${who.size} người`;
    }
    case 'comment': await call('POST', task('/comments'), { text: await fill(a.text || '', c) }); return 'Đã bình luận';
    case 'assign': { const u = await pick(a, key); await call('PUT', task(), { assigneeUserIds: [u] }); return `Đã giao cho ${await userName(u)}`; }
    case 'follow': await call('PUT', task(), { followerUserIds: [...new Set([...(t?.followers || []), ...(a.userIds || [])])] }); return 'Đã thêm người theo dõi';
    case 'reviewer': await call('POST', task('/flow'), { action: 'reviewer', reviewerId: a.userId }); return 'Đã đặt người duyệt';
    case 'update_task': await call('PUT', task(), { dueAt: a.dueIn == null ? null : endOfDayVN(now() + a.dueIn * DAY) }); return a.dueIn == null ? 'Đã bỏ hạn chót' : `Đã đặt hạn sau ${a.dueIn} ngày`;
    case 'flow': await call('POST', task('/flow'), { action: a.move }); return `Đã chuyển bước (${a.move})`;
    case 'customer_assign': {
      if (!cu) throw new Error('Bước này cần một khách hàng');
      const u = await pick(a, key); await call('PUT', `/api/customers/${cu.id}/record`, { managerId: u });
      return `Đã giao khách cho ${await userName(u)}`;
    }
    case 'customer_status': if (!cu) throw new Error('Bước này cần một khách hàng'); await call('PUT', `/api/customers/${cu.id}/record`, { status: a.statusId }); return 'Đã đổi trạng thái khách';
    case 'create_task': {
      const r = await call('POST', '/api/tasks', {
        title: await fill(a.text || '', c), description: a.body ? await fill(a.body, c) : undefined, brandServiceId: a.serviceId || null,
        dueAt: a.dueDays === undefined ? null : endOfDayVN(now() + a.dueDays * DAY), ...(a.userId ? { assigneeUserIds: [a.userId] } : {}),
      });
      return `Đã tạo công việc ${r.id}`;
    }
    case 'webhook': {
      const res = await fetch(a.url!, {
        method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'DMI-Workspace-Automation' }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ rule: c.rule, by: { id: owner.id, name: owner.name }, from: c.from || null, to: c.to || null, body: c.body ?? null, comment: c.comment || null, at: new Date().toISOString(),
          task: t ? { id: t.id, title: t.title, stage: t.stage, dueAt: t.due, customer: t.customer || null, service: t.service || null, assignees: t.assigneeNames, link: await fill('{{task.link}}', c) } : null,
          customer: cu ? { id: cu.id, name: cu.name, status: cu.status || null, owner: cu.ownerName || null, link: await fill('{{customer.link}}', c) } : null }),
      });
      if (!res.ok) throw new Error(`Webhook trả lỗi ${res.status}`);
      return `Webhook ${res.status}`;
    }
    default: return '';
  }
}

// ---------------------------------------------------------------- running a rule: steps, branches, waits
/** Where a run is: each level's list and the index in it, and which branch ('t' Đúng, 'e' Sai) the level is. */
type Frame = { list: Action[]; i: number; branch: 't' | 'e' | null; prefix: string };
type Cursor = { i: number; branch: 't' | 'e' | null }[];
function framesAt(actions: Action[], cursor: Cursor | null): Frame[] {
  if (!cursor?.length) return [{ list: actions, i: 0, branch: null, prefix: '' }];
  const frames: Frame[] = [];
  for (const [k, c] of cursor.entries()) {
    if (!k) { frames.push({ list: actions, i: c.i, branch: null, prefix: '' }); continue; }
    const up = frames[k - 1], step = up.list[up.i], list = (c.branch === 't' ? step?.then : step?.else) || [];
    frames.push({ list, i: c.i, branch: c.branch, prefix: `${pathOf(up)}.${c.branch}` });
  }
  return frames;
}
function pathOf(f: Frame) { return f.prefix ? `${f.prefix}.${f.i}` : String(f.i); }
async function count(ruleId: string, path: string, ok: boolean) {
  await run('INSERT INTO automation_stats(rule_id,path,ok,fail) VALUES(?,?,?,?) ON CONFLICT(rule_id,path) DO UPDATE SET ok=ok+excluded.ok, fail=fail+excluded.fail', ruleId, path, ok ? 1 : 0, ok ? 0 : 1);
}

/** Runs a rule for one record (or none): its conditions (unless forced or resumed), then its steps from `cursor`.
 *  Logs the run; a "wait" stores the rest for later. */
async function runRule(rule: Parsed, start: { kind: Scope; recordId: string | null; extra?: Partial<Ctx>; cursor?: Cursor | null; force?: boolean }): Promise<{ ok: boolean; message: string } | null> {
  const facts = await factsOf(start.kind, start.recordId);
  if (start.recordId && !facts) return null;
  const c: Ctx = { rule: rule.name, ruleId: rule.id, facts, ...start.extra };
  const resumed = !!start.cursor;
  if (!resumed && !start.force) {
    if (!passes(rule.conditions, rule.match, facts, c)) return null;
    if (rule.once && start.recordId && await get('SELECT 1 FROM automation_done WHERE rule_id=? AND record_id=?', rule.id, start.recordId)) return null;
    const s = await settings();
    // Outside working hours, a rule kept to them starts at the next working time.
    if (rule.workHoursOnly && !inWork(now(), s)) {
      if (rule.once && start.recordId) await run('INSERT OR IGNORE INTO automation_done(rule_id,record_id,at) VALUES(?,?,?)', rule.id, start.recordId, now());
      await queue(rule, start.kind, start.recordId, [{ i: 0, branch: null }], c, nextWork(now(), s), 'Chờ giờ làm việc');
      return { ok: true, message: 'Chờ tới giờ làm việc' };
    }
  }
  if (rule.once && start.recordId && !resumed) await run('INSERT OR IGNORE INTO automation_done(rule_id,record_id,at) VALUES(?,?,?)', rule.id, start.recordId, now());
  const owner = rule.owner_id ? await get<User>(`${USER_SQL} WHERE u.id = ? AND u.disabled = 0`, rule.owner_id) : null;
  let ok = true;
  const notes: string[] = resumed ? ['Tiếp tục sau khi chờ'] : [];
  if (!owner) { ok = false; notes.push('Người lưu luật không còn hoạt động: hãy lưu lại luật bằng tài khoản khác'); }
  else {
    const call = callAs({ headers: { host: 'automation' }, socket: {} } as any, owner, 'Tự động hoá');
    await auto.run(true, async () => {
      const frames = framesAt(rule.actions, start.cursor || null);
      while (frames.length) {
        const f = frames[frames.length - 1];
        if (f.i >= f.list.length) { frames.pop(); if (frames.length) frames[frames.length - 1].i++; continue; }
        const step = f.list[f.i], path = pathOf(f);
        if (step.type === 'if') {
          // The record as it is now: an earlier step may have changed it.
          if (c.facts) c.facts = await factsOf(c.facts.kind, c.facts.id);
          const yes = passes(step.conditions || [], step.match, c.facts, c), branch = yes ? 't' : 'e';
          await count(rule.id, path, true); await count(rule.id, `${path}.${branch}`, true);
          notes.push(`Nếu: ${yes ? 'Đúng' : 'Sai'}`);
          frames.push({ list: (yes ? step.then : step.else) || [], i: 0, branch, prefix: `${path}.${branch}` });
          continue;
        }
        if (step.type === 'wait') {
          const ms = (step.amount || 1) * (step.unit === 'minutes' ? MIN : step.unit === 'days' ? DAY : HOUR), s = await settings();
          const at = step.workHours ? addWork(now(), ms, s) : now() + ms;
          // Where to go on: the step after the wait, at every level.
          const cursor: Cursor = frames.map((x, k) => ({ i: k === frames.length - 1 ? x.i + 1 : x.i, branch: x.branch }));
          await queue(rule, start.kind, start.recordId, cursor, c, at, path);
          await count(rule.id, path, true);
          notes.push(`Đợi tới ${fmt(at)}`);
          break;
        }
        try { notes.push(await act(step, `${rule.id}:${path}`, call, owner, c)); await count(rule.id, path, true); }
        catch (e: any) { ok = false; notes.push(`Lỗi (${step.type}): ${e?.message || 'không rõ'}`); await count(rule.id, path, false); break; }
        if (c.facts && ['assign', 'follow', 'reviewer', 'update_task', 'flow', 'customer_assign', 'customer_status'].includes(step.type)) c.facts = await factsOf(c.facts.kind, c.facts.id);
        f.i++;
      }
    });
  }
  const at = now(), message = notes.join(' · ').slice(0, 1000);
  await run('INSERT INTO automation_runs(id,rule_id,at,ok,task_id,message) VALUES(?,?,?,?,?,?)', uid('ar_'), rule.id, at, ok ? 1 : 0, start.recordId, message);
  await run('UPDATE automation_rules SET runs=runs+1,last_run_at=?,last_ok=? WHERE id=?', at, ok ? 1 : 0, rule.id);
  const old = await get<any>('SELECT at FROM automation_runs WHERE rule_id=? ORDER BY at DESC LIMIT 1 OFFSET ?', rule.id, KEEP_RUNS);
  if (old) await run('DELETE FROM automation_runs WHERE rule_id=? AND at<=?', rule.id, old.at);
  return { ok, message };
}
async function queue(rule: Parsed, kind: Scope, recordId: string | null, cursor: Cursor, c: Ctx, at: number, step: string) {
  await run('INSERT INTO automation_jobs(id,rule_id,kind,record_id,cursor,ctx,step,run_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    uid('aj_'), rule.id, kind, recordId, JSON.stringify(cursor), JSON.stringify({ from: c.from, to: c.to, body: c.body, comment: c.comment }), step, at, now());
}
async function fire(type: TriggerType, kind: Scope, recordId: string | null, extra: Partial<Ctx> = {}, pickRule: (t: Trigger) => boolean = () => true) {
  for (const rule of (await rulesFor(type)).filter((r) => pickRule(r.trigger))) {
    await runRule(rule, { kind, recordId, extra }).catch(() => console.error('Không chạy được luật tự động', rule.id));
  }
}

// ---------------------------------------------------------------- where triggers come from
/** What a change is compared against: the record as last seen (a task's step, due date, people, service; a
 *  customer's status and owner). Customers are kept as "c:<id>". */
async function seen(key: string, snap: Record<string, unknown>) {
  const row = await get<any>('SELECT snap FROM automation_seen WHERE task_id=?', key), next = JSON.stringify(snap);
  if (row?.snap !== next) await run('INSERT INTO automation_seen(task_id,stage,snap) VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET snap=excluded.snap, stage=excluded.stage', key, String(snap.stage ?? snap.status ?? ''), next);
  return row?.snap ? JSON.parse(row.snap) as Record<string, any> : null;
}
/** After a task is made or changed: "made", "moved to a step" and "field changed" rules. Changes made by a rule only
 *  keep what was seen up to date. With no rule on, nothing is kept. */
export async function automationTaskChanged(taskId: string, created: boolean) {
  try {
    if (!await anyRule()) return;
    const f = await taskFacts(taskId);
    if (!f) return;
    const people = [...f.assignees].sort().join(',');
    const before = await seen(taskId, { stage: f.stage || '', due: f.due, assignees: people, service: f.serviceId });
    if (auto.getStore()) return;
    if (created) { await fire('task.created', 'task', taskId); return; }
    if (!before) return;
    if (before.stage !== (f.stage || '') && f.stage) await fire('task.stage', 'task', taskId, { from: before.stage, to: f.stage }, (tr) => !tr.to || tr.to === f.stage);
    const changed: Record<string, boolean> = { due: before.due !== f.due, assignee: before.assignees !== people, service: before.service !== f.serviceId };
    if (Object.values(changed).some(Boolean)) await fire('task.field', 'task', taskId, {}, (tr) => !!changed[tr.field || 'due']);
  } catch { console.error('Không xử lý được tự động hoá của công việc'); }
}
export async function automationTaskComment(taskId: string, text: string) {
  try { if (!auto.getStore() && await anyRule()) await fire('task.comment', 'task', taskId, { comment: text }); }
  catch { console.error('Không xử lý được tự động hoá của bình luận'); }
}
export async function automationCustomerChanged(id: string, created: boolean) {
  try {
    if (!await anyRule()) return;
    const f = await customerFacts(id);
    if (!f) return;
    const before = await seen(`c:${id}`, { status: f.statusId, owner: f.owner });
    if (auto.getStore()) return;
    if (created) { await fire('customer.created', 'customer', id); return; }
    if (!before) return;
    if (before.status !== f.statusId) {
      const from = (await get<any>('SELECT name FROM customer_statuses WHERE id=?', before.status))?.name || '';
      await fire('customer.status', 'customer', id, { from, to: f.status }, (tr) => !tr.to || tr.to === f.statusId);
    }
    if (before.owner !== f.owner) await fire('customer.owner', 'customer', id);
  } catch { console.error('Không xử lý được tự động hoá của khách hàng'); }
}

/** Each minute: waits that are due, tasks that just went overdue or reached "due soon", and scheduled rules whose
 *  time has come, since the last tick (at most a day back; the first tick only starts the clock). */
export async function automationTick() {
  const at = now(), last = Math.max(Number(await getSetting('automation_tick', 0)) || at, at - DAY);
  await setSetting('automation_tick', at);
  for (const job of await all<any>('SELECT * FROM automation_jobs WHERE run_at<=? ORDER BY run_at LIMIT 50', at)) {
    await run('DELETE FROM automation_jobs WHERE id=?', job.id);
    const row = await get<Row>('SELECT * FROM automation_rules WHERE id=? AND enabled=1', job.rule_id);
    if (row) await runRule(parse(row), { kind: job.kind, recordId: job.record_id, extra: JSON.parse(job.ctx || '{}'), cursor: JSON.parse(job.cursor) }).catch(() => console.error('Không chạy tiếp được luật', job.rule_id));
  }
  if (last >= at) return;
  const rules = (await all<Row>('SELECT * FROM automation_rules WHERE enabled=1')).map(parse).filter((r) => ['task.overdue', 'task.due_soon', 'schedule'].includes(r.trigger.type));
  const open = "stage NOT IN ('completed','rejected') AND done_at IS NULL AND stub=0";
  for (const rule of rules) {
    const tr = rule.trigger;
    try {
      if (tr.type === 'schedule') { if (scheduledIn(tr, last, at)) await runRule(rule, { kind: 'none', recordId: null }); continue; }
      const lead = tr.type === 'task.due_soon' ? (tr.hours || 24) * HOUR : 0;
      for (const t of await all<any>(`SELECT id FROM tasks WHERE due_at>? AND due_at<=? AND ${open}`, last + lead, at + lead)) await runRule(rule, { kind: 'task', recordId: t.id });
    } catch { console.error('Không chạy được luật theo thời gian', rule.id); }
  }
}
/** Whether a schedule's time (Vietnam) falls in (from, to]. */
function scheduledIn(tr: Trigger, from: number, to: number) {
  const [h, m] = (tr.at || '08:00').split(':').map(Number);
  for (let d = Math.floor((to + VN) / DAY); d >= Math.floor((from + VN) / DAY); d--) {
    const t = d * DAY + (h * 60 + m) * MIN - VN;
    if (t <= from || t > to) continue;
    const day = new Date(d * DAY);
    if (tr.every === 'week' && ((day.getUTCDay() + 6) % 7) + 1 !== (tr.weekday || 1)) continue;
    if (tr.every === 'month' && day.getUTCDate() !== (tr.monthday || 1)) continue;
    return t;
  }
  return 0;
}
/** A schedule's next time from now (for the list). */
function nextScheduled(tr: Trigger) {
  const n = now();
  for (let k = 0; k < 32; k++) { const t = scheduledIn(tr, n + k * DAY, n + (k + 1) * DAY); if (t) return t; }
  return null;
}

// ---------------------------------------------------------------- Quản trị › Tự động hoá
const out = async (r: Row): Promise<Rule> => {
  const p = parse(r), owner = r.owner_id ? await get<any>('SELECT id,name FROM users WHERE id=?', r.owner_id) : null;
  const waiting = Number((await get<any>('SELECT COUNT(*) n FROM automation_jobs WHERE rule_id=?', r.id))?.n || 0);
  return { ...p, owner: owner ? { id: owner.id, name: owner.name } : null, runs: Number(r.runs) || 0, lastRunAt: r.last_run_at ?? null, lastOk: r.last_ok === null ? null : !!r.last_ok,
    nextRunAt: p.trigger.type === 'schedule' && p.enabled ? nextScheduled(p.trigger) : null, waiting, createdAt: r.created_at, updatedAt: r.updated_at };
};
const mustRule = async (id: string) => { const r = await get<Row>('SELECT * FROM automation_rules WHERE id=?', id); if (!r) throw new HttpError(404, 'Không tìm thấy luật'); return r; };
function cleaned(b: unknown, keepSecret?: string) {
  let input: RuleInput;
  try { input = cleanRule(b); } catch (e: any) { throw new HttpError(400, e.message); }
  // A webhook keeps the address it was given (the secret is made here, never chosen by the page).
  if (input.trigger.type === 'webhook') input.trigger.secret = keepSecret || (uid() + uid()).slice(0, 32);
  else delete input.trigger.secret;
  return input;
}
const manager = async (req: any) => { const c = await need(req, 'automation.view'); if (!may(c, 'automation.manage')) throw new HttpError(403, 'Bạn không có quyền quản lý tự động hoá'); return c; };

export function registerAutomation(api: Router) {
  // The editor's lists: rules, people, customers, services, customer statuses, and Cài đặt chung.
  api.get('/api/admin/automation', async (req, res) => {
    await need(req, 'automation.view');
    const rules = await Promise.all((await all<Row>('SELECT * FROM automation_rules ORDER BY created_at')).map(out));
    const people = await all<any>('SELECT id,name FROM users WHERE disabled=0 ORDER BY name COLLATE NOCASE');
    const customers = await all<any>('SELECT id,name FROM customers WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE');
    const statuses = await all<any>('SELECT id,name,color FROM customer_statuses WHERE active=1 ORDER BY pos');
    const services = await all<any>(`SELECT bs.id, COALESCE(NULLIF(bs.name,''), sc.name) name, br.name brand, cu.name customer FROM brand_services bs LEFT JOIN service_catalog sc ON sc.id=bs.catalog_service_id
      LEFT JOIN brands br ON br.id=bs.brand_id AND br.deleted_at IS NULL LEFT JOIN customers cu ON cu.id=br.customer_id ORDER BY cu.name COLLATE NOCASE, br.name COLLATE NOCASE`);
    json(res, 200, { rules, people, customers, statuses, settings: await settings(), services: services.map((s) => ({ id: s.id, name: [s.customer, s.brand, s.name].filter(Boolean).join(' · ') })) });
  });
  api.put('/api/admin/automation/settings', async (req, res) => {
    await manager(req);
    const s = cleanSettings(await readJson(req));
    await setSetting('automation_settings', s);
    json(res, 200, s);
  });
  api.get('/api/admin/automation/:id/runs', async (req, res) => {
    await need(req, 'automation.view');
    const rows = await all<any>('SELECT r.*, COALESCE(t.title, c.name) title FROM automation_runs r LEFT JOIN tasks t ON t.id=r.task_id LEFT JOIN customers c ON c.id=r.task_id WHERE r.rule_id=? ORDER BY r.at DESC LIMIT ?', req.params.id, KEEP_RUNS);
    json(res, 200, rows.map((r) => ({ id: r.id, at: r.at, ok: !!r.ok, taskId: r.task_id, taskTitle: r.title || null, message: r.message })));
  });
  // Each step's counts (shown on its node), and the waits not yet due.
  api.get('/api/admin/automation/:id/stats', async (req, res) => {
    await need(req, 'automation.view');
    const stats = Object.fromEntries((await all<any>('SELECT path, ok, fail FROM automation_stats WHERE rule_id=?', req.params.id)).map((r) => [r.path, { ok: Number(r.ok), fail: Number(r.fail) }]));
    const jobs = await all<any>('SELECT j.*, COALESCE(t.title, c.name) label FROM automation_jobs j LEFT JOIN tasks t ON t.id=j.record_id LEFT JOIN customers c ON c.id=j.record_id WHERE j.rule_id=? ORDER BY j.run_at LIMIT 200', req.params.id);
    json(res, 200, { stats, jobs: jobs.map((j) => ({ id: j.id, runAt: j.run_at, record: j.record_id, label: j.label || null, step: j.step })) });
  });
  api.delete('/api/admin/automation/jobs/:job', async (req, res) => {
    await manager(req);
    await run('DELETE FROM automation_jobs WHERE id=?', req.params.job);
    json(res, 200, { ok: true });
  });
  api.post('/api/admin/automation', async (req, res) => {
    const c = await manager(req), input = cleaned(await readJson(req)), id = uid('au_'), at = now();
    await run('INSERT INTO automation_rules(id,name,enabled,trigger,conditions,actions,layout,owner_id,runs,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,0,?,?)',
      id, input.name, input.enabled ? 1 : 0, JSON.stringify(input.trigger), JSON.stringify(input.conditions), JSON.stringify(input.actions), layoutOf(input), c.user.id, at, at);
    json(res, 201, await out(await mustRule(id)));
  });
  // Saving a rule makes whoever saves it the one its actions run as.
  api.put('/api/admin/automation/:id', async (req, res) => {
    const c = await manager(req), r = await mustRule(req.params.id), b = await readJson(req);
    if (Object.keys(b).length === 1 && 'enabled' in b) await run('UPDATE automation_rules SET enabled=?,updated_at=? WHERE id=?', b.enabled ? 1 : 0, now(), r.id);
    else {
      const input = cleaned(b, JSON.parse(r.trigger).secret);
      await run('UPDATE automation_rules SET name=?,enabled=?,trigger=?,conditions=?,actions=?,layout=?,owner_id=?,updated_at=? WHERE id=?',
        input.name, input.enabled ? 1 : 0, JSON.stringify(input.trigger), JSON.stringify(input.conditions), JSON.stringify(input.actions), layoutOf(input), c.user.id, now(), r.id);
    }
    json(res, 200, await out(await mustRule(r.id)));
  });
  api.delete('/api/admin/automation/:id', async (req, res) => {
    await manager(req);
    await mustRule(req.params.id);
    for (const t of ['automation_runs', 'automation_jobs', 'automation_stats', 'automation_done']) await run(`DELETE FROM ${t} WHERE rule_id=?`, req.params.id);
    await run('DELETE FROM automation_rules WHERE id=?', req.params.id);
    json(res, 200, { ok: true });
  });
  // Chạy thử: now, on a task or customer (its conditions not checked) or with none; logged like any run.
  api.post('/api/admin/automation/:id/test', async (req, res) => {
    await manager(req);
    const rule = parse(await mustRule(req.params.id)), b = await readJson(req), kind = scopeOf(rule.trigger.type);
    const recordId = b.recordId ? String(b.recordId) : b.taskId ? String(b.taskId) : null;
    if (kind !== 'none' && !recordId) throw new HttpError(400, kind === 'task' ? 'Hãy chọn công việc để chạy thử' : 'Hãy chọn khách hàng để chạy thử');
    if (recordId && !await factsOf(kind, recordId)) throw new HttpError(404, 'Không tìm thấy bản ghi');
    json(res, 200, await runRule(rule, { kind, recordId, extra: { body: b.body ?? { test: true } }, force: true }));
  });
  // Chạy cho dữ liệu có sẵn (Bizfly's "Chạy tự động bản ghi"): every open task or every customer, up to 300, through
  // the rule's conditions (and "once").
  api.post('/api/admin/automation/:id/backfill', async (req, res) => {
    await manager(req);
    const rule = parse(await mustRule(req.params.id)), kind = scopeOf(rule.trigger.type);
    if (kind === 'none') throw new HttpError(400, 'Luật theo lịch hoặc webhook không chạy theo bản ghi');
    const ids = kind === 'task'
      ? await all<any>("SELECT id FROM tasks WHERE stage NOT IN ('completed','rejected') AND done_at IS NULL AND stub=0 ORDER BY created_at DESC LIMIT 300")
      : await all<any>('SELECT id FROM customers WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 300');
    let ran = 0, failed = 0;
    for (const r of ids) { const x = await runRule(rule, { kind, recordId: r.id }); if (x) { ran++; if (!x.ok) failed++; } }
    json(res, 200, { checked: ids.length, ran, failed });
  });
  // Webhook gọi vào: anyone with the address (n8n, Zapier…) starts the rule; the JSON sent is {{body.…}}.
  api.post('/api/automation/hooks/:secret', async (req, res) => {
    const secret = String(req.params.secret || '');
    const rule = secret.length >= 24 ? (await rulesFor('webhook')).find((r) => r.trigger.secret === secret) : undefined;
    if (!rule) throw new HttpError(404, 'Không có webhook này hoặc luật đang tắt');
    const body = await readJson(req).catch(() => ({}));
    const r = await runRule(rule, { kind: 'none', recordId: null, extra: { body }, force: true });
    json(res, r?.ok ? 200 : 500, { ok: !!r?.ok, message: r?.message || '' });
  });
}
