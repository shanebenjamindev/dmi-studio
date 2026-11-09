// How a workspace on the Workspace home lists its boards: as tiles, as a list (sorted by name, client, start date or last
// change), or as a dashboard of the work by client: figures and charts to click (a client, a stage, a service narrows
// everything below), then each client's work as a tree (tasks with their subtasks), so a manager sees at a glance what
// each client still has going on and opens the task or the client from there.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { remember } from '../prefs';
import { openLink, toast } from '../store';
import { Icon } from './ui';
import { Avatar, dueState, shortDate } from './boardkit';
import { BrandLoading } from './BrandLoading';
import type { Board, BoardItem, ClientCard } from '../types';

export type WsView = 'tiles' | 'list' | 'clients';
export const WS_VIEWS: { value: WsView; label: string; icon: string }[] = [
  { value: 'tiles', label: 'Board', icon: 'grid' },
  { value: 'list', label: 'Danh sách board', icon: 'list' },
  { value: 'clients', label: 'Dashboard', icon: 'activity' },
];
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
/** A choice kept in this browser and with the account (prefs.ts). */
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } remember(k, v); };
export const savedWsView = (): WsView => { const v = read('dms.wsView'); return v === 'list' || v === 'clients' ? v : 'tiles'; };
export const saveWsView = (v: WsView) => keep('dms.wsView', v);
const day = (ms: number | null) => (ms ? shortDate(ms) : '—');
const byText = (a: string, b: string) => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' });

/** Pages of a long list: the range shown, then the page numbers to pick (the first, the last and those around this one). */
function Pages({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.ceil(total / size);
  if (pages <= 1) return null;
  const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  return <nav className="ws-pages" aria-label="Phân trang">
    <span>{`${(page - 1) * size + 1}–${Math.min(total, page * size)} / ${total}`}</span>
    <button disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Trang trước"><Icon name="left" size={13} /></button>
    {nums.map((n, i) => <Fragment key={n}>{i > 0 && n - nums[i - 1] > 1 && <span className="ws-pages-gap">…</span>}
      <button className={n === page ? 'on' : ''} aria-current={n === page ? 'page' : undefined} aria-label={`Trang ${n}`} onClick={() => onPage(n)}>{n}</button></Fragment>)}
    <button disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Trang sau"><Icon name="right" size={13} /></button>
  </nav>;
}
/** A page of a list (back to the first when `reset` changes); the page asked for stays within those there are. */
function usePage<T>(list: T[], size: number, reset: unknown) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [reset]);
  const at = Math.min(page, Math.max(1, Math.ceil(list.length / size)));
  return { items: list.slice((at - 1) * size, at * size), pager: <Pages page={at} size={size} total={list.length} onPage={setPage} /> };
}

// ---------------------------------------------------------------- the boards as a list
type BoardSort = 'name' | 'client' | 'start' | 'updated';
/** The boards as a list; a board opens out (its row, or the arrow) into what is on it, as a tree. Its name opens it. */
export function BoardList({ boards, bgOf, onOpen, onCard }: { boards: BoardItem[]; bgOf: (bg: string) => string; onOpen: (id: string) => void; onCard: (boardId: string, cardId: string) => void }) {
  const [sort, setSort] = useState<BoardSort>('updated'), [reverse, setReverse] = useState(false), [open, setOpen] = useState<Set<string>>(() => new Set());
  const sorted = [...boards].sort((a, b) => {
    const n = sort === 'name' ? byText(a.name, b.name) : sort === 'client' ? byText(a.customerName || '￿', b.customerName || '￿')
      : sort === 'start' ? (b.startAt || 0) - (a.startAt || 0) : b.updatedAt - a.updatedAt;
    return reverse ? -n : n;
  });
  const head = (key: BoardSort, label: string) => <th scope="col" aria-sort={sort === key ? (reverse ? 'descending' : 'ascending') : undefined}>
    <button onClick={() => { if (sort === key) setReverse(!reverse); else { setSort(key); setReverse(false); } }}>{label}{sort === key && <Icon name={reverse ? 'up' : 'down'} size={12} />}</button>
  </th>;
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const { items, pager } = usePage(sorted, 15, `${sort}${reverse}`);
  if (!boards.length) return <p className="note ws-empty">Workspace này chưa có board nào.</p>;
  return <><div className="ws-table-wrap"><table className="ws-table">
    <thead><tr>{head('name', 'Board')}{head('client', 'Khách hàng')}<th scope="col">Loại (dịch vụ)</th>{head('start', 'Ngày bắt đầu')}<th scope="col">Thẻ</th>{head('updated', 'Cập nhật')}</tr></thead>
    <tbody>{items.map((b) => <Fragment key={b.id}>
      <tr className={open.has(b.id) ? 'open' : ''} onClick={() => toggle(b.id)}>
        <th scope="row"><span className="ws-board-cell">
          <button className="tk-fold" aria-expanded={open.has(b.id)} aria-label={open.has(b.id) ? 'Thu gọn' : 'Mở rộng'} onClick={(e) => { e.stopPropagation(); toggle(b.id); }}><Icon name={open.has(b.id) ? 'down' : 'right'} size={12} /></button>
          <button className="ws-board-name" title="Mở board" onClick={(e) => { e.stopPropagation(); onOpen(b.id); }}><i className="ws-bcolor" style={{ background: bgOf(b.bg) }} />{b.name}</button>
        </span></th>
        <td>{b.customerName || '—'}</td><td>{b.services?.map((x) => x.name).join(', ') || '—'}</td><td>{day(b.startAt ?? null)}</td><td>{b.taskCount ?? b.cards}</td><td>{shortDate(b.updatedAt)}</td>
      </tr>
      {open.has(b.id) && <tr className="ws-sub"><td colSpan={6}><BoardTree id={b.id} stamp={b.updatedAt} onCard={(cardId) => onCard(b.id, cardId)} /></td></tr>}
    </Fragment>)}</tbody>
  </table></div>{pager}</>;
}

