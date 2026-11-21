// Trang chủ, Base-like: the person's day at a glance, in widgets they choose (Thêm widget), each one set up on its own
// (Sửa widget: its name, one customer, how it shows its data, the fields it shows), synced, opened full size, and dragged
// into place (rows of up to four sharing the width equally), kept with the account
// (dms.homeWidgets, shared/account-prefs.ts). A widget is a list of tasks (to do, today, this week, late, to review,
// given out, followed) or a table of counts (by customer, by service, by person of their team). Rows open their task,
// customer or service; everything reloads after changes made elsewhere, one request per kind of data.
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { api } from '../api';
import { quietly } from '../loading';
import { onLive } from '../live';
import { remember } from '../prefs';
import { goto, openLink, openTask, useStore, type View } from '../store';
import { Icon } from './ui';
import { Avatar, Pop, shortDate } from './boardkit';
import { Badge, STEP_ORDER, stepCode } from './taskkit';
import { Bars, Columns, Donut, Stacked, Stats, type Part } from './HomeCharts';
import type { FlowStage } from '../../../shared/task-flow';
import { Sheet } from './Dialogs';
import type { BrandServiceItem, TaskItem } from '../types';

type Kind = 'todo' | 'today' | 'week' | 'late' | 'review' | 'given' | 'following' | 'customers' | 'services' | 'team';
type Field = 'stage' | 'place' | 'due' | 'person';
type Col = 'all' | 'doing' | 'late' | 'done' | 'bar';
interface Widget { id: string; kind: Kind; title?: string; customer?: string; customerName?: string; fields?: Field[]; cols?: Col[]; row?: string; view?: ViewKind; span?: Span; wide?: boolean }
/** How a widget shows its data: a list or table, or one of the charts (HomeCharts.tsx). */
type ViewKind = 'list' | 'stage' | 'due' | 'days' | 'status' | 'customer' | 'number' | 'table' | 'stacked' | 'columns' | 'donut';
const TASK_VIEWS: [ViewKind, string, string][] = [['list', 'Danh sách', 'list'], ['stage', 'Cột theo bước', 'chart'], ['due', 'Cột theo hạn', 'chart'], ['days', 'Lịch hạn 14 ngày', 'calendar'], ['status', 'Biểu đồ tròn', 'clock'], ['customer', 'Thanh theo khách hàng', 'users'], ['number', 'Số liệu', 'info']];
const TABLE_VIEWS: [ViewKind, string, string][] = [['table', 'Bảng', 'list'], ['stacked', 'Thanh chồng', 'lines'], ['columns', 'Cột dọc', 'chart'], ['donut', 'Biểu đồ tròn', 'clock'], ['number', 'Số liệu', 'info']];
/** Widgets sit in rows (`row`), up to four to a row, sharing its width equally. Layouts saved before rows had a width
 *  per widget (`span` of four columns, or `wide`): they are packed into rows by it once. */
type Span = 1 | 2 | 3 | 4;
const PER_ROW = 4;
function packRows(list: Widget[]): Widget[] {
  if (list.every((w) => w.row)) return list;
  let row = uid(), room = PER_ROW;
  return list.map((w) => {
    const span = w.span ?? (w.wide ? 4 : 2);
    if (span > room) { row = uid(); room = PER_ROW; }
    room -= span;
    const { span: _s, wide: _w, ...rest } = w;
    return { ...rest, row };
  });
}
/** The rows of a layout, in order (a row's widgets are kept next to each other). */
function rowsOf(list: Widget[]): Widget[][] {
  const rows: Widget[][] = [];
  for (const w of list) { const last = rows.at(-1); if (last && last[0].row === w.row) last.push(w); else rows.push([w]); }
  return rows;
}
/** Where a dragged widget goes: beside another one (in its row), or into a new row before a row (or at the end). */
type Target = { into: string; after: boolean } | { before: string | null };
function place(list: Widget[], id: string, t: Target, newRow: string): Widget[] {
  const w = list.find((x) => x.id === id), rest = list.filter((x) => x.id !== id);
  if (!w) return list;
  if ('into' in t) {
    const ref = rest.find((x) => x.id === t.into);
    if (!ref || rest.filter((x) => x.row === ref.row).length >= PER_ROW) return list;
    const i = rest.indexOf(ref) + (t.after ? 1 : 0);
    return [...rest.slice(0, i), { ...w, row: ref.row }, ...rest.slice(i)];
  }
  const i = t.before ? rest.findIndex((x) => x.row === t.before) : -1, moved = { ...w, row: newRow };
  return i < 0 ? [...rest, moved] : [...rest.slice(0, i), moved, ...rest.slice(i)];
}

