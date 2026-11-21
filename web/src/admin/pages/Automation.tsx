// Quản trị › Tự động hoá, laid out like n8n with Bizfly CRM's rule blocks: a list of rules (like n8n's workflow list:
// name, when it changed, its next or last run, a switch, a "…" menu), Cài đặt chung (working hours, who is on leave),
// and, opened full screen, the rule's canvas: a dotted grid with its steps as nodes joined by lines (trigger → filter
// → steps; an "if" splits into Đúng / Sai), nodes dragged anywhere, a + at the end of each line to add a step, a node
// opening its details in three panes (fields to insert, parameters, output), each node's counts of runs, and the run
// history and waiting runs as their own tabs. Rules are shared/automation.ts, run by server/automation.ts as whoever
// saved them last, with their rights.
import { Fragment, useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/ui';
import { Pop } from '../../components/boardkit';
import { askConfirm, askText } from '../../components/AskDialog';
import { openLink, openTask, toast } from '../../store';
import { admin } from '../api';
import { PageHead, Empty, Async, useLoad, act, useCan, fmtTime, fmtAgo, Drawer } from '../kit';
import {
  ACTIONS, ASSIGN_MODES, DUE_VALUES, FIELDS, FLOW_MOVES, OP_LABEL, RECIPIENTS, TRIGGERS, WATCHED, actionsFor, conditionsFor, scopeOf,
  type Action, type ActionType, type AutomationSettings, type Condition, type Match, type Pos, type Rule, type RuleInput, type RuleJob, type RuleRun, type Scope, type StepStats, type Trigger, type TriggerType,
} from '../../../../shared/automation';
import { FLOW_STAGES } from '../../../../shared/task-flow';

type Ref = { id: string; name: string };
type Lists = { people: Ref[]; customers: Ref[]; services: Ref[]; statuses: (Ref & { color: string })[]; settings: AutomationSettings };
type Draft = Omit<RuleInput, 'trigger'> & { id?: string; trigger: Trigger | null };
const WEEKDAYS = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];
const hookUrl = (secret?: string) => (secret ? `${location.origin}/api/automation/hooks/${secret}` : '');
/** Each kind of step's colour, as n8n gives each node its own. */
const TONE: Record<string, string> = { trigger: '#ff6d5a', filter: '#f59f00', if: '#f59f00', wait: '#64748b', notify: '#0b7df2', comment: '#7c3aed', assign: '#16a34a', follow: '#0891b2', reviewer: '#9333ea', update_task: '#0d9488', flow: '#2563eb', create_task: '#ea580c', customer_assign: '#16a34a', customer_status: '#db2777', webhook: '#475569' };
const iconOfTrigger = (t: TriggerType) => TRIGGERS.find((x) => x.type === t)!.icon;
const iconOfAction = (t: ActionType) => ACTIONS.find((x) => x.type === t)!.icon;

/** Ready-made rules: picking one opens its canvas filled in. */
const TEMPLATES: { title: string; about: string; rule: RuleInput }[] = [
  { title: 'Chia khách mới cho sale (vòng tròn)', about: 'Khách hàng mới → Nếu chưa có người phụ trách → Giao người phụ trách', rule: { name: 'Chia khách mới cho sale', enabled: true, once: true, trigger: { type: 'customer.created' }, conditions: [], actions: [{ type: 'if', match: 'all', conditions: [{ field: 'c_owner', op: 'empty', value: '' }], then: [{ type: 'customer_assign', mode: 'round_robin', userIds: [] }], else: [] }, { type: 'notify', to: ['owner'], text: 'Bạn được giao khách mới: {{customer}}' }] } },
  { title: 'Báo người duyệt khi việc sang REVIEW', about: 'Chuyển bước → Gửi thông báo', rule: { name: 'Báo người duyệt khi việc chờ duyệt', enabled: true, trigger: { type: 'task.stage', to: 'review' }, conditions: [], actions: [{ type: 'notify', to: ['reviewer'], text: 'Việc chờ bạn duyệt: {{task.title}}', body: '{{customer}} · {{service}}' }] } },
  { title: 'Nhắc lại nếu chưa giao sau 1 ngày', about: 'Việc mới → Đợi 8 giờ làm việc → Nếu vẫn ACCOUNT → Báo', rule: { name: 'Nhắc việc chưa giao', enabled: true, trigger: { type: 'task.created' }, conditions: [], actions: [{ type: 'wait', amount: 8, unit: 'hours', workHours: true }, { type: 'if', match: 'all', conditions: [{ field: 'stage', op: 'is', value: 'account' }], then: [{ type: 'notify', to: ['creator'], text: 'Việc chưa được giao sau 1 ngày: {{task.title}}' }], else: [] }] } },
  { title: 'Nhắc 24 giờ trước hạn', about: 'Sắp đến hạn → Gửi thông báo', rule: { name: 'Nhắc trước hạn 24 giờ', enabled: true, trigger: { type: 'task.due_soon', hours: 24 }, conditions: [], actions: [{ type: 'notify', to: ['assignees'], text: 'Sắp đến hạn: {{task.title}}', body: 'Hạn {{task.due}}' }] } },
  { title: 'Việc quá hạn: báo và gia hạn', about: 'Quá hạn → Báo → Gia hạn 2 ngày', rule: { name: 'Xử lý việc quá hạn', enabled: true, trigger: { type: 'task.overdue' }, conditions: [], actions: [{ type: 'notify', to: ['assignees', 'creator'], text: 'Quá hạn: {{task.title}}', body: 'Đã tự gia hạn thêm 2 ngày' }, { type: 'update_task', dueIn: 2 }] } },
  { title: 'Gửi việc mới sang n8n', about: 'Công việc được tạo → Webhook', rule: { name: 'Gửi việc mới sang n8n', enabled: true, trigger: { type: 'task.created' }, conditions: [], actions: [{ type: 'webhook', url: 'https://' }] } },
  { title: 'Việc lặp lại mỗi thứ Hai', about: 'Theo lịch → Tạo công việc', rule: { name: 'Báo cáo tuần', enabled: true, trigger: { type: 'schedule', every: 'week', weekday: 1, at: '08:30' }, conditions: [], actions: [{ type: 'create_task', text: 'Báo cáo tuần', dueDays: 4 }] } },
];

// ================================================================ the list
export function AutomationRules() {
  const load = useLoad(() => admin.automation(), []);
  const can = useCan()('automation.manage');
  const [open, setOpen] = useState<{ rule: Draft; tab: Tab } | null>(null), [conf, setConf] = useState(false);
  const blank: Draft = { name: 'Luật mới', enabled: true, trigger: null, conditions: [], actions: [] };
  return (
    <>
      <PageHead title="Tự động hoá" sub="Luật tự động cho toàn hệ thống: kích hoạt → điều kiện → các bước (nếu/thì, đợi, hành động). Hành động chạy bằng quyền của người lưu luật."
        actions={<>
          <a className="btn btn-gray btn-sm" href="#help/tu-dong-hoa-khai-niem"><Icon name="info" size={14} />Hướng dẫn</a>
          <button className="btn btn-gray btn-sm" onClick={() => setConf(true)}><Icon name="gear" size={14} />Cài đặt chung</button>
          {can && <button className="btn btn-primary btn-sm" onClick={() => setOpen({ rule: blank, tab: 'editor' })}><Icon name="plus" size={14} />Tạo luật</button>}
        </>} />
      <Async load={load}>{(d) => (
        <>
          {d.rules.length > 0 ? <div className="n8-list">{d.rules.map((r) => (
            <RuleRow key={r.id} r={r} can={can} onOpen={(tab) => setOpen({ rule: r, tab })} onCopy={() => setOpen({ rule: { ...structuredClone(r), id: undefined, name: `${r.name} (bản sao)` }, tab: 'editor' })} reload={load.reload} />
          ))}</div> : !can && <Empty icon="refresh" title="Chưa có luật tự động nào" />}
          {can && <section className="n8-templates">
            <h3>{d.rules.length ? 'Mẫu' : 'Bắt đầu từ một mẫu'}</h3>
            <div>{TEMPLATES.map((t) => (
              <button key={t.title} type="button" onClick={() => setOpen({ rule: structuredClone(t.rule), tab: 'editor' })}>
                <Mini r={t.rule} />
                <b>{t.title}</b><small>{t.about}</small>
              </button>
            ))}</div>
          </section>}
          {open && <Workflow rule={open.rule} tab={open.tab} lists={d} can={can} onClose={() => setOpen(null)} onSaved={() => void load.reload()} />}
          {conf && <SettingsDrawer s={d.settings} people={d.people} can={can} onClose={() => setConf(false)} onSaved={() => { setConf(false); void load.reload(); }} />}
        </>
      )}</Async>
    </>
  );
}
/** A rule's blocks as small coloured icons. */
function Mini({ r }: { r: RuleInput }) {
  const flat = (l: Action[]): Action[] => l.flatMap((a) => [a, ...(a.type === 'if' ? [...flat(a.then || []), ...flat(a.else || [])] : [])]);
  return (
    <span className="n8-mini">
      <i style={{ background: TONE.trigger }}><Icon name={iconOfTrigger(r.trigger.type)} size={12} /></i>
      {r.conditions.length > 0 && <i style={{ background: TONE.filter }}><Icon name="filter" size={12} /></i>}
      {flat(r.actions).slice(0, 8).map((a, i) => <i key={i} style={{ background: TONE[a.type] }}><Icon name={iconOfAction(a.type)} size={12} /></i>)}
    </span>
  );
}