/** What is on a board, as a tree: clients' and projects' cards first, the tasks under their project; each card opens on
 *  its board. Long levels come in pages. */
function BoardTree({ id, stamp, onCard }: { id: string; stamp: number; onCard: (cardId: string) => void }) {
  const [board, setBoard] = useState<Board | null>(null), [error, setError] = useState('');
  useEffect(() => { let on = true; api.board(id).then((b) => { if (on) setBoard(b); }, (e) => { if (on) setError(e.message); }); return () => { on = false; }; }, [id, stamp]);
  if (error) return <p className="note err">{error}</p>;
  if (!board) return <BrandLoading compact />;
  const cards = board.lists.flatMap((l) => l.cards.map((c) => ({ ...c, listName: l.name })));
  const ids = new Set(cards.map((c) => c.id));
  // A task sits under its project's card; anything whose project is not on the board is at the top.
  const parentOf = (c: (typeof cards)[number]) => (c.projectCardId && ids.has(c.projectCardId) ? c.projectCardId : '');
  const under = new Map<string, typeof cards>();
  for (const c of cards) { const p = parentOf(c); under.set(p, [...(under.get(p) || []), c]); }
  const rank = { customer: 0, project: 1, task: 2 } as const;
  const sorted = (list: typeof cards) => [...list].sort((a, b) => rank[a.kind || 'task'] - rank[b.kind || 'task'] || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || byText(a.title, b.title));
  if (!cards.length) return <p className="cw-none ws-tree-empty">Board này chưa có thẻ nào.</p>;
  return <TreeLevel list={sorted(under.get('') || [])} depth={0} under={(c) => sorted(under.get(c.id) || [])} board={board} onCard={onCard} />;
}
const KIND_ICON = { customer: 'users', project: 'folder', task: 'checklist' } as const;
type TreeCard = Board['lists'][number]['cards'][number] & { listName: string };
function TreeLevel({ list, depth, under, board, onCard }: { list: TreeCard[]; depth: number; under: (c: TreeCard) => TreeCard[]; board: Board; onCard: (cardId: string) => void }) {
  const { items, pager } = usePage(list, 12, list.length);
  return <><ul className={depth ? '' : 'ws-tree'}>{items.map((c) => <TreeNode key={c.id} c={c} depth={depth} under={under} board={board} onCard={onCard} />)}</ul>{pager}</>;
}
function TreeNode({ c, depth, under, board, onCard }: { c: TreeCard; depth: number; under: (c: TreeCard) => TreeCard[]; board: Board; onCard: (cardId: string) => void }) {
  const [open, setOpen] = useState(depth < 1);
  const kids = depth < 6 ? under(c) : [], kind = c.kind || 'task', due = dueState(c.dueAt, c.done);
  const people = board.members.filter((m) => c.members.includes(m.id)).slice(0, 3);
  return <li>
    <div className="cw-row">
      {kids.length
        ? <button className="tk-fold" aria-expanded={open} aria-label={open ? 'Thu gọn' : 'Mở rộng'} onClick={() => setOpen(!open)}><Icon name={open ? 'down' : 'right'} size={12} /></button>
        : <span className="tk-fold" />}
      <button className={'cw-row-open ws-card ' + kind} onClick={() => onCard(c.id)}>
        <Icon name={KIND_ICON[kind]} size={14} />
        <span className={'cw-state' + (c.done ? ' done' : '')}><i />{c.listName}</span>
        <span className="cw-title"><b>{c.title}</b>{kids.length > 0 && <small>{`${kids.length} thẻ bên trong`}</small>}</span>
        {c.dueAt && <time className={'cw-due ' + due}>{day(c.dueAt)}</time>}
        {people.length > 0 && <span className="cw-people">{people.map((m) => <Avatar key={m.id} m={m} size={20} />)}</span>}
      </button>
    </div>
    {open && kids.length > 0 && <TreeLevel list={kids} depth={depth + 1} under={under} board={board} onCard={onCard} />}
  </li>;
}

