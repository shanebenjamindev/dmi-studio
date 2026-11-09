// Dịch vụ of a project: services of the catalogue (Quản trị › Dịch vụ), shown as chips and added from a list grouped by
// category; those allowed to grow the catalogue can add a missing one here. A customer's services are those of its
// projects, so this is where they are chosen.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { canDo, toast } from '../store';
import { Icon } from './ui';
import type { ServiceRef } from '../types';

/** The catalogue, loaded once and shared by every picker on screen. */
let shared: Promise<ServiceRef[]> | null = null;
const catalogue = () => (shared ??= api.serviceCatalog().catch((e) => { shared = null; throw e; }));

/** `value`: the services chosen (they may include ones no longer offered, still shown by `known`'s names). */
export function ServicePicker({ value, onChange, known = [], disabled }: { value: string[]; onChange: (ids: string[]) => void; known?: ServiceRef[]; disabled?: boolean }) {
  const [catalog, setCatalog] = useState<ServiceRef[]>([]);
  const [newName, setNewName] = useState(''), [busy, setBusy] = useState(false);
  const mayAdd = canDo('services.create');
  useEffect(() => { let on = true; catalogue().then((c) => { if (on) setCatalog(c); }, () => {}); return () => { on = false; }; }, []);
  const name = (id: string) => catalog.find((s) => s.id === id)?.name || known.find((s) => s.id === id)?.name || 'Dịch vụ';
  const left = catalog.filter((s) => !value.includes(s.id)), groups = [...new Set(left.map((s) => s.category || ''))];
  const add = async () => {
    const n = newName.trim();
    if (!n) return;
    setBusy(true);
    try { const s = await api.createService(n); shared = null; setCatalog((c) => [...c, s]); onChange([...value, s.id]); setNewName(''); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <div className="svc-pick">
      {value.length > 0 && <div className="crm-need-chips">{value.map((id) => (
        <span key={id} className="crm-need-chip">{name(id)}{!disabled && <button type="button" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Bỏ ${name(id)}`}><Icon name="x" size={12} /></button>}</span>
      ))}</div>}
      {!disabled && left.length > 0 && <select className="bk-in" value="" aria-label="Thêm dịch vụ" onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]); }}>
        <option value="">{value.length ? 'Thêm dịch vụ khác…' : 'Chọn dịch vụ…'}</option>
        {groups.map((g) => { const opts = left.filter((s) => (s.category || '') === g).map((s) => <option key={s.id} value={s.id}>{s.name}</option>); return g ? <optgroup key={g} label={g}>{opts}</optgroup> : opts; })}
      </select>}
      {!disabled && (mayAdd ? <div className="crm-inline-add"><input className="bk-in" maxLength={200} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} placeholder="Dịch vụ chưa có trong danh mục" /><button type="button" className="btn btn-gray btn-sm" disabled={busy || !newName.trim()} onClick={() => void add()}><Icon name="plus" size={13} />Thêm vào danh mục</button></div>
        : !catalog.length && <small className="note">Danh mục dịch vụ còn trống. Nhờ quản trị thêm trong Quản trị › Dịch vụ.</small>)}
    </div>
  );
}
