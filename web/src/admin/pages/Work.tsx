// Công việc in Quản trị: every task the scope reaches (names, status, dates, people; never a description or result) with
// its history and priority; overdue work; and the lists the Tasks page uses: statuses, categories, priorities, the order
// of the workflow, and templates (applied through the Tasks API with the person's own rights in the project).
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { applyFlowColors, openTask, useStore, toast } from '../../store';
import { Icon } from '../../components/ui';
import { admin, download, type TaskRow, type TaskTemplate } from '../api';
import { FLOW_STAGES, flowColors, type FlowConfig, type FlowStage } from '../../../../shared/task-flow';
import { routeParam, setRouteParam } from '../nav';
import { PageHead, Toolbar, Select, Table, Pager, Drawer, Field, Section, Badge, ChangeList, Async, Empty, ErrorState, Loading, DictEditor, Kpi, useLoad, useListState, useDebounced, useCan, act, fmtDate, fmtNum, dayStart, dayValue, type Col } from '../kit';
import type { TaskMeta } from '../../types';
import { DayRangeField } from '../../components/DateRange';
import { askConfirm } from '../../components/AskDialog';

export const STATE: Record<string, [string, 'ok' | 'bad' | 'warn' | 'muted' | undefined]> = {
  todo: ['Chưa làm', 'muted'], doing: ['Đang làm', undefined], review: ['Đang đánh giá', undefined], paused: ['Tạm dừng', 'warn'], overdue: ['Quá hạn', 'bad'],
  done: ['Hoàn thành', 'ok'], done_late: ['Hoàn thành muộn', 'warn'], cancelled: ['Đã huỷ', 'muted'], other: ['Khác', 'muted'],
};
/** The status as named, coloured by what it means; a late one gets its own “Quá hạn” beside it. */
const StateBadge = ({ t }: { t: Pick<TaskRow, 'state' | 'status' | 'category'> }) => <span className="ax-badges"><Badge tone={STATE[t.category]?.[1]}>{t.status || STATE[t.category]?.[0]}</Badge>{t.state === 'overdue' && <Badge tone="bad">Quá hạn</Badge>}</span>;
const late = (t: TaskRow) => (t.dueAt && t.state === 'overdue' ? Math.ceil((Date.now() - t.dueAt) / 86400e3) : 0);

