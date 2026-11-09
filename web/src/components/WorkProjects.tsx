import { ReadingTabs, ReadingHeader } from './ReadingLayout';
import { ResizeHandle } from './ResizeHandle';
import { BrandLoading } from './BrandLoading';
import { GroupedList, byKey } from './GroupedList';
import { QuickCreateDialog } from './QuickCreate';
import { EmployeeAvatars } from './EmployeePicker';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { goto, toast, useStore } from '../store';
import { Icon, Menu } from './ui';
import { ProjectCampaigns } from './ProjectCampaigns';
import type { TaskMeta } from '../types';
import { PROJECT_STAGES, type ProjectStage } from '../../../shared/projects';

type View = 'list' | 'grid' | 'table';
type GroupBy = 'customer' | 'stage' | 'none';
const LS_VIEW = 'dms.projectView', LS_GROUP = 'dms.projectGroup';
const read = <T extends string>(k: string, ok: readonly T[], d: T): T => { try { const v = localStorage.getItem(k) as T; return ok.includes(v) ? v : d; } catch { return d; } };
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const fromHash = () => location.hash.match(/^#projects\/(tj_\w+)/)?.[1] || null;

type ProjectRow = TaskMeta['projects'][number];

const STAGE_NAME = Object.fromEntries(PROJECT_STAGES) as Record<ProjectStage, string>;
const STAGE_LOOK: Record<ProjectStage, [string, string]> = { not_started: ['idle', 'clock'], in_progress: ['doing', 'play'], paused: ['late', 'pause'], done: ['ok', 'check'], cancelled: ['idle', 'x'] };
/** The project's own stage (shared/projects.ts), and how many of its tasks are late. */
function ProjectStateBadge({ p }: { p: ProjectRow }) {
  const stage = p.stage || 'not_started', [look, icon] = STAGE_LOOK[stage], late = (p.overdue || 0) > 0 && stage !== 'done' && stage !== 'cancelled';
  return <>
    <span className={'tk-badge ' + look} title={p.hold ? 'Người quản lý dự án đặt' : 'Theo tiến độ công việc'}><Icon name={icon} size={11} />{STAGE_NAME[stage]}</span>
    {late && <span className="tk-badge bad"><Icon name="clock" size={11} />{p.overdue} quá hạn</span>}
  </>;
}
/** Managers set a project on hold or cancel it; otherwise it follows its tasks. */
function ProjectStageControl({ p, onChanged }: { p: ProjectRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const set = async (hold: 'paused' | 'cancelled' | null) => { setBusy(true); try { await api.updateTaskProject(p.id, { hold }); onChanged(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  return <label className="tk-pick" title="Trạng thái dự án"><Icon name="activity" size={14} /><select aria-label="Trạng thái dự án" disabled={busy} value={p.hold || ''} onChange={(e) => void set((e.target.value || null) as 'paused' | 'cancelled' | null)}>
    <option value="">Theo tiến độ công việc</option><option value="paused">Tạm dừng</option><option value="cancelled">Đã huỷ</option>
  </select></label>;
}

/** Work projects and their tasks. Video projects live in the editor under Tools. */
export function WorkProjects() {
  const user = useStore((s) => s.user);
  const canCreate = user?.role === 'admin' || user?.level !== 'observer';
  const [meta, setMeta] = useState<TaskMeta | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [view, setViewState] = useState<View>(() => read(LS_VIEW, ['list', 'grid', 'table'] as const, 'list'));
  const [groupBy, setGroupByState] = useState<GroupBy>(() => read(LS_GROUP, ['customer', 'stage', 'none'] as const, 'customer'));
  const setView = (v: View) => { setViewState(v); keep(LS_VIEW, v); };
  const setGroupBy = (g: GroupBy) => { setGroupByState(g); keep(LS_GROUP, g); };
  const [selected, setSelected] = useState<string | null>(fromHash);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => { api.taskMeta().then((m) => { setMeta(m); setError(''); }, (e) => setError(e.message)); };
  useEffect(() => {
    let active = true;
    api.taskMeta().then((m) => { if (active) setMeta(m); }, (e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const changed = () => setSelected(fromHash());
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    window.addEventListener('dms:entities-changed', refresh);
    window.addEventListener('dms:entity-created', refresh);
    return () => {
      window.removeEventListener('dms:entities-changed', refresh);
      window.removeEventListener('dms:entity-created', refresh);
    };
  }, []);

  const select = (id: string | null) => {
    setSelected(id);
    history.replaceState(null, '', id ? `#projects/${id}` : '#projects');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  const canManage = (p: ProjectRow) => user?.role === 'admin' || p.level === 'admin';
  const renameProject = async (p: ProjectRow) => {
    const next = prompt('Tên dự án', p.name);
    if (!next?.trim() || next.trim() === p.name) return;
    setBusyId(p.id);
    try {
      await api.renameTaskProject(p.id, next.trim());
      refresh();
      window.dispatchEvent(new Event('dms:entities-changed'));
    } catch (e: any) { toast(e.message, true); } finally { setBusyId(null); }
  };
  const deleteProject = async (p: ProjectRow) => {
    if (!confirm(`Xoá dự án “${p.name}”? Các công việc được giữ lại và gỡ khỏi dự án.`)) return;
    setBusyId(p.id);
    try {
      await api.deleteTaskProject(p.id);
      if (selected === p.id) select(null);
      setSelectedIds((ids) => ids.filter((x) => x !== p.id));
      refresh();
      window.dispatchEvent(new Event('dms:entities-changed'));
      toast(`Đã xoá dự án “${p.name}”.`);
    } catch (e: any) { toast(e.message, true); } finally { setBusyId(null); }
  };
  const bulkDeleteProjects = async () => {
    if (!selectedIds.length) return;
    if (!confirm(`Xoá ${selectedIds.length} dự án đã chọn? Các công việc được giữ lại và gỡ khỏi dự án.`)) return;
    setBusyId('bulk');
    try {
      const r = await api.bulkDeleteTaskProjects(selectedIds);
      if (selected && selectedIds.includes(selected)) select(null);
      setSelectedIds([]);
      refresh();
      window.dispatchEvent(new Event('dms:entities-changed'));
      toast(`Đã xoá ${r.deleted} dự án.`);
    } catch (e: any) { toast(e.message, true); } finally { setBusyId(null); }
  };

  const current = meta?.projects.find((p) => p.id === selected);
  const matches = (s: string) => s.toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi'));
  const tasks = meta?.projects.filter((p) => matches(p.name) || (p.customerName && matches(p.customerName))) || [];
  const deletableRows = tasks.filter(canManage);
  const allChecked = deletableRows.length > 0 && deletableRows.every((p) => selectedIds.includes(p.id));
  const toggleAll = (checked: boolean) => setSelectedIds(checked ? Array.from(new Set([...selectedIds, ...deletableRows.map((p) => p.id)])) : selectedIds.filter((id) => !deletableRows.some((p) => p.id === id)));
  const toggleOne = (p: ProjectRow) => setSelectedIds((ids) => (ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id]));
  const groups = (groupBy === 'customer'
    ? byKey(tasks, (p) => (p.customerId && p.customerName ? { key: p.customerId, label: p.customerName } : null), 'Chưa phân loại')
    : groupBy === 'stage'
    ? PROJECT_STAGES.map(([key, label]) => ({ key, label, rows: tasks.filter((p) => (p.stage || 'not_started') === key) })).filter((g) => g.rows.length)
    : [{ key: 'all', label: 'Tất cả dự án', rows: tasks }]
  ).map((g) => ({ ...g, onAdd: canCreate ? () => setCreating(true) : undefined }));
  const ordered = groups.flatMap((g) => g.rows);
  const totals = `${tasks.length} dự án · ${tasks.reduce((n, p) => n + p.tasks, 0)} công việc`;

  return (
    <div className={'ad-page tk-page tk-mailbox project-page' + (selected ? ' has-selection' : '')}>
      <section className="tk-list-pane" aria-label="Danh sách dự án">
        <header className="tk-head">
          <span className="tk-head-ico"><Icon name="folder" size={20} /></span>
          <div className="tk-head-main">
            <h1>Dự án</h1>
            <ReadingTabs
              label="Cách xem dự án"
              value={view}
              items={[
                { value: 'list' as View, label: 'Danh sách', icon: 'list' },
                { value: 'grid' as View, label: 'Thẻ', icon: 'grid' },
                { value: 'table' as View, label: 'Bảng', icon: 'sheet' },
              ]}
              onChange={(v) => setView(v)}
            />
          </div>
          {!selected && <span className="cd-totals">{!meta ? '…' : totals}</span>}
          <Menu label="Thêm thao tác" items={[
            { label: 'Làm mới', icon: 'refresh', onClick: refresh },
            { label: 'Mở Công việc', icon: 'checklist', onClick: () => { goto('tasks'); window.location.hash = '#tasks'; } },
          ]} />
        </header>
        <div className="tk-toolbar">
          {canCreate && <button className="tk-new" onClick={() => setCreating(true)}><Icon name="plus" size={15} />Thêm mới</button>}
          {selectedIds.length > 0 && (
            <>
              <button className="btn btn-sm cm-danger" disabled={busyId === 'bulk'} onClick={() => void bulkDeleteProjects()}><Icon name="trash" size={14} />Xoá đã chọn ({selectedIds.length})</button>
              <button className="btn btn-gray btn-sm" onClick={() => setSelectedIds([])}>Bỏ chọn</button>
            </>
          )}
          <label className="tk-find"><Icon name="search" size={14} /><input aria-label="Tìm dự án" placeholder="Tìm dự án, khách hàng…" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          {view !== 'grid' && <label className="tk-pick"><Icon name="layers" size={14} /><span>Nhóm theo:</span><select aria-label="Nhóm theo" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}><option value="customer">Khách hàng</option><option value="stage">Trạng thái</option><option value="none">Không nhóm</option></select></label>}
        </div>
        {error ? <p className="note err" role="alert">{error}</p>
          : !meta ? <BrandLoading label="Đang tải dự án…" />
          : !tasks.length ? (
            <div className="crm-empty">
              <Icon name="folder" size={36} />
              <h3>{query ? 'Không có dự án phù hợp' : 'Chưa có dự án công việc'}</h3>
              <p>{query ? 'Thử từ khoá khác.' : 'Dự án sẽ xuất hiện khi tạo mới hoặc nhập dữ liệu công việc.'}</p>
              {canCreate && !query && <button className="btn btn-primary" onClick={() => setCreating(true)}>Thêm dự án</button>}
            </div>
          ) : selected ? (
            <div className="tk-reading-list">
              {groups.filter((g) => g.rows.length).map((g) => (
                <section key={g.key}>
                  <h3>{g.label}<span>{g.rows.length}</span></h3>
                  {g.rows.map((p) => (
                    <button
                      key={p.id}
                      id={'project-row-' + p.id}
                      className={'reading-list-row tk-reading-row' + (p.id === selected ? ' selected' : '')}
                      aria-current={p.id === selected ? 'true' : undefined}
                      onClick={() => select(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          const i = ordered.findIndex((x) => x.id === p.id);
                          const next = ordered[i + (e.key === 'ArrowDown' ? 1 : -1)];
                          if (next) { select(next.id); document.getElementById('project-row-' + next.id)?.focus(); }
                        }
                      }}
                    >
                      <span className="tk-reading-title">{p.name}</span>
                      <span className="tk-reading-project">{p.customerName || 'Chưa phân loại'}</span>
                      <span className="tk-reading-meta"><ProjectStateBadge p={p} /><span>{p.completed || 0}/{p.tasks} việc</span></span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          ) : view === 'list' ? (
            <GroupedList
              foldKey={`dms.projectFold.${groupBy}`}
              groups={groups}
              nameLabel="Tên dự án"
              addLabel="Thêm dự án"
              onOpen={(p) => select(p.id)}
              selected={selected}
              check={deletableRows.length > 0 ? {
                done: (p) => selectedIds.includes(p.id),
                toggle: toggleOne,
                label: (p) => `Chọn dự án “${p.name}”`,
                all: allChecked,
                toggleAll,
                canCheck: canManage,
              } : undefined}
              name={(p) => <b className="cd-name">{p.name}</b>}
              columns={[
                { key: 'status', label: 'Trạng thái', width: 135, render: (p) => <ProjectStateBadge p={p} /> },
                { key: 'who', label: 'Người làm', width: 115, render: (p) => <EmployeeAvatars people={p.assignees || []} /> },
                ...(groupBy === 'customer' ? [] : [{ key: 'customer', label: 'Khách hàng', width: 155, wide: true, render: (p: ProjectRow) => p.customerName || '—' }]),
                { key: 'tasks', label: 'Tiến độ', width: 130, render: (p) => p.tasks > 0 ? `${p.completed || 0}/${p.tasks} công việc` : '0 công việc' },
                {
                  key: 'actions', label: 'Thao tác', width: 145, render: (p) => canManage(p) ? (
                    <span className="crm-campaign-actions" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="btn btn-gray btn-sm" disabled={busyId === p.id} onClick={() => void renameProject(p)}>Đổi tên</button>
                      <button type="button" className="btn btn-sm cm-danger" disabled={busyId === p.id} onClick={() => void deleteProject(p)}>Xoá</button>
                    </span>
                  ) : null,
                },
              ]}
            />
          ) : view === 'grid' ? (
            <div className="cd-cards">
              {tasks.map((p) => (
                <div key={p.id} className="cd-customer" role="button" tabIndex={0} onClick={() => select(p.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(p.id); } }}>
                  <header><span className="cd-monogram">{p.name.replace(/^\W*(\[[^\]]*\]\s*)?/, '').split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || 'DA'}</span><ProjectStateBadge p={p} /></header>
                  <h3>{p.name}</h3>
                  <p>{p.customerName || 'Chưa phân loại'}</p>
                  <div className="cd-card-stats"><span><b>{p.tasks}</b>Công việc</span><span><b>{p.completed || 0}/{p.tasks}</b>Hoàn thành</span></div>
                  <footer>
                    <EmployeeAvatars people={p.assignees || []} />
                    {canManage(p) ? (
                      <span className="crm-campaign-actions" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="btn btn-gray btn-sm" disabled={busyId === p.id} onClick={() => void renameProject(p)}>Đổi tên</button>
                        <button type="button" className="btn btn-sm cm-danger" disabled={busyId === p.id} onClick={() => void deleteProject(p)}>Xoá</button>
                      </span>
                    ) : <span>Xem chi tiết</span>}
                  </footer>
                </div>
              ))}
            </div>
          ) : (
            <div className="cd-table work-project-list">
              <table>
                <thead><tr>{deletableRows.length > 0 && <th style={{ width: 36 }}><input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} aria-label="Chọn tất cả dự án" /></th>}<th>Tên dự án</th><th>Trạng thái</th><th>Người làm</th><th>Khách hàng</th><th>Tiến độ</th><th>Thao tác</th></tr></thead>
                <tbody>
                  {tasks.map((p) => (
                    <tr key={p.id} className="crm-row" onClick={() => select(p.id)}>
                      {deletableRows.length > 0 && <td onClick={(e) => e.stopPropagation()}>{canManage(p) && <input type="checkbox" checked={selectedIds.includes(p.id)} onChange={() => toggleOne(p)} aria-label={`Chọn dự án ${p.name}`} />}</td>}
                      <td><button className="work-project-name" onClick={() => select(p.id)}><Icon name="folder" size={17} /><b>{p.name}</b></button></td>
                      <td><ProjectStateBadge p={p} /></td>
                      <td><EmployeeAvatars people={p.assignees || []} /></td>
                      <td>{p.customerName || '—'}</td>
                      <td>{p.tasks > 0 ? `${p.completed || 0}/${p.tasks} công việc` : '0 công việc'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {canManage(p) ? (
                          <span className="crm-campaign-actions">
                            <button type="button" className="btn btn-gray btn-sm" disabled={busyId === p.id} onClick={() => void renameProject(p)}>Đổi tên</button>
                            <button type="button" className="btn btn-sm cm-danger" disabled={busyId === p.id} onClick={() => void deleteProject(p)}>Xoá</button>
                          </span>
                        ) : <button className="bd-icon" aria-label={`Mở dự án ${p.name}`} onClick={() => select(p.id)}><Icon name="right" size={15} /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
      {selected && meta && <ResizeHandle cssVar="--rd-list-w" storage="projects" min={220} max={640} label="Đổi độ rộng danh sách dự án" />}
      {selected && meta && (
        <article className="tk-reading-pane project-reading-pane" aria-label="Chi tiết dự án">
          <ReadingHeader label="Chi tiết dự án" onClose={() => select(null)} actions={current && <>{current.stage && <ProjectStateBadge p={current} />}{current.level === 'admin' && <ProjectStageControl p={current} onChanged={refresh} />}</>} />
          {current ? (
            <ProjectCampaigns
              key={current.id}
              id={current.id}
              name={current.name}
              displayView={view}
              onRenamed={refresh}
              onDeleted={() => { select(null); refresh(); }}
            />
          ) : <p className="note">Không tìm thấy dự án này.</p>}
        </article>
      )}
      {creating && <QuickCreateDialog kind="project" onClose={() => setCreating(false)} onCreated={(r) => { setCreating(false); refresh(); select(r.id); }} />}
    </div>
  );
}