/** Every kind of widget: its name, what it shows, its icon, the page "see all" opens, and whether it is a table. */
const KINDS: Record<Kind, { title: string; about: string; icon: string; page: View; table?: boolean }> = {
  todo: { title: 'Công việc cần làm', about: 'Việc được giao cho bạn, chưa xong, quá hạn lên đầu.', icon: 'checklist', page: 'tasks' },
  today: { title: 'Cần làm hôm nay', about: 'Việc của bạn đến hạn trong hôm nay.', icon: 'clock', page: 'tasks' },
  week: { title: 'Cần làm trong tuần', about: 'Việc của bạn đến hạn trong 7 ngày tới.', icon: 'calendar', page: 'tasks' },
  late: { title: 'Việc quá hạn', about: 'Việc của bạn đã qua hạn mà chưa xong.', icon: 'info', page: 'tasks' },
  review: { title: 'Chờ tôi duyệt', about: 'Việc đang REVIEW mà bạn là người duyệt.', icon: 'eye', page: 'tasks' },
  given: { title: 'Công việc tôi giao', about: 'Việc bạn tạo và giao cho người khác, chưa xong.', icon: 'send', page: 'tasks' },
  following: { title: 'Việc tôi theo dõi', about: 'Việc bạn đang theo dõi, chưa xong.', icon: 'star', page: 'tasks' },
  customers: { title: 'Tổng quan khách hàng', about: 'Số việc của từng khách hàng: tất cả, đang làm, quá hạn, hoàn thành.', icon: 'users', page: 'customers', table: true },
  services: { title: 'Tổng quan dịch vụ', about: 'Số việc của từng dịch vụ (nhãn hàng · dịch vụ).', icon: 'folder', page: 'projects', table: true },
  team: { title: 'Nhân viên của tôi', about: 'Số việc của từng người trong phòng ban/nhóm bạn quản lý.', icon: 'user', page: 'tasks', table: true },
};
const ORDER: Kind[] = ['todo', 'today', 'week', 'late', 'review', 'given', 'following', 'customers', 'services', 'team'];
const FIELDS: [Field, string][] = [['stage', 'Trạng thái'], ['place', 'Khách hàng · Dịch vụ'], ['due', 'Hạn'], ['person', 'Người giao / người làm']];
const COLS: [Col, string][] = [['all', 'Tất cả'], ['doing', 'Đang làm'], ['late', 'Quá hạn'], ['done', 'Hoàn thành'], ['bar', 'Thanh tiến độ']];
const ALL_FIELDS = FIELDS.map(([f]) => f), ALL_COLS = COLS.map(([c]) => c);
const LIMIT = 30, DAY = 864e5;

const KEY = 'dms.homeWidgets';
const uid = () => Math.random().toString(36).slice(2, 9);
const DEFAULT: Widget[] = [{ id: 'w1', kind: 'todo', row: 'r1' }, { id: 'w2', kind: 'today', row: 'r1' }, { id: 'w3', kind: 'late', row: 'r1' }, { id: 'w4', kind: 'review', row: 'r1' }, { id: 'w5', kind: 'customers', row: 'r2' }];
function readWidgets(): Widget[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (Array.isArray(v)) return packRows(v.filter((w) => w && KINDS[w.kind as Kind])); } catch { /* none saved */ }
  return DEFAULT;
}
function saveWidgets(list: Widget[]) {
  const v = JSON.stringify(list);
  try { localStorage.setItem(KEY, v); } catch { /* private mode */ }
  remember(KEY, v);
}

