// Tự động hoá (Quản trị › Tự động hoá), like n8n's flows and Bizfly CRM's rules: each rule is a trigger (on a task, on a
// customer, on a schedule or a webhook), the conditions its record must meet, and steps done in order: actions, an
// "if" that branches (Đúng / Sai) and a "wait" that resumes later. The server runs them (server/automation.ts) as the
// person who saved the rule, through the same API the pages use, so a rule may do only what that person may do.
// Shared here: the shapes, the catalogue the editor shows, and the checks a rule passes before it is saved.

/** A node's place on the editor's canvas; the order steps run in is the chain's, not their places. */
export type Pos = [number, number];
/** What a rule works on: one task, one customer, or nothing (a schedule, a webhook). */
export type Scope = 'task' | 'customer' | 'none';

export type TriggerType = 'task.created' | 'task.stage' | 'task.field' | 'task.comment' | 'task.overdue' | 'task.due_soon'
  | 'customer.created' | 'customer.status' | 'customer.owner' | 'schedule' | 'webhook';
export type WatchedField = 'due' | 'assignee' | 'service';
export interface Trigger {
  type: TriggerType;
  /** task.stage: the step it moves to; customer.status: the status it gets ('' any). */ to?: string;
  /** task.field: which field changed. */ field?: WatchedField;
  /** task.due_soon: hours before the due time. */ hours?: number;
  /** schedule: how often, at what time (HH:MM, Vietnam), on which weekday (1 Monday … 7 Sunday) or day of the month. */
  every?: 'day' | 'week' | 'month'; at?: string; weekday?: number; monthday?: number;
  /** webhook: the secret in its address (made by the server). */ secret?: string;
  pos?: Pos;
}

export type CondField = 'customer' | 'service' | 'assignee' | 'stage' | 'title' | 'due' | 'comment' | 'c_status' | 'c_owner' | 'c_name';
export type CondOp = 'is' | 'not' | 'contains' | 'empty' | 'filled';
export interface Condition { field: CondField; op: CondOp; value: string }
export type Match = 'all' | 'any';

export type ActionType = 'notify' | 'comment' | 'assign' | 'follow' | 'reviewer' | 'update_task' | 'flow' | 'create_task'
  | 'customer_assign' | 'customer_status' | 'webhook' | 'if' | 'wait';
/** How "assign" picks among several people: the first, in turn, by weight, or whoever has the fewest open tasks.
 *  People on leave (Cài đặt chung) are skipped. */
