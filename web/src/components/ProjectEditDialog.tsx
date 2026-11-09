// Chỉnh sửa dự án: its name, the customer it is for, its services and whether its managers put it on hold. Only what was
// changed is sent, so a manager of the project need not also manage its customer to fix a name.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { toast } from '../store';
import { Icon } from './ui';
import { ServicePicker } from './ServicePicker';
import type { TaskMeta } from '../types';

type ProjectRow = TaskMeta['projects'][number];

export function ProjectEditDialog({ project, onClose, onSaved }: { project: ProjectRow; onClose: () => void; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(project.name);
  const [customer, setCustomer] = useState(project.customerId || '');
  const [services, setServices] = useState((project.services || []).map((s) => s.id));
  const [hold, setHold] = useState(project.hold || '');
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>(project.customerId ? [{ id: project.customerId, name: project.customerName || '' }] : []);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    api.customersAll().then((list) => setCustomers((had) => [...list, ...had.filter((c) => !list.some((x) => x.id === c.id))]), () => {});
  }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    const was = (project.services || []).map((s) => s.id);
    const change = {
      ...(name.trim() !== project.name ? { name: name.trim() } : {}),
      ...(customer !== (project.customerId || '') ? { customerId: customer || null } : {}),
      ...(services.length !== was.length || services.some((id) => !was.includes(id)) ? { services } : {}),
      ...(hold !== (project.hold || '') ? { hold: (hold || null) as 'paused' | 'cancelled' | null } : {}),
    };
    if (!Object.keys(change).length) { onClose(); return; }
    setBusy(true); setError('');
    try { await api.updateTaskProject(project.id, change); toast('Đã lưu dự án'); onSaved(); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  return createPortal(
    <dialog ref={dialog} className="qc-dialog" aria-label="Chỉnh sửa dự án" onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }} onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form onSubmit={save}>
        <header><h2>Chỉnh sửa dự án</h2><button type="button" className="bd-icon" disabled={busy} onClick={onClose} aria-label="Đóng"><Icon name="x" size={16} /></button></header>
        <fieldset disabled={busy}>
          <label>Tên dự án<input className="bk-in" autoFocus required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Khách hàng<select className="bk-in" value={customer} onChange={(e) => setCustomer(e.target.value)}><option value="">Dự án nội bộ (không gắn khách hàng)</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <div className="qc-field"><span>Dịch vụ</span><ServicePicker value={services} onChange={setServices} known={project.services} /></div>
          <label>Trạng thái dự án<select className="bk-in" value={hold} onChange={(e) => setHold(e.target.value)}><option value="">Theo tiến độ công việc</option><option value="paused">Tạm dừng</option><option value="cancelled">Đã huỷ</option></select></label>
        </fieldset>
        {error && <p className="note err" role="alert">{error}</p>}
        <footer><button type="button" className="btn btn-gray" disabled={busy} onClick={onClose}>Đóng</button><button className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Đang lưu…' : 'Lưu'}</button></footer>
      </form>
    </dialog>,
    document.body,
  );
}
