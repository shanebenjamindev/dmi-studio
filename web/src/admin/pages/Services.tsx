// Dịch vụ: the catalogue of services (what each project is for is chosen from it), their categories, and packages.
import { useEffect, useState } from 'react';
import { toast } from '../../store';
import { Icon } from '../../components/ui';
import { admin, type Service, type Package } from '../api';
import { PageHead, Toolbar, Select, Table, Pager, Drawer, Field, Badge, Async, Empty, DictEditor, useLoad, useListState, useDebounced, useCan, act, fmtMoney, fmtTime, type Col } from '../kit';
import { askConfirm } from '../../components/AskDialog';

const STATUS: Record<string, [string, 'ok' | 'muted' | 'warn']> = { active: ['Đang cung cấp', 'ok'], draft: ['Nháp', 'warn'], inactive: ['Ngừng cung cấp', 'muted'] };
const by = (who: string | null, at: number) => `${who || '—'} · ${fmtTime(at)}`;

export function ServiceList() {
  const can = useCan();
  const [q, setQ] = useState(''), [category, setCategory] = useState(''), [status, setStatus] = useState('');
  const L = useListState('name'), term = useDebounced(q);
  const filter = { q: term, category, status };
  const load = useLoad(() => admin.services({ ...filter, sort: L.sort, dir: L.dir, page: L.page, size: 25 }), [JSON.stringify(filter), L.sort, L.dir, L.page]);
  const cats = useLoad(() => admin.serviceCategories.list(), []);
  const [edit, setEdit] = useState<Service | 'new' | null>(null);
  useEffect(() => { L.setPage(1); }, [JSON.stringify(filter)]); // eslint-disable-line react-hooks/exhaustive-deps
  const cols: Col<Service>[] = [
    { key: 'name', label: 'Dịch vụ', sort: true, render: (s) => <span className="ax-person">{s.image ? <img className="ax-thumb" src={s.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="ax-thumb"><Icon name="tag" size={16} /></span>}<span><b>{s.name}</b><small>{s.code || 'Chưa có mã'}{s.unit ? ` · ${s.unit}` : ''}</small></span></span> },
    { key: 'category', label: 'Danh mục', render: (s) => s.category ? <Badge color={s.category.color}>{s.category.name}</Badge> : <span className="ax-muted">—</span>, hideSm: true },
    { key: 'price', label: 'Giá', sort: true, align: 'right', render: (s) => fmtMoney(s.price, s.currency) },
    { key: 'status', label: 'Trạng thái', render: (s) => <Badge tone={STATUS[s.status]?.[1]}>{STATUS[s.status]?.[0] || s.status}</Badge> },
    { key: 'updatedAt', label: 'Cập nhật', sort: true, render: (s) => <small>{by(s.updatedBy, s.updatedAt)}</small>, hideSm: true },
  ];
  return (
    <>
      <PageHead title="Danh sách dịch vụ" sub="Dịch vụ công ty cung cấp. Mỗi dịch vụ của khách hàng chọn từ danh sách này."
        actions={can('services.create') && <button className="btn btn-primary btn-sm" onClick={() => setEdit('new')}><Icon name="plus" size={14} />Thêm dịch vụ</button>} />
      <Toolbar search={q} onSearch={setQ} placeholder="Tìm tên, mã, mô tả…">
        <Select value={category} onChange={setCategory} label="Danh mục"><option value="">Mọi danh mục</option><option value="none">Chưa có danh mục</option>{(cats.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select value={status} onChange={setStatus} label="Trạng thái"><option value="">Mọi trạng thái</option>{Object.entries(STATUS).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}</Select>
      </Toolbar>
      <div className="ax-card flush"><Async load={load}>{(d) => <>
        <Table cols={cols} rows={d.items} sort={L.sort} dir={L.dir} onSort={L.onSort} onRow={(s) => setEdit(s)} empty={<Empty icon="tag" title={term || category || status ? 'Không có dịch vụ phù hợp' : 'Chưa có dịch vụ'} text={can('services.create') ? 'Thêm dịch vụ đầu tiên để chọn làm nhu cầu của khách hàng.' : undefined} />} />
        <Pager page={d.page} size={d.size} total={d.total} onPage={L.setPage} />
      </>}</Async></div>
      {edit && <ServiceForm service={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load.reload(); }} />}
    </>
  );
}
function ServiceForm({ service, onClose, onSaved }: { service: Service | null; onClose: () => void; onSaved: () => void }) {
  const can = useCan(), editable = service ? can('services.update') : can('services.create');
  const cats = useLoad(() => admin.serviceCategories.list(), []);
  const [f, setF] = useState({ name: service?.name || '', code: service?.code || '', categoryId: service?.category?.id || '', about: service?.about || '', image: service?.image || '', price: service?.price ?? '' as number | '', currency: service?.currency || 'VND', unit: service?.unit || '', status: service?.status || 'active' });
  const [errors, setErrors] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async () => {
    const x: Record<string, string> = {};
    if (!f.name.trim()) x.name = 'Hãy nhập tên dịch vụ';
    if (f.image && !/^https:\/\/\S+$/.test(f.image)) x.image = 'Link ảnh phải bắt đầu bằng https://';
    if (f.price !== '' && (Number(f.price) < 0 || !Number.isFinite(Number(f.price)))) x.price = 'Giá phải là số không âm';
    setErrors(x); if (Object.keys(x).length) return;
    setBusy(true); setError('');
    try { await admin.saveService(service?.id || null, { ...f, categoryId: f.categoryId || null, price: f.price === '' ? null : Number(f.price) }); toast(service ? 'Đã lưu dịch vụ' : 'Đã thêm dịch vụ'); onSaved(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const remove = async () => service && await askConfirm(`Xoá dịch vụ “${service.name}”?${service.packages ? ` Dịch vụ đang nằm trong ${service.packages} gói.` : ''}`) && act(() => admin.removeService(service.id), 'Đã xoá dịch vụ', onSaved);
  return (
    <Drawer open title={service ? service.name : 'Thêm dịch vụ'} sub={service ? `Tạo: ${by(service.createdBy, service.createdAt)} · Sửa: ${by(service.updatedBy, service.updatedAt)}` : undefined} onClose={onClose} footer={<>
      {service && can('services.delete') && <button className="btn btn-gray btn-sm" onClick={remove}><Icon name="trash" size={14} />Xoá</button>}
      <button className="btn btn-gray btn-sm" onClick={onClose}>Đóng</button>{editable && <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</button>}
    </>}>
      <fieldset className="ax-form" disabled={!editable}>
        {error && <p className="note err" role="alert">{error}</p>}
        <Field label="Tên dịch vụ *" error={errors.name}><input className="bk-in" value={f.name} maxLength={200} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="ax-form-grid">
          <Field label="Mã dịch vụ"><input className="bk-in" value={f.code} maxLength={40} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          <Field label="Danh mục"><select className="bk-in" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Chưa có</option>{(cats.data || []).filter((c) => c.active || c.id === f.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        </div>
        <div className="ax-form-grid three">
          <Field label="Giá" error={errors.price}><input className="bk-in" type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
          <Field label="Tiền tệ"><select className="bk-in" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option>VND</option><option>USD</option></select></Field>
          <Field label="Đơn vị"><input className="bk-in" value={f.unit} maxLength={40} placeholder="xe, gói, tháng…" onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        </div>
        <Field label="Trạng thái"><select className="bk-in" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(STATUS).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Link ảnh" error={errors.image} hint="Dán link ảnh https (vd. ảnh trên website); hệ thống không lưu file ảnh."><input className="bk-in" type="url" value={f.image} onChange={(e) => setF({ ...f, image: e.target.value })} /></Field>
        {f.image && /^https:\/\//.test(f.image) && <img className="ax-preview" src={f.image} alt="" referrerPolicy="no-referrer" />}
        <Field label="Mô tả"><textarea className="bk-in" rows={4} maxLength={5000} value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} /></Field>
      </fieldset>
    </Drawer>
  );
}
export const Categories = () => { const can = useCan(); return <><PageHead title="Danh mục dịch vụ" sub="Nhóm dịch vụ (vd. Chăm sóc xe, Quảng cáo, Sản xuất video)." /><DictEditor api={admin.serviceCategories} noun="danh mục" canEdit={can('services.update')} usedLabel="Dịch vụ" /></>; };

export function Packages() {
  const can = useCan();
  const load = useLoad(() => admin.packages(), []);
  const [edit, setEdit] = useState<Package | 'new' | null>(null);
  return (
    <>
      <PageHead title="Gói dịch vụ" sub="Gói gồm nhiều dịch vụ với số lượng và một giá chung."
        actions={can('services.create') && <button className="btn btn-primary btn-sm" onClick={() => setEdit('new')}><Icon name="plus" size={14} />Thêm gói</button>} />
      <Async load={load} empty={<Empty icon="layers" title="Chưa có gói dịch vụ" />}>{(rows) => (
        <div className="ax-role-grid">{rows.map((p) => (
          <button key={p.id} className="ax-role" onClick={() => setEdit(p)}>
            <header><b>{p.name}</b><Badge tone={STATUS[p.status]?.[1]}>{STATUS[p.status]?.[0]}</Badge></header>
            <p>{p.items.map((i) => `${i.name}${i.qty > 1 ? ` × ${i.qty}` : ''}${i.removed ? ' (đã xoá)' : ''}`).join(', ') || 'Chưa có dịch vụ'}</p>
            <footer><span>{fmtMoney(p.price, p.currency)}</span>{p.term && <span>{p.term}</span>}</footer>
          </button>
        ))}</div>
      )}</Async>
      {edit && <PackageForm pkg={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load.reload(); }} />}
    </>
  );
}
function PackageForm({ pkg, onClose, onSaved }: { pkg: Package | null; onClose: () => void; onSaved: () => void }) {
  const can = useCan(), editable = pkg ? can('services.update') : can('services.create');
  const services = useLoad(() => admin.services({ size: 200 }), []);
  const [f, setF] = useState({ name: pkg?.name || '', about: pkg?.about || '', price: pkg?.price ?? '' as number | '', currency: pkg?.currency || 'VND', term: pkg?.term || '', status: pkg?.status || 'active' });
  const [items, setItems] = useState<Record<string, number>>(() => Object.fromEntries((pkg?.items || []).filter((i) => !i.removed).map((i) => [i.serviceId, i.qty])));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const list = services.data?.items || [];
  const sum = list.filter((s) => items[s.id] && s.price !== null && s.currency === f.currency).reduce((a, s) => a + (s.price || 0) * items[s.id], 0);
  const save = async () => {
    if (!f.name.trim()) return setError('Hãy nhập tên gói');
    setBusy(true); setError('');
    try { await admin.savePackage(pkg?.id || null, { ...f, price: f.price === '' ? null : Number(f.price), items: Object.entries(items).map(([serviceId, qty]) => ({ serviceId, qty })) }); toast(pkg ? 'Đã lưu gói' : 'Đã thêm gói'); onSaved(); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Drawer open title={pkg ? pkg.name : 'Thêm gói dịch vụ'} sub={pkg ? `Sửa: ${by(pkg.updatedBy, pkg.updatedAt)}` : undefined} onClose={onClose} footer={<>
      {pkg && can('services.delete') && <button className="btn btn-gray btn-sm" onClick={async () => await askConfirm(`Xoá gói “${pkg.name}”?`) && act(() => admin.removePackage(pkg.id), 'Đã xoá gói', onSaved)}><Icon name="trash" size={14} />Xoá</button>}
      <button className="btn btn-gray btn-sm" onClick={onClose}>Đóng</button>{editable && <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</button>}
    </>}>
      <fieldset className="ax-form" disabled={!editable}>
        {error && <p className="note err" role="alert">{error}</p>}
        <Field label="Tên gói *"><input className="bk-in" value={f.name} maxLength={200} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="ax-form-grid three">
          <Field label="Giá gói" hint={sum ? `Tổng giá lẻ: ${fmtMoney(sum, f.currency)}` : undefined}><input className="bk-in" type="number" min={0} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value === '' ? '' : Number(e.target.value) })} /></Field>
          <Field label="Tiền tệ"><select className="bk-in" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option>VND</option><option>USD</option></select></Field>
          <Field label="Thời hạn"><input className="bk-in" value={f.term} maxLength={60} placeholder="3 tháng, 1 năm…" onChange={(e) => setF({ ...f, term: e.target.value })} /></Field>
        </div>
        <Field label="Trạng thái"><select className="bk-in" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(STATUS).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Mô tả"><textarea className="bk-in" rows={3} maxLength={5000} value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} /></Field>
        <Field label={`Dịch vụ trong gói (${Object.keys(items).length})`}>
          {list.length ? <ul className="ax-pick">{list.map((s) => {
            const on = s.id in items;
            return <li key={s.id} className={on ? 'on' : ''}><label><input type="checkbox" checked={on} onChange={(e) => { const next = { ...items }; if (e.target.checked) next[s.id] = 1; else delete next[s.id]; setItems(next); }} /><span>{s.name}</span><small>{fmtMoney(s.price, s.currency)}</small></label>
              {on && <input className="bk-in ax-qty" type="number" min={1} max={1000} value={items[s.id]} onChange={(e) => setItems({ ...items, [s.id]: Math.max(1, Number(e.target.value) || 1) })} aria-label={`Số lượng ${s.name}`} />}</li>;
          })}</ul> : <p className="note">Chưa có dịch vụ nào. Thêm dịch vụ ở Danh sách dịch vụ trước.</p>}
        </Field>
      </fieldset>
    </Drawer>
  );
}