// ---------------------------------------------------------------- the list
function TaskList({ overdue }: { overdue?: boolean }) {
  const can = useCan(), departments = useStore((s) => s.roles);
  const [q, setQ] = useState(''), [state, setState] = useState(''), [priority, setPriority] = useState(''), [dept, setDept] = useState(''), [team, setTeam] = useState(''), [user, setUser] = useState(''), [project, setProject] = useState('');
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [dateField, setDateField] = useState<'due' | 'created' | 'updated'>('due');
  const L = useListState(overdue ? 'dueAt' : 'dueAt', overdue ? 'asc' : 'desc'), term = useDebounced(q);
  const filter = { q: term, state, priority, dept, team, user, project, overdue: overdue ? 1 : '', dateField, from: dayStart(from), to: dayStart(to) ? dayStart(to)! + 86400e3 : null };
  const load = useLoad(() => admin.tasks({ ...filter, sort: L.sort, dir: L.dir, page: L.page, size: 30 }), [JSON.stringify(filter), L.sort, L.dir, L.page]);
  const priorities = useLoad(() => admin.priorities.list(), []);
  const teams = useLoad(() => (can('org.view') ? admin.teams() : Promise.resolve([])), []);
  const people = useLoad(() => (can('staff.view') ? admin.staff({ size: 200 }) : Promise.resolve(null)), []);
  const meta = useLoad<TaskMeta | null>(() => api.taskMeta().catch(() => null), []);
  const [open, setOpen] = useState<string | null>(() => routeParam('id'));
  useEffect(() => { L.setPage(1); }, [JSON.stringify(filter)]); // eslint-disable-line react-hooks/exhaustive-deps
  const show = (id: string | null) => { setOpen(id); setRouteParam('id', id); };
  const cols: Col<TaskRow>[] = [
    { key: 'title', label: 'Công việc', sort: true, render: (t) => <span className="ax-stack"><b>{t.title}</b><small>{[t.project?.name, t.customer?.name].filter(Boolean).join(' · ') || 'Không thuộc dịch vụ'}</small></span> },
    { key: 'status', label: 'Trạng thái', sort: true, render: (t) => <StateBadge t={t} /> },
    { key: 'priority', label: 'Ưu tiên', sort: true, render: (t) => t.priority ? <Badge color={t.priority.color}>{t.priority.name}</Badge> : <span className="ax-muted">—</span>, hideSm: true },
    { key: 'people', label: 'Người làm', render: (t) => t.assignees.map((a) => a.name).join(', ') || <span className="ax-muted">Chưa giao</span>, hideSm: true },
    { key: 'dueAt', label: 'Thời hạn', sort: true, render: (t) => <span className="ax-stack"><span>{fmtDate(t.dueAt)}</span>{late(t) ? <small className="ax-bad">Trễ {late(t)} ngày</small> : t.doneAt ? <small>Xong {fmtDate(t.doneAt)}</small> : null}</span> },
  ];
  return (
    <>
      <PageHead title={overdue ? 'Công việc quá hạn' : 'Tất cả công việc'} sub={overdue ? 'Công việc chưa xong đã qua thời hạn, trễ lâu nhất trước.' : 'Mọi công việc trong phạm vi của bạn. Trang này chỉ đọc (trừ mức ưu tiên); mô tả và kết quả công việc không hiện ở đây.'}
        actions={can('tasks.export') && <button className="btn btn-gray btn-sm" onClick={() => act(() => download(`/api/admin/tasks/export${admin.q(filter)}`, overdue ? 'cong-viec-qua-han.csv' : 'cong-viec.csv'))}><Icon name="download" size={14} />Xuất CSV</button>} />
      {load.data && <div className="ax-kpis small">
        <Kpi label="Kết quả lọc" value={fmtNum(load.data.counts.total)} /><Kpi label="Đang mở" value={fmtNum(load.data.counts.open)} />
        <Kpi label="Quá hạn" value={fmtNum(load.data.counts.overdue)} tone={load.data.counts.overdue ? 'bad' : undefined} /><Kpi label="Hoàn thành" value={fmtNum(load.data.counts.done)} />
      </div>}
      <Toolbar search={q} onSearch={setQ} placeholder="Tìm tên, dịch vụ, khách hàng, nhãn…">
        {!overdue && <Select value={state} onChange={setState} label="Tình trạng"><option value="">Mọi tình trạng</option><option value="open">Đang mở</option><option value="done">Đã hoàn thành</option>{Object.entries(STATE).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>}
        <Select value={priority} onChange={setPriority} label="Ưu tiên"><option value="">Mọi mức ưu tiên</option><option value="none">Chưa đặt</option>{(priorities.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Select value={dept} onChange={setDept} label="Phòng ban"><option value="">Mọi phòng ban</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        {!!teams.data?.length && <Select value={team} onChange={setTeam} label="Nhóm"><option value="">Mọi nhóm</option>{teams.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}
        {!!people.data?.items.length && <Select value={user} onChange={setUser} label="Nhân viên"><option value="">Mọi nhân viên</option>{people.data.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
        {!!meta.data?.projects.length && <Select value={project} onChange={setProject} label="Dịch vụ"><option value="">Mọi dịch vụ</option>{meta.data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
        <select className="bk-in ax-date-field" aria-label="Lọc theo ngày" value={dateField} onChange={(e) => setDateField(e.target.value as 'due' | 'created' | 'updated')}><option value="due">Hạn chót</option><option value="created">Ngày tạo</option><option value="updated">Ngày sửa</option></select>
        <DayRangeField from={from} to={to} startLabel="Từ" endLabel="Đến" placeholder="Mọi ngày" onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </Toolbar>
      <div className="ax-card flush"><Async load={load}>{(d) => <>
        <Table cols={cols} rows={d.items} sort={L.sort} dir={L.dir} onSort={L.onSort} onRow={(t) => show(t.id)} selected={open}
          empty={<Empty icon="checklist" title={overdue ? 'Không có công việc quá hạn' : 'Không có công việc phù hợp'} text={overdue ? 'Mọi công việc trong phạm vi đều đúng hạn.' : 'Đổi bộ lọc hoặc từ khoá.'} />} />
        <Pager page={d.page} size={d.size} total={d.total} onPage={L.setPage} />
      </>}</Async></div>
      {open && <TaskDrawer id={open} priorities={priorities.data || []} onClose={() => show(null)} onChanged={load.reload} />}
    </>
  );
}
export const AllTasks = () => <TaskList />;
export const Overdue = () => <TaskList overdue />;

function TaskDrawer({ id, priorities, onClose, onChanged }: { id: string; priorities: { id: string; name: string; active: boolean }[]; onClose: () => void; onChanged: () => void }) {
  const load = useLoad(() => admin.task(id), [id]);
  const t = load.data;
  const setPriority = (v: string) => t && act(() => admin.setPriority(t.id, v || null), 'Đã đặt mức ưu tiên', () => { load.reload(); onChanged(); });
  return (
    <Drawer open wide title={t?.title || 'Công việc'} sub={t ? [t.project?.name, t.customer?.name].filter(Boolean).join(' · ') : undefined} onClose={onClose}
      footer={t && <button className="btn btn-gray btn-sm" onClick={() => openTask(t.id)}><Icon name="arrow" size={14} />Mở trang công việc</button>}>
      {load.error ? <ErrorState error={load.error} onRetry={load.reload} /> : !t ? <Loading /> : <>
        <dl className="ax-facts">
          <dt>Trạng thái</dt><dd><StateBadge t={t} /></dd>
          <dt>Mức ưu tiên</dt><dd>{t.canSetPriority ? <select className="bk-in ax-cell-input" value={t.priority?.id || ''} onChange={(e) => void setPriority(e.target.value)} aria-label="Mức ưu tiên"><option value="">Chưa đặt</option>{priorities.filter((p) => p.active || p.id === t.priority?.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : t.priority?.name || '—'}</dd>
          <dt>Người làm</dt><dd>{t.assignees.map((a) => a.name).join(', ') || '—'}</dd><dt>Người tạo</dt><dd>{t.creator?.name || '—'}</dd>
          <dt>Bắt đầu</dt><dd>{fmtDate(t.startAt)}</dd><dt>Thời hạn</dt><dd>{fmtDate(t.dueAt)}{late(t) ? <Badge tone="bad">Trễ {late(t)} ngày</Badge> : null}</dd><dt>Hoàn thành</dt><dd>{fmtDate(t.doneAt)}</dd>
          <dt>Công việc cha</dt><dd>{t.parent?.title || '—'}</dd><dt>Nhãn</dt><dd>{t.labels.join(', ') || '—'}</dd>
          {t.externalId && <><dt>Mã từ file nhập</dt><dd className="mono">{t.externalId}</dd></>}
        </dl>
        {!!t.subtasks.length && <Section title={`Công việc con (${t.subtasks.length})`}><ul className="ax-list">{t.subtasks.map((s) => <li key={s.id}><span><b>{s.title}</b><small>Hạn {fmtDate(s.dueAt)}</small></span><StateBadge t={s} /></li>)}</ul></Section>}
        <Section title="Lịch sử thay đổi"><ChangeList changes={t.history} empty="Chưa có thay đổi nào được ghi lại (nhật ký bắt đầu từ khi có module quản trị)." /></Section>
      </>}
    </Drawer>
  );
}

// ---------------------------------------------------------------- statuses and the workflow
const CATEGORY: Record<string, string> = { todo: 'Chưa làm', doing: 'Đang làm', review: 'Đang đánh giá', paused: 'Tạm dừng', overdue: 'Quá hạn', done: 'Hoàn thành', done_late: 'Hoàn thành muộn', cancelled: 'Đã huỷ', other: 'Khác (tính là đang làm)' };
export function Statuses() {
  const can = useCan(), editable = can('tasks.manage');
  const load = useLoad(() => admin.statuses(), []);
  const [name, setName] = useState(''), [color, setColor] = useState('#64748b'), [err, setErr] = useState('');
  const add = async (n = name, c = color) => {
    if (!n.trim()) return setErr('Hãy nhập tên trạng thái');
    setErr('');
    if (await act(() => admin.createStatus({ name: n.trim(), color: c }), 'Đã thêm trạng thái', load.reload)) setName('');
  };
  return (
    <>
      <PageHead title="Trạng thái công việc" sub="Danh sách trạng thái người dùng chọn được trên trang Công việc, theo thứ tự này. Đổi tên một trạng thái thì mọi công việc đang ở trạng thái đó đổi theo. Hệ thống hiểu ý nghĩa mỗi trạng thái từ tên của nó (cột “Hệ thống hiểu là”) để tính hoàn thành và quá hạn." />
      {editable && <form className="ax-inline-form ax-card" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Màu" />
        <input className="bk-in" value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setErr(''); }} placeholder="Tên trạng thái mới (vd. Chờ khách duyệt)" aria-label="Tên trạng thái" />
        <button className="btn btn-primary btn-sm"><Icon name="plus" size={14} />Thêm</button>
        {err && <small className="ax-field-err" role="alert">{err}</small>}
      </form>}
      <Async load={load}>{(d) => <>
        <div className="ax-card flush"><Table rows={d.statuses} empty={<Empty title="Chưa có trạng thái" />} cols={[
          { key: 'name', label: 'Trạng thái', render: (s) => editable && !s.locked ? <span className="ax-person"><input type="color" value={s.color} aria-label="Màu" onChange={(e) => void act(() => admin.updateStatus(s.id, { color: e.target.value }), undefined, load.reload)} /><input className="bk-in ax-cell-input" defaultValue={s.name} maxLength={60} aria-label="Tên trạng thái" onBlur={async (e) => { const v = e.target.value.trim(); if (v && v !== s.name) { if (!s.used || await askConfirm(`Đổi tên “${s.name}” thành “${v}”? ${s.used} công việc đang ở trạng thái này sẽ đổi theo.`)) void act(() => admin.updateStatus(s.id, { name: v }), 'Đã đổi tên', load.reload); else e.target.value = s.name; } else e.target.value = s.name; }} /></span> : <Badge color={s.color}>{s.name}</Badge> },
          { key: 'category', label: 'Hệ thống hiểu là', render: (s) => CATEGORY[s.category] || s.category },
          { key: 'used', label: 'Công việc', align: 'right', render: (s) => fmtNum(s.used) },
          { key: 'active', label: 'Trạng thái', render: (s) => s.locked ? <Badge tone="muted">Mặc định của việc mới</Badge> : s.active ? <Badge tone="ok">Đang dùng</Badge> : <Badge tone="muted">Đã tắt</Badge> },
          { key: 'x', label: '', align: 'right', render: (s) => editable && !s.locked ? <span className="ax-row-actions"><button className="btn btn-gray btn-sm" onClick={() => act(() => admin.updateStatus(s.id, { active: !s.active }), s.active ? 'Đã tắt' : 'Đã bật', load.reload)}>{s.active ? 'Tắt' : 'Bật'}</button>
            <button className="bd-icon danger" title="Xoá" aria-label={`Xoá ${s.name}`} onClick={async () => await askConfirm(s.used ? `Xoá trạng thái “${s.name}”? ${s.used} công việc đang ở trạng thái này sẽ nhận trạng thái theo bước quy trình của chúng.` : `Xoá trạng thái “${s.name}”?`) && act(() => admin.removeStatus(s.id), 'Đã xoá trạng thái', load.reload)}><Icon name="trash" size={14} /></button></span> : null },
        ]} /></div>
        {!!d.unlisted.length && <Section title="Trạng thái có trong dữ liệu nhưng chưa có trong danh sách">
          <p className="note">Công việc nhập từ file có thể mang trạng thái khác. Thêm vào danh sách để người dùng chọn được, hoặc xoá để các công việc đó nhận trạng thái theo bước quy trình.</p>
          <ul className="ax-list">{d.unlisted.map((u) => <li key={u.name}><span><b>{u.name}</b><small>{fmtNum(u.used)} công việc · hệ thống hiểu là {CATEGORY[u.category] || u.category}</small></span>{editable && <span className="ax-row-actions"><button className="btn btn-gray btn-sm" onClick={() => void add(u.name, '#64748b')}><Icon name="plus" size={13} />Thêm vào danh sách</button><button className="bd-icon danger" title="Xoá" aria-label={`Xoá ${u.name}`} onClick={async () => await askConfirm(`Xoá trạng thái “${u.name}”? ${u.used} công việc đang ở trạng thái này sẽ được chuyển về “Chưa thực hiện”.`) && act(() => admin.clearUnlistedStatus(u.name), 'Đã xoá trạng thái', load.reload)}><Icon name="trash" size={14} /></button></span>}</li>)}</ul>
        </Section>}
      </>}</Async>
    </>
  );
}
/** What happens in each stage, as the workflow page explains it. */
const STAGE_WHAT: Record<FlowStage, string> = {
  account: 'Nhận yêu cầu của khách, thu thập thông tin và giao việc cho người làm.',
  execution: 'Người làm thực hiện, cập nhật tiến độ rồi nộp duyệt. REDO đưa việc về lại bước này, giữ nguyên lịch sử.',
  review: 'Người duyệt kiểm tra kết quả và chấm PASS, REDO (kèm nhận xét) hoặc FAIL (kèm lý do).',
  completed: 'PASS: đạt yêu cầu. Công việc đóng, chỉ người duyệt hoặc Admin mở lại được.',
  rejected: 'FAIL: không đạt hoặc không thể tiếp tục. Công việc đóng, chỉ người duyệt hoặc Admin mở lại được.',
};
/** The review workflow (shared/task-flow.ts): each stage's name and the status it gives, the reminders, bringing existing
 *  tasks in, and the statuses outside it (to take off the list). */
export function Workflow() {
  const can = useCan(), editable = can('tasks.manage');
  const load = useLoad(() => Promise.all([admin.taskFlow(), admin.statuses()]), []);
  const [draft, setDraft] = useState<FlowConfig | null>(null);
  useEffect(() => { if (load.data) setDraft(load.data[0].config); }, [load.data]);
  const saved = load.data?.[0].config, dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  const stage = (key: FlowStage, b: Partial<{ name: string; status: string; color: string }>) => draft && setDraft({ ...draft, stages: { ...draft.stages, [key]: { ...draft.stages[key], ...b } } });
  const num = (k: 'reviewRemindHours' | 'remindDays' | 'remindHour', v: string) => draft && setDraft({ ...draft, [k]: Number(v) });
  return (
    <>
      <PageHead title="Quy trình công việc" sub="Mọi công việc đi qua ACCOUNT → EXECUTION → REVIEW. Người duyệt chấm PASS (hoàn thành), REDO (trả về làm lại, lặp tới khi PASS hoặc FAIL) hoặc FAIL (từ chối). Trạng thái của công việc đi theo bước của nó; chỉ REVIEW mới hoàn thành hay từ chối được một việc."
        actions={editable && <><button className="btn btn-gray btn-sm" disabled={!dirty} onClick={() => saved && setDraft(saved)}>Huỷ thay đổi</button><button className="btn btn-primary btn-sm" disabled={!dirty} onClick={() => void act(async () => { await admin.saveTaskFlow(draft!); applyFlowColors(flowColors(draft!)); }, 'Đã lưu quy trình', load.reload)}>Lưu quy trình</button></>} />
      <Async load={load}>{([flow, st]) => {
        if (!draft) return null;
        const active = st.statuses.filter((s) => s.active);
        const inFlow = new Set(FLOW_STAGES.map((x) => draft.stages[x.key].status));
        // The done-late status goes with COMPLETED (a pass after the deadline); the rest is outside the workflow.
        const outside = st.statuses.filter((s) => !inFlow.has(s.name) && s.category !== 'done_late');
        return <>
          <Section title="Các bước">
            <div className="ax-card flush"><Table rows={FLOW_STAGES.map((x) => ({ ...x, id: x.key }))} cols={[
              { key: 'code', label: 'Bước', render: (x) => <span className="tf-badge tf-solid" style={{ ['--tf' as string]: draft.stages[x.key].color }}><b>{x.code}</b></span> },
              { key: 'color', label: 'Màu', render: (x) => <input type="color" value={draft.stages[x.key].color} disabled={!editable} aria-label={`Màu của bước ${x.code}`} onChange={(e) => stage(x.key, { color: e.target.value })} /> },
              { key: 'status', label: 'Trạng thái công việc', render: (x) => editable
                ? <select className="bk-in" value={draft.stages[x.key].status} aria-label={`Trạng thái của bước ${x.code}`} onChange={(e) => stage(x.key, { status: e.target.value })}>{!active.some((s) => s.name === draft.stages[x.key].status) && <option>{draft.stages[x.key].status}</option>}{active.map((s) => <option key={s.id}>{s.name}</option>)}</select>
                : <Badge color={st.statuses.find((s) => s.name === draft.stages[x.key].status)?.color}>{draft.stages[x.key].status}</Badge> },
              { key: 'what', label: 'Ở bước này', render: (x) => <small>{STAGE_WHAT[x.key]}</small> },
              { key: 'n', label: 'Công việc', align: 'right', render: (x) => fmtNum(flow.stages[x.key] || 0) },
            ]} /></div>
          </Section>
          <Section title="Nhắc việc tự động">
            <div className="ax-card ax-form-grid three">
              <Field label="Gửi từ (giờ Việt Nam)" hint="Mỗi người nhận tối đa một nhắc mỗi ngày cho mỗi việc."><input className="bk-in" type="number" min={0} max={23} disabled={!editable} value={draft.remindHour} onChange={(e) => num('remindHour', e.target.value)} /></Field>
              <Field label="Nhắc người duyệt sau (giờ chờ)"><input className="bk-in" type="number" min={1} max={720} disabled={!editable} value={draft.reviewRemindHours} onChange={(e) => num('reviewRemindHours', e.target.value)} /></Field>
              <Field label="Nhắc trong (ngày)" hint="Quá hạn hoặc chờ duyệt lâu hơn thì thôi nhắc."><input className="bk-in" type="number" min={1} max={60} disabled={!editable} value={draft.remindDays} onChange={(e) => num('remindDays', e.target.value)} /></Field>
            </div>
          </Section>
          <Section title="Công việc hiện có">
            <div className="ax-card ax-row-actions" style={{ justifyContent: 'space-between' }}>
              <span>{flow.pending ? `${fmtNum(flow.pending)} công việc chưa vào quy trình. Hệ thống tự đưa vào mỗi 10 phút, theo trạng thái hiện tại của từng việc.` : 'Toàn bộ công việc đã theo quy trình.'}</span>
              {editable && !!flow.pending && <button className="btn btn-primary btn-sm" onClick={() => void act(async () => { const r = await admin.applyTaskFlow(); toast(`Đã đưa ${fmtNum(r.applied)} công việc vào quy trình`); }, undefined, load.reload)}>Áp dụng ngay</button>}
            </div>
            <div className="ax-card ax-row-actions" style={{ justifyContent: 'space-between' }}>
              <span>Cột của mọi board theo quy trình: mỗi board có cột cho từng bước (thêm cột còn thiếu, giữ tên cột riêng của board), cột "Quá hạn" được lưu trữ và thẻ trong đó về đúng cột, mỗi thẻ nằm ở cột của bước công việc đang ở.</span>
              {editable && <button className="btn btn-gray btn-sm" onClick={() => void act(async () => { const r = await admin.normalizeBoards(); toast(`Đã chuẩn hoá ${fmtNum(r.changed)}/${fmtNum(r.boards)} board`); }, undefined, load.reload)}>Chuẩn hoá board</button>}
            </div>
          </Section>
          <Section title="Trạng thái không thuộc quy trình">
            {!outside.length && !st.unlisted.length ? <p className="note">Mọi trạng thái đều thuộc quy trình.</p> : <div className="ax-card">
              <p className="note">Những trạng thái này không thuộc bước nào. Xoá một trạng thái thì công việc đang mang nó nhận trạng thái theo bước quy trình của chúng.</p>
              <ul className="ax-list">
                {outside.map((s) => <li key={s.id}><span><b>{s.name}</b><small>{fmtNum(s.used)} công việc{s.locked ? ' · trạng thái của việc mới, không xoá được' : ''}</small></span>
                  {editable && !s.locked && <button className="btn btn-danger btn-sm" onClick={async () => await askConfirm(s.used ? `Xoá trạng thái “${s.name}”? ${s.used} công việc đang mang nó sẽ nhận trạng thái theo bước quy trình.` : `Xoá trạng thái “${s.name}”?`) && act(() => admin.removeStatus(s.id), 'Đã xoá trạng thái', load.reload)}><Icon name="trash" size={13} />Xoá</button>}</li>)}
                {st.unlisted.map((u) => <li key={'u:' + u.name}><span><b>{u.name}</b><small>{fmtNum(u.used)} công việc · có trong dữ liệu nhưng không có trong danh sách</small></span>
                  {editable && <button className="btn btn-danger btn-sm" onClick={async () => await askConfirm(`Xoá trạng thái “${u.name}”? ${u.used} công việc đang mang nó sẽ nhận trạng thái theo bước quy trình.`) && act(() => admin.clearUnlistedStatus(u.name), 'Đã xoá trạng thái', load.reload)}><Icon name="trash" size={13} />Xoá</button>}</li>)}
              </ul>
            </div>}
          </Section>
        </>;
      }}</Async>
    </>
  );
}

// ---------------------------------------------------------------- categories (the tasks' labels) and priorities
export function Categories() {
  const can = useCan(), editable = can('tasks.manage');
  const load = useLoad(() => admin.labels(), []);
  const [name, setName] = useState(''), [color, setColor] = useState('#ef4444'), [err, setErr] = useState('');
  const add = async (e: React.FormEvent) => { e.preventDefault(); if (!name.trim()) return setErr('Hãy nhập tên danh mục/nhãn'); setErr(''); if (await act(() => admin.createLabel({ name: name.trim(), color }), 'Đã thêm nhãn', load.reload)) setName(''); };
  const quickAdd = (n: string, c: string) => async () => { setErr(''); await act(() => admin.createLabel({ name: n, color: c }), `Đã thêm nhãn ${n}`, load.reload); };
  return (
    <>
      <PageHead title="Danh mục & Nhãn công việc (Tags)" sub="Quản lý các nhãn / tag gắn trên công việc (ví dụ: Khẩn cấp, Paid Ads...). Khi tạo hoặc sửa công việc, nhân viên có thể bấm chọn nhanh các nhãn này." />
      {editable && (
        <div style={{ marginBottom: 14 }}>
          <form className="ax-inline-form ax-card" onSubmit={add}>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Màu nhãn" />
            <input className="bk-in" value={name} maxLength={100} onChange={(e) => { setName(e.target.value); setErr(''); }} placeholder="Tên nhãn mới (vd: Khẩn cấp, Paid Ads…)" aria-label="Tên danh mục" />
            <button className="btn btn-primary btn-sm"><Icon name="plus" size={14} />Thêm nhãn</button>
            {err && <small className="ax-field-err" role="alert">{err}</small>}
          </form>
          {load.data && !load.data.some((l) => l.name.toLowerCase().includes('khẩn') || l.name.toLowerCase().includes('gấp')) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 13, color: 'var(--label-2)' }}>
              <span>Gợi ý thêm nhanh:</span>
              <button type="button" className="btn btn-gray btn-sm" onClick={quickAdd('Khẩn cấp', '#ef4444')}>
                🔥 Thêm nhãn “Khẩn cấp” (#ef4444)
              </button>
            </div>
          )}
        </div>
      )}
      <div className="ax-card flush"><Async load={load}>{(rows) => <Table rows={rows} empty={<Empty icon="tag" title="Chưa có danh mục" />} cols={[
        { key: 'name', label: 'Danh mục / Nhãn', render: (l) => editable ? <span className="ax-person"><input type="color" value={l.color} aria-label="Màu" onChange={(e) => void act(() => admin.updateLabel(l.id, { color: e.target.value }), undefined, load.reload)} /><input className="bk-in ax-cell-input" defaultValue={l.name} maxLength={100} aria-label="Tên danh mục" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.name) void act(() => admin.updateLabel(l.id, { name: v }), 'Đã đổi tên', load.reload); else e.target.value = l.name; }} /></span> : <Badge color={l.color}>{l.name}</Badge> },
        { key: 'used', label: 'Công việc', align: 'right', render: (l) => fmtNum(l.used) },
        { key: 'x', label: '', align: 'right', render: (l) => editable ? <button className="bd-icon danger" aria-label={`Xoá ${l.name}`} onClick={async () => await askConfirm(`Xoá danh mục “${l.name}”?${l.used ? ` Nhãn sẽ được gỡ khỏi ${l.used} công việc.` : ''}`) && act(() => admin.removeLabel(l.id), 'Đã xoá danh mục', load.reload)}><Icon name="trash" size={14} /></button> : null },
      ]} />}</Async></div>
    </>
  );
}
export function Priorities() {
  const can = useCan();
  return (
    <>
      <PageHead title="Mức độ ưu tiên" sub="Các mức ưu tiên đặt cho công việc (ở trang Tất cả công việc) và cho mẫu công việc. Mức đang được dùng chỉ tắt được, không xoá được." />
      <DictEditor api={admin.priorities} noun="mức ưu tiên" canEdit={can('tasks.manage')} usedLabel="Công việc" />
    </>
  );
}

// ---------------------------------------------------------------- templates
export function Templates() {
  const can = useCan();
  const load = useLoad(() => admin.templates(), []);
  const [edit, setEdit] = useState<TaskTemplate | 'new' | null>(null), [apply, setApply] = useState<TaskTemplate | null>(null);
  return (
    <>
      <PageHead title="Mẫu công việc" sub="Mẫu gồm tên công việc, trạng thái, nhãn, thời hạn và checklist. Áp dụng mẫu tạo một công việc trong dịch vụ bạn chọn, mỗi mục checklist thành một công việc con."
        actions={can('tasks.manage') && <button className="btn btn-primary btn-sm" onClick={() => setEdit('new')}><Icon name="plus" size={14} />Tạo mẫu</button>} />
      <Async load={load} empty={<Empty icon="checklist" title="Chưa có mẫu công việc" text={can('tasks.manage') ? 'Tạo mẫu cho những việc lặp lại.' : undefined} />}>{(rows) => (
        <div className="ax-role-grid">{rows.map((t) => (
          <article key={t.id} className="ax-role static">
            <header><b>{t.name}</b>{t.status && <Badge tone="muted">{t.status}</Badge>}</header>
            <p>{t.about || t.title}</p>
            <footer><span><Icon name="checklist" size={13} />{t.checklist.length} mục</span>{t.dueDays !== null && <span><Icon name="clock" size={13} />{t.dueDays} ngày</span>}</footer>
            <div className="ax-row-actions"><button className="btn btn-primary btn-sm" onClick={() => setApply(t)}>Tạo công việc từ mẫu</button>{can('tasks.manage') && <button className="btn btn-gray btn-sm" onClick={() => setEdit(t)}>Sửa</button>}</div>
          </article>
        ))}</div>
      )}</Async>
      {edit && <TemplateForm tpl={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load.reload(); }} />}
      {apply && <ApplyTemplate tpl={apply} onClose={() => setApply(null)} />}
    </>
  );
}
function TemplateForm({ tpl, onClose, onSaved }: { tpl: TaskTemplate | null; onClose: () => void; onSaved: () => void }) {
  const statuses = useLoad(() => admin.statuses(), []), priorities = useLoad(() => admin.priorities.list(), []);
  const [f, setF] = useState({ name: tpl?.name || '', about: tpl?.about || '', title: tpl?.title || '', status: tpl?.status || '', priorityId: tpl?.priorityId || '', labels: (tpl?.labels || []).join(', '), dueDays: tpl?.dueDays ?? '' as number | '', checklist: (tpl?.checklist || []).join('\n') });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async () => {
    if (!f.name.trim() || !f.title.trim()) return setError('Hãy nhập tên mẫu và tên công việc');
    setBusy(true); setError('');
    try {
      await admin.saveTemplate(tpl?.id || null, { name: f.name, about: f.about, title: f.title, status: f.status || null, priorityId: f.priorityId || null, dueDays: f.dueDays === '' ? null : Number(f.dueDays),
        labels: f.labels.split(',').map((x) => x.trim()).filter(Boolean), checklist: f.checklist.split('\n').map((x) => x.trim()).filter(Boolean) });
      toast(tpl ? 'Đã lưu mẫu' : 'Đã tạo mẫu'); onSaved();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Drawer open title={tpl ? `Sửa mẫu · ${tpl.name}` : 'Tạo mẫu công việc'} onClose={onClose} footer={<>
      {tpl && <button className="btn btn-gray btn-sm" onClick={async () => await askConfirm(`Xoá mẫu “${tpl.name}”?`) && act(() => admin.removeTemplate(tpl.id), 'Đã xoá mẫu', onSaved)}><Icon name="trash" size={14} />Xoá</button>}
      <button className="btn btn-gray btn-sm" onClick={onClose}>Huỷ</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
    </>}>
      <div className="ax-form">
        {error && <p className="note err" role="alert">{error}</p>}
        <Field label="Tên mẫu *"><input className="bk-in" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Tên công việc tạo ra *"><input className="bk-in" value={f.title} maxLength={500} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Mô tả mẫu"><textarea className="bk-in" rows={2} maxLength={1000} value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} /></Field>
        <div className="ax-form-grid">
          <Field label="Trạng thái ban đầu"><select className="bk-in" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Mặc định</option>{(statuses.data?.statuses || []).filter((s) => s.active).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}</select></Field>
          <Field label="Mức ưu tiên"><select className="bk-in" value={f.priorityId} onChange={(e) => setF({ ...f, priorityId: e.target.value })}><option value="">Chưa đặt</option>{(priorities.data || []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        </div>
        <div className="ax-form-grid">
          <Field label="Hạn sau (ngày)" hint="Tính từ ngày tạo công việc"><input className="bk-in" type="number" min={0} max={365} value={f.dueDays} onChange={(e) => setF({ ...f, dueDays: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
          <Field label="Nhãn" hint="Ngăn cách bằng dấu phẩy"><input className="bk-in" value={f.labels} onChange={(e) => setF({ ...f, labels: e.target.value })} /></Field>
        </div>
        <Field label="Checklist" hint="Mỗi dòng một mục; mỗi mục thành một công việc con."><textarea className="bk-in" rows={6} value={f.checklist} onChange={(e) => setF({ ...f, checklist: e.target.value })} /></Field>
      </div>
    </Drawer>
  );
}
/** Makes the task and its sub-tasks on the Tasks API, so the person's own rights in the project apply. */
function ApplyTemplate({ tpl, onClose }: { tpl: TaskTemplate; onClose: () => void }) {
  const can = useCan();
  const meta = useLoad(() => api.taskMeta(), []);
  const [project, setProject] = useState(''), [title, setTitle] = useState(tpl.title), [due, setDue] = useState(tpl.dueDays !== null ? dayValue(Date.now() + tpl.dueDays * 86400e3) : '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const projects = (meta.data?.projects || []).filter((p) => p.level !== 'observer');
  const run = async () => {
    if (!title.trim()) return setError('Hãy nhập tên công việc');
    setBusy(true); setError('');
    try {
      const dueAt = due ? dayStart(due)! + 17 * 3600e3 : null;
      const base = { projectId: project || null, ...(tpl.status ? { status: tpl.status } : {}), ...(tpl.labels.length ? { labels: tpl.labels } : {}) };
      const parent = await api.createTask({ ...base, title: title.trim(), dueAt } as any);
      for (const item of tpl.checklist) await api.createTask({ ...base, title: item, parentId: parent.id, dueAt } as any);
      if (tpl.priorityId && can('tasks.update')) await admin.setPriority(parent.id, tpl.priorityId).catch(() => {});
      toast(`Đã tạo “${title.trim()}” với ${tpl.checklist.length} công việc con`); onClose(); openTask(parent.id);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Drawer open title={`Tạo công việc từ mẫu · ${tpl.name}`} onClose={onClose} footer={<><button className="btn btn-gray btn-sm" onClick={onClose}>Huỷ</button><button className="btn btn-primary btn-sm" disabled={busy} onClick={run}>{busy ? 'Đang tạo…' : 'Tạo công việc'}</button></>}>
      <div className="ax-form">
        {error && <p className="note err" role="alert">{error}</p>}
        <Field label="Tên công việc"><input className="bk-in" value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Dịch vụ" hint="Chỉ các dịch vụ bạn được sửa."><select className="bk-in" value={project} onChange={(e) => setProject(e.target.value)}><option value="">Không thuộc dịch vụ</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Thời hạn"><DayRangeField single from="" to={due} endLabel="Thời hạn" placeholder="Chọn thời hạn" onChange={(_, t) => setDue(t)} /></Field>
        {!!tpl.checklist.length && <Field label={`Công việc con (${tpl.checklist.length})`}><ul className="ax-list">{tpl.checklist.map((c, i) => <li key={i}><span>{c}</span></li>)}</ul></Field>}
      </div>
    </Drawer>
  );
}
