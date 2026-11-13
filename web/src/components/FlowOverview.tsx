// Tổng quan of the Tasks and Customers pages: where the work stands in the review workflow (ACCOUNT → EXECUTION → REVIEW
// → COMPLETED / REJECTED), what needs a hand (late, waiting long for its review, sent back with REDO), when the open work
// falls due, what came in and got done week by week, and on the Customers page each customer's open work. The numbers are
// of the work the page lists, so they keep its scope; every number opens the tasks it counts (shared/flow-filter.ts):
// `onPick` takes them to the page's own list, else they are listed here.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bars, ChartCard, LineChart, StackBars, SERIES } from '../admin/charts';
import { Icon } from './ui';
import { FLOW_STAGES, type FlowStage } from '../../../shared/task-flow';
import { FLOW_FILTER_LABEL, REVIEW_WAIT_HOURS, flowMatch, type FlowFilter } from '../../../shared/flow-filter';

export type FlowRow = {
  id: string; title: string; stage?: FlowStage; state: string; dueAt: number | null; revision?: number; submittedAt?: number | null;
  createdAt?: number; doneAt?: number | null; customer?: { id: string; name: string } | null; assignees: { id: string; name: string }[];
};

const HOUR = 3600e3, DAY = 24 * HOUR, WEEK = 7 * DAY, VN = 7 * HOUR;
/** How long, said simply: "5 giờ", "3 ngày". */
const span = (ms: number) => (ms < DAY ? `${Math.max(1, Math.round(ms / HOUR))} giờ` : `${Math.round(ms / DAY)} ngày`);
const OPEN: FlowStage[] = ['account', 'execution', 'review'];
const code = (s: FlowStage) => FLOW_STAGES.find((x) => x.key === s)!.code;
/** Each step keeps its colour of the fixed series order, on every chart and tile. */
const color = (s: FlowStage) => SERIES(FLOW_STAGES.findIndex((x) => x.key === s));
/** When the open work falls due: late and today in the status colours (each with its name), the rest in series ones. */
const DUE: { key: FlowFilter; color: string }[] = [
  { key: 'overdue', color: 'var(--st-critical)' }, { key: 'due-today', color: 'var(--st-warning)' },
  { key: 'due-week', color: SERIES(0) }, { key: 'due-later', color: SERIES(6) }, { key: 'no-due', color: 'var(--ax-ink-3)' },
];
/** The Monday (Vietnam time) a moment's week starts, as 'YYYY-MM-DD'. */
const weekOf = (ms: number) => { const d = new Date(Math.floor((ms + VN) / DAY) * DAY); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

export function FlowOverview({ rows, byCustomer = false, onOpenTask, onPick, onOpenCustomer }: {
  rows: FlowRow[]; byCustomer?: boolean; onOpenTask: (id: string) => void; onPick?: (f: FlowFilter) => void; onOpenCustomer?: (id: string) => void;
}) {
  const now = Date.now();
  const work = rows.filter((r) => r.stage);
  const of = (f: FlowFilter) => work.filter((r) => flowMatch(r, f, now));
  const total = work.length;
  // A number with no page of its own to open lists its tasks here, under the tiles.
  const [shown, setShown] = useState<FlowFilter | null>(null);
  const drill = useRef<HTMLElement>(null);
  useEffect(() => { if (shown) drill.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [shown]);
  const pick = (f: FlowFilter) => (onPick ? onPick(f) : setShown(shown === f ? null : f));

  const late = of('overdue').sort((a, b) => a.dueAt! - b.dueAt!);
  const reviewing = of('review').filter((r) => r.submittedAt).sort((a, b) => a.submittedAt! - b.submittedAt!);
  const waitingLong = of('waiting'), redone = of('redo'), rounds = work.reduce((n, r) => n + (r.revision || 0), 0);
  const stages = FLOW_STAGES.map((s) => ({ key: s.key, label: s.code, value: of(s.key).length, color: color(s.key) }));
  const due = DUE.map((d) => ({ key: d.key, label: FLOW_FILTER_LABEL[d.key], value: of(d.key).length, color: d.color }));
  const openCount = due.reduce((n, d) => n + d.value, 0);

  // The last 8 weeks: tasks made, and tasks finished (COMPLETED), each week.
  const weeks = Array.from({ length: 8 }, (_, i) => weekOf(now - (7 - i) * WEEK));
  const perWeek = (at: (r: FlowRow) => number | null | undefined) => weeks.map((w) => work.filter((r) => { const t = at(r); return !!t && weekOf(t) === w; }).length);
  const trend = { keys: weeks, lines: [{ name: 'Tạo mới', values: perWeek((r) => r.createdAt) }, { name: 'Hoàn thành', values: perWeek((r) => (r.stage === 'completed' ? r.doneAt : null)) }] };
  const trendColors = [SERIES(0), SERIES(2)];

  const customers = byCustomer ? [...work.filter((r) => OPEN.includes(r.stage!)).reduce((m, r) => {
    if (!r.customer) return m;
    const row = m.get(r.customer.id) || { key: r.customer.id, label: r.customer.name, values: [0, 0, 0] };
    row.values[OPEN.indexOf(r.stage!)]++;
    return m.set(r.customer.id, row);
  }, new Map<string, { key: string; label: string; values: number[] }>()).values()].sort((a, b) => b.values.reduce((x, y) => x + y, 0) - a.values.reduce((x, y) => x + y, 0)) : [];

  const list = (items: FlowRow[], note: (r: FlowRow) => string, empty: string, limit = 8) => items.length
    ? <ul className="fo-list">{items.slice(0, limit).map((r) => <li key={r.id}><button onClick={() => onOpenTask(r.id)}>
        <span className="fo-list-main"><b>{r.title}</b><small>{[r.customer?.name, r.assignees.map((a) => a.name).join(', ')].filter(Boolean).join(' · ') || '—'}</small></span>
        <em>{note(r)}</em></button></li>)}</ul>
    : <p className="fo-empty"><Icon name="check" size={15} />{empty}</p>;
  const more = (f: FlowFilter, n: number) => n > 0 && <button className="fo-more" onClick={() => pick(f)}>{`Xem tất cả (${n})`}<Icon name="right" size={12} /></button>;
  const tile = (f: FlowFilter, n: number, head: ReactNode, sub: string, tone = '') => (
    <button key={f} role="listitem" className={'fo-tile' + tone + (shown === f ? ' on' : '')} onClick={() => pick(f)} title={`Xem các việc: ${FLOW_FILTER_LABEL[f]}`}>
      <span className="fo-tile-k">{head}</span><b>{n}</b><small>{sub}</small>
    </button>
  );
  // What each listed task shows beside its name: how long it waits or is late, else its step.
  const noteOf = (r: FlowRow) => r.stage === 'review' && r.submittedAt ? `chờ ${span(now - r.submittedAt)}`
    : r.dueAt && r.dueAt < now && OPEN.includes(r.stage!) ? `trễ ${span(now - r.dueAt)}` : code(r.stage!);

  return (
    <div className="fo">
      <div className="fo-tiles" role="list" aria-label="Công việc theo bước">
        {stages.map((s) => tile(s.key, s.value, <><i style={{ background: s.color }} />{s.label}</>, total ? `${Math.round((s.value / total) * 100)}% tổng số` : '—'))}
      </div>
      <div className="fo-tiles fo-alerts" role="list" aria-label="Cần chú ý">
        {tile('overdue', late.length, <><Icon name="clock" size={13} />Quá hạn</>, 'việc chưa xong đã qua hạn', ' fo-alert' + (late.length ? ' bad' : ''))}
        {tile('waiting', waitingLong.length, <><Icon name="eye" size={13} />{`Chờ duyệt quá ${REVIEW_WAIT_HOURS} giờ`}</>, `${reviewing.length} việc đang ở REVIEW`, ' fo-alert' + (waitingLong.length ? ' warn' : ''))}
        {tile('redo', redone.length, <><Icon name="undo" size={13} />Bị trả về (REDO)</>, `việc đang mở · ${rounds} lần REDO`, ' fo-alert' + (redone.length ? ' warn' : ''))}
      </div>

      {shown && !onPick && (
        <section ref={drill} className="ax-chart fo-card fo-drill" aria-live="polite">
          <header><div><h3>{FLOW_FILTER_LABEL[shown]}</h3><p>{`${of(shown).length} việc`}</p></div>
            <button className="ax-chart-switch" onClick={() => setShown(null)}>Đóng</button></header>
          {list(of(shown), noteOf, 'Không có việc nào.', 100)}
        </section>
      )}

      <div className="fo-grid">
        <ChartCard title="Việc theo bước" sub={`${total} việc · bấm một bước để xem`} table={{ head: ['Bước', 'Số việc'], rows: stages.map((d) => [d.label, d.value]) }}>
          {total ? <Bars dist={stages} total={total} onPick={(k) => pick(k as FlowFilter)} /> : <p className="ax-nodata">Chưa có công việc</p>}
        </ChartCard>
        <ChartCard title="Hạn chót của việc đang mở" sub={`${openCount} việc · bấm một mốc để xem`} table={{ head: ['Hạn', 'Số việc'], rows: due.map((d) => [d.label, d.value]) }}>
          {openCount ? <Bars dist={due} total={openCount} onPick={(k) => pick(k as FlowFilter)} /> : <p className="ax-nodata">Không có việc đang mở</p>}
        </ChartCard>
        <ChartCard wide title="Tạo mới và hoàn thành theo tuần" sub="8 tuần gần nhất" legend={trend.lines.map((l, i) => ({ label: l.name, color: trendColors[i] }))}
          table={{ head: ['Tuần', ...trend.lines.map((l) => l.name)], rows: weeks.map((w, i) => [w, ...trend.lines.map((l) => l.values[i])]) }}>
          <LineChart trend={trend} period="week" colors={trendColors} />
        </ChartCard>
        <section className="ax-chart fo-card">
          <header><div><h3>Chờ duyệt lâu nhất</h3><p>Việc ở REVIEW, lâu nhất trước</p></div>{more('review', reviewing.length)}</header>
          {list(reviewing, (r) => `chờ ${span(now - r.submittedAt!)}`, 'Không có việc nào đang chờ duyệt.')}
        </section>
        <section className="ax-chart fo-card">
          <header><div><h3>Quá hạn</h3><p>Việc chưa xong đã qua hạn, trễ nhất trước</p></div>{more('overdue', late.length)}</header>
          {list(late, (r) => `trễ ${span(now - r.dueAt!)}`, 'Không có việc nào quá hạn.')}
        </section>
        {byCustomer && (
          <ChartCard wide title="Việc đang mở theo khách hàng" sub="ACCOUNT, EXECUTION và REVIEW của từng khách · bấm một khách để mở"
            legend={OPEN.map((s) => ({ label: code(s), color: color(s) }))}
            table={{ head: ['Khách hàng', ...OPEN.map(code)], rows: customers.map((c) => [c.label, ...c.values]) }}>
            <StackBars rows={customers.slice(0, 12)} parts={OPEN.map((s) => ({ name: code(s), color: color(s) }))} onPick={onOpenCustomer} />
            {customers.length > 12 && <p className="note">{`Và ${customers.length - 12} khách khác (xem dạng Bảng).`}</p>}
          </ChartCard>
        )}
      </div>
    </div>
  );
}
