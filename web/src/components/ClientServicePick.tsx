// Khách → Dịch vụ → Công việc (like Base Wework's project): where a task or card belongs is picked as a customer and one
// of the services, and the project behind that pair (one per customer × service) is found or made on the server.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import { Pop } from './boardkit';
import type { ServiceRef } from '../types';

export function ClientServicePop({ anchor, customerId, serviceId, onClose, onPick, onClear }: {
  anchor: HTMLElement; customerId: string | null; serviceId: string | null; onClose: () => void;
  /** The project the pair resolved to; false keeps the popover open. */
  onPick: (projectId: string, serviceId: string, customerId: string) => Promise<boolean | void>;
  onClear?: () => void;
}) {
  const [customers, setCustomers] = useState<{ id: string; name: string }[] | null>(null);
  const [catalog, setCatalog] = useState<ServiceRef[]>([]);
  const [own, setOwn] = useState<string[]>([]);
  const [customer, setCustomer] = useState(customerId || '');
  const [service, setService] = useState(serviceId || '');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api.customersAll().then(setCustomers, (e) => { toast(e.message, true); setCustomers([]); });
    api.serviceCatalog().then(setCatalog, () => setCatalog([])).finally(() => setLoaded(true));
  }, []);
  // The customer's own services come first: those its projects already carry.
  useEffect(() => {
    if (!customer) { setOwn([]); return; }
    api.customerProjects(customer).then((ps) => setOwn([...new Set(ps.flatMap((p) => p.services.map((s) => s.id)))]), () => setOwn([]));
  }, [customer]);
  const ordered = [...catalog.filter((s) => own.includes(s.id)), ...catalog.filter((s) => !own.includes(s.id))];
  const save = async () => {
    if (!customer || !service || busy) return;
    setBusy(true);
    try {
      const p = await api.projectForService(customer, service);
      if ((await onPick(p.id, service, customer)) !== false) onClose();
    } catch (e: any) { toast(e.message, true); }
    finally { setBusy(false); }
  };
  return (
    <Pop anchor={anchor} title="Khách hàng · Dịch vụ" onClose={onClose} width={320}>
      <label className="csp-field">Khách hàng
        <select className="bk-in" value={customer} disabled={busy || customers === null} onChange={(e) => setCustomer(e.target.value)}>
          <option value="">{customers === null ? 'Đang tải…' : 'Chọn khách hàng'}</option>
          {customers?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="csp-field">Dịch vụ
        <select className="bk-in" value={service} disabled={busy || !customer} onChange={(e) => setService(e.target.value)}>
          <option value="">{customer ? 'Chọn dịch vụ' : 'Chọn khách hàng trước'}</option>
          {own.length > 0 && <optgroup label="Dịch vụ của khách">{ordered.filter((s) => own.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
          <optgroup label={own.length ? 'Dịch vụ khác' : 'Danh mục dịch vụ'}>{ordered.filter((s) => !own.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
        </select>
      </label>
      {loaded && !catalog.length
        ? <p className="note csp-note">Danh mục dịch vụ đang trống. <a href="#admin/services/list" target="_blank" rel="noreferrer">Thêm dịch vụ trong Quản trị ↗</a></p>
        : <p className="note csp-note">Công việc sẽ nằm trong dịch vụ này của khách hàng (tự tạo nếu khách chưa có).</p>}
      <button className="btn btn-primary bk-wide" disabled={busy || !customer || !service} onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      {onClear && <button className="btn btn-gray bk-wide" disabled={busy} onClick={onClear}>Bỏ khách hàng & dịch vụ</button>}
    </Pop>
  );
}

/** The same choice as two fields of a form: the pair resolves to its project as soon as both are picked. */
export function ClientServiceFields({ projects, value, onChange, onResolved }: {
  projects: { id: string; customerId: string | null; customerName?: string | null; services?: ServiceRef[] }[];
  value: string; onChange: (projectId: string) => void; onResolved?: () => void;
}) {
  const start = placeOf(projects, value);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [catalog, setCatalog] = useState<ServiceRef[]>([]);
  const [customer, setCustomer] = useState(start.customerId || '');
  const [service, setService] = useState(start.service?.id || '');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api.customersAll().then(setCustomers, () => setCustomers([]));
    api.serviceCatalog().then(setCatalog, () => setCatalog([])).finally(() => setLoaded(true));
  }, []);
  // A project set from outside (a default arriving late, a form reset) shows as its pair.
  useEffect(() => {
    if (!value) return;
    const at = placeOf(projects, value);
    if (at.customerId) setCustomer(at.customerId);
    if (at.service) setService(at.service.id);
  }, [value, projects]); // eslint-disable-line react-hooks/exhaustive-deps
  const own = new Set(projects.filter((p) => p.customerId === customer).flatMap((p) => (p.services || []).map((s) => s.id)));
  const resolve = async (c: string, s: string) => {
    if (!c || !s) { onChange(''); return; }
    setBusy(true);
    try { const p = await api.projectForService(c, s); onChange(p.id); if (p.created) onResolved?.(); }
    catch (e: any) { toast(e.message, true); }
    finally { setBusy(false); }
  };
  return <>
    <label>Khách hàng<select value={customer} disabled={busy} onChange={(e) => { setCustomer(e.target.value); void resolve(e.target.value, service); }}>
      <option value="">Không có khách hàng</option>
      {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select></label>
    <label>Dịch vụ<select value={service} disabled={busy || !customer} onChange={(e) => { setService(e.target.value); void resolve(customer, e.target.value); }}>
      <option value="">{customer ? 'Chọn dịch vụ' : 'Chọn khách hàng trước'}</option>
      {catalog.filter((s) => own.has(s.id)).length > 0 && <optgroup label="Dịch vụ của khách">{catalog.filter((s) => own.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
      <optgroup label="Danh mục dịch vụ">{catalog.filter((s) => !own.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
    </select>{loaded && !catalog.length && <small className="csp-empty">Danh mục dịch vụ đang trống. <a href="#admin/services/list" target="_blank" rel="noreferrer">Thêm trong Quản trị ↗</a></small>}</label>
  </>;
}

/** The customer and the service a project stands for (its first service), from the projects the page already has. */
export function placeOf(projects: { id: string; customerId: string | null; customerName?: string | null; services?: ServiceRef[] }[] | undefined, projectId: string | null | undefined) {
  const p = projectId ? projects?.find((x) => x.id === projectId) : undefined;
  return { customerId: p?.customerId || null, customerName: p?.customerName || null, service: p?.services?.[0] || null };
}