export type AssignMode = 'fixed' | 'round_robin' | 'weighted' | 'least';
export interface Action {
  type: ActionType;
  /** notify: who ('assignees', 'creator', 'reviewer', 'followers', 'owner', or account ids). */ to?: string[];
  /** notify: its title; comment: its text; create_task: the new task's name; all may hold {{…}} fields. */ text?: string;
  /** notify, create_task: more text. */ body?: string;
  /** reviewer, create_task: one account; assign, customer_assign, follow: several. */ userId?: string; userIds?: string[];
  /** assign, customer_assign: how one is picked, and each person's weight (weighted). */ mode?: AssignMode; weights?: number[];
  /** create_task: its service and due date (days after it is made). */ serviceId?: string; dueDays?: number;
  /** update_task: the due date moved to N days from now (null: removed). */ dueIn?: number | null;
  /** flow: the workflow move (hand out, submit for review, pass). */ move?: 'start' | 'submit' | 'pass';
  /** customer_status: the status it gets. */ statusId?: string;
  /** webhook: where the facts are sent (POST, JSON). */ url?: string;
  /** if: its conditions, how they combine, and the steps of each branch. */ conditions?: Condition[]; match?: Match; then?: Action[]; else?: Action[];
  /** wait: how long; counting only working hours (Cài đặt chung) or not. */ amount?: number; unit?: 'minutes' | 'hours' | 'days'; workHours?: boolean;
  pos?: Pos;
}
export interface RuleInput {
  name: string; enabled: boolean; trigger: Trigger; conditions: Condition[]; actions: Action[];
  /** How the conditions combine. */ match?: Match;
  /** Each record runs this rule once at most. */ once?: boolean;
  /** Started outside working hours, it waits for the next working time. */ workHoursOnly?: boolean;
  /** The filter node's place. */ filterPos?: Pos;
}
export interface Rule extends RuleInput { id: string; owner: { id: string; name: string } | null; runs: number; lastRunAt: number | null; lastOk: boolean | null; nextRunAt: number | null; waiting: number; createdAt: number; updatedAt: number }
export interface RuleRun { id: string; at: number; ok: boolean; taskId: string | null; taskTitle: string | null; message: string }
export interface RuleJob { id: string; runAt: number; record: string | null; label: string | null; step: string }
/** Each step's count of runs that went through it (by its path: "0", "2.t.1"…). */
export type StepStats = Record<string, { ok: number; fail: number }>;
/** Cài đặt chung: working days (1 Monday … 7 Sunday) and hours, and who is on leave (days, Vietnam). */
export interface AutomationSettings { days: number[]; start: string; end: string; leaves: { userId: string; from: string; to: string }[] }
export const DEFAULT_SETTINGS: AutomationSettings = { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:30', leaves: [] };

export const TRIGGERS: { type: TriggerType; label: string; about: string; icon: string; scope: Scope; group: string }[] = [
  { type: 'task.created', label: 'Công việc được tạo', about: 'Khi có công việc mới (trang công việc, board, Claude).', icon: 'plus', scope: 'task', group: 'Công việc' },
  { type: 'task.stage', label: 'Công việc chuyển bước', about: 'Khi công việc sang một bước của quy trình (ACCOUNT, EXECUTION, REVIEW…).', icon: 'arrow', scope: 'task', group: 'Công việc' },
  { type: 'task.field', label: 'Trường dữ liệu thay đổi', about: 'Khi hạn chót, người thực hiện hoặc dịch vụ của công việc thay đổi.', icon: 'edit', scope: 'task', group: 'Công việc' },
  { type: 'task.comment', label: 'Có bình luận mới', about: 'Khi có người bình luận vào công việc.', icon: 'comment', scope: 'task', group: 'Công việc' },
  { type: 'task.overdue', label: 'Công việc quá hạn', about: 'Khi công việc chưa xong vừa qua hạn chót.', icon: 'clock', scope: 'task', group: 'Công việc' },
  { type: 'task.due_soon', label: 'Sắp đến hạn', about: 'Một số giờ trước hạn chót của công việc chưa xong.', icon: 'calendar', scope: 'task', group: 'Công việc' },
  { type: 'customer.created', label: 'Khách hàng mới', about: 'Khi có khách hàng mới được thêm.', icon: 'users', scope: 'customer', group: 'Khách hàng' },
  { type: 'customer.status', label: 'Khách hàng đổi trạng thái', about: 'Khi trạng thái của khách hàng thay đổi.', icon: 'tag', scope: 'customer', group: 'Khách hàng' },
  { type: 'customer.owner', label: 'Đổi người phụ trách khách', about: 'Khi khách hàng được giao cho người phụ trách khác.', icon: 'user', scope: 'customer', group: 'Khách hàng' },
  { type: 'schedule', label: 'Theo lịch', about: 'Hằng ngày, hằng tuần hoặc hằng tháng vào một giờ cố định (giờ Việt Nam).', icon: 'refresh', scope: 'none', group: 'Khác' },
  { type: 'webhook', label: 'Webhook gọi vào', about: 'Khi hệ thống khác (n8n, Zapier, Make…) gọi tới địa chỉ riêng của luật.', icon: 'link', scope: 'none', group: 'Khác' },
];
export const scopeOf = (t: TriggerType | undefined | null): Scope => TRIGGERS.find((x) => x.type === t)?.scope || 'none';
/** Triggers that happen to one task (kept for older callers). */
export const TASK_TRIGGERS: TriggerType[] = TRIGGERS.filter((t) => t.scope === 'task').map((t) => t.type);
export const WATCHED: [WatchedField, string][] = [['due', 'Hạn chót'], ['assignee', 'Người thực hiện'], ['service', 'Dịch vụ']];

export const CONDITION_FIELDS: { field: CondField; label: string; ops: CondOp[]; scope: Scope }[] = [
  { field: 'customer', label: 'Khách hàng', ops: ['is', 'not', 'empty', 'filled'], scope: 'task' },
  { field: 'service', label: 'Dịch vụ', ops: ['is', 'not', 'empty', 'filled'], scope: 'task' },
  { field: 'assignee', label: 'Người thực hiện', ops: ['is', 'not', 'empty', 'filled'], scope: 'task' },
  { field: 'stage', label: 'Bước', ops: ['is', 'not'], scope: 'task' },
  { field: 'due', label: 'Hạn chót', ops: ['is', 'not'], scope: 'task' },
  { field: 'title', label: 'Tên công việc', ops: ['contains', 'not'], scope: 'task' },
  { field: 'comment', label: 'Nội dung bình luận', ops: ['contains', 'not'], scope: 'task' },
  { field: 'c_status', label: 'Trạng thái khách', ops: ['is', 'not', 'empty', 'filled'], scope: 'customer' },
  { field: 'c_owner', label: 'Người phụ trách khách', ops: ['is', 'not', 'empty', 'filled'], scope: 'customer' },
  { field: 'c_name', label: 'Tên khách hàng', ops: ['contains', 'not'], scope: 'customer' },
];
/** The values of "Hạn chót" in a condition. */
export const DUE_VALUES: [string, string][] = [['overdue', 'Đã quá hạn'], ['today', 'Đến hạn hôm nay'], ['week', 'Trong 7 ngày tới'], ['none', 'Chưa có hạn']];
export const OP_LABEL: Record<CondOp, string> = { is: 'là', not: 'không phải', contains: 'có chứa', empty: 'đang trống', filled: 'đã có' };
export const conditionsFor = (scope: Scope) => CONDITION_FIELDS.filter((f) => f.scope === scope);

export const ACTIONS: { type: ActionType; label: string; about: string; icon: string; scope: Scope | 'any'; group: string }[] = [
  { type: 'if', label: 'Nếu / Thì', about: 'Rẽ hai nhánh: Đúng làm các bước này, Sai làm các bước kia.', icon: 'filter', scope: 'any', group: 'Logic' },
  { type: 'wait', label: 'Đợi, hẹn giờ', about: 'Chờ một khoảng thời gian (có thể chỉ tính giờ làm việc) rồi chạy tiếp.', icon: 'clock', scope: 'any', group: 'Logic' },
  { type: 'notify', label: 'Gửi thông báo', about: 'Thông báo trong app (và email nếu người nhận bật).', icon: 'bell', scope: 'any', group: 'Tin nhắn' },
  { type: 'comment', label: 'Thêm bình luận', about: 'Viết một bình luận vào công việc.', icon: 'comment', scope: 'task', group: 'Tin nhắn' },
  { type: 'webhook', label: 'Gọi webhook', about: 'Gửi dữ liệu (JSON) tới n8n, Zapier, Make, Slack… bằng POST.', icon: 'send', scope: 'any', group: 'Ứng dụng' },
  { type: 'assign', label: 'Giao việc', about: 'Đổi người thực hiện: cố định, chia vòng tròn, theo tỷ trọng hoặc người ít việc nhất.', icon: 'user', scope: 'task', group: 'Nhân sự' },
  { type: 'follow', label: 'Thêm người theo dõi', about: 'Thêm người vào danh sách theo dõi.', icon: 'eye', scope: 'task', group: 'Nhân sự' },
  { type: 'reviewer', label: 'Đặt người duyệt', about: 'Chọn người duyệt (REVIEW) cho công việc.', icon: 'check', scope: 'task', group: 'Nhân sự' },
  { type: 'customer_assign', label: 'Giao người phụ trách khách', about: 'Chia khách hàng cho người phụ trách: cố định, vòng tròn, tỷ trọng, ít việc nhất.', icon: 'user', scope: 'customer', group: 'Nhân sự' },
  { type: 'update_task', label: 'Cập nhật hạn chót', about: 'Đặt hạn chót sau N ngày, hoặc bỏ hạn.', icon: 'calendar', scope: 'task', group: 'Dữ liệu' },
  { type: 'flow', label: 'Chuyển bước quy trình', about: 'Giao việc (EXECUTION), nộp duyệt (REVIEW) hoặc duyệt PASS.', icon: 'arrow', scope: 'task', group: 'Dữ liệu' },
  { type: 'customer_status', label: 'Đổi trạng thái khách', about: 'Đặt trạng thái mới cho khách hàng.', icon: 'tag', scope: 'customer', group: 'Dữ liệu' },
  { type: 'create_task', label: 'Tạo công việc', about: 'Tạo một công việc mới (ví dụ việc lặp lại theo lịch).', icon: 'checklist', scope: 'any', group: 'Dữ liệu' },
];
export const actionsFor = (scope: Scope) => ACTIONS.filter((a) => a.scope === 'any' || a.scope === scope);
export const RECIPIENTS: Record<Scope, [string, string][]> = {
  task: [['assignees', 'Người thực hiện'], ['creator', 'Người tạo'], ['reviewer', 'Người duyệt'], ['followers', 'Người theo dõi'], ['owner', 'Người phụ trách khách']],
  customer: [['owner', 'Người phụ trách khách'], ['creator', 'Người tạo khách']],
  none: [],
};
export const ASSIGN_MODES: [AssignMode, string][] = [['fixed', 'Cố định (người đầu tiên)'], ['round_robin', 'Chia đều vòng tròn'], ['weighted', 'Theo tỷ trọng'], ['least', 'Người ít việc nhất']];
export const FLOW_MOVES: [NonNullable<Action['move']>, string][] = [['start', 'Giao việc → EXECUTION'], ['submit', 'Nộp duyệt → REVIEW'], ['pass', 'Duyệt PASS → COMPLETED']];
/** The {{…}} fields a text may hold, by what the rule works on. */
export const FIELDS: Record<Scope, [string, string][]> = {
  task: [['{{task.title}}', 'Tên công việc'], ['{{task.link}}', 'Link công việc'], ['{{task.due}}', 'Hạn chót'], ['{{task.stage}}', 'Bước hiện tại'], ['{{customer}}', 'Khách hàng'], ['{{service}}', 'Dịch vụ'], ['{{assignee}}', 'Người thực hiện']],
  customer: [['{{customer}}', 'Tên khách hàng'], ['{{customer.link}}', 'Link khách hàng'], ['{{customer.status}}', 'Trạng thái'], ['{{customer.owner}}', 'Người phụ trách']],
  none: [],
};
/** Paths name steps for statistics and waits: "2" (the third step), "2.t.0" (first of its Đúng branch), "2.e.1"… */
export const stepPath = (prefix: string, i: number, branch?: 't' | 'e') => (branch ? `${prefix}.${branch}.${i}` : prefix ? `${prefix}.${i}` : String(i));

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const ids = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => str(x, 64)).filter(Boolean).slice(0, 50);
const int = (v: unknown, min: number, max: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const pos = (v: unknown): Pos | undefined => (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n) && Math.abs(n) < 20000) ? [Math.round(v[0]), Math.round(v[1])] : undefined);
const time = (v: unknown, d: string) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : d);
const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : '');