// One request per kind of data for all the widgets that read it, made again after a change (a fresh cache).
let cache = new Map<string, Promise<unknown>>();
const once = <T,>(key: string, load: () => Promise<T>) => { if (!cache.has(key)) cache.set(key, load()); return cache.get(key) as Promise<T>; };
/** The data a kind of widget reads (its key in the cache), so its own reload asks for that again. */
const keyOf = (k: Kind) => (['todo', 'today', 'week', 'late'].includes(k) ? 'mine' : k === 'customers' ? 'services' : k);
const myOpen = () => once('mine', () => api.tasks({ scope: 'mine', rel: 'assigned', state: 'open' }).then((r) => r.tasks));
const services = () => once('services', () => api.brandServices().catch(() => [] as BrandServiceItem[]));
const dayStart = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Late first, then by due date; those with no date last. */
const byDue = (a: TaskItem, b: TaskItem) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);

function loadTasks(kind: Kind): Promise<TaskItem[]> {
  const now = Date.now(), today = dayStart();
  switch (kind) {
    case 'today': return myOpen().then((l) => l.filter((t) => t.dueAt && t.dueAt >= today && t.dueAt < today + DAY));
    case 'week': return myOpen().then((l) => l.filter((t) => t.dueAt && t.dueAt >= today && t.dueAt < today + 8 * DAY));
    case 'late': return myOpen().then((l) => l.filter((t) => t.dueAt && t.dueAt < now));
    case 'review': return once('review', () => api.tasks({ scope: 'mine', rel: 'review', state: 'review' }).then((r) => r.tasks));
    case 'given': return once('given', () => api.tasks({ scope: 'mine', rel: 'created', state: 'open' }).then((r) => r.tasks));
    case 'following': return once('following', () => api.tasks({ scope: 'mine', rel: 'following', state: 'open' }).then((r) => r.tasks));
    case 'team': return once('team', () => api.tasks({ scope: 'team' }).then((r) => r.tasks));
    default: return myOpen();
  }
}

type Row = { key: string; name: string; all: number; done: number; late: number; open?: () => void };
async function loadRows(kind: Kind, customer?: string): Promise<Row[]> {
  if (kind === 'team') {
    const rows = new Map<string, Row>(), now = Date.now();
    for (const t of await loadTasks('team')) {
      if (customer && t.customer?.id !== customer) continue;
      for (const a of t.assignees) {
        const r = rows.get(a.id) || { key: a.id, name: a.name, all: 0, done: 0, late: 0 };
        r.all++;
        if (t.state === 'done' || t.state === 'done_late') r.done++; else if (t.state !== 'cancelled' && t.dueAt && t.dueAt < now) r.late++;
        rows.set(a.id, r);
      }
    }
    return [...rows.values()].sort((a, b) => b.all - a.all);
  }
  const rows = new Map<string, Row>();
  for (const s of await services()) {
    if (!s.tasks || (customer && s.customerId !== customer)) continue;
    const key = kind === 'services' ? s.id : s.customerId || '-';
    const r = rows.get(key) || (kind === 'services'
      ? { key, name: [s.brandName, s.name].filter(Boolean).join(' · '), all: 0, done: 0, late: 0, open: () => openLink(`#projects/${s.id}`) }
      : { key, name: s.customerName || 'Chưa gắn khách hàng', all: 0, done: 0, late: 0, open: s.customerId ? () => openLink(`#customers/${s.customerId}`) : undefined });
    r.all += s.tasks; r.done += s.completed || 0; r.late += s.overdue || 0;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.all - a.all);
}