// ---------------------------------------------------------------- the work by client
type Stage = ClientCard['stage'];
/** Where work stands, in the order the bars stack (late first). Status colours, always named beside them. */
const STAGES: { key: Stage; label: string }[] = [{ key: 'overdue', label: 'Quá hạn' }, { key: 'doing', label: 'Đang làm' }, { key: 'todo', label: 'Chưa làm' }, { key: 'done', label: 'Xong' }];
const STAGE_NAME = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<Stage, string>;
type Sort = 'status' | 'service' | 'due' | 'start';
const SORTS: { value: Sort; label: string }[] = [{ value: 'status', label: 'Trạng thái' }, { value: 'service', label: 'Dịch vụ' }, { value: 'due', label: 'Thời hạn' }, { value: 'start', label: 'Ngày bắt đầu' }];
const NO_SERVICE = '';
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
const soon = (c: ClientCard) => c.stage !== 'done' && c.stage !== 'overdue' && !!c.dueAt && c.dueAt - Date.now() < 7 * 864e5;
/** What the figures and charts narrow the work to (clicked there, shown as chips above). */
type Focus = { client?: string; stage?: Stage | 'open' | 'soon'; service?: string };
type Tip = { x: number; y: number; title: string; rows: { label: string; value: number; color: string }[] };