function RuleRow({ r, can, onOpen, onCopy, reload }: { r: Rule; can: boolean; onOpen: (tab: Tab) => void; onCopy: () => void; reload: () => void }) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const scope = scopeOf(r.trigger.type);
  const backfill = async () => {
    if (!await askConfirm(`Chạy luật “${r.name}” cho ${scope === 'task' ? 'các công việc đang mở' : 'các khách hàng'} có sẵn (tối đa 300, theo điều kiện của luật)?`, { confirmLabel: 'Chạy' })) return;
    await act(async () => { const x = await admin.backfillAutomation(r.id); toast(`Đã xét ${x.checked}, chạy ${x.ran}${x.failed ? `, lỗi ${x.failed}` : ''}`, !!x.failed); }, undefined, reload);
  };
  return (
    <div className="n8-row" onClick={() => onOpen('editor')}>
      <div className="n8-row-main">
        <b>{r.name}</b>
        <small>
          {summary(r.trigger)} · Cập nhật {fmtAgo(r.updatedAt)}
          {r.nextRunAt ? ` · Lần tới ${fmtTime(r.nextRunAt)}` : r.lastRunAt ? ` · Chạy ${fmtAgo(r.lastRunAt)}` : ''}
          {r.waiting > 0 && <> · <em className="wait">{r.waiting} đang chờ</em></>}
          {r.lastOk === false && <> · <em>lần cuối lỗi</em></>}
        </small>
      </div>
      <Mini r={r} />
      <label className="n8-active" onClick={(e) => e.stopPropagation()} title={r.enabled ? 'Đang bật' : 'Đang tắt'}>
        <span>{r.enabled ? 'Đang bật' : 'Tắt'}</span>
        <span className="n8-switch"><input type="checkbox" checked={r.enabled} disabled={!can} onChange={() => act(() => admin.saveAutomation(r.id, { enabled: !r.enabled }), r.enabled ? 'Đã tắt luật' : 'Đã bật luật', reload)} /><i /></span>
      </label>
      <button type="button" className="bd-icon" onClick={(e) => { e.stopPropagation(); setMenu(menu ? null : e.currentTarget); }} aria-label={`Thao tác với luật ${r.name}`}><Icon name="more" size={16} /></button>
      {menu && <Pop anchor={menu} title={r.name} onClose={() => setMenu(null)} width={240}><div className="bk-menu" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => { setMenu(null); onOpen('editor'); }}><Icon name="edit" size={16} />Mở</button>
        <button onClick={() => { setMenu(null); onOpen('runs'); }}><Icon name="lines" size={16} />Lịch sử chạy</button>
        {r.waiting > 0 && <button onClick={() => { setMenu(null); onOpen('jobs'); }}><Icon name="clock" size={16} />Đang chờ ({r.waiting})</button>}
        {can && <button onClick={() => { setMenu(null); void testRule(r, reload); }}><Icon name="play" size={16} />Chạy thử</button>}
        {can && scope !== 'none' && <button onClick={() => { setMenu(null); void backfill(); }}><Icon name="refresh" size={16} />Chạy cho dữ liệu có sẵn</button>}
        {can && <button onClick={() => { setMenu(null); onCopy(); }}><Icon name="copy" size={16} />Nhân bản</button>}
        {can && <button className="bk-danger-link" onClick={async () => { setMenu(null); if (await askConfirm(`Xoá luật “${r.name}”?`)) await act(() => admin.deleteAutomation(r.id), 'Đã xoá luật', reload); }}><Icon name="trash" size={16} />Xoá</button>}
      </div></Pop>}
    </div>
  );
}

/** Chạy thử: a rule on a task or customer asks which one (its id or link). */
async function testRule(r: { id: string; trigger: Trigger }, after?: () => void) {
  const scope = scopeOf(r.trigger.type);
  let recordId: string | undefined;
  if (scope !== 'none') {
    const v = await askText(scope === 'task' ? 'Chạy thử trên công việc nào? Dán mã (tk_…) hoặc link của công việc.' : 'Chạy thử trên khách hàng nào? Dán mã (c_…) hoặc link của khách hàng.', '', { required: true, placeholder: scope === 'task' ? 'tk_… hoặc link' : 'c_… hoặc link' });
    if (v === null) return;
    recordId = (scope === 'task' ? v.match(/tk_[a-z0-9]+/i) : v.match(/(?:cust|c)_[a-z0-9]+/i))?.[0];
    if (!recordId) { toast(scope === 'task' ? 'Không thấy mã công việc (tk_…)' : 'Không thấy mã khách hàng (c_…)', true); return; }
  }
  await act(async () => { const res = await admin.testAutomation(r.id, recordId); toast(res?.ok ? `Chạy thành công: ${res.message}` : `Chạy lỗi: ${res?.message || ''}`, !res?.ok); }, undefined, after);
}

function summary(t: Trigger) {
  const label = TRIGGERS.find((x) => x.type === t.type)!.label;
  if (t.type === 'task.stage') return t.to ? `Chuyển sang ${FLOW_STAGES.find((s) => s.key === t.to)?.code || t.to}` : label;
  if (t.type === 'task.field') return `${WATCHED.find(([f]) => f === t.field)?.[1] || 'Hạn chót'} thay đổi`;
  if (t.type === 'task.due_soon') return `${t.hours || 24} giờ trước hạn`;
  if (t.type === 'schedule') return `${t.every === 'week' ? `Mỗi ${WEEKDAYS[(t.weekday || 1) - 1]}` : t.every === 'month' ? `Ngày ${t.monthday || 1} hằng tháng` : 'Hằng ngày'} lúc ${t.at || '08:00'}`;
  return label;
}
const nameOf = (list: Ref[], id?: string) => list.find((x) => x.id === id)?.name || 'đã chọn';
function actionSummary(a: Action, l: Lists, scope: Scope) {
  const people = (ids?: string[]) => (ids?.length ? ids.map((id) => nameOf(l.people, id)).join(', ') : 'Chưa chọn người');
  switch (a.type) {
    case 'notify': return (a.to || []).length ? `Báo ${(a.to || []).map((k) => RECIPIENTS[scope].find(([r]) => r === k)?.[1]?.toLowerCase() || nameOf(l.people, k)).join(', ')}` : 'Chưa chọn người nhận';
    case 'assign': case 'customer_assign': return `${ASSIGN_MODES.find(([m]) => m === (a.mode || 'fixed'))![1]}: ${people(a.userIds)}`;
    case 'reviewer': return a.userId ? nameOf(l.people, a.userId) : 'Chưa chọn người';
    case 'follow': return people(a.userIds);
    case 'update_task': return a.dueIn == null ? 'Bỏ hạn chót' : `Hạn sau ${a.dueIn} ngày`;
    case 'flow': return FLOW_MOVES.find(([m]) => m === a.move)?.[1] || 'Chưa chọn bước';
    case 'customer_status': return a.statusId ? nameOf(l.statuses, a.statusId) : 'Chưa chọn trạng thái';
    case 'create_task': return a.text ? `“${a.text}”` : 'Chưa đặt tên việc';
    case 'webhook': try { return new URL(a.url || '').host || 'POST'; } catch { return 'POST'; }
    case 'comment': return a.text ? `“${a.text.slice(0, 24)}${a.text.length > 24 ? '…' : ''}”` : 'Chưa viết nội dung';
    case 'wait': return `${a.amount || 1} ${a.unit === 'minutes' ? 'phút' : a.unit === 'days' ? 'ngày' : 'giờ'}${a.workHours ? ' làm việc' : ''}`;
    case 'if': return `${(a.conditions || []).length} điều kiện`;
  }
}