export function HomePage() {
  const user = useStore((s) => s.user)!;
  const [widgets, setWidgets] = useState(readWidgets);
  const [tick, setTick] = useState(0), [adding, setAdding] = useState(false), [editing, setEditing] = useState<Widget | null>(null);
  const change = (list: Widget[]) => { setWidgets(list); saveWidgets(list); };
  // Several changes in a row (a drag, a form saving its fields) reload once.
  const later = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const soon = () => { clearTimeout(later.current); later.current = setTimeout(() => { cache = new Map(); quietly(() => setTick((n) => n + 1)); }, 600); };
    cache = new Map(); setTick((n) => n + 1);
    window.addEventListener('dms:entities-changed', soon);
    const off = onLive('work', soon);
    return () => { off(); clearTimeout(later.current); window.removeEventListener('dms:entities-changed', soon); };
  }, []);
  // Dragging a widget by its handle (mouse or finger): a card follows the pointer and the layout shows, as it moves,
  // where the widget will land (a dashed shadow in its place, the row's widths shared again). Beside a widget: into
  // that row (a full row of four takes no more); between rows: a row of its own. Near the top or bottom the page scrolls.
  const [drag, setDrag] = useState<{ id: string; title: string; target: Target | null; newRow: string; x: number; y: number; w: number; dx: number; dy: number } | null>(null);
  const grab = (w: Widget, title: string) => (e: ReactPointerEvent) => {
    if (e.button) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).closest('.home-w')!.getBoundingClientRect();
    let target: Target | null = null;
    const newRow = uid();
    setDrag({ id: w.id, title, target, newRow, x: e.clientX, y: e.clientY, w: Math.min(box.width, 300), dx: e.clientX - box.left, dy: e.clientY - box.top });
    const track = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const gap = el?.closest<HTMLElement>('[data-gap]'), over = el?.closest<HTMLElement>('[data-wid]');
      if (gap) target = { before: gap.dataset.gap || null };
      else if (over && over.dataset.wid !== w.id) { const r = over.getBoundingClientRect(); target = { into: over.dataset.wid!, after: ev.clientX > r.left + r.width / 2 }; }
      setDrag((d) => d && { ...d, target, x: ev.clientX, y: ev.clientY });
      const page = document.querySelector('.home'), r = page?.getBoundingClientRect();
      if (page && r) page.scrollBy(0, ev.clientY < r.top + 48 ? -14 : ev.clientY > r.bottom - 48 ? 14 : 0);
    };
    const drop = () => {
      window.removeEventListener('pointermove', track); window.removeEventListener('pointerup', drop); window.removeEventListener('pointercancel', drop);
      setDrag(null);
      if (target) { const t = target; setWidgets((cur) => { const l = place(cur, w.id, t, newRow); saveWidgets(l); return l; }); }
    };
    window.addEventListener('pointermove', track); window.addEventListener('pointerup', drop); window.addEventListener('pointercancel', drop);
  };
  const shown = drag?.target ? place(widgets, drag.id, drag.target, drag.newRow) : widgets;
  const rows = rowsOf(shown);
  const add = (kind: Kind) => {
    // A list joins the last row when it has room (and is not a table's); a table starts a row of its own.
    const last = rowsOf(widgets).at(-1), join = !KINDS[kind].table && last && last.length < PER_ROW && !last.some((x) => KINDS[x.kind].table);
    const w: Widget = { id: uid(), kind, row: join ? last![0].row : uid() };
    change([...widgets, w]); setAdding(false); setEditing(w);
  };

  const hour = new Date().getHours();
  return (
    <div className={'home' + (drag ? ' dragging' : '')}>
      <header className="home-h">
        <div>
          <h1>{hour < 11 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'}, {user.name.split(' ').pop()}</h1>
          <p>{new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={14} />Thêm widget</button>
      </header>
      <div className="home-grid">
        {rows.map((r, i) => (
          <Fragment key={r[0].row}>
            <div className={'home-gap' + (i === 0 ? ' first' : '') + (drag?.target && 'before' in drag.target && drag.target.before === r[0].row ? ' on' : '')} data-gap={r[0].row} />
            <div className={'home-row n-' + r.length} style={{ '--n': r.length } as CSSProperties}>
              {r.map((w) => (
                <WidgetBox key={w.id} w={w} tick={tick} ghost={drag?.id === w.id} onGrab={grab}
                  onEdit={() => setEditing(w)} onRemove={() => change(widgets.filter((x) => x.id !== w.id))} />
              ))}
            </div>
          </Fragment>
        ))}
        {rows.length > 0 && <div className={'home-gap last' + (drag?.target && 'before' in drag.target && drag.target.before === null ? ' on' : '')} data-gap="" />}
        {!widgets.length && <button type="button" className="home-add" onClick={() => setAdding(true)}><Icon name="plus" size={20} />Thêm widget đầu tiên</button>}
      </div>
      {drag && <div className="home-drag" style={{ left: Math.min(drag.x - Math.min(drag.dx, 32), innerWidth - drag.w - 8), top: drag.y - Math.min(drag.dy, 24), width: drag.w }}><Icon name="grip" size={16} /><b>{drag.title}</b></div>}
      <AddWidget open={adding} onClose={() => setAdding(false)} onReset={() => { change(DEFAULT); setAdding(false); }} onPick={add} />
      {editing && <EditWidget w={editing} onClose={() => setEditing(null)} onSave={(w) => { change(widgets.map((x) => (x.id === w.id ? w : x))); setEditing(null); }} />}
    </div>
  );
}

function WidgetBox({ w, tick, ghost, onGrab, onEdit, onRemove }: {
  w: Widget; tick: number; ghost: boolean; onGrab: (w: Widget, title: string) => (e: ReactPointerEvent) => void; onEdit: () => void; onRemove: () => void;
}) {
  const def = KINDS[w.kind], title = w.title?.trim() || def.title;
  const [tasks, setTasks] = useState<TaskItem[] | null>(null), [rows, setRows] = useState<Row[] | null>(null), [error, setError] = useState('');
  const [menu, setMenu] = useState<HTMLElement | null>(null), [full, setFull] = useState(false);
  // Đồng bộ: this widget's data asked for again (a new `own`), its icon turning until it is back.
  const [own, setOwn] = useState(0), [busy, setBusy] = useState(false);
  const sync = () => { cache.delete(keyOf(w.kind)); setBusy(true); setOwn((n) => n + 1); };
  useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open], .bk-pop')) setFull(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [full]);
  useEffect(() => {
    let live = true;
    const done = (f: () => void) => { if (live) { f(); setError(''); setBusy(false); } }, fail = (e: Error) => { if (live) { setError(e.message); setBusy(false); } };
    if (def.table) loadRows(w.kind, w.customer).then((r) => done(() => setRows(r)), fail);
    else loadTasks(w.kind).then((l) => done(() => setTasks(l.filter((t) => !w.customer || t.customer?.id === w.customer).sort(w.kind === 'review' ? (a, b) => (a.submittedAt ?? a.updatedAt) - (b.submittedAt ?? b.updatedAt) : byDue))), fail);
    return () => { live = false; };
  }, [tick, own, w.kind, w.customer]);
  const count = def.table ? undefined : tasks?.length;
  const act = (f?: () => void) => () => { setMenu(null); f?.(); };
  return (
    <>{full && <div className="home-w-back" onClick={() => setFull(false)} />}
    <section className={'home-w' + (full ? ' full' : '') + (ghost ? ' ghost' : '')} data-wid={w.id}>
      <header>
        {!full && <button type="button" className="home-w-grip" onPointerDown={onGrab(w, title)} title="Kéo để đổi vị trí" aria-label={`Kéo để đổi vị trí widget ${title}`}><Icon name="grip" size={16} /></button>}
        <button type="button" className="home-w-title" onClick={() => goto(def.page)} title="Xem tất cả">
          <h2><span title={title}>{title}</span>{count ? <em>{count}</em> : null}</h2>{w.customer && <small>{w.customerName}</small>}
        </button>
        <button type="button" className={'bd-icon home-w-sync' + (busy ? ' spin' : '')} onClick={sync} title="Đồng bộ" aria-label="Đồng bộ"><Icon name="refresh" size={15} /></button>
        <button type="button" className="bd-icon" onClick={() => setFull(!full)} title={full ? 'Thu nhỏ' : 'Mở rộng'} aria-label={full ? 'Thu nhỏ' : 'Mở rộng'}><Icon name={full ? 'x' : 'expand'} size={15} /></button>
        <button type="button" className={'bd-icon' + (menu ? ' on' : '')} onClick={(e) => setMenu(menu ? null : e.currentTarget)} aria-label={`Thao tác với widget ${title}`} aria-expanded={!!menu}><Icon name="more" size={16} /></button>
      </header>
      <div className="home-w-body">
        {error ? <p className="note err" role="alert">{error}</p>
          : def.table ? (!rows ? <Loading /> : (w.view && w.view !== 'table') ? <RowChart rows={rows} view={w.view} /> : <Table rows={rows} cols={w.cols || ALL_COLS} first={w.kind === 'customers' ? 'Khách hàng' : w.kind === 'services' ? 'Dịch vụ' : 'Nhân viên'} />)
          : !tasks ? <Loading /> : !tasks.length ? <Empty text="Không có việc nào ở đây." /> : (w.view && w.view !== 'list') ? <TaskChart tasks={tasks} view={w.view} page={def.page} /> : <TaskRows tasks={tasks} limit={full ? Infinity : LIMIT} fields={w.fields || ALL_FIELDS} who={['given', 'review', 'following'].includes(w.kind) ? 'assignee' : 'creator'} />}
      </div>
      {menu && <Pop anchor={menu} title={title} onClose={() => setMenu(null)} width={220}><div className="bk-menu">
        <button onClick={act(onEdit)}><Icon name="edit" size={16} />Sửa widget</button>
        <button className="bk-danger-link" onClick={act(onRemove)}><Icon name="trash" size={16} />Xoá widget</button>
      </div></Pop>}
    </section></>
  );
}