export function ClientWork({ wsId, client, boards, onCard, onTask }: { wsId: string; client?: { id: string; name: string }; boards: BoardItem[]; onCard: (boardId: string, cardId: string) => void; onTask: (taskId: string) => void }) {
  const [rows, setRows] = useState<ClientCard[] | null>(null), [error, setError] = useState('');
  const [q, setQ] = useState(''), [focus, setFocus] = useState<Focus>({ stage: 'open' }), [tip, setTip] = useState<Tip | null>(null);
  const [sort, setSortState] = useState<Sort>(() => { const v = read('dms.clientSort'); return SORTS.some((s) => s.value === v) ? v as Sort : 'due'; });
  const setSort = (v: Sort) => { setSortState(v); keep('dms.clientSort', v); };
  // Again when the boards change (a card moved or finished there).
  const stamp = boards.map((b) => b.id + b.updatedAt).join();
  const load = () => api.clientWork(wsId).then((r) => { setRows(r); setError(''); }, (e) => setError(e.message));
  useEffect(() => { void load(); }, [wsId, stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  // Dragged onto another task: it becomes that task's subtask (onto the client's box: a task of its own). Shown at once,
  // then as the server has it.
  const move = async (task: string, parent: string | null) => {
    setRows((r) => r && r.map((c) => (c.taskId === task ? { ...c, parentTaskId: parent } : c)));
    try { await api.updateTask(task, { parentId: parent }); toast(parent ? 'Đã chuyển thành việc con' : 'Đã chuyển thành việc chính'); }
    catch (e: any) { toast(e.message, true); }
    void load();
  };
  const names = useMemo(() => {
    const m = new Map<string, string>();
    // The workspace's customer, and those of its boards, show even with nothing to do.
    if (client) m.set(client.id, client.name);
    for (const b of boards) if (b.customerId) m.set(b.customerId, b.customerName || '');
    for (const c of rows || []) m.set(c.customerId, c.customerName);
    return m;
  }, [rows, boards, client?.id, client?.name]);
  // The work the figures count: the client, service and words asked for (the stage is what they break it down by).
  const f = fold(q.trim());
  const said = (c: ClientCard) => !f || fold(`${c.title} ${c.customerName} ${c.boardName} ${c.listName} ${c.services.map((s) => s.name).join(' ')} ${c.labels.map((l) => l.name).join(' ')} ${c.members.map((p) => p.name).join(' ')}`).includes(f);
  const ofService = (c: ClientCard) => focus.service === undefined || (focus.service === NO_SERVICE ? !c.services.length : c.services.some((s) => s.id === focus.service));
  const counted = (rows || []).filter((c) => (!focus.client || c.customerId === focus.client) && ofService(c) && said(c));
  const staged = (c: ClientCard) => !focus.stage || (focus.stage === 'open' ? c.stage !== 'done' : focus.stage === 'soon' ? soon(c) : c.stage === focus.stage);
  const stats = { open: counted.filter((c) => c.stage !== 'done').length, overdue: counted.filter((c) => c.stage === 'overdue').length, soon: counted.filter(soon).length, done: counted.filter((c) => c.stage === 'done').length };
  // Per client, per stage (the done ones only when they are asked for); clients with the most open work first.
  const shownStages = STAGES.filter((s) => focus.stage !== 'open' || s.key !== 'done');
  const perClient = [...names.keys()].filter((id) => !focus.client || id === focus.client).map((id) => {
    const mine = counted.filter((c) => c.customerId === id);
    return { id, name: names.get(id) || '', counts: Object.fromEntries(STAGES.map((s) => [s.key, mine.filter((c) => c.stage === s.key).length])) as Record<Stage, number> };
  }).filter((k) => !f || k.counts.overdue + k.counts.doing + k.counts.todo + k.counts.done > 0 || fold(k.name).includes(f))
    .sort((a, b) => (b.counts.overdue + b.counts.doing + b.counts.todo) - (a.counts.overdue + a.counts.doing + a.counts.todo) || byText(a.name, b.name));
  // Open work per service (one series): every service a task names, and those naming none.
  const serviceRows = (() => {
    const open = (rows || []).filter((c) => c.stage !== 'done' && (!focus.client || c.customerId === focus.client) && said(c)), m = new Map<string, { key: string; label: string; value: number }>();
    for (const c of open) for (const s of c.services.length ? c.services : [{ id: NO_SERVICE, name: 'Chưa có dịch vụ' }]) { const x = m.get(s.id) || { key: s.id, label: s.name, value: 0 }; x.value++; m.set(s.id, x); }
    return [...m.values()].sort((a, b) => b.value - a.value || byText(a.label, b.label));
  })();
  const asked = JSON.stringify([focus, q]);
  const clientPage = usePage(perClient, 8, asked), servicePage = usePage(serviceRows, 8, asked), boxPage = usePage(perClient, 6, asked);
  const pick = (next: Focus) => { setFocus(next); setTip(null); };
  const chips = [
    focus.client && { label: names.get(focus.client) || '', clear: () => pick({ ...focus, client: undefined }) },
    focus.stage && focus.stage !== 'open' && { label: focus.stage === 'soon' ? 'Đến hạn trong 7 ngày' : STAGE_NAME[focus.stage], clear: () => pick({ ...focus, stage: 'open' }) },
    focus.service !== undefined && { label: focus.service === NO_SERVICE ? 'Chưa có dịch vụ' : serviceRows.find((s) => s.key === focus.service)?.label || (rows || []).flatMap((c) => c.services).find((s) => s.id === focus.service)?.name || '', clear: () => pick({ ...focus, service: undefined }) },
  ].filter(Boolean) as { label: string; clear: () => void }[];
  const tile = (key: 'open' | 'overdue' | 'soon' | 'done', label: string, value: number) => (
    <button className={'cw-stat ' + key + ((focus.stage || 'all') === key ? ' on' : '')} aria-pressed={focus.stage === key} onClick={() => pick({ ...focus, stage: focus.stage === key && key !== 'open' ? 'open' : key })}>
      <span>{label}</span><b>{value}</b>
    </button>
  );
  const clientTip = (e: React.PointerEvent | React.FocusEvent, k: (typeof perClient)[number]) => {
    const r = 'clientX' in e ? { x: e.clientX, y: e.clientY } : (() => { const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); return { x: b.right, y: b.top }; })();
    setTip({ ...r, title: k.name, rows: shownStages.map((s) => ({ label: s.label, value: k.counts[s.key], color: `var(--cw-${s.key})` })) });
  };
  const max = Math.max(1, ...perClient.map((k) => shownStages.reduce((a, s) => a + k.counts[s.key], 0))), smax = Math.max(1, ...serviceRows.map((s) => s.value));
  return <section className="cw" aria-label="Công việc theo khách hàng">
    <div className="cw-tools">
      <label className="cw-find"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm khách, việc, dịch vụ, người làm…" aria-label="Tìm trong công việc theo khách hàng" /></label>
      <label className="cw-sort"><span>Sắp xếp theo</span><select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>{SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
      {chips.map((c, i) => <span key={i} className="cw-chip">{c.label}<button onClick={c.clear} aria-label={`Bỏ lọc ${c.label}`}><Icon name="x" size={12} /></button></span>)}
      {chips.length > 1 && <button className="cw-clear" onClick={() => pick({ stage: 'open' })}>Xoá lọc</button>}
    </div>
    {error ? <p className="note err">{error}</p> : !rows ? <BrandLoading compact /> : !names.size
      ? <p className="note ws-empty">Chưa có board hay thẻ nào gắn khách hàng trong workspace này. Gắn khách hàng cho board (menu board › Khách hàng) hoặc cho từng thẻ.</p>
      : <>
        <div className="cw-stats">{tile('open', 'Đang mở', stats.open)}{tile('overdue', 'Quá hạn', stats.overdue)}{tile('soon', 'Đến hạn trong 7 ngày', stats.soon)}{tile('done', 'Đã xong', stats.done)}</div>
        <div className="cw-charts">
          <ChartBox title="Việc theo khách hàng" sub="Bấm tên để chỉ xem khách đó, bấm một đoạn để lọc theo trạng thái." legend={shownStages.map((s) => ({ label: s.label, color: `var(--cw-${s.key})` }))}
            table={{ head: ['Khách hàng', ...shownStages.map((s) => s.label)], rows: perClient.map((k) => [k.name, ...shownStages.map((s) => k.counts[s.key])]) }}>
            {!perClient.length ? <p className="cw-none">Không có gì khớp tìm kiếm.</p> : <><ul className="cw-bars">{clientPage.items.map((k) => {
              const total = shownStages.reduce((a, s) => a + k.counts[s.key], 0);
              return <li key={k.id} className={focus.client === k.id ? 'on' : ''}>
                <button className="cw-bar-name" onClick={() => pick({ ...focus, client: focus.client === k.id ? undefined : k.id })} title="Chỉ xem khách này">{k.name}</button>
                <span className="cw-bar-track" onPointerMove={(e) => clientTip(e, k)} onPointerLeave={() => setTip(null)}>
                  {shownStages.map((s) => k.counts[s.key] ? <button key={s.key} className="cw-seg" style={{ width: `${(k.counts[s.key] / max) * 100}%`, background: `var(--cw-${s.key})` }}
                    aria-label={`${k.name}: ${k.counts[s.key]} ${s.label}`} onFocus={(e) => clientTip(e, k)} onBlur={() => setTip(null)} onClick={() => pick({ ...focus, client: k.id, stage: s.key })} /> : null)}
                </span>
                <b className="cw-bar-value">{total}</b>
                <button className="cw-bar-open" onClick={() => openLink(`#customers/${k.id}`)} aria-label={`Mở khách hàng ${k.name}`} title="Mở trang khách hàng"><Icon name="right" size={13} /></button>
              </li>;
            })}</ul>{clientPage.pager}</>}
          </ChartBox>
          <ChartBox title="Việc đang mở theo dịch vụ" sub="Bấm một dịch vụ để lọc." table={{ head: ['Dịch vụ', 'Việc đang mở'], rows: serviceRows.map((s) => [s.label, s.value]) }}>
            {!serviceRows.length ? <p className="cw-none">Không còn việc đang mở.</p> : <><ul className="cw-bars single">{servicePage.items.map((s) => (
              <li key={s.key || '-'} className={focus.service === s.key ? 'on' : ''}>
                <button className="cw-bar-name" onClick={() => pick({ ...focus, service: focus.service === s.key ? undefined : s.key })}>{s.label}</button>
                <span className="cw-bar-track"><button className="cw-seg" style={{ width: `${(s.value / smax) * 100}%`, background: 'var(--cw-bar)' }} aria-label={`${s.label}: ${s.value}`}
                  onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, title: s.label, rows: [{ label: 'Việc đang mở', value: s.value, color: 'var(--cw-bar)' }] })} onPointerLeave={() => setTip(null)}
                  onClick={() => pick({ ...focus, service: focus.service === s.key ? undefined : s.key })} /></span>
                <b className="cw-bar-value">{s.value}</b>
              </li>
            ))}</ul>{servicePage.pager}</>}
          </ChartBox>
        </div>
        <div className="cw-grid">{boxPage.items.map((k) => <ClientTree key={k.id} id={k.id} name={k.name} items={(rows || []).filter((c) => c.customerId === k.id)} shown={(c) => staged(c) && ofService(c) && said(c)} sort={sort} onCard={onCard} onTask={onTask} onMove={move} />)}</div>
        {boxPage.pager}
      </>}
    {tip && <div className="cw-tip" role="tooltip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 220), top: tip.y + 14 }}>
      <small>{tip.title}</small>
      {tip.rows.map((r) => <span key={r.label}><i style={{ background: r.color }} /><b>{r.value}</b>{r.label}</span>)}
    </div>}
  </section>;
}

