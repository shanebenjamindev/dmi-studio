import {ReadingTabs} from './ReadingLayout';
import { ResizeHandle } from './ResizeHandle';
import {TextLinks} from './TextLinks';
import {BrandLoading} from './BrandLoading';
import {EntitySelect,useEntityRefresh} from './QuickCreate';
// Công việc của tôi (Workspace ▸ Công việc): the team's tasks imported from their task app. "Của tôi" lists the tasks
// given to the names linked to this account, by what needs doing (late, open, finished); "Tất cả" lists everyone's,
// by person, like the app's export. A task opens on the side with its parents above it, its children below, its
// description and its result (shown on request: it can hold logins). Admins import an export (paste it or pick the
// file) and link the names in it to accounts; anyone can claim their own name.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EmployeePicker, EmployeeAvatars, MemberChoices } from './EmployeePicker';
import { MemberAvatar } from './MemberAvatar';
import { Avatar, Pop, ago, dueState, fullDate } from './boardkit';
import { ClientServiceFields, ClientServicePop, placeOf } from './ClientServicePick';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useStore, toast, getState, goto } from '../store';
import { Icon, Menu } from './ui';
import { GroupedList, byDueDate, byKey } from './GroupedList';
import { SheetGrid } from './SheetGrid';
import { RichEditor, RichView } from './RichText';
import { normName, readTaskExport, readTaskSheet } from '../../../server/taskimport';
import { CardModal } from './CardModal';
import type { Board, BoardItem, TaskWrite, TaskDetail, TaskImportResult, TaskItem, TaskMeta, TaskState } from '../types';
import { Badge, STEP_ORDER, stepCode, stepGroup, when } from './taskkit';
import { SubtaskTree, addSubtask } from './Subtasks';
import { ServicePicker } from './ServicePicker';
import { FlowBadge, FlowPop, FlowSteps, TaskFlow } from './TaskFlow';
import { SpanField, SpanPop, fromLocal, toLocal } from './DateRange';
import { FlowOverview } from './FlowOverview';
import { DateFilterBar, byRecent, filterByDate, useDateFilter } from './DateFilter';
import { FLOW_FILTERS, FLOW_FILTER_LABEL } from '../../../shared/flow-filter';
import type { FlowStage } from '../../../shared/task-flow';
import { askConfirm } from './AskDialog';

const initials = (n: string) => n.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase() || '?';

const onTaskPage = () => /^#tasks\/tk_\w+\/page/.test(location.hash);

export function TasksPage({ initialProject = '', initialCampaign = '', projectName, embedded = false, forcedView }: { initialProject?: string; initialCampaign?:string; projectName?: string; embedded?: boolean; forcedView?: 'list' | 'table' } = {}) {
  const user = useStore((s) => s.user);
  const admin = user?.role === 'admin';
  // "Công việc của tôi" lists the account's own tasks (given to it, on its cards, followed). A department's head also
  // lists the department's, a company admin any department's; a project's page lists all of the project's tasks.
  // The last choice is remembered per browser.
  const [scope, setScopeState] = useState<'mine' | 'team' | 'all'>(() => { if (initialProject) return 'all'; try { return localStorage.getItem('dms.taskScope') === 'team' ? 'team' : 'mine'; } catch { return 'mine'; } });
  const [team, setTeam] = useState(user?.teamRole || '');
  const [state, setState] = useState<string>('');
  const [project, setProject] = useState(initialProject);
  const [campaign, setCampaign] = useState(initialCampaign);
  const [person, setPerson] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ tasks: TaskItem[]; linked: boolean } | null>(null);
  const [meta, setMeta] = useState<TaskMeta | null>(null);
  const [open, setOpen] = useState<string | null>(() => location.hash.match(/^#tasks\/(tk_\w+)/)?.[1] || null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deletingMany, setDeletingMany] = useState(false);
  const [taskListFolded, setTaskListFolded] = useState(false);
  // The tasks made or changed within a span of days (Ngày tạo / Ngày sửa), filtered here from what is listed.
  const [dates, setDates] = useDateFilter();
  // Danh sách or Tổng quan (FlowOverview), remembered per browser.
  const [overview, setOverviewState] = useState(() => { try { return localStorage.getItem('dms.taskOverview') === '1'; } catch { return false; } });
  const setOverview = (on: boolean) => { setOverviewState(on); try { localStorage.setItem('dms.taskOverview', on ? '1' : '0'); } catch { /* private mode */ } };
  const listPane=useRef<HTMLElement>(null),listScroll=useRef(0);
  useLayoutEffect(()=>{if(listPane.current)listPane.current.scrollTop=open?0:listScroll.current;},[!!open]);
  const [full, setFull] = useState(onTaskPage);
  const [creating, setCreating] = useState(false);
  const[syncing,setSyncing]=useState(false);
  const [error, setError] = useState('');
  // "Của tôi" in three tabs (given to me, made by me, followed), grouped by due date by default; the full table on request.
  const remembered = (k: string, fallback: string) => { try { return localStorage.getItem(k) || fallback; } catch { return fallback; } };
  const remember = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const [rel, setRelState] = useState(() => remembered('dms.taskRel', 'assigned'));
  const [groupBy, setGroupByState] = useState(() => remembered('dms.taskGroup', 'due'));
  const [view, setViewState] = useState(() => remembered('dms.taskView', 'list'));
  const effectiveView = forcedView || view;
  const setRel = (v: string) => { setRelState(v); remember('dms.taskRel', v); };
  const setGroupBy = (v: string) => { setGroupByState(v); remember('dms.taskGroup', v); };
  const setView = (v: string) => { setViewState(v); remember('dms.taskView', v); };
  // A task's own page gets a history entry, so the browser's Back returns to the list.
  const showTask = (id: string | null, page = false) => {
    if(id&&!open)listScroll.current=listPane.current?.scrollTop||0;
    setOpen(id); setFull(!!id && page);
    if (!location.hash.startsWith('#tasks')) return;
    const hash = id ? `#tasks/${id}${page ? '/page' : ''}` : '#tasks';
    if (page) history.pushState(null, '', hash); else history.replaceState(null, '', hash);
  };
  useEffect(() => { const change = () => { if (location.hash.startsWith('#tasks')) { setOpen(location.hash.match(/^#tasks\/(tk_\w+)/)?.[1] || null); setFull(onTaskPage()); } }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const [dialog, setDialog] = useState<'import' | null>(null);
  const setScope = (v: 'mine' | 'team' | 'all') => { setScopeState(v); if (!initialProject) try { localStorage.setItem('dms.taskScope', v); } catch { /* private mode */ } };
  const teams = (meta?.workTeams || meta?.teams || []).filter((t) => admin || (user?.level === 'admin' && (t.id === user.teamRole || (meta?.teams || []).some((d) => d.id === user.teamRole && d.name === t.name))));
  const teamId = teams.some((t) => t.id === team) ? team : teams[0]?.id || '';
  // Without a department to look at (not a head, or still loading), the list is the account's own.
  const listed = scope === 'team' && !teamId ? 'mine' : scope;
  const loadMeta = () => api.taskMeta().then(setMeta).catch((e) => toast(e.message, true));
  useEntityRefresh(() => { void loadMeta(); void load(); });
  const request = useRef(0);
  const load = () => {
    const seq = ++request.current;
    return api.tasks({ scope: listed, rel: listed === 'mine' ? rel : '', team: listed === 'team' ? teamId : '', state, project, campaign, employee: listed === 'team' ? person : '', q: q.trim() }).then((r) => { if (seq === request.current) { setData(r); setError(''); } }, (e) => { if (seq === request.current) { setError(e.message); setData(null); } });
  };
  useEffect(() => { loadMeta(); }, []);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    const interval = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15000);
    const focus = () => load(); window.addEventListener('focus', focus);
    return () => { clearTimeout(t); clearInterval(interval); window.removeEventListener('focus', focus); };
  }, [listed, rel, teamId, state, project, campaign, person, q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!data) return;
    setSelectedIds((prev) => prev.filter((id) => data.tasks.some((t) => t.id === id)));
  }, [data]);

  useEffect(() => {
    const handleFilterEvent = (e: any) => {
      const detail = e.detail;
      if (detail?.scope) setScope(detail.scope);
      if (detail?.rel) setRel(detail.rel);
      if (detail?.project !== undefined) {
        setProject(detail.project);
        setCampaign('');
      }
    };
    window.addEventListener('dms:task-filter', handleFilterEvent);
    return () => window.removeEventListener('dms:task-filter', handleFilterEvent);
  }, []);

  useEffect(() => {
    if (!embedded && !overview && data?.tasks?.length && !open && !location.hash.startsWith('#tasks/')) {
      showTask(data.tasks[0].id);
    }
  }, [data?.tasks, open, embedded, overview]);

  const toggleTaskDone = async (t: TaskItem) => {
    const finished = t.state === 'done' || t.state === 'done_late';
    try {
      await api.setTaskStatus(t.id, finished ? 'Chưa thực hiện' : 'Hoàn thành');
      refresh();
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const refresh = () => { load(); loadMeta(); };

  const handleBulkDelete = async () => {
    if (!selectedIds.length || deletingMany) return;
    const count = selectedIds.length;
    if (!await askConfirm(`Xoá ${count} công việc đã chọn? Các thẻ liên kết trên Workspace sẽ được xoá, các công việc con sẽ được giữ lại.`)) return;
    setDeletingMany(true);
    try {
      const res = await api.bulkDeleteTasks(selectedIds);
      toast(`Đã xoá ${res.deleted} công việc.`);
      setSelectedIds([]);
      if (open && selectedIds.includes(open)) showTask(null);
      refresh();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setDeletingMany(false);
    }
  };

  const selectableTasks = (data?.tasks || []).filter((t) => admin || t.canDelete !== false);
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };
  const toggleSelectAll = (checked: boolean) => {
    if (!data?.tasks) return;
    setSelectedIds(checked ? selectableTasks.map((t) => t.id) : []);
  };
  const isAllSelected = selectableTasks.length > 0 && selectableTasks.every((t) => selectedIds.includes(t.id));
  const selection = {
    selected: selectedIds,
    toggle: toggleSelect,
    all: isAllSelected,
    toggleAll: toggleSelectAll,
  };

  const imported = (result: TaskImportResult) => {
    setDialog(null);
    refresh();
    toast(result.linked ? `Đã lưu lên backend: ${result.created} công việc mới, ${result.updated} cập nhật, ${result.linked} tên gắn với tài khoản nhân viên.` : `Đã lưu lên backend: ${result.created} công việc mới, ${result.updated} cập nhật.`);
  };

  if (open && full) return <TaskPanel page id={open} meta={meta} statuses={meta?.statuses || []} onOpen={(id) => showTask(id, true)} onClose={() => showTask(null)} onChanged={refresh} />;
  const listed_ = data ? filterByDate(data.tasks, dates) : [];
  return (
    <div className={'ad-page tk-page tk-mailbox' + (embedded ? ' tk-embedded' : '') + (open ? ' has-selection' : '') + (open && taskListFolded ? ' task-list-folded' : '')}>
      <section ref={listPane} className="tk-list-pane" aria-label="Danh sách công việc">
      {!open && !embedded && <header className="tk-head">
        <span className="tk-head-ico"><Icon name="checklist" size={20} /></span>
        <div className="tk-head-main">
          <h1>{projectName || (listed === 'team' ? `Công việc của ${teams.find((t) => t.id === teamId)?.name || 'team'}` : 'Công việc của tôi')}</h1>
          {!initialProject && <ReadingTabs label="Danh sách công việc" value={listed==='team'?'team':rel} items={[{value:'assigned',label:'Giao cho tôi',icon:'user'},{value:'created',label:'Tôi giao đi',icon:'send'},{value:'following',label:'Đang theo dõi',icon:'eye'},...(teams.length?[{value:'team',label:'Team',icon:'users'}]:[])]} onChange={value=>{if(value==='team'){setScope('team');setPerson('');}else{setScope('mine');setRel(value);}}}/>}
        </div>
        <Menu label="Thêm thao tác" items={[
          { label: 'Mở Workspace', icon: 'boards', onClick: () => { goto('boards'); window.location.hash = '#boards'; } },
          { label: view === 'table' ? 'Xem dạng danh sách nhóm' : 'Xem bảng đầy đủ', icon: view === 'table' ? 'list' : 'sheet', onClick: () => setView(view === 'table' ? 'list' : 'table') },
          { label: 'Thêm file sheet', icon: 'sheet', onClick: () => setDialog('import'), hidden: !admin },
          { label: syncing ? 'Đang đồng bộ…' : 'Đồng bộ lên board', icon: 'boards', hidden: !admin, onClick: async () => { if (syncing) return; setSyncing(true); try { const r = await api.syncTasksToBoard(); toast(`Đã liên kết ${r.linked}/${r.total} công việc; thêm ${r.created} thẻ mới.`); refresh(); } catch (e: any) { toast(e.message, true); } finally { setSyncing(false); } } },
          { label: 'Nhân viên', icon: 'users', onClick: () => goto('admin'), hidden: !admin },
        ]} />
      </header>}
      {!open && <div className="tk-toolbar">
        <button className="tk-new" disabled={!meta} onClick={() => setCreating(true)}><Icon name="plus" size={15} />Thêm mới</button>
        {selectedIds.length > 0 && (
          <div className="tk-bulk-bar">
            <span>Đã chọn <b>{selectedIds.length}</b></span>
            <div className="tk-bulk-actions">
              <button className="btn btn-sm cm-danger" disabled={deletingMany} onClick={handleBulkDelete}>
                <Icon name="trash" size={14} />{deletingMany ? 'Đang xoá…' : `Xoá (${selectedIds.length})`}
              </button>
              <button className="btn btn-sm btn-gray" onClick={() => setSelectedIds([])}>Bỏ chọn</button>
            </div>
          </div>
        )}
        <label className="tk-find"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm công việc, dịch vụ, nhãn, mã" aria-label="Tìm công việc" /></label>
        <label className="tk-pick"><Icon name="filter" size={14} /><select aria-label="Quy trình" value={state} onChange={(e) => setState(e.target.value)}><FlowFilterOptions /></select></label>
        <DateFilterBar value={dates} onChange={setDates} />
        {!initialProject && <label className="tk-pick"><Icon name="folder" size={14} /><EntitySelect kind="project" onCreated={async()=>setMeta(await api.taskMeta())} value={project} onChange={v=>{setProject(v);setCampaign('');}} aria-label="Dịch vụ">
          <option value="">Tất cả dịch vụ</option>
          {meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.tasks})</option>)}
        </EntitySelect></label>}
        {listed === 'team' && teams.length > 1 && <label className="tk-pick"><Icon name="users" size={14} /><select aria-label="Phòng ban" value={teamId} onChange={(e) => { setTeam(e.target.value); setPerson(''); }}>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
        {listed === 'team' && <label className="tk-pick"><Icon name="user" size={14} /><EntitySelect kind="employee" onCreated={async()=>setMeta(await api.taskMeta())} value={person} onChange={setPerson} aria-label="Người được giao">
          <option value="">Cả team</option>
          {meta?.users.filter((u) => !teamId || u.teamId === teamId || (u.workTeamIds || []).includes(teamId)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </EntitySelect></label>}
        <div className="ax-seg fo-switch" role="radiogroup" aria-label="Cách xem công việc">{([[false, 'Danh sách'], [true, 'Tổng quan']] as const).map(([on, label]) => <button key={label} role="radio" aria-checked={overview === on} onClick={() => setOverview(on)}>{label}</button>)}</div>
        {!overview && effectiveView !== 'table' && <label className="tk-pick"><Icon name="layers" size={14} /><span>Nhóm theo:</span><select aria-label="Nhóm theo" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}><option value="due">Thời hạn</option><option value="status">Quy trình</option><option value="project">Dịch vụ</option><option value="created">Ngày tạo</option><option value="updated">Ngày sửa</option></select></label>}
      </div>}
      {error ? <p className="note err" role="alert">{error} <button className="btn btn-gray btn-sm" onClick={load}>Thử lại</button></p> : !data ? <BrandLoading label="Đang tải…"/> : !data.tasks.length ? (
        <p className="note">{meta && !meta.people.length ? (admin ? 'Chưa có dữ liệu công việc. Bấm “Thêm file sheet” và chọn file hoặc dán bảng.' : 'Chưa có dữ liệu công việc. Quản trị viên cần nhập dữ liệu trước.') : listed === 'mine' && !state && !q.trim() && !project && !campaign ? 'Chưa có công việc nào giao cho bạn, có tên bạn trên thẻ, hoặc bạn đang theo dõi.' : 'Không có công việc nào khớp.'}</p>
      ) : open ? (
        <TaskReadingList
          tasks={listed_}
          groupBy={groupBy}
          selected={open}
          onOpen={showTask}
          selection={selection}
          hideProject={!!initialProject}
          onToggleDone={toggleTaskDone}
          q={q}
          setQ={setQ}
          rel={rel}
          setRel={setRel}
          state={state}
          setState={setState}
          onNew={() => setCreating(true)}
          projectName={projectName}
          meta={meta}
          onFold={() => setTaskListFolded(true)}
          onOverview={() => { showTask(null); setOverview(true); }}
        />
      ) : overview ? <FlowOverview rows={listed_.map((t) => { const p = meta?.projects.find((x) => x.id === t.project?.id); return { ...t, customer: p?.customerId ? { id: p.customerId, name: p.customerName || '' } : null }; })}
          onOpenTask={(id) => showTask(id)} onPick={(f) => { setData(null); setState(f); setOverview(false); }} />
        : effectiveView === 'table' ? <TaskTable tasks={listed_} selected={open} onOpen={showTask} selection={selection} />
        : <TaskGroups tasks={listed_} groupBy={groupBy} selected={open} onOpen={showTask} onNew={() => setCreating(true)} onChanged={load} selection={selection} />}
      </section>
      {open && !taskListFolded && <ResizeHandle cssVar="--rd-list-w" storage={embedded ? 'tasks-embedded' : 'tasks'} min={220} max={640} label="Đổi độ rộng danh sách công việc" />}
      {open && <TaskPanel inline id={open} meta={meta} statuses={meta?.statuses || []} onOpen={(id) => showTask(id)} onClose={() => showTask(null)} onExpand={() => showTask(open, true)} onChanged={refresh} onUnfoldList={taskListFolded ? () => setTaskListFolded(false) : undefined} />}
      {creating && meta && <TaskEditor meta={meta} projectId={initialProject || project} campaignId={initialCampaign || campaign} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); refresh(); showTask(id); }} />}
      {dialog === 'import' && <ImportDialog meta={meta} onClose={() => setDialog(null)} onDone={imported} />}
    </div>
  );
}

