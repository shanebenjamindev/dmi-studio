// Nhật ký hệ thống, read only: one page per kind of entry, filtered by person, time and words; each change shows what it
// was before and after. Nobody can edit or delete entries (there is no such API).
import { useEffect, useState } from 'react';
import { Icon } from '../../components/ui';
import { admin, download, type LogEntry } from '../api';
import { PageHead, Toolbar, Select, Table, Pager, Drawer, Badge, Diff, Async, Empty, useLoad, useDebounced, useCan, act, fmtTime, fmtDate, dayStart, type Col } from '../kit';
import { device } from './Staff';
import { DayRangeField } from '../../components/DateRange';

type Kind = 'login' | 'action' | 'data' | 'permission' | 'error';
const ENTITY: Record<string, string> = { task: 'Công việc', customer: 'Khách hàng', user: 'Nhân viên', card: 'Thẻ', board: 'Board', department: 'Phòng ban', position: 'Chức vụ', team: 'Nhóm', role: 'Vai trò', service: 'Dịch vụ', service_package: 'Gói dịch vụ', notification: 'Thông báo', settings: 'Cấu hình', backup: 'Sao lưu', task_status: 'Trạng thái', task_label: 'Danh mục', task_priority: 'Mức ưu tiên', task_template: 'Mẫu công việc', customer_category: 'Phân loại KH', customer_source: 'Nguồn KH', service_category: 'Danh mục DV', notification_template: 'Mẫu thông báo', log: 'Nhật ký', stats: 'Thống kê' };
const ABOUT: Record<Kind, [string, string]> = {
  login: ['Lịch sử đăng nhập', 'Mọi lần đăng nhập, thành công hay thất bại, với địa chỉ IP và trình duyệt.'],
  action: ['Lịch sử thao tác', 'Mọi thay đổi người dùng làm qua hệ thống (thêm, sửa, xoá, gửi, xuất…), kể cả thao tác bị từ chối vì thiếu quyền.'],
  data: ['Lịch sử thay đổi dữ liệu', 'Từng trường đã đổi của công việc, khách hàng, nhân viên, thẻ, board…: giá trị trước và sau. Mật khẩu, mô tả, kết quả và ghi chú chỉ ghi là “đã đổi”.'],
  permission: ['Lịch sử phân quyền', 'Cấp, đổi, thu hồi vai trò và sửa quyền của vai trò.'],
  error: ['Nhật ký lỗi hệ thống', 'Lỗi phía máy chủ (đã lược bỏ email, token và dữ liệu nhạy cảm).'],
};