/** A chart's frame: its title, a legend when it has two series or more, and the same numbers as a table on request. */
function ChartBox({ title, sub, legend, table, children }: { title: string; sub: string; legend?: { label: string; color: string }[]; table: { head: string[]; rows: (string | number)[][] }; children: React.ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return <article className="cw-chart">
    <header><div><h3>{title}</h3><p>{sub}</p></div><button className="cw-switch" aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>{asTable ? 'Biểu đồ' : 'Bảng số liệu'}</button></header>
    {legend && legend.length > 1 && !asTable && <ul className="cw-legend">{legend.map((l) => <li key={l.label}><i style={{ background: l.color }} />{l.label}</li>)}</ul>}
    {asTable ? <div className="ws-table-wrap"><table className="ws-table"><thead><tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div> : children}
  </article>;
}

/** One client's work as a tree: each task with its subtasks under it (folded or not). Work that does not match what is
 *  asked for stays only as the way to work that does, dimmed. */
/** The task being dragged between rows (one at a time, across the boxes of one dashboard). */
let dragging: ClientCard | null = null;
function ClientTree({ id, name, items, shown, sort, onCard, onTask, onMove }: { id: string; name: string; items: ClientCard[]; shown: (c: ClientCard) => boolean; sort: Sort; onCard: (boardId: string, cardId: string) => void; onTask: (taskId: string) => void; onMove: (task: string, parent: string | null) => void }) {
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const [over, setOver] = useState<string | null>(null), [dragOn, setDragOn] = useState(false);
  const byTask = new Map(items.filter((c) => c.taskId).map((c) => [c.taskId!, c]));
  const under = new Map<string, ClientCard[]>();
  for (const c of items) { const p = c.parentTaskId && byTask.has(c.parentTaskId) ? c.parentTaskId : ''; under.set(p, [...(under.get(p) || []), c]); }
  const kids = (c: ClientCard) => (c.taskId ? under.get(c.taskId) || [] : []);
  const keep = new Map<string, boolean>();
  const kept = (c: ClientCard, depth = 0): boolean => {
    if (keep.has(c.id)) return keep.get(c.id)!;
    const v = shown(c) || (depth < 20 && kids(c).some((k) => kept(k, depth + 1)));
    keep.set(c.id, v);
    return v;
  };
  // Drag a task onto another of the same client to put it under that one; never under itself or its own subtasks.
  const below = (c: ClientCard, task: string) => { for (let up = c.parentTaskId, n = 0; up && n < 30; n++) { if (up === task) return true; up = byTask.get(up)?.parentTaskId || null; } return false; };
  const takes = (c: ClientCard) => !!(dragging?.taskId && c.taskId && dragging.customerId === id && dragging.taskId !== c.taskId && dragging.parentTaskId !== c.taskId && !below(c, dragging.taskId));
  const ends = () => { dragging = null; setOver(null); setDragOn(false); };
  const order = STAGES.map((s) => s.key);
  const at = (c: ClientCard) => (sort === 'start' ? c.startAt : c.dueAt) ?? Infinity;
  const sorted = (list: ClientCard[]) => list.filter((c) => kept(c)).sort((a, b) =>
    (sort === 'status' ? order.indexOf(a.stage) - order.indexOf(b.stage) || a.listPos - b.listPos : sort === 'service' ? byText(a.services[0]?.name || '￿', b.services[0]?.name || '￿') : 0)
    || at(a) - at(b) || byText(a.title, b.title));
  const roots = sorted(under.get('') || []), rootPage = usePage(roots, 8, `${sort}${roots.length}`);
  const open = items.filter((c) => c.stage !== 'done').length, overdue = items.filter((c) => c.stage === 'overdue').length;
  const node = (c: ClientCard, depth: number): React.ReactNode => {
    const below = depth < 20 ? sorted(kids(c)) : [], isOpen = !folded.has(c.id), due = dueState(c.dueAt, c.done);
    return <li key={c.id}>
      <div className={'cw-row' + (shown(c) ? '' : ' dim') + (over === c.id ? ' drop-in' : '') + (c.taskId ? ' movable' : '')} draggable={!!c.taskId}
        title={c.taskId ? 'Kéo thả lên việc khác để thành việc con của việc đó' : undefined}
        onDragStart={(e) => { dragging = c; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.title); setDragOn(true); }}
        onDragEnd={ends}
        onDragOver={(e) => { if (!takes(c)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; if (over !== c.id) setOver(c.id); }}
        onDragLeave={() => { if (over === c.id) setOver(null); }}
        onDrop={(e) => { if (!takes(c)) return; e.preventDefault(); e.stopPropagation(); const task = dragging!.taskId!; ends(); setFolded((f) => { const n = new Set(f); n.delete(c.id); return n; }); onMove(task, c.taskId); }}>
        {below.length
          ? <button className="tk-fold" aria-expanded={isOpen} aria-label={isOpen ? 'Thu gọn' : 'Mở rộng'} onClick={() => setFolded((f) => { const n = new Set(f); if (isOpen) n.add(c.id); else n.delete(c.id); return n; })}><Icon name={isOpen ? 'down' : 'right'} size={12} /></button>
          : <span className="tk-fold" />}
        <button className="cw-row-open" onClick={() => (c.boardId && c.cardId ? onCard(c.boardId, c.cardId) : c.taskId && onTask(c.taskId))}>
          <span className={'cw-state ' + c.stage}><i />{c.listName || STAGE_NAME[c.stage]}</span>
          <span className="cw-title"><b>{c.title}</b><small>{[c.boardName, ...c.services.map((s) => s.name)].filter(Boolean).join(' · ')}{below.length > 0 && <> · <em>{`${below.length} việc con`}</em></>}</small></span>
          {(sort === 'start' ? c.startAt : c.dueAt) && <time className={'cw-due ' + due}>{day(sort === 'start' ? c.startAt : c.dueAt)}</time>}
          {c.members.length > 0 && <span className="cw-people">{c.members.slice(0, 3).map((m) => <Avatar key={m.id} m={m} size={20} />)}</span>}
        </button>
      </div>
      {isOpen && below.length > 0 && <ul>{below.map((k) => node(k, depth + 1))}</ul>}
    </li>;
  };
  return <article className="cw-box">
    <header>
      <button className="cw-box-name" onClick={() => openLink(`#customers/${id}`)} title="Mở trang khách hàng">{name}<Icon name="right" size={12} /></button>
      <span className="cw-count">{`${open} đang làm`}</span>
      {overdue > 0 && <span className="cw-count bad">{`${overdue} quá hạn`}</span>}
    </header>
    {roots.length ? <><ul className="cw-tree">{rootPage.items.map((c) => node(c, 0))}</ul>{rootPage.pager}</> : <p className="cw-none">{items.length ? 'Không có việc khớp.' : 'Chưa có thẻ nào.'}</p>}
    {/* A subtask dragged here stands on its own again. */}
    {dragOn && dragging?.parentTaskId && dragging.customerId === id && <div className={'cw-drop-root' + (over === 'root' ? ' drop-in' : '')}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== 'root') setOver('root'); }} onDragLeave={() => setOver(null)}
      onDrop={(e) => { e.preventDefault(); const task = dragging?.taskId; ends(); if (task) onMove(task, null); }}>Thả vào đây để thành việc chính</div>}
  </article>;
}