const Loading = () => <p className="note">Đang tải…</p>;

// The states' colours (--chart-*: done green, in progress blue, late red, no date gray), checked for colour-blind readers.
const C = { done: 'var(--chart-done)', doing: 'var(--chart-doing)', late: 'var(--chart-late)', none: 'var(--chart-none)' };
const dm = (t: number) => new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });

/** A widget's tasks as a chart: by step, by when they are due, day by day, late or not, by customer, or as numbers. */
function TaskChart({ tasks, view, page }: { tasks: TaskItem[]; view: ViewKind; page: View }) {
  const now = Date.now(), today = dayStart(), open = () => goto(page);
  const late = tasks.filter((t) => t.dueAt && t.dueAt < now).length, none = tasks.filter((t) => !t.dueAt).length;
  const due = (from: number, to: number) => tasks.filter((t) => t.dueAt && t.dueAt >= Math.max(from, now) && t.dueAt < to).length;
  if (view === 'stage') {
    const by = new Map<string, number>();
    for (const t of tasks) { const k = t.stage || 'other'; by.set(k, (by.get(k) || 0) + 1); }
    const items: Part[] = [...STEP_ORDER.filter((k) => by.has(k)), ...(by.has('other') ? ['other'] : [])]
      .map((k) => ({ label: k === 'other' ? 'Khác' : stepCode(k as FlowStage), value: by.get(k)!, color: k === 'other' ? C.none : `var(--stage-${k})`, onClick: open }));
    return <Columns items={items} />;
  }
  if (view === 'due') return <Columns items={[
    { label: 'Quá hạn', value: late, color: C.late, onClick: open }, { label: 'Hôm nay', value: due(today, today + DAY), color: C.doing, onClick: open },
    { label: '7 ngày tới', value: due(today + DAY, today + 8 * DAY), color: C.doing, onClick: open }, { label: 'Sau đó', value: due(today + 8 * DAY, Infinity), color: C.doing, onClick: open },
    { label: 'Chưa có hạn', value: none, color: C.none, onClick: open }]} />;
  if (view === 'days') return <Columns items={Array.from({ length: 14 }, (_, i) => ({ label: i ? dm(today + i * DAY) : 'Hôm nay', value: due(today + i * DAY, today + (i + 1) * DAY), color: C.doing, onClick: open }))}
    note={late ? <p className="hc-note">Ngoài ra {late} việc đã quá hạn.</p> : null} />;
  if (view === 'status') return <Donut caption="việc" parts={[{ label: 'Quá hạn', value: late, color: C.late, onClick: open }, { label: 'Còn hạn', value: tasks.length - late - none, color: C.doing, onClick: open }, { label: 'Chưa có hạn', value: none, color: C.none, onClick: open }]} />;
  if (view === 'customer') {
    const by = new Map<string, { label: string; value: number; id?: string }>();
    for (const t of tasks) { const k = t.customer?.id || '-', r = by.get(k) || { label: t.customer?.name || 'Chưa gắn khách hàng', value: 0, id: t.customer?.id }; r.value++; by.set(k, r); }
    return <Bars items={[...by.values()].sort((a, b) => b.value - a.value).slice(0, 10).map((r) => ({ ...r, color: C.doing, onClick: r.id ? () => openLink(`#customers/${r.id}`) : undefined }))} />;
  }
  return <Stats items={[{ label: 'Tổng', value: tasks.length, onClick: open }, { label: 'Quá hạn', value: late, tone: late ? 'bad' : undefined, onClick: open }, { label: 'Hôm nay', value: due(today, today + DAY), onClick: open }, { label: 'Chưa có hạn', value: none, onClick: open }]} />;
}

