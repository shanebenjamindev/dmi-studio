import {ReadingTabs,ReadingHeader} from './ReadingLayout';
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
import { Avatar, Pop, dateIn, dueState, fullDate, timeIn } from './boardkit';
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

const STATE: Record<TaskState, [string, string, string]> = {
  done: ['Hoàn thành', 'ok', 'check'], done_late: ['Hoàn thành muộn', 'late', 'check'], overdue: ['Quá hạn', 'bad', 'clock'], doing: ['Đang thực hiện', 'doing', 'play'],
  todo: ['Chưa thực hiện', 'idle', 'clock'], paused: ['Tạm dừng', 'idle', 'pause'], cancelled: ['Đã huỷ', 'idle', 'x'], other: ['', 'idle', 'info'],
};
const when = (t: number | null) => (t ? new Date(t).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const initials = (n: string) => n.replace(/^@/, '').split(/[\s._-]+/).filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase() || '?';
function Badge({ t }: { t: Pick<TaskItem, 'state' | 'status'> }) {
  const [label, tone, icon] = STATE[t.state];
  return <span className={'tk-badge ' + tone}><Icon name={icon} size={11} />{label || t.status || 'Chưa có trạng thái'}</span>;
}

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

  const refresh = () => { load(); loadMeta(); };

  const handleBulkDelete = async () => {
    if (!selectedIds.length || deletingMany) return;
    const count = selectedIds.length;
    if (!confirm(`Xoá ${count} công việc đã chọn? Các thẻ liên kết trên Workspace sẽ được xoá, các công việc con sẽ được giữ lại.`)) return;
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
  return (
    <div className={'ad-page tk-page tk-mailbox'+(embedded?' tk-embedded':'')+(open?' has-selection':'')}>
      <section ref={listPane} className="tk-list-pane" aria-label="Danh sách công việc">
      {!embedded && <header className="tk-head">
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
      <div className="tk-toolbar">
        <button className="tk-new" disabled={!meta} onClick={() => setCreating(true)}><Icon name="plus" size={15} />Thêm mới</button>
        {selectedIds.length > 0 && (
          <div className="tk-bulk-bar">
            <span>Đã chọn <b>{selectedIds.length}</b></span>
            <button className="btn btn-sm cm-danger" disabled={deletingMany} onClick={handleBulkDelete}>
              <Icon name="trash" size={14} />{deletingMany ? 'Đang xoá…' : `Xoá (${selectedIds.length})`}
            </button>
            <button className="btn btn-sm btn-gray" onClick={() => setSelectedIds([])}>Bỏ chọn</button>
          </div>
        )}
        <label className="tk-find"><Icon name="search" size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm công việc, dự án, nhãn, mã" aria-label="Tìm công việc" /></label>
        <label className="tk-pick"><Icon name="filter" size={14} /><select aria-label="Trạng thái" value={state} onChange={(e) => setState(e.target.value)}><option value="">Tất cả trạng thái</option><option value="open">Chưa xong</option><option value="overdue">Quá hạn</option><option value="done">Hoàn thành</option></select></label>
        {!initialProject && <label className="tk-pick"><Icon name="folder" size={14} /><EntitySelect kind="project" onCreated={async()=>setMeta(await api.taskMeta())} value={project} onChange={v=>{setProject(v);setCampaign('');}} aria-label="Dự án">
          <option value="">Tất cả dự án</option>
          {meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.tasks})</option>)}
        </EntitySelect></label>}
        {listed === 'team' && teams.length > 1 && <label className="tk-pick"><Icon name="users" size={14} /><select aria-label="Phòng ban" value={teamId} onChange={(e) => { setTeam(e.target.value); setPerson(''); }}>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
        {listed === 'team' && <label className="tk-pick"><Icon name="user" size={14} /><EntitySelect kind="employee" onCreated={async()=>setMeta(await api.taskMeta())} value={person} onChange={setPerson} aria-label="Người được giao">
          <option value="">Cả team</option>
          {meta?.users.filter((u) => !teamId || u.teamId === teamId || (u.workTeamIds || []).includes(teamId)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </EntitySelect></label>}
        {effectiveView !== 'table' && <label className="tk-pick"><Icon name="layers" size={14} /><span>Nhóm theo:</span><select aria-label="Nhóm theo" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}><option value="due">Thời hạn</option><option value="status">Trạng thái</option><option value="project">Dự án</option></select></label>}
      </div>
      {error ? <p className="note err" role="alert">{error} <button className="btn btn-gray btn-sm" onClick={load}>Thử lại</button></p> : !data ? <BrandLoading label="Đang tải…"/> : !data.tasks.length ? (
        <p className="note">{meta && !meta.people.length ? (admin ? 'Chưa có dữ liệu công việc. Bấm “Thêm file sheet” và chọn file hoặc dán bảng.' : 'Chưa có dữ liệu công việc. Quản trị viên cần nhập dữ liệu trước.') : listed === 'mine' && !state && !q.trim() && !project && !campaign ? 'Chưa có công việc nào giao cho bạn, có tên bạn trên thẻ, hoặc bạn đang theo dõi.' : 'Không có công việc nào khớp.'}</p>
      ) : open ? <TaskReadingList tasks={data.tasks} groupBy={groupBy} selected={open} onOpen={showTask} selection={selection} hideProject={!!initialProject} /> : effectiveView === 'table' ? <TaskTable tasks={data.tasks} selected={open} onOpen={showTask} selection={selection} />
        : <TaskGroups tasks={data.tasks} groupBy={groupBy} selected={open} onOpen={showTask} onNew={() => setCreating(true)} onChanged={load} selection={selection} />}
      </section>
      {open && <TaskPanel inline id={open} meta={meta} statuses={meta?.statuses || []} onOpen={(id) => showTask(id)} onClose={() => showTask(null)} onExpand={() => showTask(open, true)} onChanged={refresh} />}
      {creating && meta && <TaskEditor meta={meta} projectId={initialProject || project} campaignId={initialCampaign || campaign} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); refresh(); showTask(id); }} />}
      {dialog === 'import' && <ImportDialog meta={meta} onClose={() => setDialog(null)} onDone={imported} />}
    </div>
  );
}

