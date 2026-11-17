import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { openLink, toast } from '../store';
import { DEFAULT_FLOW, FLOW_STAGES, isClosedStage, type FlowStage } from '../../../shared/task-flow';
import type { ReportItem, TaskItem, TaskMeta } from '../types';
import { askConfirm } from './AskDialog';
import { BrandLoading } from './BrandLoading';
import { DateFilterBar, filterByDate, useDateFilter } from './DateFilter';
import { EmployeeAvatars } from './EmployeePicker';
import { GroupedList, byDueDate, type Group, type GroupColumn } from './GroupedList';
import { ProjectEditDialog } from './ProjectEditDialog';
import { ProjectMembers } from './ProjectMembers';
import { ReportEditor } from './Reports';
import { TaskEditor, TaskPanel } from './Tasks';
import { Icon } from './ui';
import {
  Breadcrumb,
  BrandServiceStageBadge,
  Button,
  EmptyState,
  PageShell,
  PageTabs,
  StageBadge,
  type CrumbItem,
} from './kit';

type ServiceRow = TaskMeta['projects'][number] & { catalogServiceName?: string | null; boardId?: string | null };
type ServiceTab = 'list' | 'kanban' | 'calendar' | 'reports';
type TreeTaskRow = TaskItem & { depth: number; hasLoadedChildren: boolean; childCount: number };

const STAGE_TITLES: Record<FlowStage, string> = {
  account: 'ACCOUNT · Tiếp nhận & bàn giao',
  execution: 'EXECUTION · Thực hiện',
  review: 'REVIEW · Đánh giá',
  completed: 'COMPLETED · Hoàn thành',
  rejected: 'REJECTED · Từ chối',
};

const CORE_STAGES: FlowStage[] = ['account', 'execution', 'review', 'completed'];

const normText = (s: string) =>
  s.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');

const two = (n: number) => String(n).padStart(2, '0');
const fmtDate = (ms: number | null) => {
  if (!ms) return '—';
  const d = new Date(ms);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const fmtShortDate = (ms: number | null) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}`;
};
const fmtUpdated = (ms: number) => {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())} · ${two(d.getDate())}/${two(d.getMonth() + 1)}`;
};

function isTaskDone(t: TaskItem): boolean {
  return t.stage === 'completed' || ['done', 'done_late'].includes(t.state);
}

/** Build stage-grouped groups where subtasks stay indented cleanly beneath their visible parent. */
function buildStageGroups(
  tasks: TaskItem[],
  collapsed: Set<string>,
  onAdd?: () => void,
): Group<TreeTaskRow>[] {
  const byId = new Map<string, TaskItem>(tasks.map((t) => [t.id, t]));
  const childrenMap = new Map<string, TaskItem[]>();
  const rootsByStage = new Map<FlowStage, TaskItem[]>();

  for (const s of FLOW_STAGES) rootsByStage.set(s.key, []);

  const compareTasks = (a: TaskItem, b: TaskItem) => {
    const ad = a.dueAt ?? Number.MAX_SAFE_INTEGER;
    const bd = b.dueAt ?? Number.MAX_SAFE_INTEGER;
    if (ad !== bd) return ad - bd;
    return (a.createdAt ?? a.updatedAt ?? 0) - (b.createdAt ?? b.updatedAt ?? 0);
  };

  for (const t of tasks) {
    const pid = t.parent?.id;
    if (pid && byId.has(pid)) {
      const list = childrenMap.get(pid) || [];
      list.push(t);
      childrenMap.set(pid, list);
    } else {
      const stage: FlowStage = t.stage || 'account';
      rootsByStage.get(stage)!.push(t);
    }
  }

  for (const list of childrenMap.values()) list.sort(compareTasks);

  const flattenBranch = (root: TaskItem, depth: number, out: TreeTaskRow[]) => {
    const kids = childrenMap.get(root.id) || [];
    const childCount = Math.max(kids.length, root.children || 0);
    out.push({
      ...root,
      depth,
      hasLoadedChildren: kids.length > 0,
      childCount,
    });
    if (kids.length > 0 && !collapsed.has(root.id)) {
      const nextDepth = Math.min(4, depth + 1);
      for (const child of kids) flattenBranch(child, nextDepth, out);
    }
  };

  const groups: Group<TreeTaskRow>[] = [];
  for (const st of CORE_STAGES) {
    const roots = (rootsByStage.get(st) || []).sort(compareTasks);
    const rows: TreeTaskRow[] = [];
    for (const r of roots) flattenBranch(r, 0, rows);
    groups.push({
      key: st,
      label: STAGE_TITLES[st],
      color: DEFAULT_FLOW[st],
      rows,
      onAdd,
    });
  }

  const rejectedRoots = (rootsByStage.get('rejected') || []).sort(compareTasks);
  if (rejectedRoots.length > 0) {
    const rows: TreeTaskRow[] = [];
    for (const r of rejectedRoots) flattenBranch(r, 0, rows);
    groups.push({
      key: 'rejected',
      label: STAGE_TITLES.rejected,
      color: '#dc2626',
      rows,
    });
  }

  return groups;
}