function cleanConditions(list: unknown, scope: Scope): Condition[] {
  return (Array.isArray(list) ? list : []).slice(0, 20).flatMap((c: any) => {
    const f = CONDITION_FIELDS.find((x) => x.field === c?.field && x.scope === scope);
    if (!f || !f.ops.includes(c?.op)) return [];
    const value = str(c?.value, 200);
    return c.op === 'empty' || c.op === 'filled' ? [{ field: f.field, op: c.op, value: '' }] : value ? [{ field: f.field, op: c.op, value }] : [];
  });
}
/** One step's own fields, cleaned (none when it is not filled in enough to run). Branches are cleaned too, two deep. */
function cleanStep(a: any, scope: Scope, depth: number): Action[] {
  const def = ACTIONS.find((x) => x.type === a?.type);
  if (!def || (def.scope !== 'any' && def.scope !== scope)) return [];
  const p = pos(a.pos), people = ids(a.userIds?.length ? a.userIds : a.userId ? [a.userId] : []);
  const mode: AssignMode = ASSIGN_MODES.some(([m]) => m === a.mode) ? a.mode : 'fixed';
  const weights = people.map((_, i) => int(a.weights?.[i], 1, 100, 1));
  const one = (x: Action): Action[] => [{ ...x, pos: p }];
  switch (def.type) {
    case 'notify': {
      const roles = RECIPIENTS[scope].map(([k]) => k);
      const to = [...roles.filter((k) => a.to?.includes(k)), ...ids(a.to).filter((x) => !RECIPIENTS.task.some(([k]) => k === x))];
      return to.length && str(a.text, 200) ? one({ type: 'notify', to, text: str(a.text, 200), body: str(a.body, 2000) }) : [];
    }
    case 'comment': return str(a.text, 4000) ? one({ type: 'comment', text: str(a.text, 4000) }) : [];
    case 'assign': case 'customer_assign': return people.length ? one({ type: def.type, userIds: people, mode, weights: mode === 'weighted' ? weights : undefined }) : [];
    case 'reviewer': return str(a.userId, 64) ? one({ type: 'reviewer', userId: str(a.userId, 64) }) : [];
    case 'follow': return people.length ? one({ type: 'follow', userIds: people }) : [];
    case 'update_task': return one({ type: 'update_task', dueIn: a.dueIn === null || a.dueIn === '' || a.dueIn === undefined ? null : int(a.dueIn, 0, 365, 1) });
    case 'flow': return FLOW_MOVES.some(([m]) => m === a.move) ? one({ type: 'flow', move: a.move }) : [];
    case 'customer_status': return str(a.statusId, 64) ? one({ type: 'customer_status', statusId: str(a.statusId, 64) }) : [];
    case 'create_task': return str(a.text, 300) ? one({ type: 'create_task', text: str(a.text, 300), body: str(a.body, 4000), serviceId: str(a.serviceId, 64) || undefined, userId: str(a.userId, 64) || undefined, dueDays: a.dueDays === '' || a.dueDays == null ? undefined : int(a.dueDays, 0, 365, 1) }) : [];
    case 'webhook': { const url = str(a.url, 1000); return /^https:\/\/[^/\s]+\.[^/\s]+/i.test(url) ? one({ type: 'webhook', url }) : []; }
    case 'wait': return one({ type: 'wait', amount: int(a.amount, 1, 999, 1), unit: ['minutes', 'hours', 'days'].includes(a.unit) ? a.unit : 'hours', workHours: !!a.workHours });
    case 'if': {
      if (depth >= 2) return [];
      const conditions = cleanConditions(a.conditions, scope);
      if (!conditions.length) return [];
      const branch = (l: unknown) => (Array.isArray(l) ? l : []).slice(0, 20).flatMap((x) => cleanStep(x, scope, depth + 1));
      return one({ type: 'if', conditions, match: a.match === 'any' ? 'any' : 'all', then: branch(a.then), else: branch(a.else) });
    }
  }
}
/** A rule as sent by the editor, cleaned: unknown kinds dropped, lengths and numbers kept in range. Throws a message
 *  (Vietnamese) for what cannot be saved. */
