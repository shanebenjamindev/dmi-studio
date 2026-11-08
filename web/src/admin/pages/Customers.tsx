// Khách hàng in Quản trị: the customers the scope reaches with category, source, status, the staff member in charge and
// needs; archiving; and the category and source lists. Drive folders stay on the Customers page.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { goto, toast } from '../../store';
import { Icon } from '../../components/ui';
import type { ServiceRef } from '../../types';
import { admin, download, type CustomerRow, type CustomerDetail } from '../api';
import { routeParam, setRouteParam } from '../nav';
import { PageHead, Toolbar, Select, Table, Pager, Drawer, Field, Section, Badge, ChangeList, Async, Empty, ErrorState, Loading, DictEditor, useLoad, useListState, useDebounced, useCan, act, fmtDate, fmtNum, type Col } from '../kit';

import {useCustomerStatuses} from '../../components/useCustomerStatuses';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'muted' | undefined> = { lead: undefined, caring: undefined, active: 'ok', paused: 'warn', ended: 'muted' };

export function CustomerList() {
  const statuses=useCustomerStatuses(),STATUS=Object.fromEntries(statuses.map(s=>[s.id,s.name]));
  const can = useCan();
  const [q, setQ] = useState(''), [status, setStatus] = useState(''), [category, setCategory] = useState(''), [source, setSource] = useState(''), [need, setNeed] = useState(''), [archived, setArchived] = useState('0');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const L = useListState('name'), term = useDebounced(q);
  const filter = { q: term, status, category, source, need, archived };
  const load = useLoad(() => admin.customers({ ...filter, sort: L.sort, dir: L.dir, page: L.page, size: 25 }), [JSON.stringify(filter), L.sort, L.dir, L.page]);
  const cats = useLoad(() => admin.customerCategories.list(), []), srcs = useLoad(() => admin.customerSources.list(), []), services = useLoad<ServiceRef[]>(() => api.serviceCatalog(), []);
  const [open, setOpen] = useState<string | null>(() => routeParam('id'));
  useEffect(() => { L.setPage(1); setSelectedIds([]); }, [JSON.stringify(filter)]); // eslint-disable-line react-hooks/exhaustive-deps
  const show = (id: string | null) => { setOpen(id); setRouteParam('id', id); };
  const canDelete = can('customers.delete');
  const rows = load.data?.items || [];
  const allChecked = rows.length > 0 && rows.every((r) => selectedIds.includes(r.id));
  const toggleAll = (checked: boolean) => setSelectedIds(checked ? Array.from(new Set([...selectedIds, ...rows.map((r) => r.id)])) : selectedIds.filter((id) => !rows.some((r) => r.id === id)));
  const toggleOne = (id: string, checked: boolean) => setSelectedIds(checked ? [...selectedIds, id] : selectedIds.filter((x) => x !== id));
  const bulkDelete = () => selectedIds.length && confirm(`Xoá vĩnh viễn ${selectedIds.length} khách hàng đã chọn? Các dự án và công việc liên kết sẽ được giữ lại (gỡ liên kết khách hàng).`)
    && act(() => admin.bulkRemoveCustomers(selectedIds), `Đã xoá ${selectedIds.length} khách hàng`, () => { setSelectedIds([]); load.reload(); });
  const cols: Col<CustomerRow>[] = [
    ...(canDelete ? [{
      key: 'sel', width: '36px', align: 'center' as const,
      label: <input type="checkbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} aria-label="Chọn tất cả" />,
      render: (c: CustomerRow) => <span onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(c.id)} onChange={(e) => toggleOne(c.id, e.target.checked)} aria-label={`Chọn ${c.name}`} /></span>,
    }] : []),
    { key: 'name', label: 'Khách hàng', sort: true, render: (c) => <span className="ax-stack"><b>{c.name}{c.archivedAt && <Badge tone="muted">Lưu trữ</Badge>}</b><small>{[c.contact, c.phone, c.email].filter(Boolean).join(' · ') || 'Chưa có liên hệ'}</small></span> },
    { key: 'status', label: 'Trạng thái', render: (c) => c.status ? <Badge tone={STATUS_TONE[c.status]}>{STATUS[c.status]||c.status}</Badge> : <span className="ax-muted">—</span> },
    { key: 'category', label: 'Phân loại · Nguồn', render: (c) => <span className="ax-badges">{(c.tags?.length ? c.tags : c.category ? [c.category] : []).map((t) => <Badge key={t.id} color={t.color}>{t.name}</Badge>)}{c.source && <Badge color={c.source.color}>{c.source.name}</Badge>}{!c.category && !c.tags?.length && !c.source && <span className="ax-muted">—</span>}</span>, hideSm: true },
    { key: 'needs', label: 'Nhu cầu', render: (c) => c.needs.map((n) => n.name).join(', ') || <span className="ax-muted">—</span>, hideSm: true },
    { key: 'manager', label: 'Phụ trách', render: (c) => c.manager?.name || <span className="ax-muted">Chưa có</span> },
  ];
  return (
    <>
      <PageHead title="Danh sách khách hàng" sub="Khách hàng trong phạm vi của bạn (người tạo, người phụ trách hoặc thành viên nằm trong phạm vi). Thư mục và file Drive quản lý ở trang Khách hàng."
        actions={<>
          {canDelete && selectedIds.length > 0 && <button className="btn btn-sm cm-danger" onClick={bulkDelete}><Icon name="trash" size={14} />Xoá đã chọn ({selectedIds.length})</button>}
          {can('customers.export') && <button className="btn btn-gray btn-sm" onClick={() => act(() => download(`/api/admin/customers/export${admin.q(filter)}`, 'khach-hang.csv'))}><Icon name="download" size={14} />Xuất CSV</button>}
          {can('customers.create') && <button className="btn btn-primary btn-sm" onClick={() => show('new')}><Icon name="plus" size={14} />Thêm khách hàng</button>}</>} />
      <Toolbar search={q} onSearch={setQ} placeholder="Tìm tên, người liên hệ, điện thoại, email…">
        <Select value={status} onChange={setStatus} label="Trạng thái"><option value="">Mọi trạng thái</option><option value="none">Chưa đặt</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <Select value={category} onChange={setCategory} label="Phân loại"><option value="">Mọi phân loại</option><option value="none">Chưa phân loại</option>{(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select value={source} onChange={setSource} label="Nguồn"><option value="">Mọi nguồn</option><option value="none">Chưa rõ nguồn</option>{(srcs.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        {!!services.data?.length && <Select value={need} onChange={setNeed} label="Nhu cầu"><option value="">Mọi nhu cầu</option><option value="none">Chưa có nhu cầu</option>{services.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
        <Select value={archived} onChange={setArchived} label="Lưu trữ"><option value="0">Đang hoạt động</option><option value="1">Đã lưu trữ</option><option value="all">Tất cả</option></Select>
      </Toolbar>
      <div className="ax-card flush"><Async load={load}>{(d) => <>
        <Table cols={cols} rows={d.items} sort={L.sort} dir={L.dir} onSort={L.onSort} onRow={(c) => show(c.id)} selected={open} empty={<Empty icon="card" title="Không có khách hàng phù hợp" text="Đổi bộ lọc hoặc từ khoá." />} />
        <Pager page={d.page} size={d.size} total={d.total} onPage={L.setPage} />
      </>}</Async></div>
      {open === 'new' ? <CustomerForm onClose={() => show(null)} onSaved={(id) => { show(id); load.reload(); }} />
        : open && <CustomerDrawer id={open} onClose={() => show(null)} onChanged={load.reload} />}
    </>
  );
}

function CustomerDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const statuses=useCustomerStatuses(),STATUS=Object.fromEntries(statuses.map(s=>[s.id,s.name]));
  const can = useCan();
  const load = useLoad(() => admin.customer(id), [id]);
  const [tab, setTab] = useState<'info' | 'history'>('info'), [editing, setEditing] = useState(false);
  const c = load.data, reload = () => { load.reload(); onChanged(); };
  if (editing && c) return <CustomerForm customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />;
  const archive = () => c && confirm(c.archivedAt ? `Khôi phục “${c.name}”?` : `Lưu trữ “${c.name}”? Khách hàng không còn hiện trong danh sách ở trang Khách hàng; dự án, công việc và Drive giữ nguyên. Khôi phục được bất cứ lúc nào.`)
    && act(() => admin.archiveCustomer(c.id, !c.archivedAt), c.archivedAt ? 'Đã khôi phục' : 'Đã lưu trữ', reload);
  const remove = () => c && confirm(`Xoá vĩnh viễn khách hàng “${c.name}”?`) && act(() => admin.removeCustomer(c.id), 'Đã xoá khách hàng', () => { onClose(); onChanged(); });
  return (
    <Drawer open wide title={c?.name || 'Khách hàng'} sub={c?.contact} onClose={onClose} footer={c && <>
      {can('customers.delete') && <button className="btn btn-sm cm-danger" onClick={remove}><Icon name="trash" size={14} />Xoá</button>}
      {c.canArchive && <button className="btn btn-gray btn-sm" onClick={archive}><Icon name="archive" size={14} />{c.archivedAt ? 'Khôi phục' : 'Lưu trữ'}</button>}
      <button className="btn btn-gray btn-sm" onClick={() => { location.hash = `#customers/${c.id}`; goto('customers'); }}><Icon name="arrow" size={14} />Mở trang khách hàng</button>
      {c.canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing(true)}><Icon name="edit" size={14} />Sửa</button>}
    </>}>
      {load.error ? <ErrorState error={load.error} onRetry={load.reload} /> : !c ? <Loading /> : <>
        <div className="ax-tabs" role="tablist">{([['info', 'Thông tin'], ['history', 'Lịch sử']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
        {tab === 'info' && <dl className="ax-facts">
          <dt>Trạng thái</dt><dd>{c.status ? STATUS[c.status]||c.status : '—'}{c.archivedAt && <Badge tone="muted">Lưu trữ từ {fmtDate(c.archivedAt)}</Badge>}</dd>
          <dt>Phân loại</dt><dd>{c.category?.name || '—'}</dd><dt>Nguồn</dt><dd>{c.source?.name || '—'}</dd>
          <dt>Nhu cầu</dt><dd>{c.needs.map((n) => n.name).join(', ') || '—'}</dd>
          <dt>Người liên hệ</dt><dd>{c.contact || '—'}</dd><dt>Điện thoại</dt><dd>{c.phone || '—'}</dd><dt>Email</dt><dd>{c.email || '—'}</dd>
          <dt>Phụ trách</dt><dd>{c.manager?.name || '—'}</dd><dt>Người tạo</dt><dd>{c.owner?.name || '—'}</dd>
          <dt>Thành viên</dt><dd>{c.members.map((m) => m.name).join(', ') || '—'}</dd>
          <dt>Dự án · Công việc</dt><dd>{fmtNum(c.projects)} · {fmtNum(c.tasks)}</dd><dt>Drive</dt><dd>{c.hasDrive ? 'Đã liên kết' : 'Chưa liên kết'}</dd>
          <dt>Khác</dt><dd className="ax-pre">{c.notes || '—'}</dd><dt>Ngày tạo</dt><dd>{fmtDate(c.createdAt)}</dd>
        </dl>}
        {tab === 'history' && <ChangeList changes={c.history} />}
      </>}
    </Drawer>
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function CustomerForm({ customer, onClose, onSaved }: { customer?: CustomerDetail; onClose: () => void; onSaved: (id: string) => void }) {
  const statuses=useCustomerStatuses(),STATUS=Object.fromEntries(statuses.filter(s=>s.active||s.id===customer?.status).map(s=>[s.id,s.name]));
  const cats = useLoad(() => admin.customerCategories.list(), []), srcs = useLoad(() => admin.customerSources.list(), []), people = useLoad(() => admin.staff({ size: 200, status: 'active' }).catch(() => null), []);
  const [f, setF] = useState({ name: customer?.name || '', contact: customer?.contact || '', phone: customer?.phone || '', email: customer?.email || '', notes: customer?.notes || '', status: customer?.status || '', categoryId: customer?.category?.id || '', sourceId: customer?.source?.id || '', managerId: customer?.manager?.id || '' });
  const [errors, setErrors] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const x: Record<string, string> = {};
    if (!f.name.trim()) x.name = 'Hãy nhập tên khách hàng';
    if (f.email.trim() && !EMAIL.test(f.email.trim())) x.email = 'Email không hợp lệ';
    if (f.phone.trim() && !/^[+0-9 ().\-/]{6,60}$/.test(f.phone.trim())) x.phone = 'Số điện thoại không hợp lệ';
    setErrors(x); if (Object.keys(x).length) return;
    setBusy(true); setError('');
    try { const r = await admin.saveCustomer(customer?.id || null, { ...f, status: f.status || null, categoryId: f.categoryId || null, sourceId: f.sourceId || null, managerId: f.managerId || null }); toast(customer ? 'Đã lưu khách hàng' : 'Đã thêm khách hàng'); onSaved(r.id); }
    catch (x: any) { setError(x.message); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setErrors({ ...errors, [k]: '' }); };
  return (
    <Drawer open title={customer ? `Sửa · ${customer.name}` : 'Thêm khách hàng'} onClose={onClose} footer={<><button className="btn btn-gray btn-sm" onClick={onClose}>Huỷ</button><button className="btn btn-primary btn-sm" form="ax-customer-form" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button></>}>
      <form id="ax-customer-form" className="ax-form" onSubmit={save} noValidate>
        {error && <p className="note err" role="alert">{error}</p>}
        <Field label="Tên khách hàng *" error={errors.name}><input className="bk-in" value={f.name} maxLength={200} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="Người liên hệ"><input className="bk-in" value={f.contact} maxLength={200} onChange={(e) => set('contact', e.target.value)} /></Field>
        <div className="ax-form-grid"><Field label="Điện thoại" error={errors.phone}><input className="bk-in" type="tel" value={f.phone} maxLength={60} onChange={(e) => set('phone', e.target.value)} /></Field><Field label="Email" error={errors.email}><input className="bk-in" type="email" value={f.email} maxLength={320} onChange={(e) => set('email', e.target.value)} /></Field></div>
        <div className="ax-form-grid">
          <Field label="Trạng thái"><select className="bk-in" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Chưa đặt</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Phụ trách" hint="Người phụ trách được quản lý khách hàng này."><select className="bk-in" value={f.managerId} onChange={(e) => set('managerId', e.target.value)}><option value="">Chưa có</option>{(people.data?.items || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        </div>
        <div className="ax-form-grid">
          <Field label="Phân loại"><select className="bk-in" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}><option value="">Chưa phân loại</option>{(cats.data || []).filter((c) => c.active || c.id === f.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Nguồn"><select className="bk-in" value={f.sourceId} onChange={(e) => set('sourceId', e.target.value)}><option value="">Chưa rõ</option>{(srcs.data || []).filter((c) => c.active || c.id === f.sourceId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        </div>
        <Field label="Khác"><textarea className="bk-in" rows={4} maxLength={20000} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Ghi chú, thông tin thêm" /></Field>
        <p className="note">Nhu cầu và thư mục Drive sửa ở form khách hàng trên trang Khách hàng.</p>
      </form>
    </Drawer>
  );
}

export const Categories = () => { const can = useCan(); return <><PageHead title="Phân loại khách hàng" sub="Nhóm khách hàng theo loại (vd. Doanh nghiệp, Cá nhân, Đại lý). Loại đang được dùng chỉ tắt được, không xoá được." /><DictEditor api={admin.customerCategories} noun="phân loại" canEdit={can('customers.manage')} usedLabel="Khách hàng" /></>; };
export const Sources = () => { const can = useCan(); return <><PageHead title="Nguồn khách hàng" sub="Khách hàng đến từ đâu (vd. Facebook Ads, Giới thiệu, Website)." /><DictEditor api={admin.customerSources} noun="nguồn" canEdit={can('customers.manage')} usedLabel="Khách hàng" /></>; };

export const Statuses = () => { const can=useCan(); return <><PageHead title="Trạng thái khách hàng" sub="Tuỳ chỉnh tên, màu và thứ tự các chặng trên thanh trạng thái và Kanban. Tắt để ngừng chọn mới; khách hàng cũ vẫn giữ trạng thái. Trạng thái đang được dùng không thể xoá."/><DictEditor api={admin.customerStatuses} noun="trạng thái" canEdit={can('customers.manage')} usedLabel="Khách hàng"/></>; };