export function BrandServiceView({
  id,
  service,
  meta,
  onMetaChanged,
  onDeleted,
  onBack,
}: {
  id: string;
  service: ServiceRow;
  meta: TaskMeta | null;
  onMetaChanged: () => void;
  onDeleted: () => void;
  onBack: () => void;
}) {
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [tab, setTab] = useState<ServiceTab>('list');
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('');
  const [quickFilter, setQuickFilter] = useState<'all' | 'open' | 'review' | 'overdue' | 'completed'>('all');
  const [personFilter, setPersonFilter] = useState<string>('');
  const [dates, setDates] = useDateFilter();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [manage, setManage] = useState(service.level === 'admin');
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<ReportItem[] | null>(null);
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const loadTasks = () => {
    api.tasks({ scope: 'all', brandService: id }).then(
      (res) => setTasks(res.tasks),
      (err) => {
        toast(err.message, true);
        setTasks([]);
      },
    );
  };

  const loadReports = () => {
    api.reports({ project: id }).then(setReports, () => setReports([]));
  };

  useEffect(() => {
    setTasks(null);
    setSelectedIds([]);
    setStageFilter('');
    setQuickFilter('all');
    setPersonFilter('');
    setQuery('');
    loadTasks();
    api.projectMembers(id).then((d) => setManage(d.level === 'admin'), () => {});
  }, [id]);

  useEffect(() => {
    if (tab === 'reports' && reports === null) loadReports();
  }, [tab, id]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [menuOpen]);

  const reloadAll = () => {
    loadTasks();
    onMetaChanged();
    window.dispatchEvent(new Event('dms:entities-changed'));
  };

  const toggleExpand = (taskId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleDone = async (t: TaskItem) => {
    try {
      await api.updateTask(t.id, { status: isTaskDone(t) ? 'Chưa thực hiện' : 'Hoàn thành' });
      reloadAll();
    } catch (err: any) {
      toast(err.message, true);
    }
  };

  const toggleSelect = (tid: string) => {
    setSelectedIds((prev) => (prev.includes(tid) ? prev.filter((x) => x !== tid) : [...prev, tid]));
  };

  const handleBulkDelete = async () => {
    const targets = visibleTasks.filter((t) => selectedIds.includes(t.id) && t.canDelete !== false);
    if (!targets.length) return;
    if (!(await askConfirm(`Xoá ${targets.length} công việc đã chọn?`))) return;
    setBusy(true);
    try {
      await Promise.all(targets.map((t) => api.deleteTask(t.id)));
      toast(`Đã xoá ${targets.length} công việc`);
      setSelectedIds([]);
      reloadAll();
    } catch (err: any) {
      toast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const handleHoldChange = async (hold: 'paused' | 'cancelled' | null) => {
    setMenuOpen(false);
    setBusy(true);
    try {
      await api.updateTaskProject(id, { hold });
      toast('Đã cập nhật trạng thái dịch vụ');
      onMetaChanged();
    } catch (err: any) {
      toast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteService = async () => {
    setMenuOpen(false);
    if (!(await askConfirm(`Xoá dịch vụ “${service.name}”? Toàn bộ công việc bên trong vẫn được giữ nhưng sẽ tách khỏi dịch vụ này.`))) return;
    setBusy(true);
    try {
      await api.deleteTaskProject(id);
      toast(`Đã xoá dịch vụ “${service.name}”`);
      onDeleted();
    } catch (err: any) {
      toast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateReport = async () => {
    setBusy(true);
    try {
      const created = await api.createReport({ projectId: id, customerId: service.customerId || null });
      setOpenReportId(created.id);
      loadReports();
    } catch (err: any) {
      toast(err.message, true);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteReport = async (r: ReportItem) => {
    if (!(await askConfirm(`Xoá báo cáo “${r.title}”?`))) return;
    try {
      await api.deleteReport(r.id);
      loadReports();
    } catch (err: any) {
      toast(err.message, true);
    }
  };

  const datedTasks = useMemo(() => filterByDate(tasks || [], dates), [tasks, dates]);

  const counts = useMemo(() => {
    const all = datedTasks;
    return {
      all: all.length,
      open: all.filter((t) => !isClosedStage(t.stage || 'account') && !isTaskDone(t)).length,
      review: all.filter((t) => t.stage === 'review').length,
      overdue: all.filter((t) => t.state === 'overdue' && !isClosedStage(t.stage || 'account')).length,
      completed: all.filter((t) => isTaskDone(t)).length,
    };
  }, [datedTasks]);

  const assigneeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks || []) {
      for (const p of [...t.assignees, ...(t.cardPeople || [])]) {
        if (!map.has(p.id)) map.set(p.id, p.name);
      }
    }
    for (const p of service.assignees || []) {
      if (!map.has(p.id)) map.set(p.id, p.name);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'));
  }, [tasks, service.assignees]);

  const visibleTasks = useMemo(() => {
    const q = normText(query.trim());
    return datedTasks.filter((t) => {
      if (quickFilter === 'open' && (isClosedStage(t.stage || 'account') || isTaskDone(t))) return false;
      if (quickFilter === 'review' && t.stage !== 'review') return false;
      if (quickFilter === 'overdue' && (t.state !== 'overdue' || isClosedStage(t.stage || 'account'))) return false;
      if (quickFilter === 'completed' && !isTaskDone(t)) return false;
      if (stageFilter && (t.stage || 'account') !== stageFilter) return false;
      if (personFilter) {
        const people = [...t.assignees, ...(t.cardPeople || [])];
        if (!people.some((p) => p.id === personFilter)) return false;
      }
      if (q) {
        const hay = normText([
          t.title,
          t.status,
          ...t.assignees.map((a) => a.name),
          ...(t.cardPeople || []).map((a) => a.name),
          ...t.labels,
        ].join(' '));
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [datedTasks, quickFilter, stageFilter, personFilter, query]);

  const stageGroups = useMemo(
    () => buildStageGroups(visibleTasks, collapsed, () => setCreating(true)),
    [visibleTasks, collapsed],
  );

  const dueGroups = useMemo(
    () =>
      byDueDate(visibleTasks, () => setCreating(true)).map((g) => ({
        ...g,
        rows: g.rows.map((r) => ({ ...r, depth: 0, hasLoadedChildren: false, childCount: r.children || 0 })),
      })),
    [visibleTasks],
  );

  const crumbs: CrumbItem[] = [];
  if (service.customerId && service.customerName) {
    crumbs.push({
      label: service.customerName,
      onClick: () => openLink(`#customers/${service.customerId}`),
    });
  }
  if (service.brandId && service.brandName) {
    crumbs.push({
      label: service.brandName,
      onClick: () => openLink(`#projects?brand=${encodeURIComponent(service.brandId!)}`),
    });
  } else {
    crumbs.push({
      label: 'Dịch vụ',
      onClick: onBack,
    });
  }
  crumbs.push({ label: service.name });

  const renderTaskName = (t: TreeTaskRow, showParentHint = false) => {
    const done = isTaskDone(t);
    return (
      <div className="bsv-task-cell">
        {t.hasLoadedChildren && (
          <button
            type="button"
            className={`bsv-tree-toggle${!collapsed.has(t.id) ? ' is-open' : ''}`}
            aria-label={collapsed.has(t.id) ? 'Hiện công việc con' : 'Thu gọn công việc con'}
            aria-expanded={!collapsed.has(t.id)}
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(t.id);
            }}
          >
            <Icon name="chevron" size={12} />
          </button>
        )}
        <span className={`bsv-task-title${done ? ' is-done' : ''}`}>{t.title}</span>
        {t.childCount > 0 && <span className="bsv-subcount">{t.childCount} việc con</span>}
        {showParentHint && t.parent?.title && (
          <span className="bsv-parent-hint">↳ {t.parent.title}</span>
        )}
        {t.labels.slice(0, 2).map((lbl) => (
          <span key={lbl} className="bsv-tag">{lbl}</span>
        ))}
      </div>
    );
  };

  const columns: GroupColumn<TreeTaskRow>[] = [
    {
      key: 'stage',
      label: 'Giai đoạn',
      width: 124,
      render: (t) => <StageBadge stage={t.stage || 'account'} state={t.state} />,
    },
    {
      key: 'who',
      label: 'Người làm',
      width: 152,
      render: (t) => {
        const who = [...t.assignees, ...(t.cardPeople || [])];
        if (!who.length) return <span className="ui-muted">Chưa giao</span>;
        return (
          <div className="tk-who-cell">
            <EmployeeAvatars people={who} />
            {who.length === 1 && <span className="tk-who-name">{who[0].name}</span>}
          </div>
        );
      },
    },
    {
      key: 'due',
      label: 'Thời hạn',
      width: 112,
      end: true,
      render: (t) => {
        const late = t.state === 'overdue' && !isClosedStage(t.stage || 'account');
        return <span className={`bsv-due${late ? ' is-late' : ''}`}>{fmtDate(t.dueAt)}</span>;
      },
    },
  ];

  const allDeletableVisible = visibleTasks.filter((t) => t.canDelete !== false);
  const allChecked = allDeletableVisible.length > 0 && allDeletableVisible.every((t) => selectedIds.includes(t.id));

  const summaryBar = tab !== 'reports' && (
    <div className="bsv-metrics" role="group" aria-label="Lọc nhanh tiến độ">
      {([
        ['all', 'Tất cả', counts.all],
        ['open', 'Đang mở', counts.open],
        ['review', 'Chờ duyệt', counts.review],
        ['overdue', 'Quá hạn', counts.overdue],
        ['completed', 'Hoàn thành', counts.completed],
      ] as const).map(([key, label, count]) => (
        <button
          key={key}
          type="button"
          className={`bsv-metric${quickFilter === key ? ' is-active' : ''}${key === 'overdue' && count > 0 ? ' is-late' : ''}`}
          onClick={() => setQuickFilter(key)}
        >
          <span>{label}</span>
          <b>{count}</b>
        </button>
      ))}
    </div>
  );

  const filterToolbar = tab !== 'reports' && (
    <div className="bsv-toolbar">
      <label className="bsv-search">
        <Icon name="search" size={14} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Tìm công việc, người làm…"
          aria-label="Tìm công việc trong dịch vụ"
        />
      </label>
      <div className="bsv-filters">
        <select
          className="bsv-select"
          aria-label="Lọc giai đoạn"
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
        >
          <option value="">Tất cả giai đoạn</option>
          {FLOW_STAGES.map((s) => (
            <option key={s.key} value={s.key}>{s.code} · {s.vi}</option>
          ))}
        </select>
        <select
          className="bsv-select"
          aria-label="Lọc người thực hiện"
          value={personFilter}
          onChange={(e) => setPersonFilter(e.target.value)}
        >
          <option value="">Mọi nhân viên</option>
          {assigneeOptions.map(([pid, pname]) => (
            <option key={pid} value={pid}>{pname}</option>
          ))}
        </select>
        <DateFilterBar value={dates} onChange={setDates} />
        {selectedIds.length > 0 && (
          <Button variant="danger" size="sm" icon="trash" disabled={busy} onClick={() => void handleDeleteSelected(selectedIds)}>
            Xoá {selectedIds.length}
          </Button>
        )}
      </div>
    </div>
  );

  function handleDeleteSelected(ids: string[]) {
    if (!ids.length) return;
    return handleBulkDelete();
  }

  const catalogLabel = service.catalogServiceName && service.catalogServiceName !== service.name ? service.catalogServiceName : null;
  const memberCount = service.assignees?.length || 0;

  return (
    <div className="bsv-page">
      <PageShell
        breadcrumb={<Breadcrumb items={crumbs} />}
        title={service.name}
        subtitle={
          <div className="bsv-sub">
            <BrandServiceStageBadge stage={service.stage} />
            {catalogLabel && <span className="bsv-meta-sep">·</span>}
            {catalogLabel && <span>{catalogLabel}</span>}
            <span className="bsv-meta-sep">·</span>
            <span>{tasks === null ? 'Đang tải công việc…' : `${tasks.length} công việc`}</span>
            {memberCount > 0 && <span className="bsv-meta-sep">·</span>}
            {memberCount > 0 && <span>{memberCount} thành viên</span>}
          </div>
        }
        primaryAction={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            Thêm công việc
          </Button>
        }
        secondaryActions={
          <div className="bsv-sec-actions">
            {service.boardId && (
              <Button variant="ghost" size="sm" icon="boards" onClick={() => openLink(`#boards/${service.boardId}`)}>
                Mở board
              </Button>
            )}
            <Button variant="secondary" size="sm" icon="users" onClick={() => setMembersOpen(true)}>
              Thành viên
            </Button>
            {manage && (
              <div className="bsv-more-wrap" ref={menuRef}>
                <Button
                  variant="secondary"
                  size="sm"
                  icon="more"
                  aria-label="Tuỳ chọn dịch vụ"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((v) => !v)}
                />
                {menuOpen && (
                  <div className="bsv-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setEditing(true);
                      }}
                    >
                      <Icon name="edit" size={14} />
                      <span>Chỉnh sửa dịch vụ</span>
                    </button>
                    <div className="bsv-menu-sep" />
                    <button
                      type="button"
                      role="menuitem"
                      className={!service.hold ? 'is-selected' : ''}
                      onClick={() => void handleHoldChange(null)}
                    >
                      <Icon name="check" size={14} />
                      <span>Theo tiến độ công việc</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={service.hold === 'paused' ? 'is-selected' : ''}
                      onClick={() => void handleHoldChange('paused')}
                    >
                      <Icon name="pause" size={14} />
                      <span>Tạm dừng dịch vụ</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={service.hold === 'cancelled' ? 'is-selected' : ''}
                      onClick={() => void handleHoldChange('cancelled')}
                    >
                      <Icon name="x" size={14} />
                      <span>Huỷ dịch vụ</span>
                    </button>
                    <div className="bsv-menu-sep" />
                    <button
                      type="button"
                      role="menuitem"
                      className="is-danger"
                      onClick={() => void handleDeleteService()}
                    >
                      <Icon name="trash" size={14} />
                      <span>Xoá dịch vụ</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        }
        tabs={
          <PageTabs
            label="Chế độ xem dịch vụ"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'list', label: 'Danh sách', icon: 'checklist', count: tasks ? visibleTasks.length : undefined },
              { value: 'kanban', label: 'Kanban', icon: 'boards' },
              { value: 'calendar', label: 'Lịch', icon: 'calendar' },
              { value: 'reports', label: 'Báo cáo', icon: 'file', count: reports?.length },
            ]}
          />
        }
        summary={summaryBar}
        toolbar={filterToolbar}
      >
        {tab === 'list' && (
          tasks === null ? (
            <BrandLoading label="Đang tải công việc…" />
          ) : !visibleTasks.length ? (
            <EmptyState
              icon="checklist"
              title={tasks.length ? 'Không có công việc phù hợp bộ lọc' : 'Chưa có công việc nào'}
              description={
                tasks.length
                  ? 'Thử thay đổi bộ lọc giai đoạn, nhân sự hoặc từ khoá tìm kiếm.'
                  : 'Tạo công việc đầu tiên để theo dõi tiến độ ACCOUNT › EXECUTION › REVIEW › COMPLETED.'
              }
              action={
                tasks.length ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQuery('');
                      setStageFilter('');
                      setQuickFilter('all');
                      setPersonFilter('');
                    }}
                  >
                    Xoá bộ lọc
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" icon="plus" onClick={() => setCreating(true)}>
                    Thêm công việc đầu tiên
                  </Button>
                )
              }
            />
          ) : (
            <GroupedList<TreeTaskRow>
              groups={stageGroups}
              columns={columns}
              nameLabel="Tên công việc"
              name={(t) => renderTaskName(t, false)}
              indent={(t) => t.depth}
              check={{
                done: isTaskDone,
                toggle: (t) => void toggleDone(t),
                canCheck: (t) => !t.readOnly,
                label: (t) => (isTaskDone(t) ? `Mở lại “${t.title}”` : `Hoàn thành “${t.title}”`),
              }}
              selection={
                allDeletableVisible.length
                  ? {
                      selected: selectedIds,
                      toggle: toggleSelect,
                      all: allChecked,
                      toggleAll: (checked) =>
                        setSelectedIds(checked ? allDeletableVisible.map((t) => t.id) : []),
                    }
                  : undefined
              }
              selected={openTaskId}
              onOpen={(t) => setOpenTaskId(t.id)}
              foldKey={`dms.bsv.stageFold.${id}`}
              addLabel="Thêm công việc"
            />
          )
        )}

        {tab === 'kanban' && (
          tasks === null ? (
            <BrandLoading label="Đang tải bảng Kanban…" />
          ) : (
            <div className="bsv-kanban" role="region" aria-label="Bảng Kanban theo giai đoạn">
              {stageGroups.map((grp) => (
                <section key={grp.key} className="bsv-kcol" aria-label={grp.label}>
                  <header className="bsv-kcol-head">
                    <span className={`bsv-kcol-dot tf-${grp.key}`} />
                    <h3>{FLOW_STAGES.find((x) => x.key === grp.key)?.code || grp.key}</h3>
                    <span className="bsv-kcol-count">{grp.rows.length}</span>
                  </header>
                  <div className="bsv-kcol-list">
                    {!grp.rows.length ? (
                      <p className="bsv-kcol-empty">Chưa có công việc</p>
                    ) : (
                      grp.rows.map((t) => {
                        const who = [...t.assignees, ...(t.cardPeople || [])];
                        const late = t.state === 'overdue' && !isClosedStage(t.stage || 'account');
                        return (
                          <button
                            key={t.id}
                            type="button"
                            className={`bsv-kcard${t.depth > 0 ? ' is-sub' : ''}${openTaskId === t.id ? ' is-active' : ''}`}
                            onClick={() => setOpenTaskId(t.id)}
                          >
                            {t.parent?.title && (
                              <span className="bsv-kcard-parent">↳ {t.parent.title}</span>
                            )}
                            <span className={`bsv-kcard-title${isTaskDone(t) ? ' is-done' : ''}`}>{t.title}</span>
                            {t.labels.length > 0 && (
                              <span className="bsv-kcard-tags">
                                {t.labels.slice(0, 2).map((lbl) => (
                                  <span key={lbl} className="bsv-tag">{lbl}</span>
                                ))}
                              </span>
                            )}
                            <span className="bsv-kcard-foot">
                              <span className="bsv-kcard-who">
                                {who.length > 0 ? <EmployeeAvatars people={who} /> : <span className="ui-muted">Chưa giao</span>}
                              </span>
                              <span className="bsv-kcard-meta">
                                {t.childCount > 0 && <span>{t.childCount} con</span>}
                                {t.dueAt && <span className={late ? 'is-late' : ''}>{fmtShortDate(t.dueAt)}</span>}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </section>
              ))}
            </div>
          )
        )}

        {tab === 'calendar' && (
          tasks === null ? (
            <BrandLoading label="Đang tải lịch công việc…" />
          ) : !visibleTasks.length ? (
            <EmptyState
              icon="calendar"
              title="Chưa có lịch công việc"
              description="Đặt thời hạn cho công việc để theo dõi lịch theo ngày, tuần và hạn chót."
            />
          ) : (
            <GroupedList<TreeTaskRow>
              groups={dueGroups}
              columns={columns}
              nameLabel="Tên công việc"
              name={(t) => renderTaskName(t, true)}
              check={{
                done: isTaskDone,
                toggle: (t) => void toggleDone(t),
                canCheck: (t) => !t.readOnly,
                label: (t) => (isTaskDone(t) ? `Mở lại “${t.title}”` : `Hoàn thành “${t.title}”`),
              }}
              selected={openTaskId}
              onOpen={(t) => setOpenTaskId(t.id)}
              foldKey={`dms.bsv.dueFold.${id}`}
              hideEmpty
              addLabel="Thêm công việc"
            />
          )
        )}

        {tab === 'reports' && (
          <div className="bsv-reports">
            <div className="bsv-stat-grid">
              <div className="bsv-stat">
                <span>Tổng công việc</span>
                <b>{counts.all}</b>
              </div>
              <div className="bsv-stat">
                <span>Hoàn thành</span>
                <b>{counts.completed}</b>
              </div>
              <div className="bsv-stat">
                <span>Chờ đánh giá (REVIEW)</span>
                <b>{counts.review}</b>
              </div>
              <div className="bsv-stat">
                <span>Quá hạn</span>
                <b className={counts.overdue > 0 ? 'is-late' : ''}>{counts.overdue}</b>
              </div>
            </div>

            <div className="bsv-rep-head">
              <h3>Báo cáo chiến dịch</h3>
              <Button variant="secondary" size="sm" icon="plus" disabled={busy} onClick={() => void handleCreateReport()}>
                Tạo báo cáo
              </Button>
            </div>

            {reports === null ? (
              <BrandLoading label="Đang tải báo cáo…" />
            ) : !reports.length ? (
              <EmptyState
                icon="file"
                title="Chưa có báo cáo cho dịch vụ này"
                description="Tạo trang báo cáo tổng hợp chiến dịch để xuất bản hoặc gửi khách hàng."
                action={
                  <Button variant="secondary" size="sm" icon="plus" disabled={busy} onClick={() => void handleCreateReport()}>
                    Tạo báo cáo
                  </Button>
                }
              />
            ) : (
              <ul className="bsv-rep-list">
                {reports.map((r) => (
                  <li key={r.id} className="bsv-rep-row">
                    <button type="button" className="bsv-rep-main" onClick={() => setOpenReportId(r.id)}>
                      <span className="bsv-rep-title">{r.title}</span>
                      <span className="bsv-rep-meta">Cập nhật {fmtUpdated(r.updatedAt)}</span>
                    </button>
                    <div className="bsv-rep-actions">
                      <a className="ui-btn ui-btn-ghost ui-btn-sm" href={`/api/reports/${r.id}/html`} target="_blank" rel="noreferrer">
                        Xem
                      </a>
                      <a className="ui-btn ui-btn-secondary ui-btn-sm" href={`/api/reports/${r.id}/html?download=1`}>
                        <Icon name="download" size={13} />
                        <span>HTML</span>
                      </a>
                      <Button variant="ghost" size="sm" icon="trash" aria-label={`Xoá ${r.title}`} onClick={() => void handleDeleteReport(r)} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </PageShell>

      {openTaskId && (
        <TaskPanel
          id={openTaskId}
          meta={meta}
          statuses={meta?.statuses || []}
          onOpen={(nextId) => setOpenTaskId(nextId)}
          onClose={() => setOpenTaskId(null)}
          onChanged={reloadAll}
        />
      )}
      {creating && meta && (
        <TaskEditor
          meta={meta}
          projectId={id}
          onClose={() => setCreating(false)}
          onSaved={(tid) => {
            setCreating(false);
            reloadAll();
            setOpenTaskId(tid);
          }}
        />
      )}
      {membersOpen && (
        <ProjectMembers
          id={id}
          onClose={() => setMembersOpen(false)}
          onChanged={reloadAll}
        />
      )}
      {editing && (
        <ProjectEditDialog
          project={service}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reloadAll();
          }}
        />
      )}
      {openReportId && (
        <ReportEditor
          id={openReportId}
          driveFolder=""
          onClose={() => {
            setOpenReportId(null);
            loadReports();
          }}
        />
      )}
    </div>
  );
}