function LogPage({ kind, title, sub }: { kind: Kind; title?: string; sub?: string }) {
  const can = useCan();
  const [q, setQ] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [result, setResult] = useState(''), [entity, setEntity] = useState(''), [page, setPage] = useState(1);
  const term = useDebounced(q), toTime = dayStart(to);
  const filter = { kind, q: term, from: dayStart(from), to: toTime ? toTime + 86400e3 : null, result, entity };
  const load = useLoad(() => admin.logs({ ...filter, page, size: 30 }), [JSON.stringify(filter), page]);
  const [open, setOpen] = useState<LogEntry | null>(null);
  useEffect(() => setPage(1), [JSON.stringify(filter)]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols: Col<LogEntry>[] = kind === 'login' ? [
    { key: 'at', label: 'Thời gian', render: (l) => fmtTime(l.at) },
    { key: 'who', label: 'Tài khoản', render: (l) => <span className="ax-stack"><b>{l.userName || l.email}</b>{l.userName && <small>{l.email}</small>}</span> },
    { key: 'ok', label: 'Kết quả', render: (l) => l.ok ? <Badge tone="ok">Thành công</Badge> : <Badge tone="bad">{l.reason || 'Thất bại'}</Badge> },
    { key: 'method', label: 'Cách', render: (l) => (l.method === 'google' ? 'Google' : l.method === 'setup' ? 'Tạo tài khoản' : 'Mật khẩu'), hideSm: true },
    { key: 'ip', label: 'IP · Thiết bị', render: (l) => <span className="ax-stack"><span className="mono">{l.ip || '—'}</span><small>{device(l.agent)}</small></span>, hideSm: true },
  ] : [
    { key: 'at', label: 'Thời gian', render: (l) => fmtTime(l.at) },
    { key: 'who', label: 'Người thực hiện', render: (l) => l.userName || <span className="ax-muted">Hệ thống</span> },
    { key: 'action', label: kind === 'error' ? 'Lỗi' : 'Hành động', render: (l) => <span className="ax-stack"><b>{l.action}</b>{kind === 'error' && <small>{l.after?.message}</small>}</span> },
    { key: 'entity', label: 'Đối tượng', render: (l) => l.entityLabel || l.entityType ? <span className="ax-stack">{l.entityLabel && <span>{l.entityLabel}</span>}{l.entityType && <small>{ENTITY[l.entityType] || l.entityType}</small>}</span> : kind === 'error' ? <small className="mono">{l.method} {l.path}</small> : '—' },
    { key: 'status', label: 'Kết quả', render: (l) => l.status && l.status >= 400 ? <Badge tone="bad">{l.status}</Badge> : <Badge tone="ok">OK</Badge>, hideSm: true },
  ];
  const [t, s] = ABOUT[kind];
  return (
    <>
      <PageHead title={title || t} sub={sub || s} actions={can('logs.export') && <button className="btn btn-gray btn-sm" onClick={() => act(() => download(`/api/admin/logs/export${admin.q(filter)}`, `nhat-ky-${kind}.csv`))}><Icon name="download" size={14} />Xuất CSV</button>} />
      <Toolbar search={q} onSearch={setQ} placeholder={kind === 'login' ? 'Tìm email, IP, lý do…' : 'Tìm hành động, đối tượng, người…'}>
        <DayRangeField from={from} to={to} placeholder="Mọi ngày" onChange={(f, t) => { setFrom(f); setTo(t); }} />
        {kind === 'login' && <Select value={result} onChange={setResult} label="Kết quả"><option value="">Mọi kết quả</option><option value="ok">Thành công</option><option value="fail">Thất bại</option></Select>}
        {(kind === 'data' || kind === 'action') && <Select value={entity} onChange={setEntity} label="Đối tượng"><option value="">Mọi đối tượng</option>{['task', 'customer', 'user', 'card', 'board', 'department', 'team', 'service', 'notification', 'settings'].map((k) => <option key={k} value={k}>{ENTITY[k]}</option>)}</Select>}
      </Toolbar>
      <div className="ax-card flush"><Async load={load}>{(d) => <>
        {d.since && <p className="ax-card-note">Nhật ký được ghi từ {fmtDate(d.since)}.</p>}
        <Table cols={cols} rows={d.items} onRow={kind === 'login' ? undefined : setOpen} empty={<Empty icon="lines" title="Chưa có mục nào" text="Đổi bộ lọc hoặc khoảng thời gian." />} />
        <Pager page={d.page} size={d.size} total={d.total} onPage={setPage} />
      </>}</Async></div>
      {open && <Drawer open title={open.action || 'Mục nhật ký'} sub={fmtTime(open.at)} onClose={() => setOpen(null)}>
        <dl className="ax-facts">
          <dt>Người thực hiện</dt><dd>{open.userName || 'Hệ thống'}</dd>
          <dt>Đối tượng</dt><dd>{open.entityLabel || '—'}{open.entityType ? ` (${ENTITY[open.entityType] || open.entityType})` : ''}</dd>
          <dt>Yêu cầu</dt><dd className="mono">{open.method} {open.path}</dd><dt>Kết quả</dt><dd>{open.status ?? '—'}</dd>
          <dt>IP</dt><dd className="mono">{open.ip || '—'}</dd><dt>Thiết bị</dt><dd>{device(open.agent)}</dd>
        </dl>
        {(open.before || open.after) && <><h3 className="ax-sub">Trước → sau</h3><Diff before={open.before} after={open.after} /></>}
      </Drawer>}
    </>
  );
}
export const Logins = () => <LogPage kind="login" />;
export const Actions = () => <LogPage kind="action" />;
export const DataChanges = () => <LogPage kind="data" />;
export const PermissionChanges = () => <LogPage kind="permission" />;
export const Errors = () => <LogPage kind="error" />;
export const StaffActivity = () => <LogPage kind="action" title="Lịch sử hoạt động" sub="Thao tác của nhân viên trong phạm vi của bạn. Bấm một dòng để xem chi tiết." />;