function formatWeworkDateTime(ts?: number | null) {
  if (!ts) return 'Chưa đặt';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hh = pad(d.getHours()), mm = pad(d.getMinutes());
  const dd = pad(d.getDate()), MM = pad(d.getMonth() + 1), yyyy = d.getFullYear();
  return `${hh}:${mm} ${dd}/${MM}/${yyyy}`;
}

function formatWeworkDate(ts?: number | null) {
  if (!ts) return 'Chưa đặt';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dd = pad(d.getDate()), MM = pad(d.getMonth() + 1), yyyy = d.getFullYear();
  return `${dd}/${MM}/${yyyy}`;
}

function byWeek(tasks: TaskItem[]) {
  const groups = new Map<string, { key: string; label: string; monTime: number; rows: TaskItem[] }>();
  const undated: TaskItem[] = [];

  for (const t of tasks) {
    const ts = t.dueAt || t.startAt || t.createdAt;
    if (!ts) {
      undated.push(t);
      continue;
    }
    const d = new Date(ts);
    const day = d.getDay();
    const diffToMon = (day === 0 ? -6 : 1) - day;
    const mon = new Date(d);
    mon.setDate(d.getDate() + diffToMon);
    mon.setHours(0, 0, 0, 0);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);

    const pad = (n: number) => String(n).padStart(2, '0');
    const d1 = pad(mon.getDate()), m1 = pad(mon.getMonth() + 1);
    const d2 = pad(sun.getDate()), m2 = pad(sun.getMonth() + 1), y2 = String(sun.getFullYear()).slice(-2);
    const key = `${mon.getFullYear()}-${m1}-${d1}`;
    const label = `TUẦN ${d1}/${m1} - ${d2}/${m2}/${y2}`;

    if (!groups.has(key)) {
      groups.set(key, { key, label, monTime: mon.getTime(), rows: [] });
    }
    groups.get(key)!.rows.push(t);
  }

  const sorted = [...groups.values()].sort((a, b) => b.monTime - a.monTime);
  if (undated.length) {
    sorted.push({ key: 'undated', label: 'CHƯA CÓ THỜI HẠN', monTime: 0, rows: undated });
  }
  return sorted;
}

/** The filters of the task lists: every step, then what needs a hand (shared/flow-filter.ts; Tổng quan's numbers). */
function FlowFilterOptions() {
  return <>
    <option value="">Tất cả bước</option>
    <optgroup label="Bước">{STEP_ORDER.map((k) => <option key={k} value={k}>{stepCode(k as FlowStage)}</option>)}</optgroup>
    <optgroup label="Cần chú ý"><option value="open">Chưa xong</option>{FLOW_FILTERS.filter((f) => !STEP_ORDER.includes(f)).map((f) => <option key={f} value={f}>{FLOW_FILTER_LABEL[f]}</option>)}</optgroup>
  </>;
}