/** A widget's rows of counts as a chart: stacked bars, columns of totals, a donut of all of them, or numbers. */
function RowChart({ rows, view }: { rows: Row[]; view: ViewKind }) {
  const parts = (r: Pick<Row, 'all' | 'done' | 'late'>): Part[] => [
    { label: 'Hoàn thành', value: r.done, color: C.done }, { label: 'Đang làm', value: Math.max(0, r.all - r.done - r.late), color: C.doing }, { label: 'Quá hạn', value: r.late, color: C.late }];
  const sum = rows.reduce((s, r) => ({ all: s.all + r.all, done: s.done + r.done, late: s.late + r.late }), { all: 0, done: 0, late: 0 });
  if (!rows.length) return <Empty text="Chưa có công việc nào ở đây." />;
  if (view === 'stacked') return <Stacked legend={parts(sum)} rows={rows.slice(0, 15).map((r) => ({ label: r.name, parts: parts(r), onClick: r.open }))} />;
  if (view === 'columns') return <Columns items={rows.slice(0, 12).map((r) => ({ label: r.name, value: r.all, color: C.doing, onClick: r.open }))} />;
  if (view === 'donut') return <Donut caption="việc" parts={parts(sum)} total={sum.all} />;
  return <Stats items={[{ label: 'Tất cả', value: sum.all }, { label: 'Đang làm', value: Math.max(0, sum.all - sum.done - sum.late) }, { label: 'Quá hạn', value: sum.late, tone: sum.late ? 'bad' : undefined }, { label: 'Hoàn thành', value: sum.done, tone: 'good' }]} />;
}
const Empty = ({ text }: { text: string }) => <div className="home-empty"><Icon name="check" size={26} /><p>{text}</p></div>;