/** Cài đặt chung (Bizfly's Thời gian làm việc and Danh sách nghỉ): working days and hours, and who is on leave. */
function SettingsDrawer({ s, people, can, onClose, onSaved }: { s: AutomationSettings; people: Ref[]; can: boolean; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<AutomationSettings>(() => structuredClone(s));
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  return (
    <Drawer open title="Cài đặt chung" sub="Dùng cho bước Đợi (giờ làm việc), luật chỉ chạy trong giờ làm việc và khi chia việc." onClose={onClose}
      footer={can ? <><button className="btn btn-gray btn-sm" onClick={onClose}>Huỷ</button><button className="btn btn-primary btn-sm" onClick={() => act(() => admin.saveAutomationSettings(v), 'Đã lưu cài đặt', onSaved)}>Lưu</button></> : undefined}>
      <fieldset className="n8-set" disabled={!can}>
        <h4>Ngày làm việc</h4>
        <div className="n8-days">{WEEKDAYS.map((w, i) => (
          <label key={w} className={v.days.includes(i + 1) ? 'on' : ''}><input type="checkbox" checked={v.days.includes(i + 1)} onChange={() => setV({ ...v, days: v.days.includes(i + 1) ? v.days.filter((d) => d !== i + 1) : [...v.days, i + 1].sort() })} />{w.replace('Thứ ', 'T').replace('Chủ nhật', 'CN')}</label>
        ))}</div>
        <h4>Giờ làm việc</h4>
        <div className="n8-hours"><input className="bk-in" type="time" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} /> đến <input className="bk-in" type="time" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} /> (giờ Việt Nam)</div>
        <h4>Danh sách nghỉ</h4>
        <p className="n8-note">Người đang nghỉ không được chia việc hay khách hàng tự động.</p>
        {v.leaves.map((l, i) => (
          <div key={i} className="n8-leave">
            <select className="bk-in" value={l.userId} onChange={(e) => setV({ ...v, leaves: v.leaves.map((x, j) => (j === i ? { ...x, userId: e.target.value } : x)) })}><option value="">Chọn người…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <input className="bk-in" type="date" value={l.from} onChange={(e) => setV({ ...v, leaves: v.leaves.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} />
            <input className="bk-in" type="date" value={l.to} onChange={(e) => setV({ ...v, leaves: v.leaves.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} />
            <button type="button" className="bd-icon" onClick={() => setV({ ...v, leaves: v.leaves.filter((_, j) => j !== i) })} aria-label="Bỏ"><Icon name="x" size={14} /></button>
          </div>
        ))}
        <button type="button" className="n8-add-sm" onClick={() => setV({ ...v, leaves: [...v.leaves, { userId: '', from: today, to: today }] })}><Icon name="plus" size={13} />Thêm ngày nghỉ</button>
      </fieldset>
    </Drawer>
  );
}

// ================================================================ steps by path
// A step's path: "2" (third top step), "2.t.0" (first step of its Đúng branch), "2.e.1"… A list's path: "" (top),
// "2.t", "2.e". The same paths name each step's counts on the server.
const split = (path: string) => { const parts = path.split('.'); return { list: parts.slice(0, -1).join('.'), i: Number(parts[parts.length - 1]) }; };
function listAt(actions: Action[], listPath: string): Action[] {
  if (!listPath) return actions;
  const parts = listPath.split('.');
  let list = actions;
  for (let k = 0; k < parts.length; k += 2) { const step = list[Number(parts[k])]; list = (parts[k + 1] === 't' ? step?.then : step?.else) || []; }
  return list;
}
function withList(actions: Action[], listPath: string, fn: (l: Action[]) => Action[]): Action[] {
  if (!listPath) return fn(actions);
  const parts = listPath.split('.'), i = Number(parts[0]), key = parts[1] === 't' ? 'then' : 'else', rest = parts.slice(2).join('.');
  return actions.map((a, j) => (j === i ? { ...a, [key]: withList(a[key] || [], rest, fn) } : a));
}
const stepAt = (actions: Action[], path: string) => { const p = split(path); return listAt(actions, p.list)[p.i]; };
const withStep = (actions: Action[], path: string, fn: (a: Action) => Action) => { const p = split(path); return withList(actions, p.list, (l) => l.map((a, j) => (j === p.i ? fn(a) : a))); };

// ================================================================ the canvas
type Tab = 'editor' | 'runs' | 'jobs';
type NodeRef = { kind: 'trigger' } | { kind: 'filter' } | { kind: 'step'; path: string };
type CNode = { key: string; ref: NodeRef; pos: Pos; isIf?: boolean };
type Edge = { from: string; port?: 't' | 'e'; to: string; insert?: { list: string; at: number } };
type Plus = { key: string; from: string; port?: 't' | 'e'; list: string; at: number };
const W = 100, GAP = 120, X0 = 120, BRANCH = 150;

/** Where every node goes (dragged ones where they were left, the rest in rows: an "if" opens Đúng above and Sai below),
 *  the lines between them, and the + at the end of each line. */
function layout(r: Draft) {
  const nodes: CNode[] = [], edges: Edge[] = [], pluses: Plus[] = [];
  if (!r.trigger) return { nodes, edges, pluses };
  nodes.push({ key: 'trigger', ref: { kind: 'trigger' }, pos: r.trigger.pos || [X0, 100] });
  let x = X0 + W + GAP, exits: { from: string; port?: 't' | 'e' }[] = [{ from: 'trigger' }];
  if (r.conditions.length) { nodes.push({ key: 'filter', ref: { kind: 'filter' }, pos: r.filterPos || [x, 100] }); edges.push({ from: 'trigger', to: 'filter' }); exits = [{ from: 'filter' }]; x += W + GAP; }
  const walk = (list: Action[], listPath: string, x0: number, y: number, entries: { from: string; port?: 't' | 'e' }[]): { exits: typeof entries; width: number } => {
    let at = x0, cur = entries, width = 0;
    list.forEach((a, i) => {
      const path = listPath ? `${listPath}.${i}` : String(i);
      nodes.push({ key: path, ref: { kind: 'step', path }, pos: a.pos || [at, y], isIf: a.type === 'if' });
      for (const e of cur) edges.push({ ...e, to: path, insert: cur.length === 1 && !e.port && i > 0 ? { list: listPath, at: i } : undefined });
      if (a.type === 'if') {
        const t = walk(a.then || [], `${path}.t`, at + W + GAP, y - BRANCH, [{ from: path, port: 't' }]);
        const e = walk(a.else || [], `${path}.e`, at + W + GAP, y + BRANCH, [{ from: path, port: 'e' }]);
        cur = [...t.exits, ...e.exits];
        const span = Math.max(t.width, e.width, W + GAP);
        at += W + GAP + span; width += W + GAP + span;
      } else { cur = [{ from: path }]; at += W + GAP; width += W + GAP; }
    });
    // The + at the end of this line adds a step to it.
    if (!list.length) for (const e of entries) pluses.push({ key: `${listPath}|${e.from}|${e.port || ''}`, from: e.from, port: e.port, list: listPath, at: 0 });
    else if (cur.length === 1) pluses.push({ key: `${listPath}|${cur[0].from}|`, from: cur[0].from, list: listPath, at: list.length });
    return { exits: cur, width };
  };
  const top = walk(r.actions, '', x, 100, exits);
  if (r.actions.length && top.exits.length > 1) pluses.push({ key: '|end', from: '', list: '', at: r.actions.length });
  return { nodes, edges, pluses };
}

function Workflow({ rule, tab: tab0, lists, can, onClose, onSaved }: { rule: Draft; tab: Tab; lists: Lists; can: boolean; onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState<Draft>(() => structuredClone(rule));
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [opts, setOpts] = useState(false);
  const [tab, setTab] = useState(tab0), [node, setNode] = useState<NodeRef | null>(null), [creator, setCreator] = useState<{ list: string; at: number; first?: boolean } | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const [runs, setRuns] = useState<RuleRun[] | null>(null), [stats, setStats] = useState<StepStats>({}), [jobs, setJobs] = useState<RuleJob[] | null>(null);
  const refresh = () => {
    if (!r.id) { setRuns([]); setJobs([]); return; }
    admin.automationRuns(r.id).then(setRuns, () => setRuns([]));
    admin.automationStats(r.id).then((x) => { setStats(x.stats); setJobs(x.jobs); }, () => setJobs([]));
  };
  useEffect(refresh, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (p: Partial<Draft>) => { setR((x) => ({ ...x, ...p })); setDirty(true); };
  const scope = scopeOf(r.trigger?.type);
  const owner = 'owner' in rule ? (rule as Rule).owner : null;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open], .bk-pop, .n8-ndv, .n8-creator, .n8-opts')) void close(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  });
  const close = async () => { if (!dirty || await askConfirm('Đóng mà không lưu các thay đổi?', { confirmLabel: 'Đóng' })) onClose(); };
  const save = async (): Promise<string | null> => {
    if (!r.trigger) { toast('Hãy thêm bước kích hoạt', true); return null; }
    setBusy(true);
    let id: string | null = null;
    await act(async () => { const saved = await (r.id ? admin.saveAutomation(r.id, r as RuleInput) : admin.createAutomation(r as RuleInput)) as Rule; id = saved.id; setR((x) => ({ ...x, id: saved.id, trigger: saved.trigger })); setDirty(false); onSaved(); }, 'Đã lưu luật');
    setBusy(false);
    return id;
  };
  const run = async () => { const id = dirty || !r.id ? await save() : r.id; if (id && r.trigger) await testRule({ id, trigger: r.trigger }, () => { refresh(); onSaved(); }); };

  const { nodes, edges, pluses } = layout(r);
  const posOf = (k: string): Pos => nodes.find((n) => n.key === k)?.pos || [X0, 100];
  const setPos = (ref: NodeRef, p: Pos) => setR((x) => (ref.kind === 'trigger' ? { ...x, trigger: x.trigger && { ...x.trigger, pos: p } } : ref.kind === 'filter' ? { ...x, filterPos: p } : { ...x, actions: withStep(x.actions, ref.path, (a) => ({ ...a, pos: p })) }));
  /** The first drag pins every node where it shows, so the ones still in their rows do not slide under it. */
  const pinAll = () => setR((x) => {
    let actions = x.actions;
    for (const n of nodes) if (n.ref.kind === 'step') { const at = n.pos; actions = withStep(actions, n.ref.path, (a) => ({ ...a, pos: a.pos || at })); }
    return { ...x, actions, trigger: x.trigger && { ...x.trigger, pos: x.trigger.pos || posOf('trigger') }, filterPos: x.conditions.length ? x.filterPos || posOf('filter') : x.filterPos };
  });
  const tidy = () => {
    const clear = (l: Action[]): Action[] => l.map((a) => ({ ...a, pos: undefined, ...(a.type === 'if' ? { then: clear(a.then || []), else: clear(a.else || []) } : {}) }));
    set({ trigger: r.trigger && { ...r.trigger, pos: undefined }, filterPos: undefined, actions: clear(r.actions) });
  };
  const add = (type: string, list: string, at: number, first: boolean, near: Pos) => {
    setCreator(null);
    if (first) { const t = type as TriggerType; set({ trigger: { type: t, pos: [X0, 100] }, ...(scopeOf(t) === scope ? {} : { conditions: [], actions: [] }) }); setNode({ kind: 'trigger' }); return; }
    if (type === 'filter') { const f = conditionsFor(scope)[0]; set({ conditions: [{ field: f.field, op: f.ops[0], value: '' }], filterPos: near }); setNode({ kind: 'filter' }); return; }
    const step: Action = { ...blank(type as ActionType, scope), pos: near };
    set({ actions: withList(r.actions, list, (l) => [...l.slice(0, at), step, ...l.slice(at)]) });
    setNode({ kind: 'step', path: list ? `${list}.${at}` : String(at) });
  };
  const remove = (n: NodeRef) => {
    setNode(null);
    if (n.kind === 'trigger') set({ trigger: null });
    else if (n.kind === 'filter') set({ conditions: [], filterPos: undefined });
    else { const p = split(n.path); set({ actions: withList(r.actions, p.list, (l) => l.filter((_, j) => j !== p.i)) }); }
  };
  const move = (path: string, by: number) => {
    const p = split(path), l = listAt(r.actions, p.list), to = p.i + by;
    if (to < 0 || to >= l.length) return;
    set({ actions: withList(r.actions, p.list, (x) => { const c = [...x], [s] = c.splice(p.i, 1); c.splice(to, 0, s); return c; }) });
    setNode({ kind: 'step', path: p.list ? `${p.list}.${to}` : String(to) });
  };

  // Dragging the grid moves the canvas; dragging a node moves it (on the grid, 10px steps); a click opens it.
  const pan = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('.n8-node, .n8-plus, .n8-edge-plus, .n8-zoom, .n8-run, .n8-creator')) return;
    const sx = e.clientX - view.x, sy = e.clientY - view.y;
    const mv = (ev: PointerEvent) => setView((v) => ({ ...v, x: ev.clientX - sx, y: ev.clientY - sy }));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const grab = (n: CNode) => (e: ReactPointerEvent) => {
    if (e.button) return;
    const p0 = n.pos, x0 = e.clientX, y0 = e.clientY;
    let moved = false;
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / view.z, dy = (ev.clientY - y0) / view.z;
      if (!moved && (Math.hypot(dx, dy) < 4 || !can)) return;
      if (!moved) pinAll();
      moved = true;
      setPos(n.ref, [Math.round((p0[0] + dx) / 10) * 10, Math.round((p0[1] + dy) / 10) * 10]);
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (moved) setDirty(true); else setNode(n.ref); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  // An "if" has two outputs: Đúng above, Sai below.
  const outAt = (k: string, port?: 't' | 'e'): Pos => { const p = posOf(k); return [p[0] + W, p[1] + (port === 't' ? 28 : port === 'e' ? 72 : 50)]; };
  const inAt = (k: string): Pos => { const p = posOf(k); return [p[0], p[1] + 50]; };
  const curve = (a: Pos, b: Pos) => { const d = Math.max(40, Math.abs(b[0] - a[0]) / 2); return `M${a[0]} ${a[1]} C${a[0] + d} ${a[1]}, ${b[0] - d} ${b[1]}, ${b[0]} ${b[1]}`; };
  const farRight = Math.max(...nodes.map((n) => n.pos[0]), X0);
  const plusAt = (p: Plus): Pos => (p.from ? [outAt(p.from, p.port)[0] + 56, outAt(p.from, p.port)[1]] : [farRight + W + 60, 150]);
  const portLabel = (from: string, port: 't' | 'e', key: string) => {
    const a = outAt(from, port), n = stats[`${from}.${port}`]?.ok;
    return <span key={key} className={'n8-port-label p-' + port} style={{ left: a[0] + 8, top: a[1] + (port === 't' ? -20 : 4) }}>{port === 't' ? 'Đúng' : 'Sai'}{n ? ` · ${n}` : ''}</span>;
  };
  const ports = [...edges.filter((e) => e.port).map((e) => [e.from, e.port!] as const), ...pluses.filter((p) => p.port).map((p) => [p.from, p.port!] as const)]
    .filter(([f, p], i, l) => l.findIndex(([f2, p2]) => f2 === f && p2 === p) === i);

  return createPortal(
    <div className="n8">
      <header className="n8-top">
        <button type="button" className="bd-icon" onClick={() => void close()} aria-label="Quay lại danh sách"><Icon name="left" size={18} /></button>
        <input className="n8-name" value={r.name} onChange={(e) => set({ name: e.target.value })} aria-label="Tên luật" disabled={!can} />
        {dirty && <span className="n8-dirty">Chưa lưu</span>}
        <nav className="n8-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'editor'} className={tab === 'editor' ? 'on' : ''} onClick={() => setTab('editor')}>Trình soạn</button>
          <button role="tab" aria-selected={tab === 'runs'} className={tab === 'runs' ? 'on' : ''} onClick={() => { setTab('runs'); refresh(); }}>Lịch sử chạy</button>
          <button role="tab" aria-selected={tab === 'jobs'} className={tab === 'jobs' ? 'on' : ''} onClick={() => { setTab('jobs'); refresh(); }}>Đang chờ{jobs?.length ? ` (${jobs.length})` : ''}</button>
        </nav>
        <div className="n8-opts-wrap">
          <button type="button" className={'bd-icon' + (opts ? ' on' : '')} onClick={() => setOpts(!opts)} title="Tuỳ chọn của luật" aria-expanded={opts}><Icon name="gear" size={16} /></button>
          {opts && <div className="n8-opts" role="dialog" aria-label="Tuỳ chọn của luật">
            <b>Tuỳ chọn</b>
            {scope !== 'none' && <label><input type="checkbox" checked={!!r.once} disabled={!can} onChange={() => set({ once: !r.once })} /><span>Mỗi {scope === 'customer' ? 'khách hàng' : 'công việc'} chỉ chạy một lần<small>Bản ghi đã chạy luật này sẽ không chạy lại.</small></span></label>}
            <label><input type="checkbox" checked={!!r.workHoursOnly} disabled={!can} onChange={() => set({ workHoursOnly: !r.workHoursOnly })} /><span>Chỉ chạy trong giờ làm việc<small>Kích hoạt ngoài giờ sẽ chờ tới giờ làm việc kế tiếp ({lists.settings.start}–{lists.settings.end}).</small></span></label>
            <small className="n8-note">Hành động chạy bằng quyền của {owner ? owner.name : 'người lưu luật'}.</small>
          </div>}
        </div>
        <label className="n8-active"><span>{r.enabled ? 'Đang bật' : 'Tắt'}</span><span className="n8-switch"><input type="checkbox" checked={r.enabled} disabled={!can} onChange={() => set({ enabled: !r.enabled })} /><i /></span></label>
        {can && <button type="button" className="btn btn-primary btn-sm" disabled={busy || (!dirty && !!r.id)} onClick={() => void save()}>{busy ? 'Đang lưu…' : dirty || !r.id ? 'Lưu' : 'Đã lưu'}</button>}
      </header>

      {tab === 'editor' ? (
        <div className="n8-canvas" onPointerDown={pan} style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${20 * view.z}px ${20 * view.z}px` }}>
          <div className="n8-stage" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
            {!r.trigger ? (
              <button type="button" className="n8-first" style={{ left: X0 }} onClick={() => can && setCreator({ list: '', at: 0, first: true })} disabled={!can}>
                <span><Icon name="plus" size={28} /></span><b>Thêm bước đầu tiên…</b>
              </button>
            ) : <>
              <svg className="n8-edges" width="1" height="1">
                {edges.map((e, i) => <path key={i} d={curve(outAt(e.from, e.port), inAt(e.to))} markerEnd="url(#n8-arrow)" className={e.port ? 'p-' + e.port : ''} />)}
                {pluses.map((p) => { if (!p.from) return null; const a = outAt(p.from, p.port), b = plusAt(p); return <path key={p.key} d={`M${a[0]} ${a[1]} L${b[0]} ${b[1]}`} className={p.port ? 'p-' + p.port : ''} />; })}
                <defs><marker id="n8-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" /></marker></defs>
              </svg>
              {ports.map(([f, p]) => portLabel(f, p, `pl-${f}-${p}`))}
              {nodes.map((n) => <CanvasNode key={n.key} n={n} r={r} lists={lists} scope={scope} can={can}
                stat={n.ref.kind === 'step' ? stats[n.ref.path] : n.ref.kind === 'trigger' && 'runs' in rule ? { ok: (rule as Rule).runs, fail: 0 } : undefined}
                onGrab={grab(n)} onOpen={() => setNode(n.ref)} onRemove={n.ref.kind !== 'trigger' || nodes.length === 1 ? () => remove(n.ref) : undefined} />)}
              {can && edges.filter((e) => e.insert).map((e, i) => {
                const a = outAt(e.from), b = inAt(e.to), mid: Pos = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
                return <button key={'ep' + i} type="button" className="n8-edge-plus" style={{ left: mid[0] - 11, top: mid[1] - 11 }} onClick={() => setCreator({ list: e.insert!.list, at: e.insert!.at })} aria-label="Chèn bước"><Icon name="plus" size={12} /></button>;
              })}
              {can && pluses.map((p) => { const b = plusAt(p); return <button key={'p' + p.key} type="button" className="n8-plus" style={{ left: b[0], top: b[1] - 14 }} onClick={() => setCreator({ list: p.list, at: p.at })} aria-label="Thêm bước"><Icon name="plus" size={16} /></button>; })}
            </>}
          </div>
          <div className="n8-zoom">
            <button type="button" onClick={() => setView({ x: 0, y: 0, z: 1 })} title="Về giữa"><Icon name="expand" size={15} /></button>
            <button type="button" onClick={() => setView((v) => ({ ...v, z: Math.min(1.6, v.z + 0.1) }))} title="Phóng to"><Icon name="plus" size={15} /></button>
            <button type="button" onClick={() => setView((v) => ({ ...v, z: Math.max(0.4, v.z - 0.1) }))} title="Thu nhỏ"><Icon name="minus" size={15} /></button>
            {can && r.trigger && <button type="button" onClick={tidy} title="Sắp xếp lại"><Icon name="grid" size={15} /></button>}
          </div>
          {can && r.trigger && r.actions.length > 0 && <button type="button" className="n8-run" onClick={() => void run()}><Icon name="play" size={15} />Chạy thử luật</button>}
          {creator && <NodeCreator first={!!creator.first} scope={scope} filterable={!creator.first && !r.conditions.length && scope !== 'none'} branchDepth={creator.list.split('.').filter((x) => x === 't' || x === 'e').length}
            onPick={(t) => {
              const anchor = pluses.find((p) => p.list === creator.list && p.at === creator.at);
              const near: Pos = anchor ? [Math.round((plusAt(anchor)[0] + 20) / 10) * 10, Math.round((plusAt(anchor)[1] - 50) / 10) * 10] : [farRight + W + GAP, 100];
              add(t, creator.list, creator.at, !!creator.first, near);
            }} onClose={() => setCreator(null)} />}
        </div>
      ) : tab === 'runs' ? <Runs runs={runs} onRecord={(id) => { onClose(); if (id.startsWith('tk_')) openTask(id); else openLink(`#customers/${id}`); }} />
        : <Jobs jobs={jobs} can={can} onCancel={(id) => act(() => admin.cancelAutomationJob(id), 'Đã huỷ lượt chờ', refresh)} />}

      {node && <NodeDetails n={node} r={r} lists={lists} scope={scope} can={can} last={runs?.[0] || null} set={set} onClose={() => setNode(null)} onRemove={() => remove(node)} onMove={node.kind === 'step' ? (by) => move(node.path, by) : undefined} />}
    </div>, document.body);
}
function blank(type: ActionType, scope: Scope): Action {
  const f = conditionsFor(scope)[0];
  switch (type) {
    case 'notify': return { type, to: scope === 'customer' ? ['owner'] : scope === 'task' ? ['assignees'] : [], text: '' };
    case 'webhook': return { type, url: 'https://' };
    case 'follow': return { type, userIds: [] };
    case 'assign': case 'customer_assign': return { type, userIds: [], mode: 'round_robin' };
    case 'wait': return { type, amount: 1, unit: 'hours' };
    case 'if': return { type, match: 'all', conditions: f ? [{ field: f.field, op: f.ops[0], value: '' }] : [], then: [], else: [] };
    case 'update_task': return { type, dueIn: 1 };
    case 'flow': return { type, move: 'start' };
    default: return { type };
  }
}

function nodeLook(ref: NodeRef, r: Draft, l: Lists, scope: Scope) {
  if (ref.kind === 'trigger') { const t = TRIGGERS.find((x) => x.type === r.trigger!.type)!; return { icon: t.icon, tone: TONE.trigger, title: t.label, sub: summary(r.trigger!) }; }
  if (ref.kind === 'filter') return { icon: 'filter', tone: TONE.filter, title: 'Lọc', sub: `${r.conditions.length} điều kiện${r.conditions.length > 1 ? (r.match === 'any' ? ' (một trong)' : ' (tất cả)') : ''}` };
  const a = stepAt(r.actions, ref.path), def = ACTIONS.find((x) => x.type === a.type)!;
  return { icon: def.icon, tone: TONE[a.type], title: def.label, sub: actionSummary(a, l, scope) };
}
function CanvasNode({ n, r, lists, scope, can, stat, onGrab, onOpen, onRemove }: { n: CNode; r: Draft; lists: Lists; scope: Scope; can: boolean; stat?: { ok: number; fail: number }; onGrab: (e: ReactPointerEvent) => void; onOpen: () => void; onRemove?: () => void }) {
  const look = nodeLook(n.ref, r, lists, scope);
  return (
    <div className={'n8-node' + (n.ref.kind === 'trigger' ? ' trigger' : '') + (n.isIf ? ' if' : '')} style={{ left: n.pos[0], top: n.pos[1], ['--tone' as any]: look.tone }}>
      {can && onRemove && <div className="n8-node-bar"><button type="button" onClick={onRemove} aria-label="Xoá bước"><Icon name="trash" size={13} /></button></div>}
      {/* A click opens it (the drag handler tells a click from a drag); Enter or Space opens it from the keyboard. */}
      <button type="button" className="n8-node-box" onPointerDown={onGrab} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }} aria-label={look.title}>
        {n.ref.kind === 'trigger' && <span className="n8-bolt"><Icon name="bolt" size={12} /></span>}
        <Icon name={look.icon} size={34} />
        {n.isIf && <><span className="n8-port t" /><span className="n8-port e" /></>}
        {stat && (stat.ok > 0 || stat.fail > 0) && <span className="n8-stat">{stat.ok > 0 && <i className="ok"><Icon name="check" size={10} />{stat.ok}</i>}{stat.fail > 0 && <i className="bad"><Icon name="x" size={10} />{stat.fail}</i>}</span>}
      </button>
      <b>{look.title}</b>{look.sub !== look.title && <small>{look.sub}</small>}
    </div>
  );
}

/** "What happens next?": the steps to add, in groups (like Bizfly's Logic, Thời gian, Dữ liệu, Tin nhắn, Nhân sự,
 *  Ứng dụng), found by name. */
function NodeCreator({ first, scope, filterable, branchDepth, onPick, onClose }: { first: boolean; scope: Scope; filterable: boolean; branchDepth: number; onPick: (t: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  const items: { key: string; label: string; about: string; icon: string; tone: string; group: string }[] = first
    ? TRIGGERS.map((t) => ({ key: t.type, label: t.label, about: t.about, icon: t.icon, tone: TONE.trigger, group: t.group }))
    : [...(filterable ? [{ key: 'filter', label: 'Lọc (điều kiện chung)', about: 'Chỉ chạy luật với bản ghi thoả điều kiện.', icon: 'filter', tone: TONE.filter, group: 'Logic' }] : []),
      ...actionsFor(scope).filter((a) => !(a.type === 'if' && branchDepth >= 2)).map((a) => ({ key: a.type, label: a.label, about: a.about, icon: a.icon, tone: TONE[a.type], group: a.group }))];
  const shown = items.filter((x) => fold(x.label + ' ' + x.about).includes(fold(q)));
  const groups = [...new Set(shown.map((x) => x.group))];
  return (
    <aside className="n8-creator" role="dialog" aria-label={first ? 'Chọn kích hoạt' : 'Bước tiếp theo'}>
      <header><b>{first ? 'Điều gì khởi động luật này?' : 'Bước tiếp theo là gì?'}</b><button type="button" className="bd-icon" onClick={onClose} aria-label="Đóng"><Icon name="x" size={16} /></button></header>
      <label className="n8-search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm bước…" autoFocus /></label>
      <div className="n8-creator-list">{groups.map((g) => (
        <Fragment key={g}>
          <h5>{g}</h5>
          <ul>{shown.filter((x) => x.group === g).map((x) => (
            <li key={x.key}><button type="button" onClick={() => onPick(x.key)}>
              <span className="n8-creator-ico" style={{ color: x.tone, borderColor: x.tone }}><Icon name={x.icon} size={18} /></span>
              <span><b>{x.label}</b><small>{x.about}</small></span><Icon name="right" size={14} />
            </button></li>
          ))}</ul>
        </Fragment>
      ))}</div>
    </aside>
  );
}

// ================================================================ a node's details: input · parameters · output
/** The field of the last text box clicked, so a field from the input pane goes in at its cursor. */
let lastField: { el: HTMLInputElement | HTMLTextAreaElement; set: (v: string) => void } | null = null;
function Text({ value, onChange, area, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; area?: boolean; placeholder?: string; rows?: number }) {
  const props = { className: 'bk-in', value, placeholder, onChange: (e: any) => onChange(e.target.value), onFocus: (e: any) => { lastField = { el: e.target, set: onChange }; } };
  return area ? <textarea rows={rows} {...props} /> : <input {...props} />;
}
function insertField(token: string) {
  const f = lastField;
  if (!f || !document.body.contains(f.el)) { void navigator.clipboard?.writeText(token); toast(`Đã chép ${token}: dán vào ô cần dùng`); return; }
  const at = f.el.selectionStart ?? f.el.value.length, end = f.el.selectionEnd ?? at;
  f.set(f.el.value.slice(0, at) + token + f.el.value.slice(end));
  requestAnimationFrame(() => { f.el.focus(); f.el.setSelectionRange(at + token.length, at + token.length); });
}

function NodeDetails({ n, r, lists, scope, can, last, set, onClose, onRemove, onMove }: { n: NodeRef; r: Draft; lists: Lists; scope: Scope; can: boolean; last: RuleRun | null; set: (p: Partial<Draft>) => void; onClose: () => void; onRemove: () => void; onMove?: (by: number) => void }) {
  const look = nodeLook(n, r, lists, scope);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open], .bk-pop')) onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const fields: [string, string][] = [
    ...FIELDS[scope],
    ...(r.trigger?.type === 'task.stage' || r.trigger?.type === 'customer.status' ? [['{{from}}', 'Giá trị trước'], ['{{to}}', 'Giá trị mới']] as [string, string][] : []),
    ...(r.trigger?.type === 'task.comment' ? [['{{comment}}', 'Nội dung bình luận']] as [string, string][] : []),
    ...(r.trigger?.type === 'webhook' ? [['{{body.ten_truong}}', 'Một trường trong JSON gửi vào']] as [string, string][] : []),
    ['{{rule}}', 'Tên luật'],
  ];
  const step = n.kind === 'step' ? stepAt(r.actions, n.path) : null;
  const setStep = (p: Partial<Action>) => { if (n.kind === 'step') set({ actions: withStep(r.actions, n.path, (a) => ({ ...a, ...p })) }); };
  return (
    <div className="n8-ndv-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="n8-ndv" role="dialog" aria-label={look.title} style={{ ['--tone' as any]: look.tone }}>
        <header>
          <button type="button" className="n8-back" onClick={onClose}><Icon name="left" size={15} />Về canvas</button>
          <span className="n8-ndv-ico"><Icon name={look.icon} size={18} /></span><b>{look.title}</b>
          <a className="n8-help" href={`/#help/${helpOf(n, step)}`} target="_blank" rel="noopener" title="Hướng dẫn chi tiết bước này (mở tab mới)"><Icon name="info" size={14} />Hướng dẫn</a>
          <span style={{ flex: 1 }} />
          {can && onMove && <><button type="button" className="bd-icon" onClick={() => onMove(-1)} title="Chạy sớm hơn một bước" aria-label="Chạy sớm hơn"><Icon name="left" size={15} /></button><button type="button" className="bd-icon" onClick={() => onMove(1)} title="Chạy muộn hơn một bước" aria-label="Chạy muộn hơn"><Icon name="right" size={15} /></button></>}
          {can && <button type="button" className="bd-icon" onClick={onRemove} aria-label="Xoá bước"><Icon name="trash" size={15} /></button>}
          <button type="button" className="bd-icon" onClick={onClose} aria-label="Đóng"><Icon name="x" size={16} /></button>
        </header>
        <div className="n8-panes">
          <aside className="n8-pane in">
            <h4>Đầu vào</h4>
            {n.kind === 'trigger' ? <p className="n8-note">Bước kích hoạt là điểm bắt đầu: không có đầu vào.</p> : <>
              <p className="n8-note">Bấm một trường để chèn vào ô đang chọn.</p>
              <ul className="n8-fields">{fields.map(([t, l]) => <li key={t}><button type="button" onClick={() => insertField(t)}><code>{t}</code><small>{l}</small></button></li>)}</ul>
            </>}
          </aside>
          <div className="n8-pane params">
            <h4>Tham số</h4>
            <fieldset disabled={!can}>
              {n.kind === 'trigger' && <TriggerFields t={r.trigger!} lists={lists} set={(p) => set({ trigger: { ...r.trigger!, ...p } })}
                onType={(type) => set({ trigger: { type, pos: r.trigger?.pos }, ...(scopeOf(type) === scope ? {} : { conditions: [], actions: [] }) })} />}
              {n.kind === 'filter' && <Conditions list={r.conditions} match={r.match} scope={scope} lists={lists} onChange={(conditions, match) => set({ conditions, match })} />}
              {step?.type === 'if' && <>
                <Conditions list={step.conditions || []} match={step.match} scope={scope} lists={lists} onChange={(conditions, match) => setStep({ conditions, match })} />
                <p className="n8-note">Đúng: chạy các bước ở nhánh trên. Sai: chạy các bước ở nhánh dưới. Xong nhánh, luật chạy tiếp các bước sau khối này.</p>
              </>}
              {step && step.type !== 'if' && <ActionFields a={step} scope={scope} lists={lists} onChange={setStep} />}
            </fieldset>
          </div>
          <aside className="n8-pane out">
            <h4>Đầu ra</h4>
            {last ? <div className={'n8-out' + (last.ok ? '' : ' bad')}>
              <span><Icon name={last.ok ? 'check' : 'x'} size={14} />{last.ok ? 'Chạy thành công' : 'Chạy lỗi'} · {fmtTime(last.at)}</span>
              {last.taskTitle && <small>{last.taskTitle}</small>}
              <pre>{last.message}</pre>
            </div> : <p className="n8-note">Chưa có lần chạy nào. Lưu rồi bấm “Chạy thử luật” để xem kết quả.</p>}
          </aside>
        </div>
      </section>
    </div>
  );
}

/** The guide article (Trợ giúp) for a node. */
const helpOf = (n: NodeRef, step: Action | null) => (n.kind === 'trigger' ? 'tu-dong-hoa-kich-hoat' : n.kind === 'filter' || step?.type === 'if' ? 'tu-dong-hoa-dieu-kien' : step?.type === 'wait' ? 'tu-dong-hoa-doi-hen-gio' : 'tu-dong-hoa-hanh-dong');
function TriggerFields({ t, lists, set, onType }: { t: Trigger; lists: Lists; set: (p: Partial<Trigger>) => void; onType: (type: TriggerType) => void }) {
  const groups = [...new Set(TRIGGERS.map((x) => x.group))];
  return <>
    <Row label="Kích hoạt"><select className="bk-in" value={t.type} onChange={(e) => onType(e.target.value as TriggerType)}>{groups.map((g) => <optgroup key={g} label={g}>{TRIGGERS.filter((x) => x.group === g).map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}</optgroup>)}</select></Row>
    <p className="n8-note">{TRIGGERS.find((x) => x.type === t.type)!.about}</p>
    {t.type === 'task.stage' && <Row label="Sang bước"><select className="bk-in" value={t.to || ''} onChange={(e) => set({ to: e.target.value })}><option value="">Bất kỳ bước nào</option>{FLOW_STAGES.map((s) => <option key={s.key} value={s.key}>{s.code}</option>)}</select></Row>}
    {t.type === 'customer.status' && <Row label="Sang trạng thái"><select className="bk-in" value={t.to || ''} onChange={(e) => set({ to: e.target.value })}><option value="">Bất kỳ trạng thái nào</option>{lists.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Row>}
    {t.type === 'task.field' && <Row label="Trường"><select className="bk-in" value={t.field || 'due'} onChange={(e) => set({ field: e.target.value as Trigger['field'] })}>{WATCHED.map(([f, l]) => <option key={f} value={f}>{l}</option>)}</select></Row>}
    {t.type === 'task.due_soon' && <Row label="Trước hạn"><input className="bk-in n8-num" type="number" min={1} max={720} value={t.hours ?? 24} onChange={(e) => set({ hours: Number(e.target.value) })} /> giờ</Row>}
    {t.type === 'schedule' && <>
      <Row label="Lặp lại"><select className="bk-in" value={t.every || 'day'} onChange={(e) => set({ every: e.target.value as Trigger['every'] })}><option value="day">Hằng ngày</option><option value="week">Hằng tuần</option><option value="month">Hằng tháng</option></select></Row>
      {t.every === 'week' && <Row label="Vào"><select className="bk-in" value={t.weekday || 1} onChange={(e) => set({ weekday: Number(e.target.value) })}>{WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}</select></Row>}
      {t.every === 'month' && <Row label="Vào"><select className="bk-in" value={t.monthday || 1} onChange={(e) => set({ monthday: Number(e.target.value) })}>{Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>Ngày {i + 1}</option>)}</select></Row>}
      <Row label="Lúc"><input className="bk-in n8-num" type="time" value={t.at || '08:00'} onChange={(e) => set({ at: e.target.value })} /> giờ Việt Nam</Row>
    </>}
    {t.type === 'webhook' && (t.secret
      ? <div className="n8-hook"><span className="n8-method">POST</span><code>{hookUrl(t.secret)}</code><button type="button" className="btn btn-gray btn-sm" onClick={() => { void navigator.clipboard.writeText(hookUrl(t.secret)); toast('Đã chép địa chỉ webhook'); }}><Icon name="copy" size={14} />Chép</button>
        <p className="n8-note">Gửi JSON từ n8n, Zapier, Make… Các trường gửi kèm dùng bằng {'{{body.<tên>}}'}.</p></div>
      : <p className="n8-note">Lưu luật để nhận địa chỉ webhook riêng.</p>)}
  </>;
}

/** What each box asks for, shown under it (the full guide: Trợ giúp › Tự động hoá). */
const HINTS: Record<string, string> = {
  'Kích hoạt': 'Sự kiện làm luật bắt đầu chạy. Đổi sang loại khác nhóm (công việc ↔ khách hàng ↔ lịch) sẽ xoá điều kiện và các bước, vì chúng làm việc trên dữ liệu khác.',
  'Sang bước': 'Chỉ chạy khi công việc chuyển vào đúng bước này. Để "Bất kỳ" thì chạy mỗi lần công việc đổi bước.',
  'Sang trạng thái': 'Chỉ chạy khi khách hàng chuyển sang trạng thái này. Để "Bất kỳ" thì chạy mỗi lần đổi trạng thái.',
  'Trường': 'Trường nào của công việc thay đổi thì luật chạy: hạn chót (đặt, đổi hoặc bỏ), người thực hiện (giao, đổi), dịch vụ.',
  'Trước hạn': 'Số giờ trước hạn chót. Ví dụ 24: việc có hạn 17:00 ngày mai sẽ được nhắc lúc 17:00 hôm nay. Chỉ tính việc chưa xong.',
  'Lặp lại': 'Bao lâu chạy một lần. Luật theo lịch không gắn với công việc nào: thường dùng để tạo việc định kỳ hoặc gọi webhook.',
  'Vào': 'Ngày trong tuần hoặc ngày trong tháng (1–28) mà luật chạy.',
  'Lúc': 'Giờ chạy, theo giờ Việt Nam. Luật được kiểm tra mỗi phút nên có thể chạy trễ tối đa khoảng một phút.',
  'Gửi cho': 'Người nhận thông báo. Chọn vai trò (người thực hiện, người tạo, người duyệt…) để luật tự tìm đúng người của từng bản ghi, hoặc chọn tên cụ thể.',
  'Tiêu đề': 'Dòng chữ đậm trong thông báo. Bấm một trường ở cột Đầu vào để chèn, ví dụ {{task.title}} thành tên công việc.',
  'Nội dung': 'Dòng chữ nhỏ dưới tiêu đề (cũng có thể chèn trường). Để trống thì dùng tên công việc hoặc khách hàng.',
  'Bình luận': 'Nội dung bình luận được viết vào công việc, dưới tên người lưu luật. Có thể chèn trường như {{to}} (bước mới).',
  'Cách chia': 'Cách chọn một người trong danh sách: cố định (luôn người đầu), vòng tròn (lần lượt), tỷ trọng (theo số phần), ít việc nhất (người đang ít việc chưa xong nhất).',
  'Nhân sự': 'Danh sách người có thể được giao. Người có tên trong Danh sách nghỉ (Cài đặt chung) hôm nay sẽ được bỏ qua.',
  'Người duyệt': 'Người chấm PASS / REDO / FAIL khi công việc ở bước REVIEW. Không đặt thì người tạo việc là người duyệt.',
  'Thêm': 'Những người được thêm vào danh sách theo dõi (nhận thông báo khi công việc thay đổi). Người đã theo dõi thì giữ nguyên.',
  'Hạn chót': 'Đặt hạn mới tính từ lúc luật chạy, hoặc bỏ hạn của công việc.',
  'Sau': 'Số ngày tính từ hôm nay; hạn rơi vào 23:59 của ngày đó (giờ Việt Nam). 0 là cuối ngày hôm nay.',
  'Chuyển': 'Bước của quy trình duyệt: Giao việc (ACCOUNT → EXECUTION, cần có người thực hiện), Nộp duyệt (→ REVIEW), Duyệt PASS (→ COMPLETED).',
  'Trạng thái': 'Trạng thái mới của khách hàng (danh sách trạng thái đặt ở Quản trị › Khách hàng › Trạng thái).',
  'Tên việc': 'Tên của công việc mới. Có thể chèn trường, ví dụ “Gọi lại cho {{customer}}”.',
  'Mô tả': 'Mô tả của công việc mới (tuỳ chọn).',
  'Dịch vụ': 'Dịch vụ (khách hàng · nhãn hàng · dịch vụ) mà việc mới thuộc về; việc sẽ lên board của dịch vụ đó. Để trống: việc chung.',
  'Giao cho': 'Người làm việc mới. Để trống thì việc chờ ở ACCOUNT để người tạo giao sau.',
  'Hạn': 'Hạn của việc mới: số ngày sau khi tạo (23:59 của ngày đó). Để trống: không có hạn.',
  'Phương thức': 'Webhook luôn gửi bằng POST với dữ liệu JSON.',
  'URL': 'Địa chỉ nhận (phải bắt đầu bằng https://), ví dụ địa chỉ Webhook node của n8n, Catch Hook của Zapier, hoặc webhook của Make/Slack.',
  'Đợi': 'Thời gian chờ trước khi chạy các bước tiếp theo. Bật “Chỉ tính giờ làm việc” để không tính đêm và ngày nghỉ.',
};
const Row = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => <div className="n8-row-f"><span>{label}</span><div>{children}</div>{(hint ?? HINTS[label]) && <small className="n8-hint">{hint ?? HINTS[label]}</small>}</div>;

/** A list of conditions and how they combine (tất cả / một trong). */
function Conditions({ list, match, scope, lists, onChange }: { list: Condition[]; match?: Match; scope: Scope; lists: Lists; onChange: (l: Condition[], m: Match) => void }) {
  const m = match || 'all', first = conditionsFor(scope)[0];
  return <>
    <div className="n8-match">Chạy khi <select className="bk-in" value={m} onChange={(e) => onChange(list, e.target.value as Match)}><option value="all">tất cả</option><option value="any">một trong</option></select> các điều kiện sau đúng:</div>
    {list.map((c, i) => <ConditionRow key={i} c={c} scope={scope} lists={lists} onChange={(p) => onChange(list.map((x, j) => (j === i ? { ...x, ...p } : x)), m)} onRemove={() => onChange(list.filter((_, j) => j !== i), m)} />)}
    {first && <button type="button" className="n8-add-sm" onClick={() => onChange([...list, { field: first.field, op: first.ops[0], value: '' }], m)}><Icon name="plus" size={13} />Thêm điều kiện</button>}
  </>;
}
function ConditionRow({ c, scope, lists, onChange, onRemove }: { c: Condition; scope: Scope; lists: Lists; onChange: (p: Partial<Condition>) => void; onRemove: () => void }) {
  const defs = conditionsFor(scope), def = defs.find((x) => x.field === c.field) || defs[0];
  const options = ({ customer: lists.customers, service: lists.services, assignee: lists.people, c_owner: lists.people, c_status: lists.statuses, stage: FLOW_STAGES.map((s) => ({ id: s.key, name: s.code })), due: DUE_VALUES.map(([id, name]) => ({ id, name })) } as Record<string, Ref[]>)[c.field];
  const noValue = c.op === 'empty' || c.op === 'filled';
  return (
    <div className="n8-cond">
      <select className="bk-in" value={c.field} onChange={(e) => { const f = defs.find((x) => x.field === e.target.value)!; onChange({ field: f.field, op: f.ops[0], value: '' }); }}>{defs.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}</select>
      <select className="bk-in" value={c.op} onChange={(e) => onChange({ op: e.target.value as Condition['op'] })}>{def.ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</select>
      {noValue ? <span /> : options ? <select className="bk-in" value={c.value} onChange={(e) => onChange({ value: e.target.value })}><option value="">Chọn…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        : <Text value={c.value} onChange={(value) => onChange({ value })} placeholder="Từ khoá" />}
      <button type="button" className="bd-icon" onClick={onRemove} aria-label="Xoá điều kiện"><Icon name="x" size={14} /></button>
    </div>
  );
}

function People({ value, onChange, lists, extra = [] }: { value: string[]; onChange: (v: string[]) => void; lists: Lists; extra?: [string, string][] }) {
  const label = (id: string) => extra.find(([k]) => k === id)?.[1] || nameOf(lists.people, id);
  return (
    <div className="n8-people">
      {value.map((id) => <span key={id} className="n8-chip">{label(id)}<button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Bỏ ${label(id)}`}><Icon name="x" size={11} /></button></span>)}
      <select className="bk-in" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])} aria-label="Thêm người">
        <option value="">+ Thêm…</option>
        {extra.filter(([k]) => !value.includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        {lists.people.filter((p) => !value.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>
  );
}
const PersonSelect = ({ value, onChange, lists, none }: { value?: string; onChange: (v: string) => void; lists: Lists; none?: string }) => (
  <select className="bk-in" value={value || ''} onChange={(e) => onChange(e.target.value)}><option value="">{none || 'Chọn người…'}</option>{lists.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
);
/** Who gets it, and how one is picked among several (Bizfly's chia đều, vòng tròn, tỷ trọng). */
function AssignFields({ a, lists, onChange }: { a: Action; lists: Lists; onChange: (p: Partial<Action>) => void }) {
  const ids = a.userIds || [], mode = a.mode || 'fixed', today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const away = ids.filter((u) => lists.settings.leaves.some((l) => l.userId === u && today >= l.from && today <= l.to));
  return <>
    <Row label="Cách chia"><select className="bk-in" value={mode} onChange={(e) => onChange({ mode: e.target.value as Action['mode'] })}>{ASSIGN_MODES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></Row>
    <Row label="Nhân sự"><People value={ids} onChange={(userIds) => onChange({ userIds, weights: (a.weights || []).slice(0, userIds.length) })} lists={lists} /></Row>
    {mode === 'weighted' && ids.length > 0 && <div className="n8-weights">{ids.map((id, i) => (
      <label key={id}><span>{nameOf(lists.people, id)}</span><input className="bk-in n8-num" type="number" min={1} max={100} value={a.weights?.[i] ?? 1} onChange={(e) => onChange({ weights: ids.map((_, j) => (j === i ? Number(e.target.value) : a.weights?.[j] ?? 1)) })} /><small>phần</small></label>
    ))}</div>}
    <p className="n8-note">{mode === 'round_robin' ? 'Lần lượt từng người theo thứ tự.' : mode === 'weighted' ? 'Ví dụ 4 và 1: người đầu nhận khoảng 80%, người sau 20%.' : mode === 'least' ? 'Người đang có ít việc chưa xong nhất.' : 'Luôn là người đầu tiên (người đó nghỉ thì người kế tiếp).'}
      {away.length ? ` Hôm nay nghỉ: ${away.map((u) => nameOf(lists.people, u)).join(', ')} (sẽ được bỏ qua).` : ''}</p>
  </>;
}

function ActionFields({ a, scope, lists, onChange }: { a: Action; scope: Scope; lists: Lists; onChange: (p: Partial<Action>) => void }) {
  switch (a.type) {
    case 'notify': return <>
      <Row label="Gửi cho"><People value={a.to || []} onChange={(to) => onChange({ to })} lists={lists} extra={RECIPIENTS[scope]} /></Row>
      <Row label="Tiêu đề"><Text value={a.text || ''} onChange={(text) => onChange({ text })} placeholder="Ví dụ: Việc chờ bạn duyệt: {{task.title}}" /></Row>
      <Row label="Nội dung"><Text value={a.body || ''} onChange={(body) => onChange({ body })} placeholder="Tuỳ chọn" /></Row>
    </>;
    case 'comment': return <Row label="Bình luận"><Text area value={a.text || ''} onChange={(text) => onChange({ text })} placeholder="Ví dụ: Đã chuyển sang {{to}}, nhờ anh chị xem giúp." /></Row>;
    case 'assign': case 'customer_assign': return <AssignFields a={a} lists={lists} onChange={onChange} />;
    case 'reviewer': return <Row label="Người duyệt"><PersonSelect value={a.userId} onChange={(userId) => onChange({ userId })} lists={lists} /></Row>;
    case 'follow': return <Row label="Thêm"><People value={a.userIds || []} onChange={(userIds) => onChange({ userIds })} lists={lists} /></Row>;
    case 'update_task': return <>
      <Row label="Hạn chót"><select className="bk-in" value={a.dueIn == null ? 'clear' : 'set'} onChange={(e) => onChange({ dueIn: e.target.value === 'clear' ? null : 1 })}><option value="set">Đặt sau một số ngày</option><option value="clear">Bỏ hạn chót</option></select></Row>
      {a.dueIn != null && <Row label="Sau"><input className="bk-in n8-num" type="number" min={0} max={365} value={a.dueIn} onChange={(e) => onChange({ dueIn: Number(e.target.value) })} /> ngày (cuối ngày, giờ Việt Nam)</Row>}
    </>;
    case 'flow': return <><Row label="Chuyển"><select className="bk-in" value={a.move || 'start'} onChange={(e) => onChange({ move: e.target.value as Action['move'] })}>{FLOW_MOVES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></Row><p className="n8-note">Người lưu luật cần có quyền làm bước đó (ví dụ duyệt PASS cần là người duyệt hoặc Admin).</p></>;
    case 'customer_status': return <Row label="Trạng thái"><select className="bk-in" value={a.statusId || ''} onChange={(e) => onChange({ statusId: e.target.value })}><option value="">Chọn…</option>{lists.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Row>;
    case 'create_task': return <>
      <Row label="Tên việc"><Text value={a.text || ''} onChange={(text) => onChange({ text })} placeholder="Ví dụ: Gọi lại cho {{customer}}" /></Row>
      <Row label="Mô tả"><Text area rows={2} value={a.body || ''} onChange={(body) => onChange({ body })} placeholder="Tuỳ chọn" /></Row>
      <Row label="Dịch vụ"><select className="bk-in" value={a.serviceId || ''} onChange={(e) => onChange({ serviceId: e.target.value || undefined })}><option value="">Không gắn dịch vụ</option>{lists.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Row>
      <Row label="Giao cho"><PersonSelect value={a.userId} onChange={(userId) => onChange({ userId: userId || undefined })} lists={lists} none="Chưa giao (chờ ở ACCOUNT)" /></Row>
      <Row label="Hạn"><input className="bk-in n8-num" type="number" min={0} max={365} value={a.dueDays ?? ''} onChange={(e) => onChange({ dueDays: e.target.value === '' ? undefined : Number(e.target.value) })} placeholder="—" /> ngày sau khi tạo</Row>
    </>;
    case 'webhook': return <>
      <Row label="Phương thức"><span className="n8-method">POST</span></Row>
      <Row label="URL"><Text value={a.url || ''} onChange={(url) => onChange({ url })} placeholder="https://n8n.example.com/webhook/…" /></Row>
      <p className="n8-note">Gửi JSON: rule, by, from, to, body, comment, at, task (id, title, stage, dueAt, customer, service, assignees, link) và customer (id, name, status, owner, link).</p>
    </>;
    case 'wait': return <>
      <Row label="Đợi"><input className="bk-in n8-num" type="number" min={1} max={999} value={a.amount ?? 1} onChange={(e) => onChange({ amount: Number(e.target.value) })} />
        <select className="bk-in n8-num" value={a.unit || 'hours'} onChange={(e) => onChange({ unit: e.target.value as Action['unit'] })}><option value="minutes">phút</option><option value="hours">giờ</option><option value="days">ngày</option></select></Row>
      <label className="n8-check"><input type="checkbox" checked={!!a.workHours} onChange={() => onChange({ workHours: !a.workHours })} />Chỉ tính giờ làm việc ({lists.settings.start}–{lists.settings.end})</label>
      <p className="n8-note">Sau khi chờ, luật chạy tiếp với dữ liệu mới nhất của bản ghi. Các lượt đang chờ xem ở tab “Đang chờ”.</p>
    </>;
    default: return null;
  }
}

// ================================================================ run history and waiting runs
function Runs({ runs, onRecord }: { runs: RuleRun[] | null; onRecord: (id: string) => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const cur = runs?.find((x) => x.id === pick) || runs?.[0] || null;
  const csv = () => {
    const rows = [['Thời gian', 'Kết quả', 'Bản ghi', 'Chi tiết'], ...(runs || []).map((x) => [fmtTime(x.at), x.ok ? 'Thành công' : 'Lỗi', x.taskTitle || x.taskId || '', x.message])];
    const blob = new Blob(['﻿' + rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lich-su-chay.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
  if (!runs) return <div className="n8-runs"><p className="n8-note">Đang tải…</p></div>;
  if (!runs.length) return <div className="n8-runs"><Empty icon="lines" title="Chưa có lần chạy nào" text="Luật chạy khi kích hoạt xảy ra, hoặc khi bạn bấm “Chạy thử luật”." /></div>;
  const ok = runs.filter((x) => x.ok).length;
  return (
    <div className="n8-runs">
      <ul>
        <li className="n8-runs-head"><span>{runs.length} lần · {ok} thành công · {runs.length - ok} lỗi</span><button type="button" className="btn btn-gray btn-sm" onClick={csv}><Icon name="download" size={13} />CSV</button></li>
        {runs.map((x) => (
          <li key={x.id}><button type="button" className={(cur?.id === x.id ? 'on ' : '') + (x.ok ? '' : 'bad')} onClick={() => setPick(x.id)}>
            <span><b>{fmtTime(x.at)}</b>{x.taskTitle && <small>{x.taskTitle}</small>}</span><span className={'n8-status' + (x.ok ? '' : ' bad')}>{x.ok ? 'Thành công' : 'Lỗi'}</span>
          </button></li>
        ))}
      </ul>
      {cur && <article>
        <h3><span className={'n8-status' + (cur.ok ? '' : ' bad')}>{cur.ok ? 'Thành công' : 'Lỗi'}</span>{fmtTime(cur.at)}</h3>
        {cur.taskId && <p>Bản ghi: <button type="button" className="link" onClick={() => onRecord(cur.taskId!)}>{cur.taskTitle || cur.taskId}</button></p>}
        <ol className="n8-steps">{cur.message.split(' · ').map((s, i) => <li key={i} className={s.startsWith('Lỗi') ? 'bad' : ''}>{s}</li>)}</ol>
      </article>}
    </div>
  );
}
function Jobs({ jobs, can, onCancel }: { jobs: RuleJob[] | null; can: boolean; onCancel: (id: string) => void }) {
  if (!jobs) return <div className="n8-runs"><p className="n8-note">Đang tải…</p></div>;
  if (!jobs.length) return <div className="n8-runs"><Empty icon="clock" title="Không có lượt nào đang chờ" text="Bước “Đợi, hẹn giờ” và luật “chỉ chạy trong giờ làm việc” xếp lượt chạy tiếp ở đây." /></div>;
  return (
    <div className="n8-jobs">
      <table className="n8-table"><thead><tr><th>Chạy tiếp lúc</th><th>Bản ghi</th><th>Tại bước</th><th /></tr></thead>
        <tbody>{jobs.map((j) => (
          <tr key={j.id}><td>{fmtTime(j.runAt)}</td><td>{j.label || j.record || '—'}</td><td>{j.step === 'Chờ giờ làm việc' ? j.step : `Bước ${j.step}`}</td>
            <td>{can && <button type="button" className="btn btn-gray btn-sm" onClick={() => onCancel(j.id)}>Huỷ</button>}</td></tr>
        ))}</tbody></table>
    </div>
  );
}
