import {TextLinks} from './TextLinks';
import {BrandLoading} from './BrandLoading';
import {EntitySelect,useEntityRefresh} from './QuickCreate';
// Công việc của tôi (Workspace ▸ Công việc): the team's tasks imported from their task app. "Của tôi" lists the tasks
// given to the names linked to this account, by what needs doing (late, open, finished); "Tất cả" lists everyone's,
// by person, like the app's export. A task opens on the side with its parents above it, its children below, its
// description and its result (shown on request: it can hold logins). Admins import an export (paste it or pick the
// file) and link the names in it to accounts; anyone can claim their own name.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EmployeePicker, EmployeeAvatars } from './EmployeePicker';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useStore, toast, getState, goto } from '../store';
import { Icon, Segmented } from './ui';
import { SheetGrid } from './SheetGrid';
import { Rich } from './boardkit';
import { readTaskExport, readTaskSheet } from '../../../server/taskimport';
import { CardModal } from './CardModal';
import type { Board, BoardItem, TaskWrite, TaskDetail, TaskImportResult, TaskItem, TaskMeta, TaskState } from '../types';

const STATE: Record<TaskState, [string, string, string]> = {
  done: ['Hoàn thành', 'ok', 'check'], done_late: ['Hoàn thành muộn', 'late', 'check'], overdue: ['Quá hạn', 'bad', 'clock'], doing: ['Đang thực hiện', 'doing', 'play'],
  todo: ['Chưa thực hiện', 'idle', 'clock'], paused: ['Tạm dừng', 'idle', 'pause'], cancelled: ['Đã huỷ', 'idle', 'x'], other: ['', 'idle', 'info'],
};
const when = (t: number | null) => (t ? new Date(t).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase();
function Badge({ t }: { t: Pick<TaskItem, 'state' | 'status'> }) {
  const [label, tone, icon] = STATE[t.state];
  return <span className={'tk-badge ' + tone}><Icon name={icon} size={11} />{label || t.status || 'Chưa có trạng thái'}</span>;
}

const onTaskPage = () => /^#tasks\/tk_\w+\/page/.test(location.hash);

export function TasksPage({ initialProject = '', initialCampaign = '', projectName }: { initialProject?: string; initialCampaign?:string; projectName?: string } = {}) {
  const admin = useStore((s) => s.user?.role === 'admin');
  // "Công việc của tôi" opens on the account's own tasks (given to it or followed); a project shows all of its tasks.
  // The last choice is remembered per browser.
  const [scope, setScopeState] = useState<'mine' | 'all'>(() => { if (initialProject) return 'all'; try { return localStorage.getItem('dms.taskScope') === 'all' ? 'all' : 'mine'; } catch { return 'mine'; } });
  const [state, setState] = useState<string>('');
  const [project, setProject] = useState(initialProject);
  const [campaign, setCampaign] = useState(initialCampaign);
  const [person, setPerson] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ tasks: TaskItem[]; linked: boolean } | null>(null);
  const [meta, setMeta] = useState<TaskMeta | null>(null);
  const [open, setOpen] = useState<string | null>(() => location.hash.match(/^#tasks\/(tk_\w+)/)?.[1] || null);
  const [full, setFull] = useState(onTaskPage);
  const [creating, setCreating] = useState(false);
  const[syncing,setSyncing]=useState(false);
  const [error, setError] = useState('');
  // A task's own page gets a history entry, so the browser's Back returns to the list.
  const showTask = (id: string | null, page = false) => {
    setOpen(id); setFull(!!id && page);
    if (!location.hash.startsWith('#tasks')) return;
    const hash = id ? `#tasks/${id}${page ? '/page' : ''}` : '#tasks';
    if (page) history.pushState(null, '', hash); else history.replaceState(null, '', hash);
  };
  useEffect(() => { const change = () => { if (location.hash.startsWith('#tasks')) { setOpen(location.hash.match(/^#tasks\/(tk_\w+)/)?.[1] || null); setFull(onTaskPage()); } }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const [dialog, setDialog] = useState<'import' | null>(null);
  const setScope = (v: 'mine' | 'all') => { setScopeState(v); if (!initialProject) try { localStorage.setItem('dms.taskScope', v); } catch { /* private mode */ } };
  const loadMeta = () => api.taskMeta().then(setMeta).catch((e) => toast(e.message, true));
  useEntityRefresh(loadMeta);
  const request = useRef(0);
  const load = () => {
    const seq = ++request.current;
    return api.tasks({ scope, state, project, campaign, employee: scope === 'all' ? person : '', q: q.trim() }).then((r) => { if (seq === request.current) { setData(r); setError(''); } }, (e) => { if (seq === request.current) { setError(e.message); setData(null); } });
  };
  useEffect(() => { loadMeta(); }, []);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    const interval = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 8000);
    const focus = () => load(); window.addEventListener('focus', focus);
    return () => { clearTimeout(t); clearInterval(interval); window.removeEventListener('focus', focus); };
  }, [scope, state, project, campaign, person, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => { load(); loadMeta(); };

  const imported = (result: TaskImportResult) => {
    setDialog(null); setScope('all'); setState(''); setProject(initialProject || ''); setPerson(''); setQ('');
    loadMeta();
    const seq = ++request.current;
    api.tasks({ scope: 'all', project: initialProject || '', campaign:initialCampaign }).then((r) => { if (seq === request.current) { setData(r); setError(''); } }, (e) => { if (seq === request.current) toast(e.message, true); });
    toast(`Đã lưu lên backend: ${result.created} công việc mới, ${result.updated} cập nhật.`);
  };

  if (open && full) return <TaskPanel page id={open} meta={meta} statuses={meta?.statuses || []} onOpen={(id) => showTask(id, true)} onClose={() => showTask(null)} onChanged={refresh} />;
  return (
    <div className="ad-page tk-page">
      <header className="ad-head">
        <h1>{projectName || (scope === 'mine' ? 'Công việc của tôi' : 'Công việc của mọi người')}</h1>
        {!initialProject && <Segmented<'mine' | 'all'> small ariaLabel="Phạm vi" value={scope} onChange={setScope} options={[['mine', 'Của tôi'], ['all', 'Tất cả']]} />}
        <button className="btn btn-gray btn-sm tk-act" onClick={() => { goto('boards'); window.location.hash = '#boards'; }}><Icon name="boards" size={14} />Workspace</button>
        <button className="btn btn-primary btn-sm tk-act" disabled={!meta} onClick={() => setCreating(true)}><Icon name="plus" size={14} />Tạo công việc</button>
        {admin&&<button className="btn btn-gray btn-sm tk-act" disabled={syncing} onClick={async()=>{setSyncing(true);try{const r=await api.syncTasksToBoard();toast(`Đã liên kết ${r.linked}/${r.total} công việc; thêm ${r.created} thẻ mới.`);refresh();}catch(e:any){toast(e.message,true);}finally{setSyncing(false);}}}><Icon name="boards" size={14}/>{syncing?'Đang đồng bộ…':'Đồng bộ lên board'}</button>}
        {admin && <button className="btn btn-gray btn-sm tk-act" onClick={() => goto('admin')}><Icon name="users" size={14} />Nhân viên</button>}
        {admin && <button className="btn btn-primary btn-sm tk-act" onClick={() => setDialog('import')}><Icon name="sheet" size={14} />Thêm file sheet</button>}
      </header>
      <div className="tk-filters">
        <div className="ad-presets" role="group" aria-label="Trạng thái">
          {([['', 'Tất cả'], ['open', 'Chưa xong'], ['overdue', 'Quá hạn'], ['done', 'Hoàn thành']] as [string, string][]).map(([k, l]) => <button key={k} className={state === k ? 'on' : ''} aria-pressed={state === k} onClick={() => setState(k)}>{l}</button>)}
        </div>
        <EntitySelect kind="project" onCreated={async()=>setMeta(await api.taskMeta())} disabled={!!initialProject} value={project} onChange={v=>{setProject(v);setCampaign('');}} aria-label="Dự án">
          <option value="">Mọi dự án</option>
          {meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.tasks})</option>)}
        </EntitySelect>
        <EntitySelect kind="campaign" context={{projectId:project}} onCreated={async r=>{setMeta(await api.taskMeta());if(r.projectId)setProject(r.projectId);}} aria-label="Chiến dịch" value={campaign} disabled={!!initialCampaign} onChange={setCampaign}><option value="">Tất cả chiến dịch</option>{meta?.campaigns.filter(c=>!project||c.projectId===project).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</EntitySelect>
        {scope === 'all' && (
          <EntitySelect kind="employee" onCreated={async()=>setMeta(await api.taskMeta())} value={person} onChange={setPerson} aria-label="Người được giao">
            <option value="">Mọi người</option>
            {meta?.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </EntitySelect>
        )}
        <label className="rp-search"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm công việc, dự án, nhãn, mã" aria-label="Tìm công việc" /></label>
      </div>
      {error ? <p className="note err" role="alert">{error} <button className="bk-link" onClick={load}>Thử lại</button></p> : !data ? <BrandLoading label="Đang tải…"/> : !data.tasks.length ? (
        <p className="note">{meta && !meta.people.length ? (admin ? 'Chưa có dữ liệu công việc. Bấm “Thêm file sheet” và chọn file hoặc dán bảng.' : 'Chưa có dữ liệu công việc. Quản trị viên cần nhập dữ liệu trước.') : scope === 'mine' && !state && !q.trim() && !project && !campaign ? 'Chưa có công việc nào giao cho bạn hoặc bạn đang theo dõi. Chọn “Tất cả” để xem công việc của mọi người.' : 'Không có công việc nào khớp.'}</p>
      ) : <TaskTable tasks={data.tasks} selected={open} onOpen={showTask} />}
      {open && <TaskPanel id={open} meta={meta} statuses={meta?.statuses || []} onOpen={(id) => showTask(id)} onClose={() => showTask(null)} onExpand={() => showTask(open, true)} onChanged={refresh} />}
      {creating && meta && <TaskEditor meta={meta} projectId={initialProject || project} campaignId={initialCampaign || campaign} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); refresh(); showTask(id); }} />}
      {dialog === 'import' && <ImportDialog last={meta?.imports || []} onClose={() => setDialog(null)} onDone={imported} />}
    </div>
  );
}

/** Imported and manually created tasks share a table; each task appears once, including multi-assignee tasks. */
function TaskTable({ tasks, selected, onOpen }: { tasks: TaskItem[]; selected: string | null; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const size = 50, pages = Math.max(1, Math.ceil(tasks.length / size)), at = Math.min(page, pages - 1);
  useEffect(() => setPage(0), [tasks]);
  return <section className="tk-table-section" aria-label="Danh sách công việc dạng bảng">
    <div className="tk-table-count"><span>{tasks.length} công việc · hiển thị {at * size + 1}–{Math.min((at + 1) * size, tasks.length)}</span><span>Bấm tên công việc để xem, sửa hoặc liên kết Workspace.</span></div>
    <div className="tk-table-scroll" tabIndex={0} role="region" aria-label="Bảng công việc">
      <table className="tk-data-table">
        <thead><tr>{['Mã công việc', 'Tên công việc', 'Trạng thái', 'Dự án', 'Chiến dịch', 'Board / thẻ', 'Giao cho', 'Ngày bắt đầu', 'Thời hạn', 'Hoàn thành', 'Công việc cha', 'Nhãn', 'Tạo bởi', 'Cập nhật'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{tasks.slice(at * size, (at + 1) * size).map(t => <tr key={t.id} className={selected === t.id ? 'on' : ''}>
          <td>{t.externalId || '—'}</td>
          <th scope="row"><button className="tk-table-title" onClick={() => onOpen(t.id)}>{t.title}</button>{t.children > 0 && <small>{t.children} việc con</small>}</th>
          <td><Badge t={t} /></td><td>{t.project?.name || '—'}</td><td>{t.campaign?.name || '—'}</td><td>{t.boardLink?<button className="tk-board-shortcut" onClick={()=>openLinkedBoard(t.boardLink!)}><Icon name="boards" size={14}/><span>{t.boardLink.boardName}<small>{t.boardLink.listName}</small></span></button>:t.hasBoardLink?<small>Đã liên kết · chưa có quyền xem board</small>:<button className="bk-link" onClick={()=>onOpen(t.id)}>Liên kết board</button>}</td><td><EmployeeAvatars people={t.assignees}/></td>
          <td>{when(t.startAt)}</td><td className={t.state === 'overdue' ? 'bad' : ''}>{when(t.dueAt)}</td><td>{when(t.doneAt)}</td>
          <td>{t.parent ? <button className="bk-link" onClick={() => onOpen(t.parent!.id)}>{t.parent.title}</button> : '—'}</td>
          <td><span className="tk-labels">{t.labels.map(l => <i key={l}>{l}</i>)}</span></td><td>{t.createdBy?.name || '—'}</td><td>{when(t.sourceUpdatedAt || t.updatedAt)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {pages > 1 && <div className="tk-preview-pages"><button className="btn btn-gray btn-sm" disabled={at === 0} onClick={() => setPage(at - 1)}>Trang trước</button><span>Trang {at + 1} / {pages}</span><button className="btn btn-gray btn-sm" disabled={at === pages - 1} onClick={() => setPage(at + 1)}>Trang sau</button></div>}
  </section>;
}

/** A task's detail: beside the list, or as its own page (`page`) with the content and the facts side by side. */
export function TaskPanel({ id, meta, statuses, page = false, onOpen, onClose, onChanged, onExpand }: { id: string; meta: TaskMeta | null; statuses: string[]; page?: boolean; onOpen: (id: string) => void; onClose: () => void; onChanged: () => void; onExpand?: () => void }) {
  const [t, setT] = useState<TaskDetail | null>(null);
  const [show, setShow] = useState(false);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asCard, setAsCard] = useState(true);
  const activeId = useRef(id); activeId.current = id;
  const load = () => api.task(id).then((value) => { if (activeId.current === id) setT(value); }, (e) => { if (activeId.current === id) { toast(e.message, true); onClose(); } });
  useEffect(() => { setT(null); setShow(false); setLinking(false); setAsCard(true); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (page) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !linking && !document.querySelector('dialog.qc-dialog[open]')) onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose, linking, page]);
  const setStatus = async (s: string) => { if (busy) return; setBusy(true); try { await api.setTaskStatus(id, s); await load(); onChanged(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  const head = t && <>
          {t.path.length > 0 && <nav className="tk-path" aria-label="Công việc cha">{t.path.map((p) => <button key={p.id} onClick={() => onOpen(p.id)}>{p.title}</button>)}</nav>}
          <div className="tk-panel-title" role="heading" aria-level={2}><TaskInlineField task={t} field="title" label="Tên công việc" value={t.title} onSaved={()=>{void load();onChanged();}}><TextLinks text={t.title}/></TaskInlineField></div>
          <div className="tk-action-row">
            {t.canEdit&&<small className="note">Bấm vào nội dung để chỉnh sửa trực tiếp.</small>}
            {t.canDelete && <button className="btn btn-gray btn-sm" disabled={busy} onClick={async () => { if (!confirm('Xoá công việc này? Việc con và thẻ Workspace được giữ lại, liên kết sẽ được gỡ.')) return; setBusy(true); try { await api.deleteTask(id); onChanged(); onClose(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } }}><Icon name="trash" size={14} />Xoá</button>}
          </div>
  </>;
  const side = t && <>
          <section className="tk-sec tk-board-link"><h3><Icon name="boards" size={16} />Workspace</h3>
            {t.boardLink ? <><p className="note">{t.boardLink.boardName} · {t.boardLink.listName}</p><button className="btn btn-primary btn-sm" onClick={() => { goto('boards'); window.location.hash = `#boards/${t.boardLink!.boardId}/c/${t.boardLink!.cardId}`; }}>Mở thẻ trên board</button></> : <p className="note">{t.hasBoardLink ? 'Công việc có thẻ liên kết trên board bạn chưa có quyền xem.' : 'Chưa liên kết với thẻ Workspace.'}</p>}
            {t.canEdit && (t.hasBoardLink ? <button className="bk-link" disabled={busy} onClick={async () => { setBusy(true); try { await api.unlinkTaskCard(id); await load(); onChanged(); } catch (e: any) { toast(e.message,true); } finally { setBusy(false); } }}>Gỡ liên kết (giữ thẻ)</button> : <button className="btn btn-gray btn-sm" onClick={() => setLinking(true)}>Liên kết / tạo thẻ</button>)}
          </section>
          {t.stub && <p className="note">Công việc cha được tạo từ cột “Công việc cha” (bảng xuất không có dòng riêng cho nó).</p>}
          <div className="tk-status">
            <Badge t={t} />
            {t.canEdit && statuses.length > 0 && (
              t.boardLink ? <EntitySelect kind="list" context={{boardId:t.boardLink.boardId}} createdValue={r=>r.name} onCreated={async()=>{await load();}} disabled={busy} value="" onChange={s=>{if(s)void setStatus(s);}} aria-label="Đổi trạng thái"><option value="">Đổi trạng thái…</option>{(t.statuses||statuses).map(s=><option key={s}>{s}</option>)}</EntitySelect> : <select disabled={busy} value="" onChange={(e) => e.target.value && setStatus(e.target.value)} aria-label="Đổi trạng thái"><option value="">Đổi trạng thái…</option>{(t.statuses || statuses).map((s) => <option key={s} value={s}>{s}</option>)}</select>
            )}
          </div>
          <dl className="tk-facts">
            <div><dt>Dự án</dt><dd><TaskInlineField task={t} field="projectId" label="Dự án" value={t.project?.id||''} meta={meta} onSaved={()=>{void load();onChanged();}}>{t.project?.name||'—'}</TaskInlineField></dd></div>
            <div><dt>Giao cho</dt><dd>{t.canEdit&&meta?<TaskInlineMembers key={t.id+':'+t.updatedAt} task={t} meta={meta} onSaved={()=>{void load();onChanged();}}/>:<EmployeeAvatars people={t.assignees}/>}</dd></div>
            <div><dt>Người theo dõi</dt><dd>{t.canEdit&&meta?<TaskInlineFollowers key={t.id+':'+t.updatedAt} task={t} meta={meta} onSaved={()=>{void load();onChanged();}}/>:<EmployeeAvatars people={t.followers}/>}</dd></div>
            <div><dt>Chiến dịch</dt><dd><TaskInlineField task={t} field="campaignId" label="Chiến dịch" value={t.campaign?.id||''} meta={meta} onSaved={()=>{void load();onChanged();}}>{t.campaign?.name||'—'}</TaskInlineField></dd></div>
            <div><dt>Tạo bởi</dt><dd>{t.createdBy?.name || '—'}</dd></div>
            <div><dt>Bắt đầu</dt><dd><TaskInlineField task={t} field="startAt" label="Ngày bắt đầu" value={localDateTime(t.startAt)} onSaved={()=>{void load();onChanged();}}>{when(t.startAt)}</TaskInlineField></dd></div>
            <div><dt>Thời hạn</dt><dd className={t.state === 'overdue' ? 'bad' : ''}><TaskInlineField task={t} field="dueAt" label="Thời hạn" value={localDateTime(t.dueAt)} onSaved={()=>{void load();onChanged();}}>{when(t.dueAt)}</TaskInlineField></dd></div>
            <div><dt>Hoàn thành</dt><dd>{when(t.doneAt)}</dd></div>
            {(t.labels.length>0||t.canEdit)&&<div><dt>Nhãn</dt><dd><TaskInlineField task={t} field="labels" label="Nhãn (cách nhau bằng dấu phẩy)" value={t.labels.join(', ')} onSaved={()=>{void load();onChanged();}}><span className="tk-labels">{t.labels.length?t.labels.map(l=><i key={l}>{l}</i>):'Thêm nhãn…'}</span></TaskInlineField></dd></div>}
            <div><dt>Cập nhật</dt><dd>{when(t.sourceUpdatedAt || t.updatedAt)}</dd></div>
          </dl>
  </>;
  const main = t && <>
          {(t.description||t.canEditDescription)&&<section className="tk-sec"><h3>Mô tả</h3><TaskInlineField task={t} field="description" label="Mô tả" value={t.description} multiline editable={t.canEditDescription} onSaved={()=>{void load();onChanged();}}><div className="tk-rich">{t.description?<Rich text={t.description}/>:<span className="note">Thêm mô tả…</span>}</div></TaskInlineField></section>}
          {(t.result || t.resultHidden || t.canEdit&&t.result!==null) && (
            <section className="tk-sec"><h3>Kết quả công việc</h3>
              {t.result === null ? <p className="note">Chỉ người sửa được công việc (người được giao, người tạo, thành viên dự án, quản trị viên) xem được kết quả.</p>
                : show ? <><div className="tk-result"><TaskInlineField task={t} field="result" label="Kết quả công việc" value={t.result} multiline onSaved={()=>{void load();onChanged();}}>{t.result?<Rich text={t.result}/>:<span className="note">Thêm kết quả…</span>}</TaskInlineField></div><button className="bk-link" onClick={() => setShow(false)}>Ẩn đi</button></>
                : <button className="btn btn-gray btn-sm" onClick={() => setShow(true)}><Icon name="key" size={13} />Hiện kết quả (có thể chứa thông tin đăng nhập)</button>}
            </section>
          )}
          <section className="tk-sec"><h3>Việc con <em>{t.childTasks.length}</em></h3>
            {!t.childTasks.length ? <p className="note">Không có việc con.</p> : (
              <ul className="tk-kids">{t.childTasks.map((k) => <li key={k.id}><button onClick={() => onOpen(k.id)}><Badge t={k} /><span>{k.title}</span><small>{when(k.dueAt)}</small></button></li>)}</ul>
            )}
          </section>
  </>;
  const linkDialog = linking && t && <TaskBoardLink task={t} onClose={() => setLinking(false)} onLinked={() => { setLinking(false); load(); onChanged(); }} />;
  if (!page && asCard && t?.boardLink) return <LinkedCard link={t.boardLink} onClose={onClose} onChanged={() => { void load(); onChanged(); }} onFail={() => setAsCard(false)} />;
  if (page) return (
    <div className="ad-page tk-page tk-detail-page">
      <header className="tk-detail-top"><button className="btn btn-gray btn-sm" onClick={onClose}><Icon name="left" size={14} />Danh sách công việc</button>{t?.externalId && <span>#{t.externalId}</span>}</header>
      {!t ? <BrandLoading label="Đang mở…"/> : <article className="tk-detail" aria-label="Chi tiết công việc"><div className="tk-detail-head">{head}</div><div className="tk-detail-grid"><div className="tk-detail-main">{main}</div><aside className="tk-detail-side">{side}</aside></div></article>}
      {linkDialog}
    </div>
  );
  return (
    <aside className="tk-panel" aria-label="Chi tiết công việc">
      <header><span>{t?.externalId ? `#${t.externalId}` : 'Công việc'}</span><div className="tk-panel-tools">{onExpand && <button className="bd-icon" onClick={onExpand} aria-label="Mở trang chi tiết" title="Mở trang chi tiết"><Icon name="expand" size={15} /></button>}<button className="bd-icon" onClick={onClose} aria-label="Đóng"><Icon name="x" size={16} /></button></div></header>
      {!t ? <BrandLoading label="Đang mở…"/> : <div className="tk-panel-b">{head}{side}{main}</div>}
      {linkDialog}
    </aside>
  );
}


const localDateTime = (ms: number | null | undefined) => ms == null ? '' : new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0,16);

/** A task on a board card opens as that card, as the board shows it: one piece of work, one window. When the board
 *  cannot be read, the task's own panel shows instead. */
function LinkedCard({ link, onClose, onChanged, onFail }: { link: { boardId: string; cardId: string }; onClose: () => void; onChanged: () => void; onFail: () => void }) {
  const me = useStore((s) => s.user)!;
  const [board, setBoard] = useState<Board | null>(null);
  const load = () => api.board(link.boardId).then(setBoard, onFail);
  useEffect(() => { void load(); }, [link.boardId]); // eslint-disable-line react-hooks/exhaustive-deps
  return board ? <CardModal id={link.cardId} board={board} me={me} onClose={onClose} onChanged={() => { void load(); onChanged(); }} /> : null;
}
function TaskInlineField({task,field,label,value,multiline=false,meta,children,onSaved,editable=task.canEdit}:{editable?:boolean;task:TaskDetail;field:'title'|'description'|'result'|'labels'|'startAt'|'dueAt'|'projectId'|'campaignId';label:string;value:string;multiline?:boolean;meta?:TaskMeta|null;children:ReactNode;onSaved:()=>void}){
 const[editing,setEditing]=useState(false),[draft,setDraft]=useState(value),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setEditing(false);setDraft(value);setError('');},[task.id,value]);
 if(!editable)return <>{children}</>;
 const save=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{const body:TaskWrite={};if(field==='startAt'||field==='dueAt')body[field]=draft?new Date(draft).getTime():null;else if(field==='projectId'){body.projectId=draft||null;body.campaignId=null;}else if(field==='campaignId')body.campaignId=draft||null;else if(field==='labels')body.labels=draft.split(',').map(s=>s.trim()).filter(Boolean);else body[field]=draft;await api.updateTask(task.id,body);setEditing(false);onSaved();}catch(e:any){setError(e.message);}finally{setBusy(false);}};
 return editing?<form className="tk-field-editor" onSubmit={save} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();if(!busy)setEditing(false);}}}>
 <fieldset disabled={busy}>{field==='projectId'||field==='campaignId'?<select autoFocus aria-label={label} value={draft} onChange={e=>setDraft(e.target.value)}><option value="">{field==='projectId'?'Không có dự án':'Công việc hiện có'}</option>{field==='projectId'?meta?.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>):meta?.campaigns.filter(c=>c.projectId===task.project?.id).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>:multiline?<textarea autoFocus aria-label={label} rows={Math.min(16,Math.max(5,draft.split('\n').length))} maxLength={20000} value={draft} onChange={e=>setDraft(e.target.value)}/>:<input autoFocus aria-label={label} type={field==='startAt'||field==='dueAt'?'datetime-local':'text'} required={field==='title'} maxLength={field==='title'?500:undefined} value={draft} onChange={e=>setDraft(e.target.value)}/>}
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
  useEffect(() => { let active=true; api.tasks({scope:'all'}).then(r=>{if(active)setParents(r.tasks);},()=>{}); return()=>{active=false;}; },[]);
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
  const content=<form className={inline?"tk-dialog tk-editor tk-inline-editor":"tk-dialog tk-editor"} role={inline?undefined:"dialog"} aria-modal={inline?undefined:true} aria-label={task?'Sửa công việc':'Tạo công việc'} onSubmit={save}>
    <header><b>{task?'Sửa công việc':'Tạo công việc'}</b><button type="button" className="bd-icon" disabled={busy} onClick={onClose} aria-label="Đóng"><Icon name="x" size={15}/></button></header>
    <fieldset disabled={busy}>
      <label>Tên công việc<input autoFocus required maxLength={500} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <div className="tk-form-grid"><label>Trạng thái{task?.boardLink?<EntitySelect kind="list" context={{boardId:task.boardLink.boardId}} createdValue={r=>r.name} onCreated={async()=>setLinkedStatuses((await api.board(task.boardLink!.boardId)).lists.map(l=>l.name))} value={status} onChange={setStatus}>{!(linkedStatuses||meta.statuses).includes(status)&&<option>{status}</option>}{(linkedStatuses||meta.statuses).map(s=><option key={s}>{s}</option>)}</EntitySelect>:<select value={status} onChange={e=>setStatus(e.target.value)}>{!meta.statuses.includes(status)&&<option>{status}</option>}{meta.statuses.map(s=><option key={s}>{s}</option>)}</select>}</label>
      <label>Dự án<EntitySelect kind="project" value={project} onCreated={reloadMeta} onChange={v=>{setProject(v);setCampaign('');}}><option value="">Không có dự án</option>{meta.projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</EntitySelect></label>
      <label>Chiến dịch<EntitySelect kind="campaign" context={{projectId:project}} value={campaign} onCreated={reloadMeta} onChange={setCampaign} disabled={!project}><option value="">Công việc hiện có</option>{meta.campaigns.filter(c=>c.projectId===project).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</EntitySelect></label>
      <label>Ngày bắt đầu<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Thời hạn<input type="datetime-local" value={due} onChange={e=>setDue(e.target.value)}/></label></div>
      <label>Công việc cha<EntitySelect kind="task" context={{projectId:project,campaignId:campaign}} value={parent} onCreated={async()=>setParents((await api.tasks({scope:'all'})).tasks)} onChange={setParent}><option value="">Không có</option>{task?.parent&&!parents.some(p=>p.id===task.parent!.id)&&<option value={task.parent.id}>{task.parent.title}</option>}{parents.filter(p=>p.id!==task?.id&&(!project||p.project?.id===project)&&(!campaign||p.campaign?.id===campaign)).map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</EntitySelect></label>
      <label>Mô tả<textarea rows={4} value={description} onChange={e=>setDescription(e.target.value)} maxLength={20000} readOnly={task?task.canEditDescription===false:false} title={task?.canEditDescription===false?'Chỉ người viết mô tả mới sửa được mô tả':undefined}/></label>
      {(!task || task.result !== null) && <label>Kết quả công việc<textarea rows={3} value={result} onChange={e=>setResult(e.target.value)} maxLength={20000}/></label>}
      <label>Nhãn<input value={labels} onChange={e=>setLabels(e.target.value)} placeholder="Cách nhau bằng dấu phẩy"/></label>
      <div className="tk-staff-picker"><EmployeePicker users={meta.users} selected={users} onChange={setUsers} legacy={task?.assignees.filter(p=>people.includes(p.id)) || []} onLegacyChange={setPeople}/></div>
      <div className="tk-staff-picker"><EmployeePicker label="Người theo dõi" users={meta.users} selected={followers} onChange={setFollowers}/></div>
      {!task&&(parent||project)&&<p className="note">Người theo dõi {parent?'công việc cha':'dự án'} được tự động thêm khi lưu.</p>}
    </fieldset>
    {task?.hasBoardLink&&<p className="note">Tên, mô tả, ngày và hoàn thành sẽ cập nhật trên thẻ liên kết. Kết quả công việc được giữ ở đây.</p>}
    {error&&<p className="note err" role="alert">{error}</p>}
    <div className="tk-action-row"><button className="btn btn-primary btn-sm" disabled={busy||!title.trim()}>{busy?'Đang lưu…':'Lưu công việc'}</button><button type="button" className="btn btn-gray btn-sm" disabled={busy} onClick={onClose}>Huỷ</button></div>
  </form>;
  return inline?content:createPortal(<div className="bd-modal" onMouseDown={e=>e.target===e.currentTarget&&!busy&&onClose()}>{content}</div>,document.body);
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

function ImportDialog({ last, onClose, onDone }: { last: TaskMeta['imports']; onClose: () => void; onDone: (result: TaskImportResult) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TaskImportResult | null>(null);
  const [drag, setDrag] = useState(false);
  const [reading, setReading] = useState(false);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<(ReturnType<typeof readTaskExport> & { text: string; sheetRows: number; sheetColumns: number }) | null>(null);
  const showPreview = (value: string) => {
    setError(''); setPreview(null);
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
    try { const result = await api.importTasks(preview.text, source); setRes(result); onDone(result); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
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
              {res.people > 0 && <li>{res.people} người mới trong dữ liệu (tự gắn với tài khoản cùng tên nếu có).</li>}
              {res.projects > 0 && <li>{res.projects} dự án mới.</li>}
              {res.labels > 0 && <li>{res.labels} nhãn mới.</li>}
            </ul>
            <p className="note">Nhập lại cùng bảng (hoặc bảng mới hơn) sẽ cập nhật theo “Mã công việc”, không tạo trùng.</p>
            <button className="btn btn-primary btn-sm" onClick={onClose}>Xong</button>
          </div>
        ) : preview ? <>
          <p className="note">{source || 'Dữ liệu đã dán'} · <b>{preview.sheetRows} dòng · {preview.sheetColumns} cột</b>{preview.rows.length > 0 && ` · ${preview.rows.length} công việc`}{preview.skipped > 0 && ` · ${preview.skipped} dòng nhóm / dòng trống giữ trong bảng`}. Dữ liệu chưa được lưu.</p>
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