function TaskReadingList({
  tasks,
  groupBy,
  selected,
  onOpen,
  selection,
  hideProject,
  onToggleDone,
  q,
  setQ,
  rel,
  setRel,
  state,
  setState,
  onNew,
  projectName,
  meta,
  onFold,
  onOverview,
}: {
  tasks: TaskItem[];
  groupBy?: string;
  selected: string;
  onOpen: (id: string) => void;
  selection?: { selected: string[]; toggle: (id: string) => void };
  hideProject?: boolean;
  onToggleDone?: (t: TaskItem) => void;
  q: string;
  setQ: (v: string) => void;
  rel: string;
  setRel: (v: string) => void;
  state: string;
  setState: (v: string) => void;
  onNew?: () => void;
  projectName?: string;
  meta?: TaskMeta | null;
  onFold?: () => void;
  /** Leave the open task for Tổng quan. */
  onOverview?: () => void;
}) {
  const user = useStore((s) => s.user);

  const groups = useMemo(() => {
    if (groupBy === 'project') {
      return byKey(tasks, (t) => (t.project ? { key: t.project.id, label: t.project.name } : null), 'Không thuộc dịch vụ');
    }
    if (groupBy === 'status') {
      return byKey(tasks, stepGroup, 'Khác', STEP_ORDER);
    }
    if (groupBy === 'created' || groupBy === 'updated') return byRecent(tasks, groupBy);
    return byWeek(tasks);
  }, [tasks, groupBy]);

  const ordered = groups.flatMap((g) => g.rows);

  return (
    <div className="wework-reading-list">
      <div className="wework-list-head">
        <div className="wework-head-left">
          <b className="wework-head-name">{projectName || 'Công việc của tôi'}</b>
        </div>
        <div className="wework-head-actions">
          {onFold && (
            <button
              type="button"
              className="bd-icon tk-pane-fold"
              onClick={onFold}
              title="Thu gọn danh sách công việc"
              aria-label="Thu gọn danh sách"
            >
              <Icon name="left" size={14} />
            </button>
          )}
          {onOverview && <button type="button" className="bd-icon" onClick={onOverview} title="Tổng quan công việc" aria-label="Tổng quan công việc"><Icon name="chart" size={15} /></button>}
          {onNew && (
            <button type="button" className="btn btn-primary btn-sm" onClick={onNew} title="Thêm công việc mới">
              <Icon name="plus" size={13} />
              <span>Thêm mới</span>
            </button>
          )}
        </div>
      </div>

      {!projectName && (
        <div className="wework-list-tabs">
          <button type="button" className={'wework-list-tab' + (rel === 'assigned' ? ' active' : '')} onClick={() => setRel('assigned')}>Giao cho tôi</button>
          <button type="button" className={'wework-list-tab' + (rel === 'created' ? ' active' : '')} onClick={() => setRel('created')}>Tôi giao đi</button>
          <button type="button" className={'wework-list-tab' + (rel === 'following' ? ' active' : '')} onClick={() => setRel('following')}>Đang theo dõi</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, margin: '0 14px 10px' }}>
        <label className="wework-search-bar" style={{ margin: 0, flex: 1 }}>
          <Icon name="search" size={13} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm kiếm công việc" aria-label="Tìm kiếm công việc" />
        </label>
        <select
          className="bk-in"
          style={{ width: 'auto', fontSize: 12, height: 34, padding: '0 8px', borderRadius: 8, background: 'var(--fill-2)', border: '1px solid var(--sep)', color: 'var(--label)' }}
          value={state}
          onChange={(e) => setState(e.target.value)}
          aria-label="Lọc theo quy trình"
        >
          <FlowFilterOptions />
        </select>
      </div>

      <div className="wework-list-scroll">
        {groups.map((g) => (
          <section key={g.key} className="wework-week-sec">
            <h3 className="wework-week-h">{g.label}</h3>
            {g.rows.map((t) => {
              const isDone = t.state === 'done' || t.state === 'done_late';
              const isSelected = selected === t.id;
              const isDoing = t.stage ? t.stage === 'execution' || t.stage === 'review' : t.state === 'doing' || t.status.toLowerCase().includes('đang');
              const assignee = t.assignees[0];

              return (
                <div
                  key={t.id}
                  id={'task-row-' + t.id}
                  className={'wework-row' + (isSelected ? ' selected' : '') + (isDone ? ' done' : '') + (selection?.selected.includes(t.id) ? ' checked' : '')}
                  onClick={() => onOpen(t.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const i = ordered.findIndex((x) => x.id === t.id),
                        next = ordered[i + (e.key === 'ArrowDown' ? 1 : -1)];
                      if (next) {
                        onOpen(next.id);
                        document.getElementById('task-row-' + next.id)?.focus();
                      }
                    } else if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen(t.id);
                    }
                  }}
                >
                  <button
                    type="button"
                    className={'wework-check-btn' + (isDone ? ' done' : '')}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onToggleDone) onToggleDone(t);
                    }}
                    aria-label={isDone ? 'Đánh dấu chưa xong' : 'Đánh dấu hoàn thành'}
                    title={isDone ? 'Đánh dấu chưa xong' : 'Đánh dấu hoàn thành'}
                  >
                    {isDone ? '✔' : ''}
                  </button>
                  <div className="wework-row-main">
                    <span className="wework-row-title">{t.title}</span>
                    <div className="wework-row-meta">
                      {!hideProject && t.project?.name && <span className="wework-row-project">[{t.project.name}]</span>}
                      {t.campaign?.name && t.campaign.name !== 'Công việc hiện có' && (
                        <span className="wework-row-project" style={{ color: 'var(--tint)' }}>{t.campaign.name}</span>
                      )}
                      {t.services && t.services.length > 0 && t.services.map((s) => (
                        <span key={s.id} className="wework-row-tag" style={{ background: 'rgba(59,130,246,0.12)', color: '#2563eb' }}>
                          {s.name}
                        </span>
                      ))}
                      {t.boardLink && (
                        <span className="wework-row-tag" style={{ background: 'rgba(16,185,129,0.12)', color: '#059669' }}>
                          {t.boardLink.boardName}
                        </span>
                      )}
                      {t.labels && t.labels.length > 0 && t.labels.map((l) => {
                        const isUrgent = l.toLowerCase().includes('khẩn') || l.toLowerCase().includes('gấp');
                        return (
                          <span key={l} className={'wework-row-tag' + (isUrgent ? ' urgent' : '')}>
                            {l}
                          </span>
                        );
                      })}
                      {t.dueAt && <span className="wework-row-date">Hạn {formatWeworkDate(t.dueAt)}</span>}
                      {t.children > 0 && <span className="wework-row-sub">· {t.children} việc con</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flex: 'none' }}>
                    {t.stage ? <span className={'wework-badge tf-solid tf-' + t.stage}>{stepCode(t.stage)}</span>
                      : isDone ? <span className="wework-badge done">HOÀN THÀNH</span>
                      : isDoing ? <span className="wework-badge doing">ĐANG LÀM</span>
                      : <span className="wework-badge" style={{ background: 'var(--fill)', color: 'var(--label-2)' }}>{t.status || 'CHƯA XONG'}</span>}
                    {assignee && <Avatar m={{ id: assignee.id, userId: assignee.userId, avatarAt: assignee.avatarAt, name: assignee.name }} size={22} />}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <div className="wework-pagination">
        <span>Tổng cộng {tasks.length} công việc</span>
      </div>
    </div>
  );
}

/** The tasks in groups (due date, status or project), each with a tick box to finish it or open it again. */
function TaskGroups({ tasks, groupBy, selected, onOpen, onNew, onChanged, selection }: { tasks: TaskItem[]; groupBy: string; selected: string | null; onOpen: (id: string) => void; onNew: () => void; onChanged: () => void; selection?: { selected: string[]; toggle: (id: string) => void; all?: boolean; toggleAll?: (checked: boolean) => void } }) {
  const finished = (t: TaskItem) => t.state === 'done' || t.state === 'done_late';
  const toggle = async (t: TaskItem) => {
    try { await api.updateTask(t.id, { status: finished(t) ? 'Chưa thực hiện' : 'Hoàn thành' }); onChanged(); }
    catch (e: any) { toast(e.message, true); }
  };
  const groups = groupBy === 'created' || groupBy === 'updated' ? byRecent(tasks, groupBy).map((g) => ({ ...g, onAdd: onNew }))
    : groupBy === 'status' ? byKey(tasks, stepGroup, 'Khác', STEP_ORDER).map((g) => ({ ...g, onAdd: onNew }))
    : groupBy === 'project' ? byKey(tasks, (t) => (t.project ? { key: t.project.id, label: t.project.name } : null), 'Không thuộc dịch vụ').map((g) => ({ ...g, onAdd: onNew }))
    : byDueDate(tasks, onNew);
  return <GroupedList foldKey={`dms.taskFold.${groupBy}`} groups={groups} nameLabel="Tên công việc" addLabel="Tạo công việc" onOpen={(t) => onOpen(t.id)} selected={selected}
    selection={selection}
    check={{ done: finished, toggle: (t) => void toggle(t), label: (t) => (finished(t) ? `Mở lại “${t.title}”` : `Hoàn thành “${t.title}”`) }}
    name={(t) => <><span className={finished(t) ? 'tk-done-title' : ''}>{t.title}</span>{t.children > 0 && <small className="tk-kids">{t.children} việc con</small>}{t.parent && <small className="tk-parent-of" title="Công việc cha"><Icon name="up" size={11} />{t.parent.title}</small>}</>}
    columns={[
      { key: 'status', label: 'Quy trình', width: 130, render: (t) => <Badge t={t} /> },
      // Those given the task, then the people on its card (it is listed as their work too).
      { key: 'who', label: 'Người làm', width: 110, render: (t) => <EmployeeAvatars people={[...t.assignees, ...(t.cardPeople || [])]} /> },
      { key: 'start', label: 'Bắt đầu', width: 120, render: (t) => when(t.startAt) },
      { key: 'due', label: 'Thời hạn', width: 120, render: (t) => <span className={t.state === 'overdue' ? 'tk-late' : ''}>{when(t.dueAt)}</span> },
      { key: 'done', label: 'Hoàn thành', width: 120, render: (t) => when(t.doneAt) },
      { key: 'project', label: 'Dịch vụ', width: 160, wide: true, render: (t) => t.project?.name || '—' },
      { key: 'parent', label: 'Công việc cha', width: 160, wide: true, render: (t) => t.parent?.title || '—' },
    ]} />;
}

/** Imported and manually created tasks share a table; each task appears once, including multi-assignee tasks. */
function TaskTable({ tasks, selected, onOpen, selection }: { tasks: TaskItem[]; selected: string | null; onOpen: (id: string) => void; selection?: { selected: string[]; toggle: (id: string) => void; all?: boolean; toggleAll?: (checked: boolean) => void } }) {
  const [page, setPage] = useState(0);
  const size = 50, pages = Math.max(1, Math.ceil(tasks.length / size)), at = Math.min(page, pages - 1);
  useEffect(() => setPage(0), [tasks]);
  const pageTasks = tasks.slice(at * size, (at + 1) * size);
  return <section className="tk-table-section" aria-label="Danh sách công việc dạng bảng">
    <div className="tk-table-count"><span>{tasks.length} công việc · hiển thị {at * size + 1}–{Math.min((at + 1) * size, tasks.length)}</span><span>Bấm tên công việc để xem, sửa hoặc liên kết Workspace.</span></div>
    <div className="tk-table-scroll" tabIndex={0} role="region" aria-label="Bảng công việc">
      <table className="tk-data-table">
        <thead>
          <tr>
            {selection && <th style={{ width: 36, minWidth: 36, textAlign: 'center' }} scope="col">{selection.toggleAll && <input type="checkbox" checked={!!selection.all} onChange={(e) => selection.toggleAll!(e.target.checked)} aria-label="Chọn tất cả để thao tác" />}</th>}
            {['Mã công việc', 'Tên công việc', 'Quy trình', 'Dịch vụ', 'Dịch vụ kèm', 'Board / thẻ', 'Giao cho', 'Ngày bắt đầu', 'Thời hạn', 'Hoàn thành', 'Công việc cha', 'Nhãn', 'Tạo bởi', 'Cập nhật'].map(label => <th key={label} scope="col">{label}</th>)}
          </tr>
        </thead>
        <tbody>{pageTasks.map(t => <tr key={t.id} className={(selected === t.id ? 'on' : '') + (selection?.selected.includes(t.id) ? ' checked' : '')}>
          {selection && <td style={{ width: 36, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selection.selected.includes(t.id)} onChange={() => selection.toggle(t.id)} aria-label={`Chọn ${t.title}`} /></td>}
          <td>{t.externalId || '—'}</td>
          <th scope="row"><button className="tk-table-title" onClick={() => onOpen(t.id)}>{t.title}</button>{t.children > 0 && <small>{t.children} việc con</small>}</th>
          <td><Badge t={t} /></td><td>{t.project?.name || '—'}</td><td>{t.services?.map((x) => x.name).join(', ') || '—'}</td><td>{t.boardLink?<button className="tk-board-shortcut" onClick={()=>openLinkedBoard(t.boardLink!)}><Icon name="boards" size={14}/><span>{t.boardLink.boardName}<small>{t.boardLink.listName}</small></span></button>:t.hasBoardLink?<small>Đã liên kết board</small>:'—'}</td><td><EmployeeAvatars people={[...t.assignees, ...(t.cardPeople || [])]}/></td>
          <td>{when(t.startAt)}</td><td className={t.state === 'overdue' ? 'bad' : ''}>{when(t.dueAt)}</td><td>{when(t.doneAt)}</td>
          <td>{t.parent ? <button className="btn btn-gray btn-sm" onClick={() => onOpen(t.parent!.id)}>{t.parent.title}</button> : '—'}</td>
          <td><span className="tk-labels">{t.labels.map(l => <i key={l}>{l}</i>)}</span></td><td>{t.createdBy?.name || '—'}</td><td>{when(t.sourceUpdatedAt || t.updatedAt)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {pages > 1 && <div className="tk-preview-pages"><button className="btn btn-gray btn-sm" disabled={at === 0} onClick={() => setPage(at - 1)}>Trang trước</button><span>Trang {at + 1} / {pages}</span><button className="btn btn-gray btn-sm" disabled={at === pages - 1} onClick={() => setPage(at + 1)}>Trang sau</button></div>}
  </section>;
}

function WeworkTaskView({
  task: t,
  meta,
  statuses,
  onOpen,
  onClose,
  onChanged,
  onLink,
  onToggleCard,
  onUnfoldList,
}: {
  task: TaskDetail;
  meta: TaskMeta | null;
  statuses: string[];
  onOpen: (id: string) => void;
  onClose: () => void;
  onChanged: () => void;
  onLink: () => void;
  onToggleCard?: () => void;
  onUnfoldList?: () => void;
}) {
  const me = useStore((s) => s.user)!;
  const [pop, setPop] = useState<{ kind: 'members' | 'dates' | 'project' | 'actions'; el: HTMLElement } | null>(null);
  const [busy, setBusy] = useState(false);
  const [titleDraft, setTitleDraft] = useState(t.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(t.description || '');
  // The work's result (a link to what was posted, logins handed over…): read and written by those who may (null: not them).
  const [editingResult, setEditingResult] = useState(false);
  const [resultDraft, setResultDraft] = useState(t.result || '');
  const [foldAssignor, setFoldAssignor] = useState(false);
  const [foldFollowers, setFoldFollowers] = useState(false);
  // The review workflow opens from its step's badge (one button), shut until then.
  const [flowOpen, setFlowOpen] = useState(false);
  const [foldActivity, setFoldActivity] = useState(false);
  const [starred, setStarred] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [comments, setComments] = useState<NonNullable<TaskDetail['comments']>>(t.comments || []);
  const [activity, setActivity] = useState<NonNullable<TaskDetail['activity']>>(t.activity || []);
  const [sidebarTab, setSidebarTab] = useState<'comments' | 'activity'>('comments');
  const [replyingTo, setReplyingTo] = useState<{ id: string; userName: string } | null>(null);
  const [replyText, setReplyText] = useState('');
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [subtaskParent, setSubtaskParent] = useState<{ id: string; task?: TaskDetail | TaskItem } | null>(null);

  useEffect(() => {
    const handleAddSubtask = (e: Event) => {
      const targetId = (e as CustomEvent<string>).detail;
      if (targetId === t.id) {
        setSubtaskParent({ id: t.id, task: t });
      } else {
        const found = t.childTasks?.find((k) => k.id === targetId);
        if (found) {
          setSubtaskParent({ id: targetId, task: found });
        }
      }
    };
    window.addEventListener('dms:add-subtask', handleAddSubtask);
    return () => window.removeEventListener('dms:add-subtask', handleAddSubtask);
  }, [t]);

  useEffect(() => {
    setTitleDraft(t.title);
    setDescDraft(t.description || '');
    setComments(t.comments || []);
    setActivity(t.activity || []);
    setReplyingTo(null);
    setReplyText('');
  }, [t.id, t.title, t.description, t.startAt, t.dueAt, t.comments, t.activity]);

  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true);
    try { await fn(); onChanged(); return true; }
    catch (e: any) { toast(e.message, true); return false; }
    finally { setBusy(false); }
  };

  const roles = useStore((s) => s.roles);
  const edit = t.canEdit;

  const hasAssignee = t.assignees.length > 0;
  const assignee = t.assignees[0];
  const assigneeUser = assignee?.userId ? meta?.users.find((u) => u.id === assignee.userId) : null;
  const assigneeName = assignee?.name || '';
  const assigneeDept = assigneeUser?.teamId ? roles.find((r) => r.id === assigneeUser.teamId)?.name : '';
  const assigneeRole = assigneeDept || (assigneeUser ? 'Thành viên' : '');

  const creatorUser = t.createdBy?.id ? meta?.users.find((u) => u.id === t.createdBy!.id) : null;
  const creatorName = t.createdBy?.name || 'Hệ thống';
  const creatorDept = creatorUser?.teamId ? roles.find((r) => r.id === creatorUser.teamId)?.name : '';
  const creatorRole = creatorDept || (t.createdBy ? 'Thành viên' : '');

  const projObj = t.project?.id ? meta?.projects.find((p) => p.id === t.project!.id) : null;
  const customerName = projObj?.customerName || null;
  const place = placeOf(meta?.projects, t.project?.id);
  const placeService = place.service || t.services?.[0] || null;
  // Picking a customer and a service puts the task in that pair's project, and the service among the task's own.
  const pickPlace = async (projectId: string, serviceId: string) => act(() => api.updateTask(t.id, {
    projectId, services: [...new Set([serviceId, ...(t.services || []).map((s) => s.id)])],
  }));

  const closePop = () => setPop(null);

  const handlePostComment = async () => {
    const text = commentText.trim();
    if (!text || postingComment) return;
    setPostingComment(true);
    try {
      const res = await api.addTaskComment(t.id, text);
      const newComment = { id: res.id, userId: me.id, userName: me.name, text, createdAt: Date.now(), replyToId: null };
      setComments((prev) => [...prev, newComment]);
      setCommentText('');
      toast('Đã thêm bình luận');
      onChanged();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setPostingComment(false);
    }
  };

  const handlePostReply = async (parentId: string) => {
    const text = replyText.trim();
    if (!text || postingComment) return;
    setPostingComment(true);
    try {
      const res = await api.addTaskComment(t.id, text, parentId);
      const newReply = { id: res.id, userId: me.id, userName: me.name, text, createdAt: Date.now(), replyToId: parentId };
      setComments((prev) => [...prev, newReply]);
      setReplyText('');
      setReplyingTo(null);
      toast('Đã gửi câu trả lời');
      onChanged();
    } catch (e: any) {
      toast(e.message, true);
    } finally {
      setPostingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!await askConfirm('Xoá bình luận này?')) return;
    try {
      await api.deleteTaskComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId && c.replyToId !== commentId));
      toast('Đã xoá bình luận');
      onChanged();
    } catch (e: any) {
      toast(e.message, true);
    }
  };

  const topComments = useMemo(() => comments.filter((c) => !c.replyToId), [comments]);
  const repliesByParent = useMemo(() => {
    const map = new Map<string, typeof comments>();
    for (const c of comments) {
      if (c.replyToId) {
        const list = map.get(c.replyToId) || [];
        list.push(c);
        map.set(c.replyToId, list);
      }
    }
    return map;
  }, [comments]);

  const selectedUserIds = t.assignees.flatMap((p) => (p.userId && meta?.users.some((u) => u.id === p.userId) ? [p.userId] : []));
  const legacyIds = t.assignees.filter((p) => !p.userId || !meta?.users.some((u) => u.id === p.userId)).map((p) => p.id);
  const toggleMember = (userId: string) => {
    // One person does a task: picking someone replaces who did it.
    const picked = !selectedUserIds.includes(userId);
    if (picked) setPop(null);
    void act(() => api.updateTask(t.id, { assigneeUserIds: picked ? [userId] : [], assigneeIds: picked ? [] : legacyIds }));
  };

  return (
    <div className="wework-task-view" aria-label="Chi tiết công việc Base Wework">
      {/* Column 3: Main Detail Pane */}
      <main className="wework-main">
        {/* Bento Box 1: Header, Title & Controls */}
        <section className="wework-bento-card wework-header-card">
          <header className="wework-top-bar">
            <span className="wework-top-label">CHI TIẾT CÔNG VIỆC</span>
            <div className="wework-top-actions">
              {onUnfoldList && (
                <button
                  type="button"
                  className="btn btn-gray btn-sm wework-unfold-btn"
                  onClick={onUnfoldList}
                  title="Mở danh sách công việc"
                >
                  <Icon name="lines" size={13} />
                  <span>Danh sách việc</span>
                </button>
              )}
              <button className="wework-action-btn" onClick={(e) => setPop({ kind: 'actions', el: e.currentTarget })} title="Thao tác khác" aria-label="Thao tác"><Icon name="more" size={16} /></button>
              <button className="wework-action-btn" onClick={() => { void navigator.clipboard.writeText(location.href); toast('Đã sao chép liên kết công việc'); }} title="Sao chép liên kết" aria-label="Sao chép liên kết"><Icon name="link" size={15} /></button>
              <button className={'wework-action-btn' + (bookmarked ? ' active' : '')} onClick={() => { setBookmarked(!bookmarked); toast(bookmarked ? 'Đã bỏ lưu' : 'Đã lưu công việc'); }} title="Đánh dấu" aria-label="Đánh dấu"><Icon name="tag" size={15} /></button>
              <button className={'wework-action-btn' + (starred ? ' active' : '')} onClick={() => { setStarred(!starred); toast(starred ? 'Đã bỏ gắn sao' : 'Đã gắn sao công việc'); }} title="Gắn sao" aria-label="Gắn sao"><Icon name="star" size={15} /></button>
              <button className="wework-action-btn" onClick={onClose} title="Đóng" aria-label="Đóng"><Icon name="x" size={16} /></button>
            </div>
          </header>

          <textarea
            className="wework-title-in"
            value={titleDraft}
            rows={1}
            readOnly={!edit}
            onChange={(e) => {
              setTitleDraft(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
            }}
            onBlur={() => {
              const next = titleDraft.replace(/\s+/g, ' ').trim();
              if (!next) setTitleDraft(t.title);
              else if (next !== t.title) void act(() => api.updateTask(t.id, { title: next }));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            aria-label="Tên công việc"
          />

          <div className="wework-controls-bar">
            {t.flow ? <button type="button" className={'wework-pill-btn tf-toggle' + (flowOpen ? ' on' : '')} aria-expanded={flowOpen} aria-controls="task-flow" title={flowOpen ? 'Ẩn quy trình duyệt' : 'Mở quy trình duyệt'} onClick={() => setFlowOpen(!flowOpen)}>
              <FlowBadge stage={t.flow.stage} /><Icon name={flowOpen ? 'up' : 'chevron'} size={11} />
            </button> : <Badge t={t} />}
            {hasAssignee ? (
              <button className="wework-pill-btn" onClick={(e) => setPop({ kind: 'members', el: e.currentTarget })} title="Người thực hiện">
                <Avatar m={{ id: assignee.id, userId: assignee.userId, avatarAt: assignee.avatarAt, name: assigneeName }} size={20} />
                <b>{assigneeName}</b>
                {assigneeRole && <><span className="wework-pill-sep">/</span><span className="wework-pill-sub">{assigneeRole}</span></>}
                {t.assignees.length > 1 && <span style={{ marginLeft: 4, color: 'var(--tint)', fontSize: 11 }}>+{t.assignees.length - 1}</span>}
                <Icon name="chevron" size={11} />
              </button>
            ) : (
              <button className="wework-pill-btn empty" onClick={(e) => setPop({ kind: 'members', el: e.currentTarget })} title="Giao việc cho thành viên">
                <Icon name="user" size={14} />
                <b>+ Giao việc</b>
                <Icon name="chevron" size={11} />
              </button>
            )}
          </div>
          {t.flow && flowOpen && <div id="task-flow" className="tf-inline"><TaskFlow task={t} meta={meta} bare onChanged={onChanged} /></div>}
        </section>

        {/* Bento Box 3: Mô tả công việc */}
        <section className="wework-bento-card wework-desc-card">
          <div className="wework-bento-title">
            <Icon name="lines" size={14} />
            <span>MÔ TẢ CÔNG VIỆC</span>
          </div>

          {editingDesc ? (
            <div className="wework-desc-edit">
              <RichEditor value={descDraft} onChange={setDescDraft} onSubmit={() => void act(async () => { await api.updateTask(t.id, { description: descDraft }); setEditingDesc(false); })} />
              <div className="cm-row" style={{ marginTop: 10 }}>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act(async () => { await api.updateTask(t.id, { description: descDraft }); setEditingDesc(false); })}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
                <button className="btn btn-gray btn-sm" disabled={busy} onClick={() => setEditingDesc(false)}>Huỷ</button>
              </div>
            </div>
          ) : (
            <div className="wework-desc-body" onClick={() => edit && setEditingDesc(true)} title={edit ? 'Bấm để chỉnh sửa mô tả' : undefined}>
              {t.description ? <RichView text={t.description} /> : <p className="note" style={{ margin: 0, padding: '8px 0' }}>Chưa có mô tả công việc. Bấm để thêm nội dung...</p>}
            </div>
          )}
        </section>

        {/* Kết quả công việc: kept with each submission for review (TaskFlow). */}
        {t.result !== null ? (
          <section className="wework-bento-card wework-desc-card wework-result-card">
            <div className="wework-bento-title">
              <Icon name="check" size={14} />
              <span>KẾT QUẢ CÔNG VIỆC</span>
            </div>
            {editingResult ? (
              <div className="wework-desc-edit">
                <RichEditor value={resultDraft} onChange={setResultDraft} placeholder="Link bài đăng, tài khoản bàn giao, file kết quả…" autoFocus onSubmit={() => void act(async () => { await api.updateTask(t.id, { result: resultDraft }); setEditingResult(false); })} />
                <div className="cm-row" style={{ marginTop: 10 }}>
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void act(async () => { await api.updateTask(t.id, { result: resultDraft }); setEditingResult(false); })}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
                  <button className="btn btn-gray btn-sm" disabled={busy} onClick={() => setEditingResult(false)}>Huỷ</button>
                </div>
              </div>
            ) : (
              <div className="wework-desc-body" onClick={(e) => { if (edit && !(e.target as HTMLElement).closest('a')) { setResultDraft(t.result || ''); setEditingResult(true); } }} title={edit ? 'Bấm để ghi kết quả công việc' : undefined}>
                {t.result ? <RichView text={t.result} /> : <p className="note" style={{ margin: 0, padding: '8px 0' }}>{edit ? 'Chưa có kết quả. Bấm để ghi link bài đăng, tài khoản bàn giao…' : 'Chưa có kết quả.'}</p>}
              </div>
            )}
          </section>
        ) : t.resultHidden && (
          <section className="wework-bento-card wework-desc-card">
            <div className="wework-bento-title"><Icon name="check" size={14} /><span>KẾT QUẢ CÔNG VIỆC</span></div>
            <p className="note" style={{ margin: 0 }}>Chỉ người làm, người tạo và quản lý công việc xem được kết quả.</p>
          </section>
        )}

        {/* Bento Box 4: Subtasks */}
        {(t.childTasks.length > 0 || edit) && (
          <section className="wework-bento-card wework-subtasks-card">
            <div className="wework-bento-title">
              <Icon name="checklist" size={14} />
              <span>CÔNG VIỆC CON {t.childTasks.length > 0 ? `(${t.childTasks.length})` : ''}</span>
            </div>
            <SubtaskTree
              task={t}
              onOpen={onOpen}
              onChanged={onChanged}
              onAddSubtask={(parentId, parentTask) => setSubtaskParent({ id: parentId, task: parentTask })}
            />
          </section>
        )}
      </main>

      {/* Column 4: Right Metadata & Activity Sidebar */}
      <aside className="wework-sidebar" aria-label="Thông tin bổ sung công việc">
        <div className="wework-sidebar-card wework-goal-card">
          <div className="wework-goal-title">
            <Icon name="boards" size={15} />
            <span>{t.boardLink ? 'Thẻ Workspace' : 'Chưa liên kết Workspace'}</span>
          </div>
          {t.boardLink ? (
            <button
              className="wework-goal-action"
              onClick={() => openLinkedBoard(t.boardLink!)}
              title="Mở thẻ trên Workspace"
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                {t.boardLink.boardName} · {t.boardLink.listName}
              </span>
              <Icon name="chevron" size={11} />
            </button>
          ) : (
            <button className="wework-goal-action" onClick={onLink} title="Liên kết thẻ Workspace">
              <span>+ Liên kết thẻ Workspace</span>
              <Icon name="chevron" size={11} />
            </button>
          )}
        </div>

        {/* Thông tin chung, beside the work rather than above it. */}
        <section className="wework-sidebar-card wework-info-card">
          <div className="wework-bento-title">
            <Icon name="folder" size={14} />
            <span>THÔNG TIN CHUNG</span>
          </div>
          <div className="wework-meta-list">
            <div className="wework-meta-row">
              <span className="wework-meta-ico"><Icon name="users" size={15} /></span>
              <span className="wework-meta-label">Khách hàng</span>
              <button className="wework-meta-val" disabled={!t.canEdit} onClick={(e) => setPop({ kind: 'project', el: e.currentTarget })}>
                <span>{customerName || 'Chọn khách hàng'}</span>
                {t.canEdit && <Icon name="chevron" size={11} />}
              </button>
            </div>
            <div className="wework-meta-row">
              <span className="wework-meta-ico"><Icon name="layers" size={15} /></span>
              <span className="wework-meta-label">Dịch vụ</span>
              <button className="wework-meta-val" disabled={!t.canEdit} onClick={(e) => setPop({ kind: 'project', el: e.currentTarget })}
                title={t.project && placeService && t.project.name !== placeService.name ? `Thuộc: ${t.project.name}` : undefined}>
                <span>{placeService?.name || (t.project ? t.project.name : 'Chọn dịch vụ')}</span>
                {t.canEdit && <Icon name="chevron" size={11} />}
              </button>
            </div>
            {t.campaign?.name && t.campaign.name !== 'Công việc hiện có' && (
              <div className="wework-meta-row">
                <span className="wework-meta-ico"><Icon name="tag" size={15} /></span>
                <span className="wework-meta-label">Chiến dịch</span>
                <span className="wework-meta-val" style={{ cursor: 'default' }}>
                  <span>{t.campaign.name}</span>
                </span>
              </div>
            )}
            <div className="wework-meta-row">
              <span className="wework-meta-ico"><Icon name="clock" size={15} /></span>
              <span className="wework-meta-label">Thời hạn</span>
              <button className="wework-meta-val blue" onClick={(e) => setPop({ kind: 'dates', el: e.currentTarget })}>
                <span>{t.dueAt ? `${t.startAt ? `${formatWeworkDateTime(t.startAt)} → ` : ''}${formatWeworkDate(t.dueAt)}` : 'Chưa đặt thời hạn'}</span>
              </button>
            </div>
            <div className="wework-meta-row" style={{ alignItems: 'flex-start' }}>
              <span className="wework-meta-ico" style={{ marginTop: 4, display: 'inline-flex' }}><Icon name="tag" size={15} /></span>
              <span className="wework-meta-label" style={{ marginTop: 4 }}>Dịch vụ kèm</span>
              <div style={{ flex: 1 }}>
                <TaskServices task={t} meta={meta} onSaved={onChanged} />
              </div>
            </div>
            <div className="wework-meta-row" style={{ alignItems: 'flex-start' }}>
              <span className="wework-meta-ico" style={{ marginTop: 4, display: 'inline-flex' }}><Icon name="tag" size={15} /></span>
              <span className="wework-meta-label" style={{ marginTop: 4 }}>Nhãn / Tag</span>
              <div className="tk-tag-chips" style={{ flex: 1, gap: 6 }}>
                {((meta?.labels && meta.labels.length > 0) ? meta.labels : [
                  { id: 'tl_urgent', name: 'Khẩn cấp', color: '#ef4444' },
                  { id: 'tl_paidads', name: 'Paid Ads', color: '#0b7df2' },
                ]).map((lbl) => {
                  const active = (t.labels || []).some((l) => l.toLowerCase() === lbl.name.toLowerCase());
                  const isUrgent = lbl.name.toLowerCase().includes('khẩn') || lbl.name.toLowerCase().includes('gấp');
                  return (
                    <button
                      key={lbl.id || lbl.name}
                      type="button"
                      className={'tk-tag-chip' + (active ? ' active' : '') + (isUrgent ? ' urgent' : '')}
                      style={{ fontSize: 11, padding: '3px 9px' }}
                      onClick={() => {
                        const curr = t.labels || [];
                        const next = active
                          ? curr.filter((l) => l.toLowerCase() !== lbl.name.toLowerCase())
                          : [...curr, lbl.name];
                        void act(() => api.updateTask(t.id, { labels: next }));
                      }}
                      title={active ? `Bỏ chọn nhãn ${lbl.name}` : `Chọn nhãn ${lbl.name}`}
                    >
                      {lbl.name}
                      {active && <span className="tk-tag-check">✔</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <div className="wework-sidebar-card">
          <div className="wework-sec-block">
            <button className="wework-sec-h" onClick={() => setFoldAssignor(!foldAssignor)}>
              <span>NGƯỜI GIAO VIỆC</span>
              <Icon name={foldAssignor ? 'chevron' : 'up'} size={12} />
            </button>
            {!foldAssignor && (
              <div className="wework-person-card">
                <Avatar m={{ id: t.createdBy?.id || 'c', userId: t.createdBy?.userId, name: creatorName }} size={34} />
                <div className="wework-person-meta">
                  <b className="wework-person-name">{creatorName}</b>
                  {creatorRole && <span className="wework-person-sub">{creatorRole}</span>}
                </div>
              </div>
            )}
          </div>

          <hr className="wework-sidebar-sep" />

          <div className="wework-sec-block">
            <button className="wework-sec-h" onClick={() => setFoldFollowers(!foldFollowers)}>
              <span>NGƯỜI THEO DÕI</span>
              <Icon name={foldFollowers ? 'chevron' : 'up'} size={12} />
            </button>
            {!foldFollowers && (
              <>
                <div className="wework-followers-row">
                  {t.followers.length > 0 ? (
                    t.followers.map((f) => <Avatar key={f.id} m={{ id: f.id, userId: f.id, avatarAt: f.avatarAt, name: f.name }} size={28} />)
                  ) : (
                    <p className="note" style={{ margin: '4px 0 8px', fontSize: 12 }}>Chưa có người theo dõi</p>
                  )}
                </div>
                <div className="wework-follower-btns">
                  <button className="wework-follower-btn" onClick={(e) => setPop({ kind: 'members', el: e.currentTarget })}>+ NGƯỜI THEO DÕI</button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="wework-sidebar-card">
          <div className="wework-timestamps">
            <div className="wework-time-row">
              <Icon name="clock" size={13} />
              <span>TG tạo: <b>{formatWeworkDateTime(t.createdAt || t.startAt)}</b></span>
            </div>
            <div className="wework-time-row">
              <Icon name="clock" size={13} />
              <span>TG cập nhật: <b>{formatWeworkDateTime(t.updatedAt || t.sourceUpdatedAt)}</b></span>
            </div>
          </div>

          <hr className="wework-sidebar-sep" />

          <div className="wework-side-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === 'comments'}
              className={'wework-side-tab' + (sidebarTab === 'comments' ? ' active' : '')}
              onClick={() => setSidebarTab('comments')}
            >
              <Icon name="comment" size={13} />
              <span>Trao đổi ({comments.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sidebarTab === 'activity'}
              className={'wework-side-tab' + (sidebarTab === 'activity' ? ' active' : '')}
              onClick={() => setSidebarTab('activity')}
            >
              <Icon name="clock" size={13} />
              <span>Lịch sử ({activity.length})</span>
            </button>
          </div>

          {sidebarTab === 'comments' ? (
            <div className="wework-comments-box">
              {topComments.length > 0 ? (
                <div className="wework-comments-list">
                  {topComments.map((c) => {
                    const replies = repliesByParent.get(c.id) || [];
                    return (
                      <div key={c.id} className="wework-comment-thread">
                        <div className="wework-comment-item">
                          <div className="wework-comment-header">
                            <Avatar m={{ id: c.userId, name: c.userName }} size={24} />
                            <b className="wework-comment-author">{c.userName}</b>
                            <span className="wework-comment-time">{ago(c.createdAt)}</span>
                          </div>
                          <div className="wework-comment-body"><RichView text={c.text} /></div>
                          <div className="wework-comment-actions">
                            <button
                              type="button"
                              className="wework-action-link"
                              onClick={() => {
                                setReplyingTo({ id: c.id, userName: c.userName });
                                setReplyText('');
                              }}
                            >
                              <Icon name="back" size={11} />
                              <span>Trả lời</span>
                            </button>
                            {(c.userId === me.id || me.role === 'admin') && (
                              <button
                                type="button"
                                className="wework-action-link danger"
                                onClick={() => handleDeleteComment(c.id)}
                              >
                                Xoá
                              </button>
                            )}
                          </div>
                        </div>

                        {replies.length > 0 && (
                          <div className="wework-replies-list">
                            {replies.map((r) => (
                              <div key={r.id} className="wework-reply-item">
                                <div className="wework-comment-header">
                                  <Avatar m={{ id: r.userId, name: r.userName }} size={20} />
                                  <b className="wework-comment-author">{r.userName}</b>
                                  <span className="wework-comment-time">{ago(r.createdAt)}</span>
                                </div>
                                <div className="wework-comment-body"><RichView text={r.text} /></div>
                                <div className="wework-comment-actions">
                                  <button
                                    type="button"
                                    className="wework-action-link"
                                    onClick={() => {
                                      setReplyingTo({ id: c.id, userName: r.userName });
                                      setReplyText(`@${r.userName} `);
                                    }}
                                  >
                                    <Icon name="back" size={11} />
                                    <span>Trả lời</span>
                                  </button>
                                  {(r.userId === me.id || me.role === 'admin') && (
                                    <button
                                      type="button"
                                      className="wework-action-link danger"
                                      onClick={() => handleDeleteComment(r.id)}
                                    >
                                      Xoá
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {replyingTo?.id === c.id && (
                          <div className="wework-reply-input-wrap">
                            <div className="wework-replying-to">
                              <span>Trả lời <b>@{replyingTo.userName}</b></span>
                              <button type="button" onClick={() => setReplyingTo(null)} aria-label="Huỷ">
                                <Icon name="x" size={11} />
                              </button>
                            </div>
                            <textarea
                              autoFocus
                              placeholder={`Trả lời @${replyingTo.userName}...`}
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              rows={2}
                            />
                            <div className="wework-reply-btns">
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                disabled={!replyText.trim() || postingComment}
                                onClick={() => handlePostReply(c.id)}
                              >
                                {postingComment ? 'Đang gửi…' : 'Gửi trả lời'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-gray"
                                onClick={() => setReplyingTo(null)}
                              >
                                Huỷ
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="note" style={{ fontSize: 12, margin: '8px 0' }}>Chưa có bình luận nào. Bạn có thể trao đổi công việc bên dưới.</p>
              )}

              <div className="wework-comment-input-wrap">
                <textarea
                  placeholder="Viết bình luận..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={2}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={!commentText.trim() || postingComment}
                  onClick={handlePostComment}
                >
                  {postingComment ? 'Đang gửi…' : 'Gửi'}
                </button>
              </div>
            </div>
          ) : (
            <div className="wework-activity-box">
              {activity.length > 0 ? (
                <div className="wework-act-list">
                  {activity.map((a) => (
                    <div key={a.id} className="wework-act-item">
                      <b>{a.user}</b> {a.text} <small>{ago(a.at || Date.now())}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="wework-act-list">
                  <div className="wework-act-item">
                    <b>{t.createdBy?.name || 'Hệ thống'}</b> đã tạo công việc này <small>{formatWeworkDateTime(t.createdAt || t.startAt)}</small>
                  </div>
                  {t.updatedAt && (
                    <div className="wework-act-item">
                      <span>Cập nhật gần nhất</span> <small>{formatWeworkDateTime(t.updatedAt)}</small>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <button className="wework-add-subtask-btn" onClick={() => setSubtaskParent({ id: t.id, task: t })}>
          + CÔNG VIỆC CON
        </button>
      </aside>

      {subtaskParent && (
        <TaskEditor
          meta={meta || undefined}
          projectId={subtaskParent.task?.project?.id || t.project?.id}
          parentId={subtaskParent.id}
          parentTask={subtaskParent.task || t}
          onClose={() => setSubtaskParent(null)}
          onSaved={() => {
            setSubtaskParent(null);
            onChanged();
          }}
        />
      )}

      {/* Popovers */}

      {pop?.kind === 'members' && meta && (
        <Pop anchor={pop.el} title="Thành viên" onClose={closePop}>
          <MemberChoices people={meta.users} exclude={[me.id]} chosenLabel="Người thực hiện" selected={selectedUserIds} onToggle={toggleMember} />
        </Pop>
      )}

      {pop?.kind === 'project' && (
        <ClientServicePop anchor={pop.el} customerId={place.customerId} serviceId={placeService?.id || null} onClose={closePop} onPick={pickPlace}
          onClear={t.project ? () => { closePop(); void act(() => api.updateTask(t.id, { projectId: null })); } : undefined} />
      )}

      {pop?.kind === 'dates' && (
        <SpanPop anchor={pop.el} value={{ start: t.startAt, end: t.dueAt }} onClose={closePop} onSave={(v) => void act(() => api.updateTask(t.id, { startAt: v.start, dueAt: v.end }))} />
      )}

      {pop?.kind === 'actions' && (
        <Pop anchor={pop.el} title="Thao tác" onClose={closePop}>
          <div className="bk-menu">
            {onToggleCard && <button onClick={() => { closePop(); onToggleCard(); }}><Icon name="boards" size={15} /><span>Xem dạng thẻ Workspace</span></button>}
            <button onClick={() => { closePop(); onLink(); }}><Icon name="boards" size={15} /><span>Liên kết thẻ Workspace</span></button>
            {t.canDelete && (
              <button className="cm-danger" onClick={async () => {
                closePop();
                if (!await askConfirm('Xoá công việc này? Việc con và thẻ liên kết sẽ được gỡ.')) return;
                try { await api.deleteTask(t.id); onChanged(); onClose(); }
                catch (e: any) { toast(e.message, true); }
              }}>
                <Icon name="trash" size={15} />
                <span>Xoá công việc</span>
              </button>
            )}
          </div>
        </Pop>
      )}
    </div>
  );
}

/** A task's own facts in its card's window, on its page and on the board alike: project (no card), services, people,
 *  who made it and its subtasks. Its review workflow is the card's top row (FlowSteps), opening its moves below. */
function TaskFacts({ t, meta, isLinked, busy = false, onOpen, onChanged, onAddSubtask, onDelete }: {
  t: TaskDetail; meta: TaskMeta | null; isLinked: boolean; busy?: boolean; onOpen: (id: string) => void; onChanged: () => void;
  onAddSubtask?: (parentId: string, parentTask?: TaskDetail | TaskItem) => void; onDelete?: () => void;
}) {
  return (
  <section className={'cm-sec tk-card-task' + (isLinked ? ' is-linked' : '')} aria-label="Thông tin công việc">
    {!isLinked && <h3><Icon name="checklist" size={18} />Công việc{t.externalId && <small>#{t.externalId}</small>}
      {t.canDelete && onDelete && <button className="btn btn-gray btn-sm" disabled={busy} onClick={onDelete}><Icon name="trash" size={14} />Xoá công việc</button>}</h3>}
    {t.path.length > 0 && <nav className="tk-path" aria-label="Công việc cha">{t.path.map((p) => <button key={p.id} onClick={() => onOpen(p.id)}>{p.title}</button>)}</nav>}
    <dl className="tk-facts tk-card-facts">
      {!isLinked && <div><dt>Dịch vụ</dt><dd><TaskInlineField task={t} field="projectId" label="Dịch vụ" value={t.project?.id||''} meta={meta} onSaved={onChanged}>{t.project?.name||'—'}</TaskInlineField></dd></div>}
      <div><dt>Dịch vụ kèm</dt><dd><TaskServices task={t} meta={meta} onSaved={onChanged}/></dd></div>
      {!isLinked && <div><dt>Giao cho</dt><dd>{t.canEdit&&meta?<TaskInlineMembers key={t.id+':'+t.updatedAt} task={t} meta={meta} onSaved={onChanged}/>:<EmployeeAvatars people={t.assignees}/>}</dd></div>}
      <div><dt>Người theo dõi</dt><dd>{t.canEdit&&meta?<TaskInlineFollowers key={t.id+':'+t.updatedAt} task={t} meta={meta} onSaved={onChanged}/>:<EmployeeAvatars people={t.followers}/>}</dd></div>
      <div><dt>Tạo bởi</dt><dd>{t.createdBy?.name || '—'}</dd></div>
    </dl>
    {(t.childTasks.length > 0 || t.canEdit) && (
      <SubtaskTree
        task={t}
        onOpen={onOpen}
        onChanged={onChanged}
        onAddSubtask={onAddSubtask}
      />
    )}
  </section>
  );
}

/** The facts of the task a board card is (TaskFacts), for the card's window over the board (which loads the task, for
 *  its row of steps too); subtasks are added in place. */
export function LinkedTaskFacts({ task, meta, onOpen, onChanged }: { task: TaskDetail; meta: TaskMeta | null; onOpen: (id: string) => void; onChanged: () => void }) {
  return <TaskFacts t={task} meta={meta} isLinked onOpen={onOpen} onChanged={onChanged} />;
}

/** A task's detail: beside the list, or as its own page (`page`) with the unified CardModal layout (Image 2). */
export function TaskPanel({ id, meta, statuses, page = false, inline=false, onOpen, onClose, onChanged, onExpand, onUnfoldList }: { inline?:boolean; id: string; meta: TaskMeta | null; statuses: string[]; page?: boolean; onOpen: (id: string) => void; onClose: () => void; onChanged: () => void; onExpand?: () => void; onUnfoldList?: () => void }) {
  const [t, setT] = useState<TaskDetail | null>(null);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asCard, setAsCard] = useState(false);
  const [subtaskParent, setSubtaskParent] = useState<{ id: string; task?: TaskDetail | TaskItem } | null>(null);
  const activeId = useRef(id); activeId.current = id;
  const load = () => api.task(id).then((value) => { if (activeId.current === id) setT(value); }, (e) => { if (activeId.current === id) { toast(e.message, true); onClose(); } });
  useEffect(() => { setT(null); setLinking(false); setAsCard(false); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (page) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !linking && !document.querySelector('dialog.qc-dialog[open]')) onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose, linking, page]);

  useEffect(() => {
    const handleAddSubtask = (e: Event) => {
      const targetId = (e as CustomEvent<string>).detail;
      if (t) {
        if (targetId === t.id) {
          setSubtaskParent({ id: t.id, task: t });
        } else {
          const found = t.childTasks?.find((k) => k.id === targetId);
          if (found) {
            setSubtaskParent({ id: targetId, task: found });
          }
        }
      }
    };
    window.addEventListener('dms:add-subtask', handleAddSubtask);
    return () => window.removeEventListener('dms:add-subtask', handleAddSubtask);
  }, [t]);

  // Unified task facts section displayed inside the card view (both linked and standalone tasks).
  const taskFacts = t && <TaskFacts t={t} meta={meta} isLinked={!!(t.boardLink && asCard)} busy={busy} onOpen={onOpen} onChanged={() => { void load(); onChanged(); }}
    onAddSubtask={(parentId, parentTask) => setSubtaskParent({ id: parentId, task: parentTask })}
    onDelete={async () => { if (!await askConfirm('Xoá công việc này? Việc con và thẻ Workspace được giữ lại, liên kết sẽ được gỡ.')) return; setBusy(true); try { await api.deleteTask(id); onChanged(); onClose(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } }} />;

  // Inline beside the list: the card's own top row carries expand and close, so there is no separate header line.
  const topActions = inline ? <>
    {onExpand && <button className="cm-top-b" onClick={onExpand} aria-label="Mở trang chi tiết" title="Mở trang chi tiết"><Icon name="expand" size={16} /></button>}
    <button className="cm-top-b" onClick={onClose} aria-label="Đóng" title="Về danh sách"><Icon name="x" size={18} /></button>
  </> : undefined;
  const cardBody = t ? (
    asCard ? (
      t.boardLink
        ? <LinkedCard embedded={inline || page} link={t.boardLink} extra={taskFacts} topActions={topActions} onClose={onClose} onChanged={() => { void load(); onChanged(); }} onFail={() => setAsCard(false)} />
        : <StandaloneTaskCard task={t} meta={meta} statuses={t.statuses || statuses} embedded={inline || page} extra={taskFacts} topActions={topActions} onClose={onClose} onChanged={() => { void load(); onChanged(); }} onLink={() => setLinking(true)} />
    ) : (
      <WeworkTaskView task={t} meta={meta} statuses={t.statuses || statuses} onOpen={onOpen} onClose={onClose} onChanged={() => { void load(); onChanged(); }} onLink={() => setLinking(true)} onToggleCard={() => setAsCard(true)} onUnfoldList={onUnfoldList} />
    )
  ) : null;

  const linkDialog = linking && t && <TaskBoardLink task={t} onClose={() => setLinking(false)} onLinked={() => { setLinking(false); setAsCard(true); load(); onChanged(); }} />;
  const subtaskDialog = subtaskParent && (
    <TaskEditor
      meta={meta || undefined}
      projectId={subtaskParent.task?.project?.id || t?.project?.id}
      parentId={subtaskParent.id}
      parentTask={subtaskParent.task || t || undefined}
      onClose={() => setSubtaskParent(null)}
      onSaved={() => {
        setSubtaskParent(null);
        void load();
        onChanged();
      }}
    />
  );
  if (!page && !inline) return <>{cardBody}{linkDialog}{subtaskDialog}</>;
  if (inline) return <article className="tk-reading-pane" aria-label="Chi tiết công việc" aria-busy={!t}>
    {!t?<BrandLoading label="Đang mở công việc…"/>:<div className="tk-card-embed">{cardBody}</div>}
    {linkDialog}
    {subtaskDialog}
  </article>;
  return (
    <div className="ad-page tk-page tk-detail-page">
      <header className="tk-detail-top"><button className="btn btn-gray btn-sm" onClick={onClose}><Icon name="left" size={14} />Danh sách công việc</button></header>
      {!t ? <BrandLoading label="Đang mở…"/> : <div className="tk-card-embed tk-card-page">{cardBody}</div>}
      {linkDialog}
      {subtaskDialog}
    </div>
  );
}

/** A task's services: picked on the task, its project's suggested first. */
function TaskServices({ task, meta, onSaved }: { task: TaskDetail; meta: TaskMeta | null; onSaved: () => void }) {
  const [ids, setIds] = useState((task.services || []).map((s) => s.id));
  useEffect(() => setIds((task.services || []).map((s) => s.id)), [task.id, task.services]);
  const suggested = (meta?.projects.find((p) => p.id === task.project?.id)?.services || []).map((s) => s.id);
  const save = async (next: string[]) => {
    const before = ids;
    setIds(next);
    try { await api.updateTask(task.id, { services: next }); onSaved(); } catch (e: any) { setIds(before); toast(e.message, true); }
  };
  return <ServicePicker value={ids} onChange={(next) => void save(next)} known={task.services} suggested={suggested} disabled={!task.canEdit} />;
}

type TaskPopKind = 'add' | 'labels' | 'dates' | 'members' | 'actions';

/** Renders a task without an accessible Workspace card using the exact same CardModal layout (Image 2). */
function StandaloneTaskCard({ task: t, meta, statuses, embedded, extra, topActions, onClose, onChanged, onLink }: {
  task: TaskDetail; meta: TaskMeta | null; statuses: string[]; embedded: boolean; extra: ReactNode; topActions?: ReactNode;
  onClose: () => void; onChanged: () => void; onLink: () => void;
}) {
  const me = useStore((s) => s.user)!;
  const [pop, setPop] = useState<{ kind: TaskPopKind; el: HTMLElement } | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(!embedded);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [titleDraft, setTitleDraft] = useState(t.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(t.description || '');
  const [editingResult, setEditingResult] = useState(false);
  const [resultDraft, setResultDraft] = useState(t.result || '');
  const [labelsDraft, setLabelsDraft] = useState(t.labels.join(', '));
  // The review workflow's moves open in a window by the step picked on its row of steps on top.
  const [flowEl, setFlowEl] = useState<HTMLElement | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTitleDraft(t.title);
    setDescDraft(t.description || '');
    setResultDraft(t.result || '');
    setLabelsDraft(t.labels.join(', '));
  }, [t.id, t.title, t.description, t.result, t.startAt, t.dueAt, t.labels]);

  useEffect(() => {
    const el = titleRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }
  }, [titleDraft]);

  const act = async (fn: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true);
    try { await fn(); onChanged(); return true; }
    catch (e: any) { toast(e.message, true); return false; }
    finally { setBusy(false); }
  };

  const isDone = t.state === 'done' || t.state === 'done_late';
  const due = dueState(t.dueAt, isDone);
  const edit = t.canEdit;
  const toggleDone = () => { if (edit) void act(() => api.setTaskStatus(t.id, isDone ? 'Chưa thực hiện' : 'Hoàn thành')); };
  const openPop = (kind: TaskPopKind) => (e: React.MouseEvent<HTMLElement>) => setPop({ kind, el: e.currentTarget });
  const closePop = () => setPop(null);

  const selectedUserIds = t.assignees.flatMap((p) => (p.userId && meta?.users.some((u) => u.id === p.userId) ? [p.userId] : []));
  const legacyIds = t.assignees.filter((p) => !p.userId || !meta?.users.some((u) => u.id === p.userId)).map((p) => p.id);
  const toggleMember = (userId: string) => {
    // One person does a task: picking someone replaces who did it.
    const picked = !selectedUserIds.includes(userId);
    if (picked) setPop(null);
    void act(() => api.updateTask(t.id, { assigneeUserIds: picked ? [userId] : [], assigneeIds: picked ? [] : legacyIds }));
  };

  const top = (
    <div className="cm-top">
      {t.flow ? <FlowSteps stage={t.flow.stage} open={!!flowEl} onPick={(el) => setFlowEl(flowEl === el ? null : el)} /> : <Badge t={t} />}
      <span className="cm-gap" />
      <button className="cm-top-b" onClick={() => setCommentsOpen((v) => !v)} aria-label={commentsOpen ? 'Ẩn bình luận' : 'Hiện bình luận'} aria-expanded={commentsOpen} aria-controls="card-comments" title={commentsOpen ? 'Ẩn bình luận' : 'Hiện bình luận'}><Icon name="comment" size={16} /></button>
      {edit && <button className="cm-top-b" onClick={onLink} aria-label="Liên kết Workspace" title="Liên kết thẻ Workspace"><Icon name="boards" size={16} /></button>}
      <button className="cm-top-b" onClick={openPop('actions')} aria-label="Thao tác" title="Thao tác"><Icon name="more" size={16} /></button>
      {embedded ? topActions : <button className="cm-top-b" onClick={onClose} aria-label="Đóng" title="Đóng (Esc)"><Icon name="x" size={18} /></button>}
    </div>
  );

  return (
    <div className={embedded ? 'cm-embed cm-card-back' : 'cm-back cm-card-back'} onMouseDown={(e) => { if (!embedded && e.target === e.currentTarget) onClose(); }}>
      <div className="cm" role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : true} aria-label={t.title} aria-busy={busy}>
        <div className="cm-fixed">{top}</div>
        {busy && <p className="cm-saving" role="status">Đang lưu…</p>}
        <div className={'cm-panes' + (!commentsOpen ? ' comments-hidden' : '')}>
          <main className="cm-left">
            <header className="cm-head has-task">
              <button className={'cm-done' + (isDone ? ' on' : '')} disabled={!edit || busy} onClick={toggleDone} aria-label={isDone ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành'} title={isDone ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành'}>
                {isDone ? <Icon name="check" size={14} /> : null}
              </button>
              <textarea
                ref={titleRef}
                className="cm-title"
                rows={1}
                value={titleDraft}
                readOnly={!edit}
                onChange={(e) => setTitleDraft(e.target.value)}
                aria-label="Tên công việc"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
                onBlur={() => { const next = titleDraft.replace(/\s+/g, ' ').trim(); if (!next) setTitleDraft(t.title); else if (next !== t.title) void act(() => api.updateTask(t.id, { title: next })); }}
              />
            </header>
            {edit ? (
              <div className="cm-actions">
                <button className="cm-chip cm-add-chip" onClick={openPop('add')} aria-haspopup="dialog" aria-expanded={pop?.kind === 'add'}><Icon name="plus" size={15} />Thêm</button>
                {t.labels.length === 0 && <button className="cm-chip" onClick={openPop('labels')}><Icon name="tag" size={14} />Nhãn</button>}
                {!t.dueAt && !t.startAt && <button className="cm-chip" onClick={openPop('dates')}><Icon name="clock" size={14} />Ngày</button>}
                <button className="cm-chip" onClick={() => addSubtask(t.id)}><Icon name="checklist" size={14} />Việc cần làm</button>
                {t.assignees.length === 0 && <button className="cm-chip" onClick={openPop('members')}><Icon name="user" size={14} />Thành viên</button>}
              </div>
            ) : <p className="cm-readonly"><Icon name="info" size={15} />Bạn đang xem công việc ở chế độ chỉ đọc.</p>}

            {(t.assignees.length > 0 || t.labels.length > 0 || t.dueAt || t.startAt) && (
              <div className="cm-meta">
                {t.assignees.length > 0 && (
                  <div>
                    <h4>Thành viên</h4>
                    <div className="cm-row">
                      {t.assignees.map((m) => (
                        <MemberAvatar
                          key={m.id}
                          person={{ id: m.userId || m.id, name: m.name }}
                          onRemove={edit && m.userId ? () => toggleMember(m.userId!) : undefined}
                        />
                      ))}
                      {edit && <button className="cm-plus employee-picker-add" onClick={openPop('members')} aria-label="Thêm thành viên"><Icon name="plus" size={22} /></button>}
                    </div>
                  </div>
                )}
                {t.labels.length > 0 && (
                  <div>
                    <h4>Nhãn</h4>
                    <div className="cm-row">
                      {t.labels.map((l) => <button key={l} className="cm-label" style={{ background: '#4b5563' }} disabled={!edit} onClick={openPop('labels')}>{l}</button>)}
                      {edit && <button className="cm-plus" onClick={openPop('labels')} aria-label="Thêm nhãn"><Icon name="plus" size={15} /></button>}
                    </div>
                  </div>
                )}
                {(t.dueAt || t.startAt) && (
                  <div>
                    <h4>{t.dueAt ? (t.startAt ? 'Ngày' : 'Ngày hết hạn') : 'Ngày bắt đầu'}</h4>
                    <div className="cm-row">
                      {t.dueAt && <input type="checkbox" className="cm-check" checked={isDone} disabled={!edit} onChange={toggleDone} aria-label="Hoàn thành" />}
                      <button className="cm-date" disabled={!edit} onClick={openPop('dates')}>
                        {t.startAt && t.dueAt ? `${fullDate(t.startAt).split(' lúc')[0]} – ${fullDate(t.dueAt)}` : fullDate((t.dueAt || t.startAt)!)}
                        {due && <em className={'cm-due ' + due}>{due === 'done' ? 'Hoàn tất' : due === 'over' ? 'Quá hạn' : 'Sắp hết hạn'}</em>}
                        <Icon name="chevron" size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {extra}

            {(t.description || t.canEditDescription) && (
              <section className="cm-sec">
                <h3><Icon name="lines" size={18} />Mô tả
                  {t.canEditDescription && t.description && !editingDesc && <button className="btn btn-gray btn-sm" onClick={() => { setDescDraft(t.description); setEditingDesc(true); }}>Sửa</button>}
                </h3>
                {editingDesc ? (
                  <div className="cm-edit">
                    <RichEditor value={t.description} onChange={setDescDraft} placeholder="Mô tả" autoFocus disabled={busy} onSubmit={async () => { if (await act(() => api.updateTask(t.id, { description: descDraft }))) setEditingDesc(false); }} />
                    <div className="cm-row">
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { if (await act(() => api.updateTask(t.id, { description: descDraft }))) setEditingDesc(false); }}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
                      <button className="btn btn-gray btn-sm" disabled={busy} onClick={() => setEditingDesc(false)}>Huỷ</button>
                    </div>
                  </div>
                ) : t.description ? (
                  <div className={'cm-desc' + (!t.canEditDescription ? ' cm-desc-ro' : '')} onClick={(e) => { if (t.canEditDescription && !(e.target as HTMLElement).closest('a')) { setDescDraft(t.description); setEditingDesc(true); } }}><RichView text={t.description} /></div>
                ) : (
                  <button className="cm-desc-empty" onClick={() => { setDescDraft(''); setEditingDesc(true); }}>Thêm mô tả chi tiết hơn…</button>
                )}
              </section>
            )}

            {(t.result || t.resultHidden || (edit && t.result !== null)) && (
              <section className="cm-sec">
                <h3><Icon name="check" size={18} />Kết quả công việc</h3>
                {t.resultHidden ? <p className="note">Chỉ người làm hoặc quản lý công việc này xem được ghi chú kết quả.</p>
                  : editingResult ? (
                    <div className="cm-edit">
                      <RichEditor value={t.result || ''} onChange={setResultDraft} placeholder="Ghi chú kết quả: link bài đăng, tài khoản bàn giao…" autoFocus disabled={busy} onSubmit={async () => { if (await act(() => api.updateTask(t.id, { result: resultDraft }))) setEditingResult(false); }} />
                      <div className="cm-row">
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { if (await act(() => api.updateTask(t.id, { result: resultDraft }))) setEditingResult(false); }}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
                        <button className="btn btn-gray btn-sm" disabled={busy} onClick={() => setEditingResult(false)}>Huỷ</button>
                      </div>
                    </div>
                  ) : !t.result ? (
                    <button className="cm-desc-empty" onClick={() => { setResultDraft(''); setEditingResult(true); }}>Thêm ghi chú kết quả…</button>
                  ) : (
                    <div className="cm-desc" onClick={(e) => { if (edit && !(e.target as HTMLElement).closest('a')) { setResultDraft(t.result || ''); setEditingResult(true); } }}><RichView text={t.result} /></div>
                  )}
              </section>
            )}
          </main>

          {commentsOpen && <ResizeHandle side="after" cssVar="--cm-side-w" storage="comments" min={260} max={640} label="Đổi độ rộng khung bình luận" />}
          <aside id="card-comments" className="cm-right" hidden={!commentsOpen} aria-label="Bình luận và hoạt động">
            <h3 className="cm-right-h"><Icon name="comment" size={18} />Bình luận và hoạt động<button className="btn btn-gray btn-sm" onClick={() => setDetails(!details)}>{details ? 'Ẩn chi tiết' : 'Hiện chi tiết'}</button></h3>
            <div className="cm-comment-new">
              <Avatar m={me} size={32} />
              <div className="cm-comment-box">
                <button type="button" className="cm-comment-start" onClick={edit ? onLink : undefined}>Viết bình luận…</button>
              </div>
            </div>
            <p className="cm-feed-empty">Chưa có bình luận{details ? ' hoặc hoạt động' : ''}. Trao đổi về công việc tại đây.</p>
            {edit && (
              <div style={{ marginTop: 10 }}>
                {t.hasBoardLink ? (
                  <button className="btn btn-gray btn-sm" disabled={busy} onClick={() => void act(() => api.unlinkTaskCard(t.id))}>Gỡ liên kết thẻ (giữ thẻ)</button>
                ) : (
                  <button className="btn btn-gray btn-sm" onClick={onLink}><Icon name="boards" size={14} />Liên kết / tạo thẻ Workspace</button>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>

      {t.flow && flowEl && <FlowPop task={t} meta={meta} onClose={() => setFlowEl(null)} onChanged={onChanged} />}
      {pop?.kind === 'add' && (
        <Pop anchor={pop.el} title="Thêm vào công việc" onClose={closePop}>
          <div className="cm-add-menu">
            <button onClick={() => setPop({ kind: 'labels', el: pop.el })}><span className="cm-add-icon"><Icon name="tag" size={19} /></span><span><b>Nhãn</b><small>Phân loại công việc</small></span></button>
            <button onClick={() => setPop({ kind: 'dates', el: pop.el })}><span className="cm-add-icon"><Icon name="clock" size={19} /></span><span><b>Ngày</b><small>Đặt ngày bắt đầu và hạn hoàn thành</small></span></button>
            <button onClick={() => { closePop(); addSubtask(t.id); }}><span className="cm-add-icon"><Icon name="checklist" size={19} /></span><span><b>Việc cần làm</b><small>Thêm công việc con</small></span></button>
            <button onClick={() => setPop({ kind: 'members', el: pop.el })}><span className="cm-add-icon"><Icon name="user" size={19} /></span><span><b>Thành viên</b><small>Giao công việc cho nhân viên</small></span></button>
            {!t.hasBoardLink && <button onClick={() => { closePop(); onLink(); }}><span className="cm-add-icon"><Icon name="boards" size={19} /></span><span><b>Workspace</b><small>Tạo thẻ trên board</small></span></button>}
          </div>
        </Pop>
      )}
      {pop?.kind === 'labels' && (
        <Pop anchor={pop.el} title="Nhãn" onClose={closePop}>
          {meta?.labels && meta.labels.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <h5 style={{ margin: '0 0 6px' }}>Chọn nhãn nhanh:</h5>
              <div className="tk-tag-chips">
                {meta.labels.map((lbl) => {
                  const list = labelsDraft.split(',').map((s) => s.trim()).filter(Boolean);
                  const active = list.some((l) => l.toLowerCase() === lbl.name.toLowerCase());
                  const isUrgent = lbl.name.toLowerCase().includes('khẩn') || lbl.name.toLowerCase().includes('gấp');
                  return (
                    <button
                      key={lbl.id || lbl.name}
                      type="button"
                      className={'tk-tag-chip' + (active ? ' active' : '') + (isUrgent ? ' urgent' : '')}
                      onClick={() => {
                        const next = active
                          ? list.filter((l) => l.toLowerCase() !== lbl.name.toLowerCase())
                          : [...list, lbl.name];
                        setLabelsDraft(next.join(', '));
                      }}
                    >
                      {lbl.name}
                      {active && <span className="tk-tag-check">✔</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <h5>Nhãn tuỳ chỉnh (cách nhau bằng dấu phẩy)</h5>
          <input className="bk-in" autoFocus value={labelsDraft} onChange={(e) => setLabelsDraft(e.target.value)} placeholder="Vd: Paid Ads, Khẩn cấp…" onKeyDown={(e) => { if (e.key === 'Enter') { closePop(); void act(() => api.updateTask(t.id, { labels: labelsDraft.split(',').map((s) => s.trim()).filter(Boolean) })); } }} />
          <button className="btn btn-primary btn-sm bk-wide" style={{ marginTop: 8 }} onClick={() => { closePop(); void act(() => api.updateTask(t.id, { labels: labelsDraft.split(',').map((s) => s.trim()).filter(Boolean) })); }}>Lưu nhãn</button>
        </Pop>
      )}
      {pop?.kind === 'dates' && (
        <SpanPop anchor={pop.el} value={{ start: t.startAt, end: t.dueAt }} onClose={closePop} onSave={(v) => void act(() => api.updateTask(t.id, { startAt: v.start, dueAt: v.end }))} />
      )}
      {pop?.kind === 'members' && meta && (
        <Pop anchor={pop.el} title="Thành viên" onClose={closePop}>
          <MemberChoices people={meta.users} exclude={[me.id]} chosenLabel="Người thực hiện" selected={selectedUserIds} onToggle={toggleMember} />
        </Pop>
      )}
      {pop?.kind === 'actions' && (
        <Pop anchor={pop.el} title="Thao tác" onClose={closePop}>
          <div className="bk-menu">
            {edit && <button onClick={() => { closePop(); onLink(); }}><Icon name="boards" size={15} />Liên kết / tạo thẻ Workspace</button>}
            <button onClick={() => { closePop(); navigator.clipboard.writeText(`${location.origin}${location.pathname}#tasks/${t.id}`).then(() => toast('Đã sao chép link công việc'), () => toast('Trình duyệt chặn clipboard', true)); }}><Icon name="share" size={15} />Sao chép link công việc</button>
            {t.canDelete && (
              <>
                <hr />
                <button className="bk-danger" onClick={async () => { if (!await askConfirm('Xoá công việc này?')) return; closePop(); try { await api.deleteTask(t.id); onChanged(); onClose(); } catch (e: any) { toast(e.message, true); } }}><Icon name="trash" size={15} />Xoá công việc</button>
              </>
            )}
          </div>
        </Pop>
      )}
    </div>
  );
}


const localDateTime = (ms: number | null | undefined) => ms == null ? '' : new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0,16);

/** A task on a board card opens as that card, as the board shows it: one piece of work, one window. When the board
 *  cannot be read, the task's own panel shows instead. */
function LinkedCard({ link, onClose, onChanged, onFail, embedded = false, extra, topActions }: { link: { boardId: string; cardId: string }; onClose: () => void; onChanged: () => void; onFail: () => void; embedded?: boolean; extra?: ReactNode; topActions?: ReactNode }) {
  const me = useStore((s) => s.user)!;
  const [board, setBoard] = useState<Board | null>(null);
  const load = () => api.board(link.boardId).then(setBoard, onFail);
  useEffect(() => { void load(); }, [link.boardId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!board) return embedded ? <BrandLoading label="Đang mở thẻ…" /> : null;
  return <CardModal key={link.cardId} id={link.cardId} board={board} me={me} embedded={embedded} extra={extra} topActions={topActions} onClose={onClose} onChanged={() => { void load(); onChanged(); }} />;
}
function TaskInlineField({task,field,label,value,multiline=false,meta,children,onSaved,editable=task.canEdit}:{editable?:boolean;task:TaskDetail;field:'title'|'description'|'result'|'labels'|'startAt'|'dueAt'|'projectId'|'campaignId';label:string;value:string;multiline?:boolean;meta?:TaskMeta|null;children:ReactNode;onSaved:()=>void}){
 const[editing,setEditing]=useState(false),[draft,setDraft]=useState(value),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setEditing(false);setDraft(value);setError('');},[task.id,value]);
 if(!editable)return <>{children}</>;
 const save=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const body:TaskWrite={};if(field==='startAt'||field==='dueAt')body[field]=draft?new Date(draft).getTime():null;else if(field==='projectId'){body.projectId=draft||null;body.campaignId=null;}else if(field==='campaignId')body.campaignId=draft||null;else if(field==='labels')body.labels=draft.split(',').map(s=>s.trim()).filter(Boolean);else body[field]=draft;await api.updateTask(task.id,body);setEditing(false);onSaved();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return editing?<form className="tk-field-editor" onSubmit={save} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();if(!busy)setEditing(false);}}}>
 <fieldset disabled={busy}>{field==='projectId'||field==='campaignId'?<select autoFocus aria-label={label} value={draft} onChange={e=>setDraft(e.target.value)}><option value="">{field==='projectId'?'Không có dịch vụ':'Không thuộc chiến dịch'}</option>{field==='projectId'?meta?.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>):meta?.campaigns.filter(c=>c.projectId===task.project?.id).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>:multiline?<RichEditor value={value} onChange={setDraft} placeholder={label} autoFocus onSubmit={()=>document.querySelector<HTMLFormElement>('.tk-field-editor')?.requestSubmit()}/>:<input autoFocus aria-label={label} type={field==='startAt'||field==='dueAt'?'datetime-local':'text'} required={field==='title'} maxLength={field==='title'?500:undefined} value={draft} onChange={e=>setDraft(e.target.value)}/>}
 <div className="tk-action-row"><button type="submit" className="btn btn-primary btn-sm">{busy?'Đang lưu…':'Lưu'}</button><button type="button" className="btn btn-gray btn-sm" onClick={()=>setEditing(false)}>Huỷ</button></div></fieldset>{error&&<p className="note err" role="alert">{error}</p>}</form>:<div className="tk-editable" role="button" tabIndex={0} aria-label={`Sửa ${label.toLocaleLowerCase('vi')}`} title="Bấm để sửa" onClick={e=>{if((e.target as HTMLElement).closest('a,button'))return;setDraft(value);setError('');setEditing(true);}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setDraft(value);setError('');setEditing(true);}}}>{children}<Icon name="edit" size={13}/></div>;
}
function TaskInlineMembers({task,meta,onSaved}:{task:TaskDetail;meta:TaskMeta;onSaved:()=>void}){
 const me=useStore((s)=>s.user);
 const[users,setUsers]=useState(task.assignees.flatMap(p=>p.userId&&meta.users.some(u=>u.id===p.userId)?[p.userId]:[])),[legacy,setLegacy]=useState(task.assignees.filter(p=>!p.userId||!meta.users.some(u=>u.id===p.userId)).map(p=>p.id)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const save=async(nextUsers:string[],nextLegacy:string[])=>{if(busy)return;setBusy(true);setError('');try{await api.updateTask(task.id,{assigneeUserIds:nextUsers,assigneeIds:nextLegacy});setUsers(nextUsers);setLegacy(nextLegacy);onSaved();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return <div className="tk-inline-members" aria-busy={busy}><fieldset disabled={busy}><EmployeePicker single exclude={me ? [me.id] : []} label="Người thực hiện" users={meta.users} selected={users} onChange={ids=>void save(ids,ids.length?[]:legacy)} legacy={task.assignees.filter(p=>legacy.includes(p.id))} onLegacyChange={ids=>void save(users,ids)}/></fieldset>{busy&&<small>Đang lưu…</small>}{error&&<p className="note err" role="alert">{error}</p>}</div>;
}

function TaskInlineFollowers({task,meta,onSaved}:{task:TaskDetail;meta:TaskMeta;onSaved:()=>void}){
 const[ids,setIds]=useState(task.followers.map(f=>f.id)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const save=async(next:string[])=>{if(busy)return;setBusy(true);setError('');try{await api.updateTask(task.id,{followerUserIds:next});setIds(next);onSaved();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return <div className="tk-inline-members" aria-busy={busy}><fieldset disabled={busy}><EmployeePicker label="Người theo dõi" users={meta.users} selected={ids} onChange={next=>void save(next)}/></fieldset>{busy&&<small>Đang lưu…</small>}{error&&<p className="note err" role="alert">{error}</p>}</div>;
}

export function TaskEditor({ task, meta:initialMeta, inline=false, projectId, campaignId, parentId, parentTask, onClose, onSaved }: { inline?:boolean; task?: TaskDetail; meta?: TaskMeta; projectId?: string; campaignId?:string; parentId?: string; parentTask?: TaskDetail | TaskItem; onClose: () => void; onSaved: (id: string) => void }) {
  const[meta,setMeta]=useState<TaskMeta | null>(initialMeta || null);
  // Whoever gives a task out is not offered to do it.
  const me=useStore((s)=>s.user);
  const reloadMeta=()=>api.taskMeta().then(setMeta);
  useEffect(()=>{ if(!meta) void reloadMeta().catch(()=>{}); },[meta]);
  useEntityRefresh(()=>{void reloadMeta().catch(()=>{});});
  const [title,setTitle] = useState(task?.title || '');
  const [description,setDescription] = useState(task?.description || '');
  const [result,setResult] = useState(task?.result || '');
  const [status] = useState(task?.status || 'Chưa thực hiện');
  const [project,setProject] = useState(task?.project?.id || projectId || parentTask?.project?.id || '');
  const [campaign,setCampaign] = useState(task?.campaign?.id || campaignId || '');
  const [parent,setParent] = useState(task?.parent?.id || parentId || '');
  const [start,setStart] = useState(localDateTime(task?.startAt));
  const [due,setDue] = useState(localDateTime(task?.dueAt || parentTask?.dueAt));
  const [people,setPeople] = useState(task?.assignees.filter(p=>!p.userId || !meta?.users.some(u=>u.id===p.userId)).map(p=>p.id) || []);
  const [users,setUsers] = useState<string[]>(task?.assignees.map(p=>p.userId).filter((id):id is string=>!!id&&!!meta?.users.some(u=>u.id===id)) || []);
  const [followers,setFollowers] = useState<string[]>(task?.followers.map(f=>f.id) || []);
  const [labels,setLabels] = useState(task?.labels.join(', ') || '');
  const [reviewer,setReviewer] = useState('');
  const [parents,setParents] = useState<TaskItem[]>(parentTask ? [parentTask as TaskItem] : []);
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  // A parent is one of the project's tasks (without a project: one of the account's own).
  const parentsOf = (projectId: string) => api.tasks(projectId ? { scope: 'all', project: projectId } : { scope: 'mine' });
  useEffect(() => {
    let active=true;
    parentsOf(project).then(r=>{
      if(active){
        setParents(prev => {
          if (parentTask && !r.tasks.some(p => p.id === parentTask.id)) {
            return [parentTask as TaskItem, ...r.tasks];
          }
          return r.tasks;
        });
      }
    },()=>{});
    return()=>{active=false;};
  },[project]);
  // Esc closes the window, unless a picker or question is open over it: that one closes first.
  useEffect(() => { const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy&&!document.querySelector('dialog.qc-dialog[open], dialog.ask-modal[open], .bk-pop')){e.stopPropagation();onClose();}}; document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true); },[busy,onClose]);
  const save = async (e:React.FormEvent) => {
    e.preventDefault(); if(busy)return;
    setBusy(true);setError('');
    try {
      const body: TaskWrite={title:title.trim(),description,campaignId:campaign||null,projectId:project||null,parentId:parent||null,startAt:start?new Date(start).getTime():null,dueAt:due?new Date(due).getTime():null,labels:labels.split(',').map(x=>x.trim()).filter(Boolean)};
      if(!task || task.result !== null)body.result=result;
      // The workflow sets a task's status (TaskFlow); a new one starts at ACCOUNT, or EXECUTION when it is given out.
      if(!task)body.status=status;
      body.assigneeIds=people; body.assigneeUserIds=users; body.followerUserIds=followers;
      if(!task&&reviewer)body.reviewerUserId=reviewer;
      if(task)await api.updateTask(task.id,body);
      const id=task?.id || (await api.createTask(body)).id;
      onSaved(id);
    } catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  const [dueChoice,setDueChoice]=useState<''|'today'|'tomorrow'|'custom'>('');
  // The new task's window is laid out as a card's: quick buttons that open a picker each (place, people, labels, dates, reviewer).
  const [pick,setPick]=useState<{kind:'place'|'members'|'labels'|'dates'|'reviewer';el:HTMLElement}|null>(null);
  const pickDue=(choice:'today'|'tomorrow'|'custom')=>{
    setDueChoice(choice);
    if(choice==='custom')return;
    const date=new Date();date.setDate(date.getDate()+(choice==='tomorrow'?1:0));date.setHours(23,59,0,0);setDue(localDateTime(date.getTime()));
  };

  if (!meta) return null;
  const isSubtask = !!(parent || parentId);
  const headerTitle = task ? 'Sửa công việc' : isSubtask ? 'Tạo công việc con' : 'Tạo công việc mới';

  const availableLabels = (meta.labels && meta.labels.length > 0)
    ? meta.labels
    : [
        { id: 'tl_urgent', name: 'Khẩn cấp', color: '#ef4444' },
        { id: 'tl_paidads', name: 'Paid Ads', color: '#0b7df2' },
      ];

  const currentLabelList = labels.split(',').map((s) => s.trim()).filter(Boolean);
  const place = placeOf(meta.projects, project);

  const toggleTag = (tagName: string) => {
    const norm = tagName.trim();
    const exists = currentLabelList.some((l) => l.toLowerCase() === norm.toLowerCase());
    const next = exists
      ? currentLabelList.filter((l) => l.toLowerCase() !== norm.toLowerCase())
      : [...currentLabelList, norm];
    setLabels(next.join(', '));
  };

  const content=<form className={(inline?"tk-dialog tk-editor tk-inline-editor":"tk-dialog tk-editor")+(!task?" tk-create-simple":"")} role={inline?undefined:"dialog"} aria-modal={inline?undefined:true} aria-label={task?'Sửa công việc':'Tạo công việc'} onSubmit={save}>
    <header><b>{headerTitle}</b><button type="button" className="bd-icon" disabled={busy} onClick={onClose} aria-label="Đóng"><Icon name="x" size={15}/></button></header>
    {task?(<fieldset disabled={busy}>
      <label>Tên công việc<input autoFocus required maxLength={500} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <div className="tk-form-grid">
      <ClientServiceFields projects={meta.projects} value={project} onResolved={reloadMeta} onChange={v=>{setProject(v);setCampaign('');setParent('');}}/>
      <div className="tk-span-field"><span>Thời gian</span><SpanField value={{start:fromLocal(start),end:fromLocal(due)}} onChange={v=>{setStart(toLocal(v.start));setDue(toLocal(v.end));}}/></div></div>
      <label>Công việc cha<EntitySelect kind="task" context={{projectId:project}} value={parent} onCreated={async()=>setParents((await parentsOf(project)).tasks)} onChange={setParent}><option value="">Không có</option>{task?.parent&&!parents.some(p=>p.id===task.parent!.id)&&<option value={task.parent.id}>{task.parent.title}</option>}{parents.filter(p=>p.id!==task?.id&&(!project||p.project?.id===project)).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</EntitySelect></label>
      {/* Not <label>: one around the editor would press its first toolbar button on any click inside. */}
      <div className="tk-rt-field" title={task?.canEditDescription===false?'Chỉ người viết mô tả mới sửa được mô tả':undefined}><span>Mô tả</span>{task.canEditDescription===false?<div className="tk-rich"><RichView text={description||'Chưa có mô tả.'}/></div>:<RichEditor value={task.description||''} onChange={setDescription} placeholder="Mô tả"/>}</div>
      {task.result !== null && <div className="tk-rt-field"><span>Kết quả công việc</span><RichEditor value={task.result||''} onChange={setResult} placeholder="Link bài đăng, tài khoản bàn giao…" compact/></div>}
      <div className="tk-tag-picker" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--label-2)' }}>Nhãn / Tag:</span>
          <a href="#admin/tasks/categories" target="_blank" rel="noreferrer" className="tk-admin-tag-link" style={{ fontSize: 11, color: 'var(--tint)' }}>Quản lý nhãn trong Quản trị ↗</a>
        </div>
        <div className="tk-tag-chips">
          {availableLabels.map((lbl) => {
            const active = currentLabelList.some((l) => l.toLowerCase() === lbl.name.toLowerCase());
            const isUrgent = lbl.name.toLowerCase().includes('khẩn') || lbl.name.toLowerCase().includes('gấp');
            return (
              <button
                key={lbl.id || lbl.name}
                type="button"
                className={'tk-tag-chip' + (active ? ' active' : '') + (isUrgent ? ' urgent' : '')}
                onClick={() => toggleTag(lbl.name)}
                title={active ? `Bỏ chọn nhãn ${lbl.name}` : `Chọn nhãn ${lbl.name}`}
              >
                {lbl.name}
                {active && <span className="tk-tag-check">✔</span>}
              </button>
            );
          })}
        </div>
      </div>
      <label>Nhãn tuỳ chỉnh<input value={labels} onChange={e=>setLabels(e.target.value)} placeholder="Cách nhau bằng dấu phẩy"/></label>
      <div className="tk-staff-picker"><EmployeePicker single exclude={me ? [me.id] : []} label="Người thực hiện" users={meta.users} selected={users} onChange={setUsers} legacy={task?.assignees.filter(p=>people.includes(p.id)) || []} onLegacyChange={setPeople}/></div>
      <div className="tk-staff-picker"><EmployeePicker label="Người theo dõi" users={meta.users} selected={followers} onChange={setFollowers}/></div>
      {!task&&(parent||project)&&<p className="note">Người theo dõi {parent?'công việc cha':'dịch vụ'} được tự động thêm khi lưu.</p>}
    </fieldset>):(<fieldset disabled={busy} className="tk-create-fields tk-cc">
      {/* As a card's window: its head (title, quick buttons, what is chosen), then a section for each part. */}
      <section className="cm-sec cm-header-card tk-cc-head">
        {isSubtask && <p className="tk-cc-parent"><Icon name="layers" size={14} />Thuộc việc cha: <b>{parentTask?.title || parents.find((p) => p.id === parent)?.title || 'Công việc cha'}</b></p>}
        <textarea className="cm-title tk-cc-title" rows={1} aria-label="Tên công việc" placeholder={isSubtask ? 'Tên công việc con' : 'Tên công việc'} autoFocus required maxLength={500} value={title}
          onChange={(e) => { setTitle(e.target.value.replace(/\n/g, ' ')); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px'; }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
        <div className="cm-actions">
          {!place.customerId && <button type="button" className="cm-chip" onClick={(e) => setPick({ kind: 'place', el: e.currentTarget })}><Icon name="folder" size={14} />Khách hàng</button>}
          {!place.service && <button type="button" className="cm-chip" onClick={(e) => setPick({ kind: 'place', el: e.currentTarget })}><Icon name="layers" size={14} />Dịch vụ</button>}
          {!users.length && <button type="button" className="cm-chip" onClick={(e) => setPick({ kind: 'members', el: e.currentTarget })}><Icon name="user" size={14} />Thành viên</button>}
          {!currentLabelList.length && <button type="button" className="cm-chip" onClick={(e) => setPick({ kind: 'labels', el: e.currentTarget })}><Icon name="tag" size={14} />Nhãn</button>}
          {!due && !start && <button type="button" className="cm-chip" onClick={(e) => setPick({ kind: 'dates', el: e.currentTarget })}><Icon name="clock" size={14} />Ngày</button>}
          {!reviewer && <button type="button" className="cm-chip" onClick={(e) => setPick({ kind: 'reviewer', el: e.currentTarget })}><Icon name="eye" size={14} />Người duyệt</button>}
        </div>
        {(place.customerId || place.service || users.length > 0 || currentLabelList.length > 0 || due || start || reviewer) && (
          <div className="cm-meta">
            {place.customerId && <div><h4>Khách hàng</h4><div className="cm-row"><button type="button" className="cm-date" onClick={(e) => setPick({ kind: 'place', el: e.currentTarget })}><Icon name="folder" size={14} />{place.customerName}<Icon name="chevron" size={12} /></button></div></div>}
            {place.service && <div><h4>Dịch vụ</h4><div className="cm-row"><button type="button" className="cm-date" onClick={(e) => setPick({ kind: 'place', el: e.currentTarget })}><Icon name="layers" size={14} />{place.service.name}<Icon name="chevron" size={12} /></button></div></div>}
            {users.length > 0 && <div><h4>Người thực hiện</h4><div className="cm-row">{users.map((id) => { const u = meta.users.find((x) => x.id === id); return u ? <Avatar key={id} m={{ id: u.id, name: u.name }} size={30} /> : null; })}<button type="button" className="cm-plus" onClick={(e) => setPick({ kind: 'members', el: e.currentTarget })} aria-label="Thêm người thực hiện"><Icon name="plus" size={15} /></button></div></div>}
            {currentLabelList.length > 0 && <div><h4>Nhãn</h4><div className="cm-row">{currentLabelList.map((l) => <button type="button" key={l} className={'tk-tag-chip active' + (/khẩn|gấp/i.test(l) ? ' urgent' : '')} onClick={(e) => setPick({ kind: 'labels', el: e.currentTarget })}>{l}</button>)}<button type="button" className="cm-plus" onClick={(e) => setPick({ kind: 'labels', el: e.currentTarget })} aria-label="Thêm nhãn"><Icon name="plus" size={15} /></button></div></div>}
            {(due || start) && <div><h4>Ngày</h4><div className="cm-row"><button type="button" className="cm-date" onClick={(e) => setPick({ kind: 'dates', el: e.currentTarget })}><Icon name="clock" size={14} />{[start && fullDate(new Date(start).getTime()), due && fullDate(new Date(due).getTime())].filter(Boolean).join(' → ')}<Icon name="chevron" size={12} /></button></div></div>}
            {reviewer && <div><h4>Người duyệt</h4><div className="cm-row"><button type="button" className="cm-date" onClick={(e) => setPick({ kind: 'reviewer', el: e.currentTarget })}><Icon name="eye" size={14} />{meta.users.find((u) => u.id === reviewer)?.name}<Icon name="chevron" size={12} /></button></div></div>}
          </div>
        )}
      </section>
      <section className="cm-sec tk-cc-sec">
        <h3><Icon name="lines" size={18} />Mô tả</h3>
        <div className="tk-create-compose"><RichEditor value={description} onChange={setDescription} placeholder="Thêm mô tả chi tiết hơn…" /></div>
      </section>
      <details className="cm-sec tk-cc-sec tk-cc-more"><summary><Icon name="more" size={16} />Tuỳ chọn khác</summary>
        <div className="tk-create-advanced">
          <label>Công việc cha<EntitySelect kind="task" context={{projectId:project}} value={parent} onCreated={async()=>setParents((await parentsOf(project)).tasks)} onChange={setParent}><option value="">Không có</option>{parents.filter(p=>!project||p.project?.id===project).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</EntitySelect></label>
          <div className="tk-staff-picker"><EmployeePicker label="Người theo dõi" users={meta.users} selected={followers} onChange={setFollowers}/></div>
          {(parent||project)&&<p className="note">Người theo dõi {parent?'công việc cha':'dịch vụ'} được tự động thêm khi lưu.</p>}
        </div>
      </details>
      {pick?.kind === 'place' && <ClientServicePop anchor={pick.el} customerId={place.customerId} serviceId={place.service?.id || null} onClose={() => setPick(null)}
        onPick={async (projectId) => { await reloadMeta(); setProject(projectId); setCampaign(''); setParent(''); setPick(null); }}
        onClear={project ? () => { setProject(''); setPick(null); } : undefined} />}
      {pick?.kind === 'members' && <Pop anchor={pick.el} title="Người thực hiện" onClose={() => setPick(null)}><MemberChoices people={meta.users} exclude={me ? [me.id] : []} chosenLabel="Người thực hiện" selected={users} onToggle={(id) => { setUsers(users.includes(id) ? [] : [id]); setPick(null); }} /></Pop>}
      {pick?.kind === 'labels' && <Pop anchor={pick.el} title="Nhãn" onClose={() => setPick(null)}>
        <div className="tk-tag-chips">{availableLabels.map((lbl) => { const active = currentLabelList.some((l) => l.toLowerCase() === lbl.name.toLowerCase()); return <button key={lbl.id || lbl.name} type="button" className={'tk-tag-chip' + (active ? ' active' : '') + (/khẩn|gấp/i.test(lbl.name) ? ' urgent' : '')} onClick={() => toggleTag(lbl.name)}>{lbl.name}{active && <span className="tk-tag-check">✔</span>}</button>; })}</div>
        <h5>Nhãn khác (cách nhau bằng dấu phẩy)</h5><input className="bk-in" value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="Vd: Paid Ads, Khẩn cấp…" />
        <a href="#admin/tasks/categories" target="_blank" rel="noreferrer" className="tk-admin-tag-link">Quản trị nhãn ↗</a>
      </Pop>}
      {pick?.kind === 'dates' && <SpanPop anchor={pick.el} value={{ start: fromLocal(start), end: fromLocal(due) }} onClose={() => setPick(null)} onSave={(v) => { setStart(toLocal(v.start)); setDue(toLocal(v.end)); }} />}
      {pick?.kind === 'reviewer' && <Pop anchor={pick.el} title="Người duyệt (REVIEW)" onClose={() => setPick(null)}><div className="bk-menu">
        <button type="button" onClick={() => { setReviewer(''); setPick(null); }}><span>Người tạo (mặc định)</span>{!reviewer && <Icon name="check" size={15} />}</button>
        {meta.users.map((u) => <button type="button" key={u.id} onClick={() => { setReviewer(u.id); setPick(null); }}><span>{u.name}</span>{reviewer === u.id && <Icon name="check" size={15} />}</button>)}
      </div></Pop>}
    </fieldset>)}
    {task?.hasBoardLink&&<p className="note">Tên, mô tả, ngày và hoàn thành sẽ cập nhật trên thẻ liên kết. Kết quả công việc được giữ ở đây.</p>}
    {error&&<p className="note err" role="alert">{error}</p>}
    <div className="tk-action-row"><button className="btn btn-primary btn-sm" disabled={busy||!title.trim()}>{busy?'Đang lưu…':task?'Lưu công việc':isSubtask?'Tạo việc con':'Tạo công việc'}</button><button type="button" className="btn btn-gray btn-sm" disabled={busy} onClick={onClose}>Huỷ</button></div>
  </form>;
  return inline?content:createPortal(<div className="bd-modal task-editor-back" onMouseDown={e=>e.target===e.currentTarget&&!busy&&onClose()}>{content}</div>,document.body);
}

function TaskBoardLink({task,onClose,onLinked}:{task:TaskDetail;onClose:()=>void;onLinked:()=>void}) {
  const [boards,setBoards]=useState<BoardItem[]|null>(null),[boardId,setBoardId]=useState(''),[board,setBoard]=useState<Board|null>(null);
  const [listId,setListId]=useState(''),[cardId,setCardId]=useState(''),[mode,setMode]=useState<'new'|'existing'>('new');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{let active=true;api.boards().then(r=>{if(active)setBoards(r.filter(b=>b.level!=='observer'));},e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  useEffect(()=>{let active=true;setBoard(null);setListId('');setCardId('');if(boardId)api.board(boardId).then(b=>{if(active){setBoard(b);setListId(b.lists[0]?.id||'');}},e=>{if(active)setError(e.message);});return()=>{active=false;};},[boardId]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy&&!document.querySelector('dialog.qc-dialog[open]')){e.stopPropagation();onClose();}};document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true);},[busy,onClose]);
  const cards=board?.lists.find(l=>l.id===listId)?.cards||[];
  const save=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await api.linkTaskCard(task.id,mode==='new'?{listId}:{cardId});onLinked();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
  return createPortal(<div className="bd-modal" onMouseDown={e=>e.target===e.currentTarget&&!busy&&onClose()}><form className="tk-dialog tk-editor" role="dialog" aria-modal="true" aria-label="Liên kết Workspace" onSubmit={save}>
    <header><b>Liên kết Workspace</b><button type="button" className="bd-icon" disabled={busy} onClick={onClose} aria-label="Đóng"><Icon name="x" size={15}/></button></header>
    <p className="note">{task.title}</p>
    <fieldset disabled={busy}>
      <label>Board<EntitySelect kind="board" required value={boardId} onCreated={async()=>setBoards((await api.boards()).filter(b=>b.level!=='observer'))} onChange={v=>{setBoardId(v);setError('');}}><option value="">Chọn board</option>{boards?.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</EntitySelect></label>
      {boards===null&&!error&&<BrandLoading label="Đang tải board…"/>}{boards?.length===0&&<p className="note">Bạn chưa có board được phép chỉnh sửa. Hãy tạo board hoặc nhờ quản trị viên cấp quyền.</p>}
      <label>Thao tác<select value={mode} onChange={e=>setMode(e.target.value as 'new'|'existing')}><option value="new">Tạo thẻ mới từ công việc</option><option value="existing">Liên kết với thẻ có sẵn</option></select></label>
      <label>Danh sách<EntitySelect kind="list" context={{boardId}} disabled={!boardId} onCreated={async()=>setBoard(await api.board(boardId))} required value={listId} onChange={v=>{setListId(v);setCardId('');}}><option value="">Chọn danh sách</option>{board?.lists.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</EntitySelect></label>
      {mode==='existing'&&<label>Thẻ<EntitySelect kind="card" context={{listId}} disabled={!listId} onCreated={async()=>setBoard(await api.board(boardId))} required value={cardId} onChange={setCardId}><option value="">Chọn thẻ</option>{cards.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</EntitySelect></label>}
    </fieldset>
    <p className="note">{mode==='existing'?'Tên, mô tả, ngày và hoàn thành của thẻ sẽ được thay bằng dữ liệu công việc này. ':''}Sau khi liên kết, các trường này đồng bộ hai chiều. Bình luận, checklist, nhãn và thành viên của thẻ vẫn được quản lý trên board.</p>
    {error&&<p className="note err" role="alert">{error}</p>}
    <div className="tk-action-row"><button className="btn btn-primary btn-sm" disabled={busy||!listId||(mode==='existing'&&!cardId)}>{busy?'Đang liên kết…':mode==='new'?'Tạo và liên kết thẻ':'Liên kết thẻ'}</button><button type="button" className="btn btn-gray btn-sm" disabled={busy} onClick={onClose}>Huỷ</button></div>
  </form></div>,document.body);
}

/** The names a sheet gives people (Giao cho, Tạo bởi), each with how many of its tasks name it, in sheet order. */
function sheetPeople(rows: { assignees: string[]; createdBy: string }[]) {
  const out = new Map<string, { name: string; tasks: number }>();
  for (const r of rows) for (const name of new Set([...r.assignees, r.createdBy].filter((n) => normName(n)))) {
    const k = normName(name), x = out.get(k);
    if (x) x.tasks++; else out.set(k, { name: name.trim(), tasks: 1 });
  }
  return [...out.values()];
}

/** Which employee each name in the sheet is: the account chosen at an earlier import until changed here; a name on
 *  "Giữ tên trong sheet" stays a plain name. */
function SheetPeople({ names, users, value, onChange }: { names: { name: string; tasks: number }[]; users: TaskMeta['users']; value: (name: string) => string; onChange: (name: string, userId: string) => void }) {
  return (
    <section className="tk-import-people" aria-label="Nhân viên trong sheet">
      <p className="note"><b>Nhân viên trong sheet</b> <span>Chọn tài khoản nhân viên cho từng tên ở cột Giao cho / Tạo bởi. Lựa chọn được nhớ cho các lần nhập sau.</span></p>
      <div className="tk-import-people-grid">
        {names.map(({ name, tasks }) => (
          <label key={name}>
            <span><b className="no-i18n">{name}</b><small>{`${tasks} việc`}</small></span>
            <select value={value(name)} onChange={(e) => onChange(name, e.target.value)}>
              <option value="">Giữ tên trong sheet</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}

function ImportDialog({ meta, onClose, onDone }: { meta: TaskMeta | null; onClose: () => void; onDone: (result: TaskImportResult) => void }) {
  const last = meta?.imports || [];
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TaskImportResult | null>(null);
  const [drag, setDrag] = useState(false);
  const [reading, setReading] = useState(false);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<(ReturnType<typeof readTaskExport> & { text: string; sheetRows: number; sheetColumns: number }) | null>(null);
  const names = useMemo(() => sheetPeople(preview?.rows || []), [preview]);
  // Only the names changed here are sent: the others keep the account they were linked to (shown from `known`).
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const known = useMemo(() => new Map((meta?.people || []).filter((p) => p.userId).map((p) => [normName(p.name), p.userId!])), [meta]);
  const linkOf = (name: string) => chosen[name] ?? known.get(normName(name)) ?? '';
  const showPreview = (value: string) => {
    setError(''); setPreview(null); setChosen({});
    try {
      const sheet = readTaskSheet(value);
      if (!sheet.rows.length) throw new Error('File chưa có dòng dữ liệu.');
      const parsed = sheet.titleColumn >= 0 ? readTaskExport(value) : { rows: [], skipped: 0, columns: [], sourceRows: [] };
      if (sheet.rows.length > 20000) throw new Error('Mỗi file tối đa 20.000 dòng.');
      if (parsed.rows.length > 5000) throw new Error('Mỗi lần nhập tối đa 5.000 công việc.');
      setPreview({ ...parsed, text: value, sheetRows: sheet.rows.length, sheetColumns: sheet.headers.length });
    } catch (e: any) { setError(e.message); }
  };
  // An Excel export (.xlsx: its first sheet) or a CSV/TSV file, read here into the same text a paste gives.
  const file = async (f: File | undefined) => {
    if (!f || reading || busy) return;
    setReading(true); setError(''); setPreview(null); setSource(f.name);
    try {
      const value = await (await import('../tools/text')).tableText(f);
      setText(value); showPreview(value);
    } catch (e: any) { setText(''); setError(e.message); }
    finally { setReading(false); }
  };
  const go = async () => {
    if (!preview || busy || reading) return;
    setBusy(true); setError('');
    try { const result = await api.importTasks(preview.text, source, Object.fromEntries(Object.entries(chosen).map(([name, id]) => [name, id || null]))); setRes(result); onDone(result); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="bd-modal" onMouseDown={(e) => e.target === e.currentTarget && !busy && !reading && onClose()}>
      <div className={"tk-dialog" + (preview && !res ? " tk-import-preview" : "")} role="dialog" aria-modal="true" aria-busy={busy || reading} aria-label="Thêm file sheet">
        <header><b>{preview && !res ? 'Xem trước file sheet' : 'Thêm file sheet'}</b><button className="bd-icon" disabled={busy || reading} onClick={onClose} aria-label="Đóng"><Icon name="x" size={15} /></button></header>
        {res ? (
          <div className="tk-done">
            <p><b>Đã nhập {res.rows} công việc</b>: {res.created} mới, {res.updated} cập nhật{res.skipped ? `, bỏ qua ${res.skipped} dòng nhóm / dòng trống` : ''}.</p>
            <ul>
              {res.parents > 0 && <li>{res.parents} việc được xếp dưới công việc cha{res.stubs ? ` (${res.stubs} công việc cha không có trong bảng nên được tạo sẵn)` : ''}.</li>}
              {res.people > 0 && <li>{`${res.people} tên mới trong dữ liệu.`}</li>}
              {res.linked > 0 && <li>{`${res.linked} tên được gắn với tài khoản nhân viên.`}</li>}
              {res.projects > 0 && <li>{res.projects} dịch vụ mới.</li>}
              {res.labels > 0 && <li>{res.labels} nhãn mới.</li>}
            </ul>
            <p className="note">Nhập lại cùng bảng (hoặc bảng mới hơn) sẽ cập nhật theo “Mã công việc”, không tạo trùng.</p>
            <button className="btn btn-primary btn-sm" onClick={onClose}>Xong</button>
          </div>
        ) : preview ? <>
          <p className="note">{source || 'Dữ liệu đã dán'} · <b>{preview.sheetRows} dòng · {preview.sheetColumns} cột</b>{preview.rows.length > 0 && ` · ${preview.rows.length} công việc`}{preview.skipped > 0 && ` · ${preview.skipped} dòng nhóm / dòng trống giữ trong bảng`}. Dữ liệu chưa được lưu.</p>
          {names.length > 0 && <SheetPeople names={names} users={meta?.users || []} value={linkOf} onChange={(name, id) => setChosen({ ...chosen, [name]: id })} />}
          <TaskImportTable text={preview.text} />
          {error && <p className="note err" role="alert">{error}</p>}
          <div className="tk-dialog-row">
            <button className="btn btn-gray btn-sm" disabled={busy} onClick={() => { setPreview(null); setError(''); }}>Quay lại / đổi file</button>
            <span className="note">Kiểm tra bảng rồi xác nhận nhập.</span>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={go}>{busy ? 'Đang nhập…' : preview.rows.length ? `Nhập ${preview.rows.length} công việc & lưu bảng` : 'Lưu bảng theo file'}</button>
          </div>
        </> : <>
          <p className="note">Chọn file Excel (.xlsx), CSV / TSV, kéo thả file vào ô dưới, hoặc dán bảng đã sao chép. Bảng giữ các cột của file. Nếu có cột “Tên công việc”, các dòng công việc được nhận diện để quản lý và liên kết Workspace.</p>
          <textarea className={'tk-paste' + (drag ? ' drag' : '')} disabled={reading} value={text} onChange={(e) => { setText(e.target.value); setSource(''); setError(''); }} placeholder={'Kéo thả file .xlsx / .csv vào đây, hoặc dán bảng:\nTên công việc\tTrạng thái\tThời gian bắt đầu\tThời hạn\t…\tMã công việc (ID)'} spellCheck={false}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDrag(false); file(e.dataTransfer.files[0]); } }} />
          <div className="tk-dialog-row">
            <label className="btn btn-gray btn-sm"><Icon name="sheet" size={13} />Chọn file Excel / CSV<input type="file" accept=".xlsx,.xls,.tsv,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/tab-separated-values,text/csv,text/plain" hidden disabled={reading} onChange={(e) => { file(e.target.files?.[0]); e.target.value = ''; }} /></label>
            <span className="note" role="status">{reading ? 'Đang đọc file…' : source || ''}</span>
            <button className="btn btn-primary btn-sm" disabled={reading || !text.trim()} onClick={() => showPreview(text)}>Xem trước dạng bảng</button>
          </div>
          {error && <p className="note err" role="alert">{error}</p>}
          {last.length > 0 && <p className="note">Lần nhập gần nhất: {when(last[0].at)}{last[0].by ? ` · ${last[0].by}` : ''} · {last[0].rows} công việc.</p>}
        </>}
      </div>
    </div>
  );
}

function TaskImportTable({ text }: { text: string }) {
  const [page, setPage] = useState(0);
  const sheet = useMemo(() => readTaskSheet(text), [text]), size = 50, pages = Math.max(1,Math.ceil(sheet.rows.length / size));
  return <>
    <p className="note">{sheet.headers.length} cột · {sheet.rows.length} dòng theo file gốc</p>
    <SheetGrid headers={sheet.headers} rows={sheet.rows.slice(page*size,(page+1)*size)} start={page*size} />
    {pages>1&&<div className="tk-preview-pages"><button className="btn btn-gray btn-sm" disabled={!page} onClick={()=>setPage(page-1)}>Trang trước</button><span>Trang {page+1} / {pages}</span><button className="btn btn-gray btn-sm" disabled={page===pages-1} onClick={()=>setPage(page+1)}>Trang sau</button></div>}
  </>;
}

function openLinkedBoard(link:{boardId:string;cardId?:string}){
  goto('boards');
  history.replaceState(null,'',`#boards/${link.boardId}${link.cardId?`/c/${link.cardId}`:''}`);
}
