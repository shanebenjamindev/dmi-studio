// Building blocks of Quản trị's pages: loading data with its three states, the page head, a toolbar, a sortable table
// with paging, a right-side drawer, form fields, badges, KPI cards and the small lists editor.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/ui';
import { Avatar as Initials } from '../components/boardkit';
import { BrandLoading } from '../components/BrandLoading';
import { toast, useStore } from '../store';
import type { DictApi, DictItem } from './api';
import { SCOPE_LABEL, type Scope } from '../../../shared/permissions';

// ---------------------------------------------------------------- formats (Vietnam time)
const TZ = { timeZone: 'Asia/Ho_Chi_Minh' } as const;
export const fmtDate = (t: number | null | undefined) => (t ? new Date(t).toLocaleDateString('vi-VN', { ...TZ, day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
export const fmtTime = (t: number | null | undefined) => (t ? new Date(t).toLocaleString('vi-VN', { ...TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export function fmtAgo(t: number | null | undefined) {
  if (!t) return 'Chưa có';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'Vừa xong' : m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.round(m / 60)} giờ trước` : m < 43200 ? `${Math.round(m / 1440)} ngày trước` : fmtDate(t);
}
/** Lowercase without Vietnamese marks, for matching what people type. */
export const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('vi-VN'));
export const fmtMoney = (n: number | null | undefined, currency = 'VND') => (n === null || n === undefined ? '—' : n.toLocaleString('vi-VN', { style: 'currency', currency, maximumFractionDigits: currency === 'VND' ? 0 : 2 }));
export const fmtBytes = (b: number | null | undefined) => (b === null || b === undefined ? '—' : b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b >= 1e3 ? Math.round(b / 1e3) + ' KB' : b + ' B');
/** A time picked in a date input (start of that day in Vietnam), and back. */
export const dayStart = (v: string) => (v ? Date.parse(v + 'T00:00:00+07:00') : null);
export const dayValue = (t: number | null | undefined) => (t ? new Date(t + 7 * 3600e3).toISOString().slice(0, 10) : '');

// ---------------------------------------------------------------- permissions
export const useCan = () => { const a = useStore((s) => s.admin); return (perm: string) => !!a?.perms[perm]; };
export const useScope = (perm: string): Scope | null => useStore((s) => (s.admin?.perms[perm] as Scope) || null);

// ---------------------------------------------------------------- data
/** Loads with the page and again on `reload` or when `deps` change; keeps the last data while reloading. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true); setError('');
    try { const d = await fn(); if (n === seq.current) setData(d); }
    catch (e: any) { if (n === seq.current) setError(e.message); }
    finally { if (n === seq.current) setLoading(false); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}
/** Runs a change, says how it went, then reloads. */
export async function act(fn: () => Promise<unknown>, done?: string, after?: () => unknown) {
  try { await fn(); if (done) toast(done); await after?.(); return true; }
  catch (e: any) { toast(e.message, true); return false; }
}
export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

// ---------------------------------------------------------------- states
export const Loading = ({ label = 'Đang tải dữ liệu…' }: { label?: string }) => <div className="ax-state"><BrandLoading label={label} compact /></div>;
export const ErrorState = ({ error, onRetry }: { error: string; onRetry?: () => void }) => (
  <div className="ax-state ax-error" role="alert"><Icon name="info" size={22} /><p>{error}</p>{onRetry && <button className="btn btn-gray btn-sm" onClick={onRetry}><Icon name="refresh" size={14} />Thử lại</button>}</div>
);
export const Empty = ({ icon = 'inbox', title, text, action }: { icon?: string; title: string; text?: ReactNode; action?: ReactNode }) => (
  <div className="ax-state ax-empty"><Icon name={icon} size={28} /><b>{title}</b>{text && <p>{text}</p>}{action}</div>
);
/** Loading, error or the content (the content stays while it reloads). */
export function Async<T>({ load, children, empty }: { load: { data: T | null; error: string; loading: boolean; reload: () => void }; children: (d: T) => ReactNode; empty?: ReactNode }) {
  if (load.error && !load.data) return <ErrorState error={load.error} onRetry={load.reload} />;
  if (!load.data) return <Loading />;
  if (empty && Array.isArray(load.data) && !load.data.length) return <>{empty}</>;
  return <>{load.error && <ErrorState error={load.error} onRetry={load.reload} />}{children(load.data)}</>;
}

// ---------------------------------------------------------------- page parts
export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return <header className="ax-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{actions && <div className="ax-head-actions">{actions}</div>}</header>;
}
export function Toolbar({ search, onSearch, placeholder = 'Tìm…', children, right }: { search?: string; onSearch?: (v: string) => void; placeholder?: string; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="ax-toolbar">
      {onSearch && <label className="ax-search"><Icon name="search" size={15} /><input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} aria-label={placeholder} /></label>}
      {children}
      {right && <div className="ax-toolbar-right">{right}</div>}
    </div>
  );
}
export function Select({ value, onChange, label, children, className = '' }: { value: string; onChange: (v: string) => void; label: string; children: ReactNode; className?: string }) {
  return <select className={'bk-in ax-select ' + className} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} title={label}>{children}</select>;
}

export interface Col<T> { key: string; label: ReactNode; render: (r: T) => ReactNode; sort?: boolean; align?: 'right' | 'center'; width?: string; hideSm?: boolean }
export function Table<T extends { id: string }>({ cols, rows, sort, dir, onSort, onRow, empty, selected }: {
  cols: Col<T>[]; rows: T[]; sort?: string; dir?: 'asc' | 'desc'; onSort?: (key: string) => void; onRow?: (r: T) => void; empty?: ReactNode; selected?: string | null;
}) {
  if (!rows.length) return <>{empty || <Empty title="Không có dữ liệu" />}</>;
  return (
    <div className="ax-table-wrap">
      <table className="ax-table">
        <thead><tr>{cols.map((c) => (
          <th key={c.key} style={{ width: c.width, textAlign: c.align }} className={c.hideSm ? 'ax-sm-hide' : ''} aria-sort={sort === c.key ? (dir === 'desc' ? 'descending' : 'ascending') : undefined}>
            {c.sort && onSort ? <button onClick={() => onSort(c.key)}>{c.label}<Icon name={sort === c.key ? (dir === 'desc' ? 'down' : 'up') : 'chevron'} size={12} /></button> : c.label}
          </th>
        ))}</tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className={(onRow ? 'ax-click' : '') + (selected === r.id ? ' on' : '')} onClick={onRow ? () => onRow(r) : undefined}
            tabIndex={onRow ? 0 : undefined} onKeyDown={onRow ? (e) => { if (e.key === 'Enter') onRow(r); } : undefined}>
            {cols.map((c) => <td key={c.key} style={{ textAlign: c.align }} className={c.hideSm ? 'ax-sm-hide' : ''}>{c.render(r)}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return total ? <p className="ax-pager-info">{fmtNum(total)} mục</p> : null;
  return (
    <nav className="ax-pager" aria-label="Phân trang">
      <span>{fmtNum((page - 1) * size + 1)}–{fmtNum(Math.min(total, page * size))} / {fmtNum(total)}</span>
      <button className="btn btn-gray btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Trang trước"><Icon name="left" size={14} /></button>
      <b>{page}/{pages}</b>
      <button className="btn btn-gray btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Trang sau"><Icon name="right" size={14} /></button>
    </nav>
  );
}
/** The sort and page of a list, flipping the direction when the same column is chosen again. */
export function useListState(initialSort: string, initialDir: 'asc' | 'desc' = 'asc') {
  const [sort, setSort] = useState(initialSort), [dir, setDir] = useState<'asc' | 'desc'>(initialDir), [page, setPage] = useState(1);
  const onSort = (k: string) => { if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir('asc'); } setPage(1); };
  return { sort, dir, page, setPage, onSort };
}

/** A panel sliding in from the right, to look at one record or edit it. */
export function Drawer({ open, title, sub, onClose, children, footer, wide }: { open: boolean; title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="ax-drawer-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className={'ax-drawer' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <header><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div><button className="bd-icon" onClick={onClose} aria-label="Đóng"><Icon name="x" size={16} /></button></header>
        <div className="ax-drawer-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </aside>
    </div>, document.body);
}
export function Field({ label, error, hint, children, wide }: { label: string; error?: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
  return <label className={'ax-field' + (error ? ' bad' : '') + (wide ? ' wide' : '')}><span>{label}</span>{children}{error ? <small className="ax-field-err" role="alert">{error}</small> : hint ? <small>{hint}</small> : null}</label>;
}
export const Section = ({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) => (
  <section className="ax-section"><header><h3>{title}</h3>{actions}</header>{children}</section>
);
export const Badge = ({ color, children, tone }: { color?: string; children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'muted' | 'accent' }) => (
  <span className={'ax-badge' + (tone ? ' ' + tone : '')} style={color ? { ['--c' as any]: color } : undefined}>{color && <i />}{children}</span>
);
export const ScopeBadge = ({ scope }: { scope: Scope | null | undefined }) => (scope ? <Badge tone="muted">{SCOPE_LABEL[scope]}</Badge> : null);
export function Kpi({ label, value, hint, icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; icon?: string; tone?: 'accent' | 'bad' | 'ok' }) {
  return <article className={'ax-kpi' + (tone ? ' ' + tone : '')}>{icon && <span className="ax-kpi-ico"><Icon name={icon} size={18} /></span>}<div><small>{label}</small><strong>{value}</strong>{hint && <em>{hint}</em>}</div></article>;
}
/** A person's picture when they have one, else their initials. */
export const Person = ({ p, size = 28 }: { p: { id: string; name: string; avatarAt?: number | null }; size?: number }) => (p.avatarAt
  ? <img className="ax-avatar" src={`/api/avatars/${p.id}?v=${p.avatarAt}`} alt="" width={size} height={size} />
  : <Initials m={p} size={size} />);
/** Old → new for each field a change touched. */
export function ChangeList({ changes, empty = 'Chưa có thay đổi nào được ghi lại.' }: { changes: { action: string; by: string | null; before: any; after: any; at: number }[]; empty?: string }) {
  if (!changes.length) return <p className="note">{empty}</p>;
  return <ol className="ax-changes">{changes.map((c, i) => (
    <li key={i}><div><b>{c.action}</b><span>{c.by || 'Hệ thống'} · {fmtTime(c.at)}</span></div><Diff before={c.before} after={c.after} /></li>
  ))}</ol>;
}
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
export function Diff({ before, after }: { before: any; after: any }) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  if (!keys.length) return null;
  return <dl className="ax-diff">{keys.map((k) => <div key={k}><dt>{k}</dt><dd>{before && <del>{show(before[k])}</del>}{before && after && ' → '}{after && <ins>{show(after[k])}</ins>}</dd></div>)}</dl>;
}
export const Check = ({ on }: { on: boolean }) => <span className={'ax-check' + (on ? ' on' : '')}>{on ? <Icon name="check" size={13} /> : '—'}</span>;

// ---------------------------------------------------------------- small lists (priorities, categories, sources…)
/** Add, rename, recolour, reorder, turn off and delete (only while unused) the items of a small list. */
export function DictEditor({ api: d, noun, canEdit, usedLabel = 'Đang dùng' }: { api: DictApi; noun: string; canEdit: boolean; usedLabel?: string }) {
  const load = useLoad(() => d.list(), [d]);
  const [name, setName] = useState(''), [color, setColor] = useState('#64748b'), [err, setErr] = useState('');
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr(`Hãy nhập tên ${noun}`);
    setErr('');
    if (await act(() => d.create({ name: name.trim(), color }), `Đã thêm ${noun}`, load.reload)) setName('');
  };
  const move = (items: DictItem[], i: number, by: number) => { const ids = items.map((x) => x.id); [ids[i], ids[i + by]] = [ids[i + by], ids[i]]; void act(() => d.order(ids), undefined, load.reload); };
  return (
    <div className="ax-card">
      {canEdit && <form className="ax-inline-form" onSubmit={add}>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Màu" />
        <input className={'bk-in' + (err ? ' bad' : '')} value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setErr(''); }} placeholder={`Tên ${noun} mới`} aria-label={`Tên ${noun} mới`} />
        <button className="btn btn-primary btn-sm"><Icon name="plus" size={14} />Thêm</button>
        {err && <small className="ax-field-err" role="alert">{err}</small>}
      </form>}
      <Async load={load} empty={<Empty title={`Chưa có ${noun} nào`} text={canEdit ? `Thêm ${noun} đầu tiên ở ô bên trên.` : undefined} />}>{(items) => (
        <ul className="ax-dict">{items.map((it, i) => <DictRow key={it.id} it={it} canEdit={canEdit} usedLabel={usedLabel} first={i === 0} last={i === items.length - 1}
          onMove={(by) => move(items, i, by)} onSave={(b) => act(() => d.update(it.id, b), 'Đã lưu', load.reload)}
          onDelete={() => { if (confirm(`Xoá ${noun} “${it.name}”?`)) void act(() => d.remove(it.id), `Đã xoá ${noun}`, load.reload); }} />)}</ul>
      )}</Async>
    </div>
  );
}
function DictRow({ it, canEdit, usedLabel, first, last, onMove, onSave, onDelete }: { it: DictItem; canEdit: boolean; usedLabel: string; first: boolean; last: boolean; onMove: (by: number) => void; onSave: (b: Partial<{ name: string; color: string; active: boolean }>) => void; onDelete: () => void }) {
  const [name, setName] = useState(it.name);
  useEffect(() => setName(it.name), [it.name]);
  return (
    <li className={it.active ? '' : 'off'}>
      {canEdit ? <input type="color" value={it.color} onChange={(e) => onSave({ color: e.target.value })} aria-label={`Màu của ${it.name}`} /> : <i className="ax-dot" style={{ background: it.color }} />}
      {canEdit ? <input className="bk-in ax-dict-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== it.name) onSave({ name: name.trim() }); else setName(it.name); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Tên" /> : <b>{it.name}</b>}
      <span className="ax-dict-used">{usedLabel}: {fmtNum(it.used)}</span>
      {!it.active && <Badge tone="muted">Đã tắt</Badge>}
      {canEdit && <span className="ax-row-actions">
        <button className="bd-icon" disabled={first} onClick={() => onMove(-1)} aria-label="Lên"><Icon name="up" size={14} /></button>
        <button className="bd-icon" disabled={last} onClick={() => onMove(1)} aria-label="Xuống"><Icon name="down" size={14} /></button>
        <button className="btn btn-gray btn-sm" onClick={() => onSave({ active: !it.active })}>{it.active ? 'Tắt' : 'Bật'}</button>
        <button className="bd-icon danger" disabled={it.used > 0} title={it.used ? 'Đang được dùng: hãy tắt thay vì xoá' : 'Xoá'} onClick={onDelete} aria-label={`Xoá ${it.name}`}><Icon name="trash" size={14} /></button>
      </span>}
    </li>
  );
}
