// Chỉnh sửa dịch vụ: its name, the customer it is for, its services and whether its managers put it on hold. Only what was
// changed is sent, so a manager of the project need not also manage its customer to fix a name.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { toast } from '../store';
import { Icon } from './ui';
import { ServicePicker } from './ServicePicker';
import type { Brand, TaskMeta } from '../types';

type ProjectRow = TaskMeta['projects'][number];

export function ProjectEditDialog({ project, onClose, onSaved }: { project: ProjectRow; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(project.name);
  const [customer, setCustomer] = useState(project.customerId || '');
  const [brandId, setBrandId] = useState(project.brandId || '');
  const [brands, setBrands] = useState<Brand[]>([]);
  const [services, setServices] = useState((project.services || []).map((s) => s.id));
  const [hold, setHold] = useState(project.hold || '');
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>(project.customerId ? [{ id: project.customerId, name: project.customerName || '' }] : []);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    api.customersAll().then((list) => setCustomers((had) => [...list, ...had.filter((c) => !list.some((x) => x.id === c.id))]), () => {});
  }, []);
  useEffect(() => {
    if (!customer) { setBrands([]); setBrandId(''); return; }
    let active = true;
    api.customerBrands(customer).then((list) => {
      if (!active) return;
      setBrands(list);
      setBrandId((prev) => (prev && list.some((b) => b.id === prev) ? prev : list[0]?.id || ''));
    }, () => {});
    return () => { active = false; };
  }, [customer]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    const was = (project.services || []).map((s) => s.id);
    const catalogChanged = services.length !== was.length || services.some((id) => !was.includes(id));
    const brandChanged = brandId !== (project.brandId || '');
    const holdChanged = hold !== (project.hold || '');
    const custChanged = customer !== (project.customerId || '');
    if (!catalogChanged && !brandChanged && !holdChanged && !custChanged) { onClose(); return; }
    setBusy(true); setError('');
    try {
      if (brandId) {
        await api.updateBrandService(project.id, {
          brandId,
          ...(catalogChanged && services[0] ? { catalogServiceId: services[0] } : {}),
          ...(holdChanged ? { hold: (hold || null) as 'paused' | 'cancelled' | null } : {}),
        });
      } else {
        await api.updateTaskProject(project.id, {
          ...(custChanged ? { customerId: customer || null } : {}),
          ...(catalogChanged ? { services } : {}),
          ...(holdChanged ? { hold: (hold || null) as 'paused' | 'cancelled' | null } : {}),
        });
      }
      toast('Đã lưu dịch vụ'); onSaved();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return createPortal(
    <dialog ref={dialog} className="qc-dialog" aria-label="Chỉnh sửa dịch vụ" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form onSubmit={save}>
        <header><h2>Chỉnh sửa dịch vụ</h2><button type="button" className="bd-icon" disabled={busy} onClick={onClose} aria-label="Đóng"><Icon name="x" size={16} /></button></header>
        <fieldset disabled={busy}>
          <label>Khách hàng<select className="bk-in" value={customer} onChange={(e) => setCustomer(e.target.value)}><option value="">Dịch vụ nội bộ (không gắn khách hàng)</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          {customer && brands.length > 0 && (
            <label>Nhãn hàng<select className="bk-in" value={brandId} onChange={(e) => setBrandId(e.target.value)}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          )}
          <div className="qc-field"><span>Danh mục dịch vụ</span><ServicePicker single value={services} onChange={setServices} known={project.services} /></div>
          <label>Trạng thái dịch vụ<select className="bk-in" value={hold} onChange={(e) => setHold(e.target.value)}><option value="">Theo tiến độ công việc</option><option value="paused">Tạm dừng</option><option value="cancelled">Đã huỷ</option></select></label>
        </fieldset>
        {error && <p className="note err" role="alert">{error}</p>}
        <footer><button type="button" className="btn btn-gray" disabled={busy} onClick={onClose}>Đóng</button><button className="btn btn-primary" disabled={busy || services.length !== 1}>{busy ? 'Đang lưu…' : 'Lưu'}</button></footer>
      </form>
    </dialog>,
    document.body,
  );
}
