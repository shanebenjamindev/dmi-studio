// Khách → Nhãn hàng / Dịch vụ → Công việc: where a task or card belongs is picked as a customer (and optional brand /
// service). When no service is selected, the task follows the customer/brand directly via its general container.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import { Pop } from './boardkit';
import type { Brand, ServiceRef } from '../types';

export function ClientServicePop({ anchor, customerId, brandId, serviceId, onClose, onPick, onClear }: {
  anchor: HTMLElement; customerId: string | null; brandId?: string | null; serviceId: string | null; onClose: () => void;
  /** The project the pair resolved to; false keeps the popover open. */
  onPick: (projectId: string, serviceId: string, customerId: string, brandId?: string | null) => Promise<boolean | void>;
  onClear?: () => void;
}) {
  const [customers, setCustomers] = useState<{ id: string; name: string }[] | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [catalog, setCatalog] = useState<ServiceRef[]>([]);
  const [own, setOwn] = useState<string[]>([]);
  const [customer, setCustomer] = useState(customerId || '');
  const [brand, setBrand] = useState(brandId || '');
  const [service, setService] = useState(serviceId || '');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api.customersAll().then(setCustomers, (e) => { toast(e.message, true); setCustomers([]); });
    api.serviceCatalog().then(setCatalog, () => setCatalog([])).finally(() => setLoaded(true));
  }, []);
  // Load customer's brands and services when customer changes.
  useEffect(() => {
    if (!customer) { setBrands([]); setOwn([]); return; }
    api.customerBrands(customer).then((bs) => {
      setBrands(bs);
      if (bs.length === 1 && !brand) setBrand(bs[0].id);
    }, () => setBrands([]));
    api.customerProjects(customer).then((ps) => setOwn([...new Set(ps.flatMap((p) => p.services.map((s) => s.id)))]), () => setOwn([]));
  }, [customer]); // eslint-disable-line react-hooks/exhaustive-deps
  const ordered = [...catalog.filter((s) => own.includes(s.id)), ...catalog.filter((s) => !own.includes(s.id))];
  const save = async () => {
    if (!customer || busy) return;
    setBusy(true);
    try {
      const p = await api.projectForService(customer, service || '', brand ? { brandId: brand } : undefined);
      if ((await onPick(p.id, service || '', customer, brand || null)) !== false) onClose();
    } catch (e: any) { toast(e.message, true); }
    finally { setBusy(false); }
  };
  return (
    <Pop anchor={anchor} title="Khách hàng · Nhãn hàng · Dịch vụ" onClose={onClose} width={340}>
      <label className="csp-field">Khách hàng
        <select className="bk-in" value={customer} disabled={busy || customers === null} onChange={(e) => { setCustomer(e.target.value); setBrand(''); }}>
          <option value="">{customers === null ? 'Đang tải…' : 'Chọn khách hàng'}</option>
          {customers?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {customer && brands.length > 0 && (
        <label className="csp-field">Nhãn hàng (tuỳ chọn)
          <select className="bk-in" value={brand} disabled={busy} onChange={(e) => setBrand(e.target.value)}>
            <option value="">Mặc định theo khách hàng</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      <label className="csp-field">Dịch vụ (không bắt buộc)
        <select className="bk-in" value={service} disabled={busy || !customer} onChange={(e) => setService(e.target.value)}>
          <option value="">{customer ? 'Không chọn dịch vụ (Theo khách hàng / nhãn hàng)' : 'Chọn khách hàng trước'}</option>
          {own.length > 0 && <optgroup label="Dịch vụ của khách">{ordered.filter((s) => own.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
          <optgroup label={own.length ? 'Dịch vụ khác' : 'Danh mục dịch vụ'}>{ordered.filter((s) => !own.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
        </select>
      </label>
      {loaded && !catalog.length
        ? <p className="note csp-note">Danh mục dịch vụ đang trống (vẫn có thể lưu theo khách hàng / nhãn hàng).</p>
        : <p className="note csp-note">Có thể gắn trực tiếp theo khách hàng / nhãn hàng mà không cần chọn dịch vụ.</p>}
      <button className="btn btn-primary bk-wide" disabled={busy || !customer} onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      {onClear && <button className="btn btn-gray bk-wide" disabled={busy} onClick={onClear}>Bỏ khách hàng & dịch vụ</button>}
    </Pop>
  );
}

/** The same choice as two fields of a form: resolves to its project as soon as customer (and optional service) is picked. */
export function ClientServiceFields({ projects, value, onChange, onResolved }: {
  projects: { id: string; customerId: string | null; customerName?: string | null; brandId?: string | null; brandName?: string | null; services?: ServiceRef[] }[];
  value: string; onChange: (projectId: string) => void; onResolved?: () => void;
}) {
  const start = placeOf(projects, value);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [catalog, setCatalog] = useState<ServiceRef[]>([]);
  const [customer, setCustomer] = useState(start.customerId || '');
  const [service, setService] = useState(start.service?.id || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.customersAll().then(setCustomers, () => setCustomers([]));
    api.serviceCatalog().then(setCatalog, () => setCatalog([]));
  }, []);
  // A project set from outside (a default arriving late, a form reset) shows as its pair.
  useEffect(() => {
    if (!value) return;
    const at = placeOf(projects, value);
    if (at.customerId) setCustomer(at.customerId);
    setService(at.service?.id || '');
  }, [value, projects]); // eslint-disable-line react-hooks/exhaustive-deps
  const own = new Set(projects.filter((p) => p.customerId === customer).flatMap((p) => (p.services || []).map((s) => s.id)));
  const resolve = async (c: string, s: string) => {
    if (!c) { onChange(''); return; }
    setBusy(true);
    try { const p = await api.projectForService(c, s || ''); onChange(p.id); if (p.created) onResolved?.(); }
    catch (e: any) { toast(e.message, true); }
    finally { setBusy(false); }
  };
  return <>
    <label>Khách hàng<select value={customer} disabled={busy} onChange={(e) => { setCustomer(e.target.value); void resolve(e.target.value, service); }}>
      <option value="">Không có khách hàng</option>
      {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select></label>
    <label>Dịch vụ (tuỳ chọn)<select value={service} disabled={busy || !customer} onChange={(e) => { setService(e.target.value); void resolve(customer, e.target.value); }}>
      <option value="">{customer ? 'Không chọn dịch vụ (Theo khách hàng)' : 'Chọn khách hàng trước'}</option>
      {catalog.filter((s) => own.has(s.id)).length > 0 && <optgroup label="Dịch vụ của khách">{catalog.filter((s) => own.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
      <optgroup label="Danh mục dịch vụ">{catalog.filter((s) => !own.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
    </select></label>
  </>;
}

/** The customer and the service a project stands for (its first service), from the projects the page already has. */
export function placeOf(projects: { id: string; customerId: string | null; customerName?: string | null; brandId?: string | null; brandName?: string | null; services?: ServiceRef[] }[] | undefined, projectId: string | null | undefined) {
  const p = projectId ? projects?.find((x) => x.id === projectId) : undefined;
  return {
    customerId: p?.customerId || null,
    customerName: p?.customerName || null,
    brandId: p?.brandId || null,
    brandName: p?.brandName || null,
    service: p?.services?.[0] || null,
  };
}