export function cleanRule(b: any): RuleInput {
  const name = str(b?.name, 120);
  if (!name) throw new Error('Hãy đặt tên cho luật');
  const t = b?.trigger || {}, type = TRIGGERS.find((x) => x.type === t.type)?.type;
  if (!type) throw new Error('Hãy chọn kích hoạt');
  const trigger: Trigger = { type, pos: pos(t.pos) };
  if (type === 'task.stage' || type === 'customer.status') trigger.to = str(t.to, 64);
  if (type === 'task.field') trigger.field = WATCHED.some(([f]) => f === t.field) ? t.field : 'due';
  if (type === 'task.due_soon') trigger.hours = int(t.hours, 1, 720, 24);
  if (type === 'schedule') {
    trigger.every = ['day', 'week', 'month'].includes(t.every) ? t.every : 'day';
    trigger.at = time(t.at, '08:00');
    if (trigger.every === 'week') trigger.weekday = int(t.weekday, 1, 7, 1);
    if (trigger.every === 'month') trigger.monthday = int(t.monthday, 1, 28, 1);
  }
  if (type === 'webhook' && t.secret) trigger.secret = str(t.secret, 64);
  const scope = scopeOf(type), conditions = cleanConditions(b?.conditions, scope);
  const actions = (Array.isArray(b?.actions) ? b.actions : []).slice(0, 30).flatMap((a: any) => cleanStep(a, scope, 0));
  if (!actions.some((a: Action) => a.type !== 'wait')) throw new Error('Hãy thêm ít nhất một hành động đã điền đủ (webhook phải là địa chỉ https://)');
  return { name, enabled: b?.enabled !== false, trigger, conditions, actions, match: b?.match === 'any' ? 'any' : 'all', once: !!b?.once, workHoursOnly: !!b?.workHoursOnly, filterPos: conditions.length ? pos(b?.filterPos) : undefined };
}
export function cleanSettings(b: any): AutomationSettings {
  const days = (Array.isArray(b?.days) ? b.days : []).map(Number).filter((d: number) => d >= 1 && d <= 7);
  const leaves = (Array.isArray(b?.leaves) ? b.leaves : []).slice(0, 200).flatMap((l: any) => {
    const userId = str(l?.userId, 64), from = day(l?.from), to = day(l?.to) || from;
    return userId && from ? [{ userId, from, to: to < from ? from : to }] : [];
  });
  return { days: [...new Set<number>(days)].sort(), start: time(b?.start, DEFAULT_SETTINGS.start), end: time(b?.end, DEFAULT_SETTINGS.end), leaves };
}
