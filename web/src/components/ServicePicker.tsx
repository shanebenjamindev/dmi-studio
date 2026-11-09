// Dịch vụ of a project or a task: services of the catalogue (Quản trị › Dịch vụ), shown as chips, with a small + that opens
// a searchable list (grouped by category, `suggested` ones first: a task's project's). Those allowed to grow the
// catalogue add a missing one from the same list. A customer's services are those of its projects.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { canDo, toast } from '../store';
import { Icon } from './ui';
import type { ServiceRef } from '../types';

/** The catalogue, loaded once and shared by every picker on screen. */
let shared: Promise<ServiceRef[]> | null = null;
const catalogue = () => (shared ??= api.serviceCatalog().catch((e) => { shared = null; throw e; }));
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();

/** `value`: the services chosen (they may include ones no longer offered, still shown by `known`'s names). */
export function ServicePicker({ value, onChange, known = [], suggested = [], disabled }: { value: string[]; onChange: (ids: string[]) => void; known?: ServiceRef[]; suggested?: string[]; disabled?: boolean }) {
  const [catalog, setCatalog] = useState<ServiceRef[]>([]);
  const [open, setOpen] = useState(false), [q, setQ] = useState(''), [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const mayAdd = canDo('services.create');
  useEffect(() => { let on = true; catalogue().then((c) => { if (on) setCatalog(c); }, () => {}); return () => { on = false; }; }, []);
  // Closed by a click elsewhere; Escape closes the list only (not the dialog it may be in).
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  const name = (id: string) => catalog.find((s) => s.id === id)?.name || known.find((s) => s.id === id)?.name || 'Dịch vụ';
  const shown = catalog.filter((s) => !q.trim() || fold(s.name).includes(fold(q.trim())));
  const ofSuggested = shown.filter((s) => suggested.includes(s.id)), rest = shown.filter((s) => !suggested.includes(s.id));
  const groups = [...(ofSuggested.length ? [{ name: 'Của dự án', list: ofSuggested }] : []), ...[...new Set(rest.map((s) => s.category || ''))].map((g) => ({ name: g, list: rest.filter((s) => (s.category || '') === g) }))];
  const exact = catalog.some((s) => fold(s.name) === fold(q.trim()));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const add = async () => {
    const n = q.trim();
    if (!n || busy) return;
    setBusy(true);
    try { const s = await api.createService(n); shared = null; setCatalog((c) => [...c, s]); onChange([...value, s.id]); setQ(''); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <div className="svc-pick" ref={box}>
      {value.map((id) => (
        <span key={id} className="crm-need-chip">{name(id)}{!disabled && <button type="button" onClick={() => toggle(id)} aria-label={`Bỏ ${name(id)}`}><Icon name="x" size={12} /></button>}</span>
      ))}
      {disabled ? !value.length && <span className="svc-none">—</span>
        : <button type="button" className={'svc-add' + (value.length ? ' icon' : '')} aria-expanded={open} aria-label="Thêm dịch vụ" title="Thêm dịch vụ" onClick={() => setOpen(!open)}><Icon name="plus" size={13} />{!value.length && 'Dịch vụ'}</button>}
      {open && (
        <div className="svc-menu" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}>
          <input className="bk-in" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={mayAdd ? 'Tìm hoặc thêm dịch vụ…' : 'Tìm dịch vụ…'} aria-label="Tìm dịch vụ"
            onKeyDown={(e) => { if (e.key !== 'Enter') return; e.preventDefault(); if (shown.length === 1) { toggle(shown[0].id); setQ(''); } else if (mayAdd && q.trim() && !exact) void add(); }} />
          <div className="svc-list" role="listbox" aria-multiselectable aria-label="Dịch vụ">
            {groups.map((g) => <div key={g.name || '-'}>
              {g.name && <small>{g.name}</small>}
              {g.list.map((s) => <button type="button" key={s.id} role="option" aria-selected={value.includes(s.id)} onClick={() => toggle(s.id)}><span>{s.name}</span>{value.includes(s.id) && <Icon name="check" size={14} />}</button>)}
            </div>)}
            {!shown.length && <p className="note">{catalog.length ? 'Không có dịch vụ khớp.' : mayAdd ? 'Danh mục còn trống: gõ tên để thêm.' : 'Danh mục dịch vụ còn trống. Nhờ quản trị thêm trong Quản trị › Dịch vụ.'}</p>}
          </div>
          {mayAdd && q.trim() && !exact && <button type="button" className="svc-new" disabled={busy} onClick={() => void add()}><Icon name="plus" size={13} /><span>Thêm vào danh mục</span><b>{q.trim()}</b></button>}
        </div>
      )}
    </div>
  );
}
