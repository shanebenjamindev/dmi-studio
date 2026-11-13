// Thống kê: numbers worked out on the server from the records (nothing estimated), over the people the stats.view scope
// reaches, filtered in one row above the charts: the period (day, week, month, quarter, year), dates, department, person
// and task status. Every chart reads as a table too; the export is a CSV of the same numbers.
import { useState, type ReactNode } from 'react';
import { useStore } from '../../store';
import { Icon } from '../../components/ui';
import { admin, download } from '../api';
import { goAdmin } from '../nav';
import { PageHead, Select, Kpi, Table, Async, Empty, useLoad, useCan, act, fmtNum, fmtDate, dayStart, dayValue } from '../kit';
import { ChartCard, LineChart, Columns, Bars, StackBars, Donut, SERIES, periodLabel, type Dist, type Trend } from '../charts';
import { DayRangeField } from '../../components/DateRange';

const PERIODS: [string, string][] = [['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng'], ['quarter', 'Quý'], ['year', 'Năm']];
const SPAN: Record<string, number> = { day: 30, week: 84, month: 365, quarter: 730, year: 1825 };
/** What each SPAN covers, in its own unit. */
const SPAN_LABEL: Record<string, string> = { day: '30 ngày', week: '12 tuần', month: '12 tháng', quarter: '8 quý', year: '5 năm' };
const STATES: [string, string][] = [['', 'Mọi trạng thái'], ['open', 'Đang mở'], ['done', 'Đã hoàn thành'], ['overdue', 'Quá hạn'], ['doing', 'Đang làm'], ['todo', 'Chưa làm'], ['paused', 'Tạm dừng'], ['cancelled', 'Đã huỷ']];
/** A task state keeps one colour on every chart: done, late and overdue are status colours (always labelled). */
const STATE_COLOR: Record<string, string> = { todo: '#94a3b8', doing: 'var(--viz-1)', review: 'var(--viz-7)', paused: 'var(--st-warning)', overdue: 'var(--st-critical)', done: 'var(--st-good)', done_late: 'var(--st-serious)', cancelled: '#64748b', other: 'var(--viz-3)' };
const states = (d: Dist) => d.map((x) => ({ ...x, color: STATE_COLOR[x.key] }));
const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`);
const distTable = (d: Dist, head: string) => ({ head: [head, 'Số lượng'], rows: d.map((x) => [x.label, x.value]) });
const trendTable = (t: Trend, period: string) => ({ head: ['Kỳ', ...t.lines.map((l) => l.name)], rows: t.keys.map((k, i) => [periodLabel(k, period), ...t.lines.map((l) => l.values[i])]) });

/** The filters, the data for them, and the page's charts. */
function StatsPage({ view, title, sub, render, taskFilter }: { view: string; title: string; sub: string; taskFilter?: boolean; render: (d: any, f: { period: string }) => ReactNode }) {
  const can = useCan(), departments = useStore((s) => s.roles);
  const [period, setPeriod] = useState(view === 'performance' ? 'month' : 'day');
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [dept, setDept] = useState(''), [team, setTeam] = useState(''), [user, setUser] = useState(''), [status, setStatus] = useState('');
  const teams = useLoad(() => (can('org.view') ? admin.teams() : Promise.resolve([])), []);
  const people = useLoad(() => (can('staff.view') ? admin.staff({ size: 200, dept, team }) : Promise.resolve(null)), [dept, team]);
  const end = dayStart(to) ? dayStart(to)! + 86400e3 : null;
  const params = { view, period, from: dayStart(from), to: end, dept, team, user, status };
  const load = useLoad(() => admin.stats(params), [JSON.stringify(params)]);
  const pickPeriod = (p: string) => { setPeriod(p); setFrom(''); setTo(''); };
  return (
    <>
      <PageHead title={title} sub={sub} actions={can('stats.export') && <button className="btn btn-gray btn-sm" onClick={() => act(() => download(`/api/admin/stats/export${admin.q(params)}`, `thong-ke-${view}.csv`))}><Icon name="download" size={14} />Xuất báo cáo</button>} />
      <div className="ax-toolbar ax-filters">
        <div className="ax-seg" role="radiogroup" aria-label="Chu kỳ">{PERIODS.map(([k, l]) => <button key={k} role="radio" aria-checked={period === k} onClick={() => pickPeriod(k)}>{l}</button>)}</div>
        <DayRangeField from={from || dayValue(load.data?.from)} to={to || dayValue(load.data ? load.data.to - 1 : Date.now())} onChange={(f, t) => { setFrom(f); setTo(t || f); }} />
        <Select value={dept} onChange={(v) => { setDept(v); setTeam(''); setUser(''); }} label="Phòng ban"><option value="">Mọi phòng ban</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        {!!teams.data?.length && <Select value={team} onChange={(v) => { setTeam(v); setUser(''); }} label="Nhóm"><option value="">Mọi nhóm</option>{teams.data.filter((t) => !dept || !t.departmentId || t.departmentId === dept).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
        {!!people.data?.items.length && <Select value={user} onChange={setUser} label="Nhân viên"><option value="">Mọi nhân viên</option>{people.data.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
        {taskFilter && <Select value={status} onChange={setStatus} label="Trạng thái công việc">{STATES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}
        {(from || to || dept || team || user || status) && <button className="btn btn-plain btn-sm" onClick={() => { setFrom(''); setTo(''); setDept(''); setTeam(''); setUser(''); setStatus(''); }}>Bỏ lọc</button>}
      </div>
      <Async load={load}>{(d) => <>
        <p className="ax-card-note">Từ {fmtDate(d.from)} đến {fmtDate(d.to - 1)} · {SPAN[period] && !from && !to ? `${SPAN_LABEL[period]} gần nhất` : 'khoảng tự chọn'}{d.since ? ` · Nhật ký có từ ${fmtDate(d.since)}` : ''}</p>
        {render(d, { period })}
      </>}</Async>
    </>
  );
}

export const Overview = () => <StatsPage view="overview" taskFilter title="Thống kê tổng quan" sub="Công việc, khách hàng và nhân sự trong phạm vi của bạn. Công việc thuộc kỳ theo thời hạn; hoàn thành tính theo ngày xong." render={(d, f) => <>
  <div className="ax-kpis">
    <Kpi icon="checklist" label="Công việc đến hạn trong kỳ" value={fmtNum(d.kpis.inPeriod)} />
    <Kpi icon="check" label="Hoàn thành trong kỳ" value={fmtNum(d.kpis.done)} hint={`Theo ngày xong · đúng hạn ${pct(d.kpis.onTimeRate)}`} />
    <Kpi icon="clock" label="Đang quá hạn" value={<button className="ax-kpi-link" onClick={() => goAdmin('tasks', 'overdue')}>{fmtNum(d.kpis.overdue)}</button>} tone={d.kpis.overdue ? 'bad' : undefined} />
    <Kpi icon="card" label="Khách hàng" value={fmtNum(d.kpis.customers)} hint={`${fmtNum(d.kpis.newCustomers)} mới trong kỳ`} />
    <Kpi icon="users" label="Nhân sự đang hoạt động" value={fmtNum(d.kpis.staff)} hint={`${fmtNum(d.kpis.logins)} lượt đăng nhập trong kỳ`} />
  </div>
  <div className="ax-charts">
    <ChartCard wide title="Công việc đến hạn và hoàn thành" legend={d.trend.lines.map((l: any, i: number) => ({ label: l.name, color: SERIES(i) }))} table={trendTable(d.trend, f.period)}><LineChart trend={d.trend} period={f.period} /></ChartCard>
    <ChartCard title="Tình trạng việc đến hạn trong kỳ" table={distTable(d.byState, 'Tình trạng')}><Donut dist={states(d.byState)} center="công việc" /></ChartCard>
    <ChartCard title="Việc đang mở theo phòng ban" legend={[{ label: 'Đang làm', color: SERIES(0) }, { label: 'Quá hạn', color: 'var(--st-critical)' }]} table={{ head: ['Phòng ban', 'Đang làm', 'Quá hạn'], rows: d.byDept.map((r: any) => [r.label, ...r.values]) }}>
      <StackBars rows={d.byDept} parts={[{ name: 'Đang làm', color: SERIES(0) }, { name: 'Quá hạn', color: 'var(--st-critical)' }]} /></ChartCard>
    <ChartCard title="Khách hàng mới" table={trendTable(d.newCustomers, f.period)}><Columns keys={d.newCustomers.keys} values={d.newCustomers.lines[0].values} period={f.period} name="Khách hàng mới" /></ChartCard>
  </div>
</>} />;

export const Activity = () => <StatsPage view="activity" title="Thống kê hoạt động" sub="Đăng nhập và thao tác của người trong phạm vi, từ nhật ký hệ thống." render={(d, f) => <>
  <div className="ax-kpis">
    <Kpi icon="user" label="Người hoạt động" value={fmtNum(d.kpis.activeUsers)} /><Kpi icon="key" label="Đăng nhập thành công" value={fmtNum(d.kpis.logins)} />
    <Kpi icon="lock" label="Đăng nhập thất bại" value={fmtNum(d.kpis.failed)} tone={d.kpis.failed ? 'bad' : undefined} /><Kpi icon="activity" label="Thao tác" value={fmtNum(d.kpis.actions)} hint={`${fmtNum(d.kpis.changes)} thay đổi dữ liệu`} />
  </div>
  <div className="ax-charts">
    <ChartCard wide title="Đăng nhập và thao tác" legend={d.trend.lines.map((l: any, i: number) => ({ label: l.name, color: SERIES(i) }))} table={trendTable(d.trend, f.period)}><LineChart trend={d.trend} period={f.period} /></ChartCard>
    <ChartCard title="Người thao tác nhiều nhất" table={distTable(d.topUsers, 'Người')}><Bars dist={d.topUsers.map((x: any) => ({ ...x, color: SERIES(0) }))} /></ChartCard>
    <ChartCard title="Loại thao tác" table={distTable(d.byAction, 'Thao tác')}><Bars dist={d.byAction.map((x: any) => ({ ...x, color: SERIES(0) }))} /></ChartCard>
  </div>
</>} />;

export const CustomerStats = () => <StatsPage view="customers" title="Thống kê khách hàng" sub="Khách hàng trong phạm vi (đang hoạt động, không tính lưu trữ) theo phân loại, nguồn, trạng thái, dịch vụ và người phụ trách." render={(d, f) => <>
  <div className="ax-kpis">
    <Kpi icon="card" label="Khách hàng" value={fmtNum(d.kpis.total)} /><Kpi icon="plus" label="Mới trong kỳ" value={fmtNum(d.kpis.new)} />
    <Kpi icon="user" label="Có người phụ trách" value={pct(d.kpis.withManager)} /><Kpi icon="archive" label="Đã lưu trữ" value={fmtNum(d.kpis.archived)} />
  </div>
  <div className="ax-charts">
    <ChartCard wide title="Khách hàng mới" table={trendTable(d.trend, f.period)}><LineChart trend={d.trend} period={f.period} /></ChartCard>
    <ChartCard title="Phân loại" table={distTable(d.byCategory, 'Phân loại')}><Donut dist={d.byCategory} center="khách hàng" /></ChartCard>
    <ChartCard title="Nguồn khách hàng" table={distTable(d.bySource, 'Nguồn')}><Bars dist={d.bySource} /></ChartCard>
    <ChartCard title="Trạng thái" table={distTable(d.byStatus, 'Trạng thái')}><Bars dist={d.byStatus} /></ChartCard>
    <ChartCard title="Dịch vụ của khách hàng" table={distTable(d.byNeed, 'Dịch vụ')}><Bars dist={d.byNeed.map((x: any) => ({ ...x, color: SERIES(0) }))} /></ChartCard>
    <ChartCard title="Theo người phụ trách" table={distTable(d.byManager, 'Người phụ trách')}><Bars dist={d.byManager.map((x: any) => ({ ...x, color: SERIES(0) }))} /></ChartCard>
  </div>
</>} />;

export const TaskStats = () => <StatsPage view="tasks" taskFilter title="Thống kê công việc" sub="Công việc trong phạm vi theo tình trạng, mức ưu tiên, dịch vụ và danh mục." render={(d, f) => <>
  <div className="ax-kpis">
    <Kpi icon="checklist" label="Đến hạn trong kỳ" value={fmtNum(d.kpis.inPeriod)} /><Kpi icon="check" label="Hoàn thành trong kỳ" value={fmtNum(d.kpis.done)} />
    <Kpi icon="badge" label="Tỉ lệ đúng hạn" value={pct(d.kpis.onTimeRate)} /><Kpi icon="activity" label="Đang mở" value={fmtNum(d.kpis.open)} />
    <Kpi icon="clock" label="Đang quá hạn" value={<button className="ax-kpi-link" onClick={() => goAdmin('tasks', 'overdue')}>{fmtNum(d.kpis.overdue)}</button>} tone={d.kpis.overdue ? 'bad' : undefined} />
  </div>
  <div className="ax-charts">
    <ChartCard wide title="Đến hạn và hoàn thành" legend={d.trend.lines.map((l: any, i: number) => ({ label: l.name, color: SERIES(i) }))} table={trendTable(d.trend, f.period)}><LineChart trend={d.trend} period={f.period} /></ChartCard>
    <ChartCard title="Tình trạng" table={distTable(d.byState, 'Tình trạng')}><Donut dist={states(d.byState)} center="công việc" /></ChartCard>
    <ChartCard title="Mức ưu tiên" table={distTable(d.byPriority, 'Mức ưu tiên')}><Bars dist={d.byPriority} /></ChartCard>
    <ChartCard title="Theo dịch vụ" table={distTable(d.byProject, 'Dịch vụ')}><Bars dist={d.byProject.map((x: any) => ({ ...x, color: SERIES(0) }))} /></ChartCard>
    <ChartCard title="Theo danh mục" table={distTable(d.byLabel, 'Danh mục')}><Bars dist={d.byLabel.map((x: any) => ({ ...x, color: SERIES(0) }))} /></ChartCard>
  </div>
</>} />;

export const StaffStats = () => <StatsPage view="staff" title="Thống kê nhân sự" sub="Nhân sự đang hoạt động theo phòng ban, cấp, vai trò và mức độ đăng nhập." render={(d, f) => <>
  <div className="ax-kpis">
    <Kpi icon="users" label="Đang hoạt động" value={fmtNum(d.kpis.active)} hint={`${fmtNum(d.kpis.total)} tài khoản`} /><Kpi icon="lock" label="Đã khoá" value={fmtNum(d.kpis.locked)} />
    <Kpi icon="user" label="Đăng nhập trong 7 ngày" value={fmtNum(d.kpis.recent)} /><Kpi icon="info" label="Chưa đăng nhập lần nào" value={fmtNum(d.kpis.never)} />
  </div>
  <div className="ax-charts">
    <ChartCard title="Theo phòng ban" table={distTable(d.byDept, 'Phòng ban')}><Bars dist={d.byDept} /></ChartCard>
    <ChartCard title="Lần đăng nhập gần nhất" table={distTable(d.byRecency, 'Khoảng')}><Bars dist={d.byRecency.map((x: any) => ({ ...x, color: SERIES(0) }))} /></ChartCard>
    <ChartCard title="Cấp trong phòng" table={distTable(d.byLevel, 'Cấp')}><Donut dist={d.byLevel} center="người" /></ChartCard>
    <ChartCard title="Vai trò" table={distTable(d.byRole, 'Vai trò')}><Bars dist={d.byRole.map((x: any) => ({ ...x, color: SERIES(0) }))} /></ChartCard>
    <ChartCard wide title="Nhân viên mới" table={trendTable(d.trend, f.period)}><Columns keys={d.trend.keys} values={d.trend.lines[0].values} period={f.period} name="Nhân viên mới" /></ChartCard>
  </div>
</>} />;

export const Performance = () => <StatsPage view="performance" taskFilter title="Báo cáo hiệu suất" sub="Mỗi nhân viên trong kỳ: việc được giao (theo thời hạn), hoàn thành đúng hạn và trễ hạn, việc đang quá hạn, số thao tác." render={(d) => <>
  <div className="ax-kpis">
    <Kpi icon="users" label="Nhân viên" value={fmtNum(d.kpis.people)} /><Kpi icon="check" label="Hoàn thành trong kỳ" value={fmtNum(d.kpis.done)} />
    <Kpi icon="badge" label="Tỉ lệ đúng hạn" value={pct(d.kpis.onTimeRate)} /><Kpi icon="clock" label="Đang quá hạn" value={fmtNum(d.kpis.overdue)} tone={d.kpis.overdue ? 'bad' : undefined} />
  </div>
  <div className="ax-charts">
    <ChartCard wide title="Hoàn thành đúng hạn và trễ hạn" legend={[{ label: 'Đúng hạn', color: 'var(--st-good)' }, { label: 'Trễ hạn', color: 'var(--st-serious)' }]} table={{ head: ['Nhân viên', 'Đúng hạn', 'Trễ hạn'], rows: d.chart.map((r: any) => [r.label, ...r.values]) }}>
      <StackBars rows={d.chart} parts={[{ name: 'Đúng hạn', color: 'var(--st-good)' }, { name: 'Trễ hạn', color: 'var(--st-serious)' }]} /></ChartCard>
  </div>
  <div className="ax-card flush"><Table rows={d.rows} empty={<Empty title="Chưa có số liệu" />} cols={[
    { key: 'name', label: 'Nhân viên', render: (r: any) => <span className="ax-stack"><b>{r.name}</b><small>{r.department || 'Chưa có phòng ban'}</small></span> },
    { key: 'assigned', label: 'Được giao', align: 'right', render: (r: any) => fmtNum(r.assigned) },
    { key: 'done', label: 'Hoàn thành', align: 'right', render: (r: any) => fmtNum(r.done) },
    { key: 'onTime', label: 'Đúng hạn', align: 'right', render: (r: any) => fmtNum(r.onTime), hideSm: true },
    { key: 'late', label: 'Trễ hạn', align: 'right', render: (r: any) => fmtNum(r.late), hideSm: true },
    { key: 'rate', label: 'Tỉ lệ đúng hạn', align: 'right', render: (r: any) => pct(r.onTimeRate) },
    { key: 'overdue', label: 'Đang quá hạn', align: 'right', render: (r: any) => r.overdue ? <span className="ax-bad">{fmtNum(r.overdue)}</span> : '0' },
    { key: 'actions', label: 'Thao tác', align: 'right', render: (r: any) => fmtNum(r.actions), hideSm: true },
  ]} /></div>
</>} />;