/** Tasks as rows: the title, and the fields the widget shows (step, where it belongs, due date in red when late, person). */
function TaskRows({ tasks, fields, who, limit }: { tasks: TaskItem[]; fields: Field[]; who: 'creator' | 'assignee'; limit: number }) {
  const now = Date.now(), has = (f: Field) => fields.includes(f);
  return (
    <ul className="home-tasks">
      {tasks.slice(0, limit).map((t) => {
        const person = who === 'creator' ? t.createdBy : t.assignees[0], late = !!t.dueAt && t.dueAt < now;
        const place = [t.customer?.name, t.brandService?.name || t.project?.name].filter(Boolean).join(' · ');
        return (
          <li key={t.id}><button type="button" onClick={() => openTask(t.id)}>
            <span className="home-t-main">
              <b>{t.title}</b>
              {(has('stage') || (has('place') && place)) && <span className="home-t-sub">{has('stage') && <Badge t={t} />}{has('place') && place && <small>{place}</small>}</span>}
            </span>
            {has('due') && t.dueAt && <time className={late ? 'late' : ''}>{shortDate(t.dueAt)}</time>}
            {has('person') && person && <span className="home-t-who" title={person.name}><Avatar m={person} size={26} /></span>}
          </button></li>
        );
      })}
      {tasks.length > limit && <li className="home-more">… và {tasks.length - limit} việc nữa</li>}
    </ul>
  );
}