function TaskReadingList({tasks,groupBy,selected,onOpen,selection,hideProject}:{tasks:TaskItem[];groupBy:string;selected:string;onOpen:(id:string)=>void;selection?:{selected:string[];toggle:(id:string)=>void};hideProject?:boolean}) {
 const groups=groupBy==='project'?byKey(tasks,t=>t.project?{key:t.project.id,label:t.project.name}:null,'Không thuộc dự án'):groupBy==='status'?byKey(tasks,t=>({key:t.state,label:STATE[t.state][0]||t.status||'Khác'}),'Khác'):byDueDate(tasks);
 const ordered=groups.flatMap(g=>g.rows);
 return <div className="tk-reading-list">{groups.filter(g=>g.rows.length).map(g=><section key={g.key}><h3>{g.label}<span>{g.rows.length}</span></h3>{g.rows.map(t=><button key={t.id} className={'reading-list-row tk-reading-row'+(selected===t.id?' selected':'')+(selection?.selected.includes(t.id)?' checked':'')} aria-current={selected===t.id?'true':undefined} onClick={()=>onOpen(t.id)} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const i=ordered.findIndex(x=>x.id===t.id),next=ordered[i+(e.key==='ArrowDown'?1:-1)];if(next){onOpen(next.id);document.getElementById('task-row-'+next.id)?.focus();}}}} id={'task-row-'+t.id}>{selection&&<span className="tk-reading-check-wrap" onClick={(e)=>e.stopPropagation()}><input type="checkbox" className="tk-reading-check" checked={selection.selected.includes(t.id)} onChange={()=>selection.toggle(t.id)} aria-label={`Chọn ${t.title}`}/></span>}<span className="tk-reading-title">{t.title}</span>{!hideProject&&t.project?.name&&<span className="tk-reading-project">{t.project.name}</span>}<span className="tk-reading-meta"><Badge t={t}/><time>{t.dueAt?new Date(t.dueAt).toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit'}):'Không thời hạn'}</time></span></button>)}</section>)}</div>;
}

/** The tasks in groups (due date, status or project), each with a tick box to finish it or open it again. */
function TaskGroups({ tasks, groupBy, selected, onOpen, onNew, onChanged, selection }: { tasks: TaskItem[]; groupBy: string; selected: string | null; onOpen: (id: string) => void; onNew: () => void; onChanged: () => void; selection?: { selected: string[]; toggle: (id: string) => void; all?: boolean; toggleAll?: (checked: boolean) => void } }) {
  const finished = (t: TaskItem) => t.state === 'done' || t.state === 'done_late';
  const toggle = async (t: TaskItem) => {
    try { await api.updateTask(t.id, { status: finished(t) ? 'Chưa thực hiện' : 'Hoàn thành' }); onChanged(); }
    catch (e: any) { toast(e.message, true); }
  };
  const order = ['overdue', 'doing', 'todo', 'paused', 'other', 'done_late', 'done', 'cancelled'];
  const groups = groupBy === 'status' ? byKey(tasks, (t) => ({ key: t.state, label: STATE[t.state][0] || t.status || 'Khác' }), 'Khác', order).map((g) => ({ ...g, onAdd: onNew }))
    : groupBy === 'project' ? byKey(tasks, (t) => (t.project ? { key: t.project.id, label: t.project.name } : null), 'Không thuộc dự án').map((g) => ({ ...g, onAdd: onNew }))
    : byDueDate(tasks, onNew);
  return <GroupedList foldKey={`dms.taskFold.${groupBy}`} groups={groups} nameLabel="Tên công việc" addLabel="Tạo công việc" onOpen={(t) => onOpen(t.id)} selected={selected}
    selection={selection}
    check={{ done: finished, toggle: (t) => void toggle(t), label: (t) => (finished(t) ? `Mở lại “${t.title}”` : `Hoàn thành “${t.title}”`) }}
    name={(t) => <><span className={finished(t) ? 'tk-done-title' : ''}>{t.title}</span>{t.children > 0 && <small className="tk-kids">{t.children} việc con</small>}</>}
    columns={[
      { key: 'status', label: 'Trạng thái', width: 130, render: (t) => <Badge t={t} /> },
      { key: 'who', label: 'Người làm', width: 110, render: (t) => <EmployeeAvatars people={t.assignees} /> },
      { key: 'start', label: 'Bắt đầu', width: 120, render: (t) => when(t.startAt) },
      { key: 'due', label: 'Thời hạn', width: 120, render: (t) => <span className={t.state === 'overdue' ? 'tk-late' : ''}>{when(t.dueAt)}</span> },
      { key: 'done', label: 'Hoàn thành', width: 120, render: (t) => when(t.doneAt) },
      { key: 'project', label: 'Dự án', width: 160, wide: true, render: (t) => t.project?.name || '—' },
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
            {['Mã công việc', 'Tên công việc', 'Trạng thái', 'Dự án', 'Board / thẻ', 'Giao cho', 'Ngày bắt đầu', 'Thời hạn', 'Hoàn thành', 'Công việc cha', 'Nhãn', 'Tạo bởi', 'Cập nhật'].map(label => <th key={label} scope="col">{label}</th>)}
          </tr>
        </thead>
        <tbody>{pageTasks.map(t => <tr key={t.id} className={(selected === t.id ? 'on' : '') + (selection?.selected.includes(t.id) ? ' checked' : '')}>
          {selection && <td style={{ width: 36, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selection.selected.includes(t.id)} onChange={() => selection.toggle(t.id)} aria-label={`Chọn ${t.title}`} /></td>}
          <td>{t.externalId || '—'}</td>
          <th scope="row"><button className="tk-table-title" onClick={() => onOpen(t.id)}>{t.title}</button>{t.children > 0 && <small>{t.children} việc con</small>}</th>
          <td><Badge t={t} /></td><td>{t.project?.name || '—'}</td><td>{t.boardLink?<button className="tk-board-shortcut" onClick={()=>openLinkedBoard(t.boardLink!)}><Icon name="boards" size={14}/><span>{t.boardLink.boardName}<small>{t.boardLink.listName}</small></span></button>:t.hasBoardLink?<small>Đã liên kết board</small>:'—'}</td><td><EmployeeAvatars people={t.assignees}/></td>
          <td>{when(t.startAt)}</td><td className={t.state === 'overdue' ? 'bad' : ''}>{when(t.dueAt)}</td><td>{when(t.doneAt)}</td>
          <td>{t.parent ? <button className="btn btn-gray btn-sm" onClick={() => onOpen(t.parent!.id)}>{t.parent.title}</button> : '—'}</td>
          <td><span className="tk-labels">{t.labels.map(l => <i key={l}>{l}</i>)}</span></td><td>{t.createdBy?.name || '—'}</td><td>{when(t.sourceUpdatedAt || t.updatedAt)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {pages > 1 && <div className="tk-preview-pages"><button className="btn btn-gray btn-sm" disabled={at === 0} onClick={() => setPage(at - 1)}>Trang trước</button><span>Trang {at + 1} / {pages}</span><button className="btn btn-gray btn-sm" disabled={at === pages - 1} onClick={() => setPage(at + 1)}>Trang sau</button></div>}
  </section>;
}

/** A task's detail: beside the list, or as its own page (`page`) with the unified CardModal layout (Image 2). */
export function TaskPanel({ id, meta, statuses, page = false, inline=false, onOpen, onClose, onChanged, onExpand }: { inline?:boolean; id: string; meta: TaskMeta | null; statuses: string[]; page?: boolean; onOpen: (id: string) => void; onClose: () => void; onChanged: () => void; onExpand?: () => void }) {
  const [t, setT] = useState<TaskDetail | null>(null);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asCard, setAsCard] = useState(true);
  const activeId = useRef(id); activeId.current = id;
  const load = () => api.task(id).then((value) => { if (activeId.current === id) setT(value); }, (e) => { if (activeId.current === id) { toast(e.message, true); onClose(); } });
  useEffect(() => { setT(null); setLinking(false); setAsCard(true); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (page) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !linking && !document.querySelector('dialog.qc-dialog[open]')) onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose, linking, page]);

  // Unified task facts section displayed inside the card view (both linked and standalone tasks).
  const isLinked = !!(t && t.boardLink && asCard);
  const taskFacts = t && (
    <section className={'cm-sec tk-card-task' + (isLinked ? ' is-linked' : '')} aria-label="Thông tin công việc">
      {!isLinked && <h3><Icon name="checklist" size={18} />Công việc{t.externalId && <small>#{t.externalId}</small>}
        {t.canDelete && <button className="btn btn-gray btn-sm" disabled={busy} onClick={async () => { if (!confirm('Xoá công việc này? Việc con và thẻ Workspace được giữ lại, liên kết sẽ được gỡ.')) return; setBusy(true); try { await api.deleteTask(id); onChanged(); onClose(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } }}><Icon name="trash" size={14} />Xoá công việc</button>}</h3>}
      {t.path.length > 0 && <nav className="tk-path" aria-label="Công việc cha">{t.path.map((p) => <button key={p.id} onClick={() => onOpen(p.id)}>{p.title}</button>)}</nav>}
      <dl className="tk-facts tk-card-facts">
        {!isLinked && <div><dt>Dự án</dt><dd><TaskInlineField task={t} field="projectId" label="Dự án" value={t.project?.id||''} meta={meta} onSaved={()=>{void load();onChanged();}}>{t.project?.name||'—'}</TaskInlineField></dd></div>}
        {!isLinked && <div><dt>Giao cho</dt><dd>{t.canEdit&&meta?<TaskInlineMembers key={t.id+':'+t.updatedAt} task={t} meta={meta} onSaved={()=>{void load();onChanged();}}/>:<EmployeeAvatars people={t.assignees}/>}</dd></div>}
        <div><dt>Người theo dõi</dt><dd>{t.canEdit&&meta?<TaskInlineFollowers key={t.id+':'+t.updatedAt} task={t} meta={meta} onSaved={()=>{void load();onChanged();}}/>:<EmployeeAvatars people={t.followers}/>}</dd></div>
        <div><dt>Tạo bởi</dt><dd>{t.createdBy?.name || '—'}</dd></div>
      </dl>
      {t.childTasks.length > 0 && (
        <div className="tk-child-tasks-block">
          <h4>Việc con <em>{t.childTasks.length}</em></h4>
          <ul className="tk-kids">{t.childTasks.map((k) => <li key={k.id}><button onClick={() => onOpen(k.id)}><Badge t={k} /><span>{k.title}</span><small>{when(k.dueAt)}</small></button></li>)}</ul>
        </div>
      )}
    </section>
  );

  const cardBody = t ? (
    t.boardLink && asCard
      ? <LinkedCard embedded={inline || page} link={t.boardLink} extra={taskFacts} onClose={onClose} onChanged={() => { void load(); onChanged(); }} onFail={() => setAsCard(false)} />
      : <StandaloneTaskCard task={t} meta={meta} statuses={t.statuses || statuses} embedded={inline || page} extra={taskFacts} onClose={onClose} onChanged={() => { void load(); onChanged(); }} onLink={() => setLinking(true)} />
  ) : null;

  const linkDialog = linking && t && <TaskBoardLink task={t} onClose={() => setLinking(false)} onLinked={() => { setLinking(false); setAsCard(true); load(); onChanged(); }} />;
  if (!page && !inline) return <>{cardBody}{linkDialog}</>;
  if (inline) return <article className="tk-reading-pane" aria-label="Chi tiết công việc" aria-busy={!t}>
    <ReadingHeader label={t?.externalId?`Chi tiết công việc · #${t.externalId}`:'Chi tiết công việc'} onClose={onClose} actions={onExpand&&<button className="bd-icon" onClick={onExpand} aria-label="Mở trang chi tiết"><Icon name="expand" size={16}/></button>}/>
    {!t?<BrandLoading label="Đang mở công việc…"/>:<div className="tk-card-embed">{cardBody}</div>}
    {linkDialog}
  </article>;
  return (
    <div className="ad-page tk-page tk-detail-page">
      <header className="tk-detail-top"><button className="btn btn-gray btn-sm" onClick={onClose}><Icon name="left" size={14} />Danh sách công việc</button>{t?.externalId && <span>#{t.externalId}</span>}</header>
      {!t ? <BrandLoading label="Đang mở…"/> : <div className="tk-card-embed tk-card-page">{cardBody}</div>}
      {linkDialog}
    </div>
  );
}

type TaskPopKind = 'status' | 'add' | 'labels' | 'dates' | 'subtask' | 'members' | 'actions';

/** Renders a task without an accessible Workspace card using the exact same CardModal layout (Image 2). */
function StandaloneTaskCard({ task: t, meta, statuses, embedded, extra, onClose, onChanged, onLink }: {
  task: TaskDetail; meta: TaskMeta | null; statuses: string[]; embedded: boolean; extra: ReactNode;
  onClose: () => void; onChanged: () => void; onLink: () => void;
}) {
  const me = useStore((s) => s.user)!;
  const [pop, setPop] = useState<{ kind: TaskPopKind; el: HTMLElement } | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(true);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [titleDraft, setTitleDraft] = useState(t.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(t.description || '');
  const [editingResult, setEditingResult] = useState(false);
  const [resultDraft, setResultDraft] = useState(t.result || '');
  const [labelsDraft, setLabelsDraft] = useState(t.labels.join(', '));
  const [subtaskTitle, setSubtaskTitle] = useState('');
  const [hasStart, setHasStart] = useState(!!t.startAt);
  const [startDate, setStartDate] = useState(dateIn(t.startAt || Date.now()));
  const [hasDue, setHasDue] = useState(!!t.dueAt || !t.startAt);
  const [dueDate, setDueDate] = useState(dateIn(t.dueAt || Date.now() + 864e5));
  const [dueTime, setDueTime] = useState(t.dueAt ? timeIn(t.dueAt) : '17:00');
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTitleDraft(t.title);
    setDescDraft(t.description || '');
    setResultDraft(t.result || '');
    setLabelsDraft(t.labels.join(', '));
    setHasStart(!!t.startAt);
    setStartDate(dateIn(t.startAt || Date.now()));
    setHasDue(!!t.dueAt || !t.startAt);
    setDueDate(dateIn(t.dueAt || Date.now() + 864e5));
    setDueTime(t.dueAt ? timeIn(t.dueAt) : '17:00');
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
  const statusLabel = STATE[t.state]?.[0] || t.status || 'Chưa thực hiện';
  const allStatuses = statuses.length ? statuses : ['Chưa thực hiện', 'Đang thực hiện', 'Đang đánh giá', 'Tạm dừng', 'Hoàn thành', 'Đã huỷ'];

  const selectedUserIds = t.assignees.flatMap((p) => (p.userId && meta?.users.some((u) => u.id === p.userId) ? [p.userId] : []));
  const legacyIds = t.assignees.filter((p) => !p.userId || !meta?.users.some((u) => u.id === p.userId)).map((p) => p.id);
  const toggleMember = (userId: string) => {
    const nextUsers = selectedUserIds.includes(userId) ? selectedUserIds.filter((x) => x !== userId) : [...selectedUserIds, userId];
    void act(() => api.updateTask(t.id, { assigneeUserIds: nextUsers, assigneeIds: legacyIds }));
  };

  const top = (
    <div className="cm-top">
      {edit ? <button className="cm-list-b" onClick={openPop('status')} title="Đổi trạng thái công việc">{statusLabel}<Icon name="chevron" size={12} /></button> : <span className="cm-list-b">{statusLabel}</span>}
      <span className="cm-gap" />
      <button className="cm-top-b" onClick={() => setCommentsOpen((v) => !v)} aria-label={commentsOpen ? 'Ẩn bình luận' : 'Hiện bình luận'} aria-expanded={commentsOpen} aria-controls="card-comments" title={commentsOpen ? 'Ẩn bình luận' : 'Hiện bình luận'}><Icon name="comment" size={16} /></button>
      {edit && <button className="cm-top-b" onClick={onLink} aria-label="Liên kết Workspace" title="Liên kết thẻ Workspace"><Icon name="boards" size={16} /></button>}
      <button className="cm-top-b" onClick={openPop('actions')} aria-label="Thao tác" title="Thao tác"><Icon name="more" size={16} /></button>
      {!embedded && <button className="cm-top-b" onClick={onClose} aria-label="Đóng" title="Đóng (Esc)"><Icon name="x" size={18} /></button>}
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
                <button className="cm-chip" onClick={openPop('labels')}><Icon name="tag" size={15} />Nhãn</button>
                <button className="cm-chip" onClick={openPop('dates')}><Icon name="clock" size={15} />Ngày</button>
                <button className="cm-chip" onClick={openPop('subtask')}><Icon name="checklist" size={15} />Việc cần làm</button>
                <button className="cm-chip" onClick={openPop('members')}><Icon name="user" size={15} />Thành viên</button>
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

      {pop?.kind === 'status' && (
        <Pop anchor={pop.el} title="Đổi trạng thái" onClose={closePop}>
          <div className="bk-menu">
            {allStatuses.map((s) => (
              <button key={s} onClick={() => { closePop(); void act(() => api.setTaskStatus(t.id, s)); }}>
                <span>{s}</span>
                {t.status === s && <Icon name="check" size={15} />}
              </button>
            ))}
          </div>
        </Pop>
      )}
      {pop?.kind === 'add' && (
        <Pop anchor={pop.el} title="Thêm vào công việc" onClose={closePop}>
          <div className="cm-add-menu">
            <button onClick={() => setPop({ kind: 'labels', el: pop.el })}><span className="cm-add-icon"><Icon name="tag" size={19} /></span><span><b>Nhãn</b><small>Phân loại công việc</small></span></button>
            <button onClick={() => setPop({ kind: 'dates', el: pop.el })}><span className="cm-add-icon"><Icon name="clock" size={19} /></span><span><b>Ngày</b><small>Đặt ngày bắt đầu và hạn hoàn thành</small></span></button>
            <button onClick={() => setPop({ kind: 'subtask', el: pop.el })}><span className="cm-add-icon"><Icon name="checklist" size={19} /></span><span><b>Việc cần làm</b><small>Thêm công việc con</small></span></button>
            <button onClick={() => setPop({ kind: 'members', el: pop.el })}><span className="cm-add-icon"><Icon name="user" size={19} /></span><span><b>Thành viên</b><small>Giao công việc cho nhân viên</small></span></button>
            {!t.hasBoardLink && <button onClick={() => { closePop(); onLink(); }}><span className="cm-add-icon"><Icon name="boards" size={19} /></span><span><b>Workspace</b><small>Tạo thẻ trên board</small></span></button>}
          </div>
        </Pop>
      )}
      {pop?.kind === 'labels' && (
        <Pop anchor={pop.el} title="Nhãn" onClose={closePop}>
          <h5>Nhãn (cách nhau bằng dấu phẩy)</h5>
          <input className="bk-in" autoFocus value={labelsDraft} onChange={(e) => setLabelsDraft(e.target.value)} placeholder="Vd: Paid Ads, Gấp…" onKeyDown={(e) => { if (e.key === 'Enter') { closePop(); void act(() => api.updateTask(t.id, { labels: labelsDraft.split(',').map((s) => s.trim()).filter(Boolean) })); } }} />
          <button className="btn btn-primary btn-sm bk-wide" style={{ marginTop: 8 }} onClick={() => { closePop(); void act(() => api.updateTask(t.id, { labels: labelsDraft.split(',').map((s) => s.trim()).filter(Boolean) })); }}>Lưu nhãn</button>
        </Pop>
      )}
      {pop?.kind === 'dates' && (
        <Pop anchor={pop.el} title="Ngày" onClose={closePop}>
          <label className="bk-check"><input type="checkbox" checked={hasStart} onChange={(e) => setHasStart(e.target.checked)} />Ngày bắt đầu</label>
          <input className="bk-in" type="date" disabled={!hasStart} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <label className="bk-check"><input type="checkbox" checked={hasDue} onChange={(e) => setHasDue(e.target.checked)} />Ngày hết hạn</label>
          <div className="cm-row">
            <input className="bk-in" type="date" disabled={!hasDue} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <input className="bk-in bk-time" type="time" disabled={!hasDue} value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </div>
          <button className="btn btn-primary bk-wide" onClick={() => {
            closePop();
            const ms = (d: string, tm = '00:00') => new Date(`${d}T${tm}`).getTime();
            void act(() => api.updateTask(t.id, { startAt: hasStart && startDate ? ms(startDate) : null, dueAt: hasDue && dueDate ? ms(dueDate, dueTime || '00:00') : null }));
          }}>Lưu</button>
          <button className="btn btn-gray bk-wide" onClick={() => { closePop(); void act(() => api.updateTask(t.id, { startAt: null, dueAt: null })); }}>Gỡ bỏ</button>
        </Pop>
      )}
      {pop?.kind === 'subtask' && (
        <Pop anchor={pop.el} title="Thêm việc con" onClose={closePop}>
          <h5>Tên công việc con</h5>
          <input className="bk-in" autoFocus value={subtaskTitle} onChange={(e) => setSubtaskTitle(e.target.value)} placeholder="Nhập tên việc con…" onKeyDown={(e) => { if (e.key === 'Enter' && subtaskTitle.trim()) { const next = subtaskTitle.trim(); setSubtaskTitle(''); closePop(); void act(() => api.createTask({ title: next, projectId: t.project?.id || null, parentId: t.id, dueAt: t.dueAt })); } }} />
          <button className="btn btn-primary btn-sm" disabled={!subtaskTitle.trim()} onClick={() => { const next = subtaskTitle.trim(); setSubtaskTitle(''); closePop(); void act(() => api.createTask({ title: next, projectId: t.project?.id || null, parentId: t.id, dueAt: t.dueAt })); }}>Thêm</button>
        </Pop>
      )}
      {pop?.kind === 'members' && meta && (
        <Pop anchor={pop.el} title="Thành viên" onClose={closePop}>
          <MemberChoices people={meta.users} selected={selectedUserIds} onToggle={toggleMember} />
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
                <button className="bk-danger" onClick={async () => { if (!confirm('Xoá công việc này?')) return; closePop(); try { await api.deleteTask(t.id); onChanged(); onClose(); } catch (e: any) { toast(e.message, true); } }}><Icon name="trash" size={15} />Xoá công việc</button>
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
function LinkedCard({ link, onClose, onChanged, onFail, embedded = false, extra }: { link: { boardId: string; cardId: string }; onClose: () => void; onChanged: () => void; onFail: () => void; embedded?: boolean; extra?: ReactNode }) {
  const me = useStore((s) => s.user)!;
  const [board, setBoard] = useState<Board | null>(null);
  const load = () => api.board(link.boardId).then(setBoard, onFail);
  useEffect(() => { void load(); }, [link.boardId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!board) return embedded ? <BrandLoading label="Đang mở thẻ…" /> : null;
  return <CardModal key={link.cardId} id={link.cardId} board={board} me={me} embedded={embedded} extra={extra} onClose={onClose} onChanged={() => { void load(); onChanged(); }} />;
}
function TaskInlineField({task,field,label,value,multiline=false,meta,children,onSaved,editable=task.canEdit}:{editable?:boolean;task:TaskDetail;field:'title'|'description'|'result'|'labels'|'startAt'|'dueAt'|'projectId'|'campaignId';label:string;value:string;multiline?:boolean;meta?:TaskMeta|null;children:ReactNode;onSaved:()=>void}){
 const[editing,setEditing]=useState(false),[draft,setDraft]=useState(value),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setEditing(false);setDraft(value);setError('');},[task.id,value]);
 if(!editable)return <>{children}</>;
 const save=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const body:TaskWrite={};if(field==='startAt'||field==='dueAt')body[field]=draft?new Date(draft).getTime():null;else if(field==='projectId'){body.projectId=draft||null;body.campaignId=null;}else if(field==='campaignId')body.campaignId=draft||null;else if(field==='labels')body.labels=draft.split(',').map(s=>s.trim()).filter(Boolean);else body[field]=draft;await api.updateTask(task.id,body);setEditing(false);onSaved();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return editing?<form className="tk-field-editor" onSubmit={save} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();if(!busy)setEditing(false);}}}>
 <fieldset disabled={busy}>{field==='projectId'||field==='campaignId'?<select autoFocus aria-label={label} value={draft} onChange={e=>setDraft(e.target.value)}><option value="">{field==='projectId'?'Không có dự án':'Công việc hiện có'}</option>{field==='projectId'?meta?.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>):meta?.campaigns.filter(c=>c.projectId===task.project?.id).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>:multiline?<RichEditor value={value} onChange={setDraft} placeholder={label} autoFocus onSubmit={()=>document.querySelector<HTMLFormElement>('.tk-field-editor')?.requestSubmit()}/>:<input autoFocus aria-label={label} type={field==='startAt'||field==='dueAt'?'datetime-local':'text'} required={field==='title'} maxLength={field==='title'?500:undefined} value={draft} onChange={e=>setDraft(e.target.value)}/>}
 <div className="tk-action-row"><button type="submit" className="btn btn-primary btn-sm">{busy?'Đang lưu…':'Lưu'}</button><button type="button" className="btn btn-gray btn-sm" onClick={()=>setEditing(false)}>Huỷ</button></div></fieldset>{error&&<p className="note err" role="alert">{error}</p>}</form>:<div className="tk-editable" role="button" tabIndex={0} aria-label={`Sửa ${label.toLocaleLowerCase('vi')}`} title="Bấm để sửa" onClick={e=>{if((e.target as HTMLElement).closest('a,button'))return;setDraft(value);setError('');setEditing(true);}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setDraft(value);setError('');setEditing(true);}}}>{children}<Icon name="edit" size={13}/></div>;
}
function TaskInlineMembers({task,meta,onSaved}:{task:TaskDetail;meta:TaskMeta;onSaved:()=>void}){
 const[users,setUsers]=useState(task.assignees.flatMap(p=>p.userId&&meta.users.some(u=>u.id===p.userId)?[p.userId]:[])),[legacy,setLegacy]=useState(task.assignees.filter(p=>!p.userId||!meta.users.some(u=>u.id===p.userId)).map(p=>p.id)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const save=async(nextUsers:string[],nextLegacy:string[])=>{if(busy)return;setBusy(true);setError('');try{await api.updateTask(task.id,{assigneeUserIds:nextUsers,assigneeIds:nextLegacy});setUsers(nextUsers);setLegacy(nextLegacy);onSaved();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return <div className="tk-inline-members" aria-busy={busy}><fieldset disabled={busy}><EmployeePicker users={meta.users} selected={users} onChange={ids=>void save(ids,legacy)} legacy={task.assignees.filter(p=>legacy.includes(p.id))} onLegacyChange={ids=>void save(users,ids)}/></fieldset>{busy&&<small>Đang lưu…</small>}{error&&<p className="note err" role="alert">{error}</p>}</div>;
}

function TaskInlineFollowers({task,meta,onSaved}:{task:TaskDetail;meta:TaskMeta;onSaved:()=>void}){
 const[ids,setIds]=useState(task.followers.map(f=>f.id)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const save=async(next:string[])=>{if(busy)return;setBusy(true);setError('');try{await api.updateTask(task.id,{followerUserIds:next});setIds(next);onSaved();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return <div className="tk-inline-members" aria-busy={busy}><fieldset disabled={busy}><EmployeePicker label="Người theo dõi" users={meta.users} selected={ids} onChange={next=>void save(next)}/></fieldset>{busy&&<small>Đang lưu…</small>}{error&&<p className="note err" role="alert">{error}</p>}</div>;
}

export function TaskEditor({ task, meta:initialMeta, inline=false, projectId, campaignId, onClose, onSaved }: { inline?:boolean; task?: TaskDetail; meta: TaskMeta; projectId?: string; campaignId?:string; onClose: () => void; onSaved: (id: string) => void }) {
  const[meta,setMeta]=useState(initialMeta);
  const reloadMeta=()=>api.taskMeta().then(setMeta);
  useEntityRefresh(()=>{void reloadMeta().catch(()=>{});});
  const[linkedStatuses,setLinkedStatuses]=useState(task?.statuses);
  const [title,setTitle] = useState(task?.title || '');
  const [description,setDescription] = useState(task?.description || '');
  const [result,setResult] = useState(task?.result || '');
  const [status,setStatus] = useState(task?.status || 'Chưa thực hiện');
  const [project,setProject] = useState(task?.project?.id || projectId || '');
  const [campaign,setCampaign] = useState(task?.campaign?.id || campaignId || '');
  const [parent,setParent] = useState(task?.parent?.id || '');
  const [start,setStart] = useState(localDateTime(task?.startAt));
  const [due,setDue] = useState(localDateTime(task?.dueAt));
  const [people,setPeople] = useState(task?.assignees.filter(p=>!p.userId || !meta.users.some(u=>u.id===p.userId)).map(p=>p.id) || []);
  const [users,setUsers] = useState<string[]>(task?.assignees.map(p=>p.userId).filter((id):id is string=>!!id&&meta.users.some(u=>u.id===id)) || []);
  const [followers,setFollowers] = useState<string[]>(task?.followers.map(f=>f.id) || []);
  const [labels,setLabels] = useState(task?.labels.join(', ') || '');
  const [parents,setParents] = useState<TaskItem[]>([]);
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  // A parent is one of the project's tasks (without a project: one of the account's own).
  const parentsOf = (projectId: string) => api.tasks(projectId ? { scope: 'all', project: projectId } : { scope: 'mine' });
  useEffect(() => { let active=true; parentsOf(project).then(r=>{if(active)setParents(r.tasks);},()=>{}); return()=>{active=false;}; },[project]);
  useEffect(() => { const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy&&!document.querySelector('dialog.qc-dialog[open]')){e.stopPropagation();onClose();}}; document.addEventListener('keydown',key,true);return()=>document.removeEventListener('keydown',key,true); },[busy,onClose]);
  const save = async (e:React.FormEvent) => {
    e.preventDefault(); if(busy)return;
    setBusy(true);setError('');
    try {
      const body: TaskWrite={title:title.trim(),description,campaignId:campaign||null,projectId:project||null,parentId:parent||null,startAt:start?new Date(start).getTime():null,dueAt:due?new Date(due).getTime():null,labels:labels.split(',').map(x=>x.trim()).filter(Boolean)};
      if(!task || task.result !== null)body.result=result;
      if(!task || status!==task.status)body.status=status;
      body.assigneeIds=people; body.assigneeUserIds=users; body.followerUserIds=followers;
      if(task)await api.updateTask(task.id,body);
      const id=task?.id || (await api.createTask(body)).id;
      onSaved(id);
    } catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  const [dueChoice,setDueChoice]=useState<''|'today'|'tomorrow'|'custom'>('');
  const pickDue=(choice:'today'|'tomorrow'|'custom')=>{
    setDueChoice(choice);
    if(choice==='custom')return;
    const date=new Date();date.setDate(date.getDate()+(choice==='tomorrow'?1:0));date.setHours(23,59,0,0);setDue(localDateTime(date.getTime()));
  };
  const content=<form className={(inline?"tk-dialog tk-editor tk-inline-editor":"tk-dialog tk-editor")+(!task?" tk-create-simple":"")} role={inline?undefined:"dialog"} aria-modal={inline?undefined:true} aria-label={task?'Sửa công việc':'Tạo công việc'} onSubmit={save}>
    <header><b>{task?'Sửa công việc':'Tạo công việc mới'}</b><button type="button" className="bd-icon" disabled={busy} onClick={onClose} aria-label="Đóng"><Icon name="x" size={15}/></button></header>
    {task?(<fieldset disabled={busy}>
      <label>Tên công việc<input autoFocus required maxLength={500} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <div className="tk-form-grid"><label>Trạng thái{task?.boardLink?<EntitySelect kind="list" context={{boardId:task.boardLink.boardId}} createdValue={r=>r.name} onCreated={async()=>setLinkedStatuses((await api.board(task.boardLink!.boardId)).lists.map(l=>l.name))} value={status} onChange={setStatus}>{!(linkedStatuses||meta.statuses).includes(status)&&<option>{status}</option>}{(linkedStatuses||meta.statuses).map(s=><option key={s}>{s}</option>)}</EntitySelect>:<select value={status} onChange={e=>setStatus(e.target.value)}>{!meta.statuses.includes(status)&&<option>{status}</option>}{meta.statuses.map(s=><option key={s}>{s}</option>)}</select>}</label>
      <label>Dự án<EntitySelect kind="project" value={project} onCreated={reloadMeta} onChange={v=>{setProject(v);setCampaign('');setParent('');}}><option value="">Không có dự án</option>{meta.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</EntitySelect></label>
      <label>Ngày bắt đầu<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Thời hạn<input type="datetime-local" value={due} onChange={e=>setDue(e.target.value)}/></label></div>
      <label>Công việc cha<EntitySelect kind="task" context={{projectId:project}} value={parent} onCreated={async()=>setParents((await parentsOf(project)).tasks)} onChange={setParent}><option value="">Không có</option>{task?.parent&&!parents.some(p=>p.id===task.parent!.id)&&<option value={task.parent.id}>{task.parent.title}</option>}{parents.filter(p=>p.id!==task?.id&&(!project||p.project?.id===project)).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</EntitySelect></label>
      {/* Not <label>: one around the editor would press its first toolbar button on any click inside. */}
      <div className="tk-rt-field" title={task?.canEditDescription===false?'Chỉ người viết mô tả mới sửa được mô tả':undefined}><span>Mô tả</span>{task.canEditDescription===false?<div className="tk-rich"><RichView text={description||'Chưa có mô tả.'}/></div>:<RichEditor value={task.description||''} onChange={setDescription} placeholder="Mô tả"/>}</div>
      {task.result !== null && <div className="tk-rt-field"><span>Kết quả công việc</span><RichEditor value={task.result||''} onChange={setResult} placeholder="Link bài đăng, tài khoản bàn giao…" compact/></div>}
      <label>Nhãn<input value={labels} onChange={e=>setLabels(e.target.value)} placeholder="Cách nhau bằng dấu phẩy"/></label>
      <div className="tk-staff-picker"><EmployeePicker users={meta.users} selected={users} onChange={setUsers} legacy={task?.assignees.filter(p=>people.includes(p.id)) || []} onLegacyChange={setPeople}/></div>
      <div className="tk-staff-picker"><EmployeePicker label="Người theo dõi" users={meta.users} selected={followers} onChange={setFollowers}/></div>
      {!task&&(parent||project)&&<p className="note">Người theo dõi {parent?'công việc cha':'dự án'} được tự động thêm khi lưu.</p>}
    </fieldset>):(<fieldset disabled={busy} className="tk-create-fields">
      <input className="tk-create-title" aria-label="Tên công việc" placeholder="Tên công việc" autoFocus required maxLength={500} value={title} onChange={e=>setTitle(e.target.value)}/>
      <div className="tk-create-row"><Icon name="user" size={18}/><div><div className="tk-staff-picker"><EmployeePicker users={meta.users} selected={users} onChange={setUsers} legacy={[]} onLegacyChange={setPeople}/></div></div></div>
      <div className="tk-create-row"><Icon name="folder" size={18}/><div><label>Dự án<EntitySelect kind="project" value={project} onCreated={reloadMeta} onChange={v=>{setProject(v);setCampaign('');setParent('');}}><option value="">Không có dự án</option>{meta.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</EntitySelect></label></div></div>
      <div className="tk-create-row"><Icon name="clock" size={18}/><div className="tk-quick-due"><span>Đến hạn vào</span><div role="group" aria-label="Chọn hạn công việc">{([['today','Hôm nay'],['tomorrow','Ngày mai'],['custom','Khác']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={dueChoice===key} onClick={()=>pickDue(key)}>{label}</button>)}{due&&<button type="button" onClick={()=>{setDue('');setDueChoice('');}} aria-label="Bỏ thời hạn"><Icon name="x" size={13}/></button>}</div>{dueChoice==='custom'?<input type="datetime-local" aria-label="Thời hạn công việc" value={due} onChange={e=>setDue(e.target.value)}/>:due&&<small>{when(new Date(due).getTime())}</small>}</div></div>
      <div className="tk-create-row tk-create-description"><Icon name="lines" size={18}/><div className="tk-create-compose"><RichEditor value={description} onChange={setDescription} placeholder="Mô tả"/></div></div>
      <details className="tk-create-more"><summary>Tuỳ chọn khác</summary><div className="tk-create-advanced"><div className="tk-form-grid"><label>Trạng thái<select value={status} onChange={e=>setStatus(e.target.value)}>{!meta.statuses.includes(status)&&<option>{status}</option>}{meta.statuses.map(s=><option key={s}>{s}</option>)}</select></label><label>Ngày bắt đầu<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label></div><label>Công việc cha<EntitySelect kind="task" context={{projectId:project}} value={parent} onCreated={async()=>setParents((await parentsOf(project)).tasks)} onChange={setParent}><option value="">Không có</option>{parents.filter(p=>!project||p.project?.id===project).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</EntitySelect></label><label>Nhãn<input value={labels} onChange={e=>setLabels(e.target.value)} placeholder="Cách nhau bằng dấu phẩy"/></label><div className="tk-staff-picker"><EmployeePicker label="Người theo dõi" users={meta.users} selected={followers} onChange={setFollowers}/></div>
      {(parent||project)&&<p className="note">Người theo dõi {parent?'công việc cha':'dự án'} được tự động thêm khi lưu.</p>}
      </div></details>
    </fieldset>)}
    {task?.hasBoardLink&&<p className="note">Tên, mô tả, ngày và hoàn thành sẽ cập nhật trên thẻ liên kết. Kết quả công việc được giữ ở đây.</p>}
    {error&&<p className="note err" role="alert">{error}</p>}
    <div className="tk-action-row"><button className="btn btn-primary btn-sm" disabled={busy||!title.trim()}>{busy?'Đang lưu…':task?'Lưu công việc':'Tạo công việc'}</button><button type="button" className="btn btn-gray btn-sm" disabled={busy} onClick={onClose}>Huỷ</button></div>
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
              {res.projects > 0 && <li>{res.projects} dự án mới.</li>}
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