/** Rows of counts, busiest first, in the columns the widget shows. */
function Table({ rows, cols, first }: { rows: Row[]; cols: Col[]; first: string }) {
  if (!rows.length) return <Empty text="Chưa có công việc nào ở đây." />;
  const has = (c: Col) => cols.includes(c), pct = (n: number, all: number) => `${(n / all) * 100}%`;
  const heads = COLS.filter(([c]) => c !== 'bar' && has(c));
  return (
    <div className="home-ov-scroll">
      <table className="home-ov">
        <thead><tr><th>{first}</th>{heads.map(([c, l]) => <th key={c}>{l}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => {
            const n: Record<Col, number> = { all: r.all, doing: Math.max(0, r.all - r.done - r.late), late: r.late, done: r.done, bar: 0 };
            return (
              <tr key={r.key} className={r.open ? 'go' : ''} onClick={r.open}>
                <th scope="row"><div>
                  <span className="home-ov-name">{r.name}</span>
                  {has('bar') && <span className="home-ov-bar" aria-hidden="true"><i className="done" style={{ width: pct(n.done, r.all) }} /><i className="doing" style={{ width: pct(n.doing, r.all) }} /><i className="late" style={{ width: pct(n.late, r.all) }} /></span>}
                </div></th>
                {heads.map(([c]) => <td key={c} className={c}>{n[c]}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Tạo widget: every kind as a card with a sketch of how it looks; picking one adds it and opens its settings. */
function AddWidget({ open, onClose, onPick, onReset }: { open: boolean; onClose: () => void; onPick: (k: Kind) => void; onReset: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Thêm widget" wide footer={<button type="button" className="btn btn-gray btn-sm" onClick={onReset}>Khôi phục mặc định</button>}>
      <div className="home-pick">
        {ORDER.map((k) => (
          <button key={k} type="button" onClick={() => onPick(k)}>
            <span className="home-pick-h"><Icon name={KINDS[k].icon} size={16} /><b>{KINDS[k].title}</b></span>
            <span className={'home-pick-sketch' + (KINDS[k].table ? ' table' : '')} aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} />)}</span>
            <small>{KINDS[k].about}</small>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Sửa widget: its name, one customer (the customers come from the services this account sees), what it shows, its width. */
function EditWidget({ w, onClose, onSave }: { w: Widget; onClose: () => void; onSave: (w: Widget) => void }) {
  const def = KINDS[w.kind];
  const [title, setTitle] = useState(w.title || ''), [customer, setCustomer] = useState(w.customer || ''), [view, setView] = useState<ViewKind>(w.view || (def.table ? 'table' : 'list'));
  const [fields, setFields] = useState<Field[]>(w.fields || ALL_FIELDS), [cols, setCols] = useState<Col[]>(w.cols || ALL_COLS);
  const [list, setList] = useState<BrandServiceItem[]>([]);
  useEffect(() => { services().then(setList, () => {}); }, []);
  const customers = useMemo(() => [...new Map(list.filter((s) => s.customerId).map((s) => [s.customerId!, s.customerName || 'Khách hàng'])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi')), [list]);
  const toggle = <T,>(l: T[], x: T) => (l.includes(x) ? l.filter((y) => y !== x) : [...l, x]);
  const save = () => onSave({ ...w, title: title.trim() || undefined, customer: customer || undefined, customerName: customers.find(([id]) => id === customer)?.[1], view, ...(def.table ? { cols } : { fields }) });
  return (
    <Sheet open onClose={onClose} title="Sửa widget" footer={<><button type="button" className="btn btn-gray btn-sm" onClick={onClose}>Huỷ</button><button type="button" className="btn btn-primary btn-sm" onClick={save}>Lưu</button></>}>
      <form className="home-edit" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label><span>Tên widget</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={def.title} /></label>
        <label><span>Khách hàng</span>
          <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">Tất cả khách hàng</option>
            {customers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
        <fieldset><legend>Kiểu hiển thị</legend>
          <div className="home-views">{(def.table ? TABLE_VIEWS : TASK_VIEWS).map(([v, l, icon]) => (
            <button key={v} type="button" className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)}><Icon name={icon} size={18} />{l}</button>
          ))}</div>
        </fieldset>
        {(view === 'list' || view === 'table') && <fieldset><legend>{def.table ? 'Cột hiển thị' : 'Trường hiển thị'}</legend>
          {def.table
            ? COLS.map(([c, l]) => <label key={c} className="home-check"><input type="checkbox" checked={cols.includes(c)} onChange={() => setCols(toggle(cols, c))} />{l}</label>)
            : FIELDS.map(([f, l]) => <label key={f} className="home-check"><input type="checkbox" checked={fields.includes(f)} onChange={() => setFields(toggle(fields, f))} />{l}</label>)}
        </fieldset>}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
