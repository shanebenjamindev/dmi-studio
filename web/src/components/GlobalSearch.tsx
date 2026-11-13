// Tìm kiếm toàn bộ (Ctrl/⌘ K, or Tìm kiếm on the rail): colleagues, tasks (by name, project, people and description),
// customers, projects, boards and cards, and the account's own quick notes, each only as far as this account may open
// it (the server decides). "Tất cả" shows a few of each; a tab, or Xem thêm, shows one kind in full.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { openCard, openLink, openProfile, openTask } from '../store';
import { Icon } from './ui';
import { openNote } from './QuickNotes';
import { stepCode } from './taskkit';

type Tab = 'all' | 'members' | 'tasks' | 'customers' | 'projects' | 'boards' | 'notes';
const TABS: [Tab, string][] = [['all', 'Tất cả'], ['members', 'Thành viên'], ['tasks', 'Công việc'], ['customers', 'Khách hàng'], ['projects', 'Dự án'], ['boards', 'Board & thẻ'], ['notes', 'Ghi chú']];
const TONE: Record<string, string> = { done: 'ok', done_late: 'late', overdue: 'bad', doing: 'doing', review: 'doing' };
const day = (t: number | null) => (t ? new Date(t).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
/** The text with the searched words marked (matching without marks, shown as written). */
/** "Label: value · Label: value", each label its own text so the English interface can put it in English. */
function Facts({ list }: { list: (false | null | undefined | '' | [string, string])[] }) {
  return <>{list.filter((f): f is [string, string] => !!f).map(([label, value], i) => <span key={label}>{i > 0 && ' · '}{label} {value}</span>)}</>;
}

function Mark({ text, words }: { text: string; words: string[] }) {
  if (!words.length || !text) return <>{text}</>;
  const norm = text.normalize('NFC');
  const f = fold(norm), hits: [number, number][] = [];
  for (const w of words) for (let i = f.indexOf(w); i >= 0; i = f.indexOf(w, i + w.length)) hits.push([i, i + w.length]);
  if (!hits.length) return <>{norm}</>;
  hits.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let at = 0;
  for (const [s, e] of hits) { if (s < at) continue; out.push(norm.slice(at, s), <mark key={s}>{norm.slice(s, e)}</mark>); at = e; }
  out.push(norm.slice(at));
  return <>{out}</>;
}

interface Hit { key: string; group: Tab; open: () => void; node: ReactNode }
export function GlobalSearch() {
  const [open, setOpen] = useState(false), [q, setQ] = useState(''), [tab, setTab] = useState<Tab>('all'), [cursor, setCursor] = useState(0);
  const [data, setData] = useState<Record<string, { items: any[]; total: number }> | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null), seq = useRef(0);
  useEffect(() => {
    const show = () => { setOpen(true); setTimeout(() => input.current?.select(), 0); };
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); show(); } };
    window.addEventListener('dms:search', show); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('dms:search', show); window.removeEventListener('keydown', key); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setData(null); setError(''); return; }
    const n = ++seq.current, t = setTimeout(async () => {
      setLoading(true);
      try {
        const type = tab === 'all' || tab === 'boards' ? '' : tab;
        const [found, boards] = await Promise.all([tab === 'boards' ? Promise.resolve({}) : api.search(term, type), tab === 'all' || tab === 'boards' ? api.searchBoards(term).catch(() => ({ boards: [], cards: [] })) : Promise.resolve(null)]);
        if (n !== seq.current) return;
        const merged: Record<string, { items: any[]; total: number }> = { ...found };
        if (boards) { const items = [...boards.boards.map((b) => ({ kind: 'board', ...b })), ...boards.cards.map((c) => ({ kind: 'card', ...c }))]; merged.boards = { items: tab === 'all' ? items.slice(0, 5) : items, total: items.length }; }
        setData(merged); setError(''); setCursor(0);
      } catch (e: any) { if (n === seq.current) setError(e.message); }
      finally { if (n === seq.current) setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, tab, open]);
  if (!open) return null;
  const close = () => setOpen(false);
  const go = (fn: () => void) => () => { close(); fn(); };
  const words = fold(q.trim()).split(/\s+/).filter(Boolean);
  const hits: Hit[] = [];
  const groups = (tab === 'all' ? TABS.slice(1).map(([k]) => k) : [tab]).filter((k) => data?.[k]?.items.length);
  for (const g of groups) for (const it of data![g].items) {
    if (g === 'members') hits.push({ key: `m${it.id}`, group: g, open: go(() => openProfile(it.id)), node: <><span className="gs-av">{it.avatarAt ? <img src={`/api/avatars/${it.id}?v=${it.avatarAt}`} alt="" /> : it.name.charAt(0).toUpperCase()}</span><span className="gs-main"><b><Mark text={it.name} words={words} /></b><small><Mark text={[it.email, it.position, it.department].filter(Boolean).join(' · ')} words={words} /></small></span></> });
    if (g === 'tasks') hits.push({ key: `t${it.id}`, group: g, open: go(() => openTask(it.id)), node: <><span className="gs-ico"><Icon name="checklist" size={16} /></span><span className="gs-main"><b><Mark text={it.title} words={words} /></b>
      <small><Facts list={[it.project && ['Dự án:', it.project.name], it.assignees.length > 0 && ['Người thực hiện:', it.assignees.join(', ')], !!it.dueAt && ['Thời hạn:', day(it.dueAt)]]} /></small>
      {it.snippet && <small className="gs-snip">Mô tả: <Mark text={it.snippet} words={words} /></small>}</span><span className={'tk-badge ' + (TONE[it.state] || 'idle')}>{it.state === 'overdue' ? 'Quá hạn' : it.stage ? stepCode(it.stage) : it.status}</span></> });
    if (g === 'customers') hits.push({ key: `c${it.id}`, group: g, open: go(() => openLink(`#customers/${it.id}`)), node: <><span className="gs-ico"><Icon name="users" size={16} /></span><span className="gs-main"><b><Mark text={it.name} words={words} /></b><small><Mark text={[it.contact, it.phone, it.email].filter(Boolean).join(' · ')} words={words} /></small></span></> });
    if (g === 'projects') hits.push({ key: `p${it.id}`, group: g, open: go(() => openLink(`#projects/${it.id}`)), node: <><span className="gs-ico"><Icon name="folder" size={16} /></span><span className="gs-main"><b><Mark text={it.name} words={words} /></b><small>{it.customer && <Facts list={[['Khách hàng:', it.customer]]} />}{it.customer && ' · '}{`${it.tasks} công việc`}</small></span></> });
    if (g === 'boards') hits.push({ key: `b${it.id}`, group: g, open: go(() => (it.kind === 'card' ? openCard(it.boardId, it.id) : openLink(`#boards/${it.id}`))), node: <><span className="gs-ico"><Icon name={it.kind === 'card' ? 'card' : 'boards'} size={16} /></span><span className="gs-main"><b><Mark text={it.kind === 'card' ? it.title : it.name} words={words} /></b><small>{it.kind === 'card' ? `${it.boardName} · ${it.listName}` : 'Board'}</small></span></> });
    if (g === 'notes') hits.push({ key: `n${it.id}`, group: g, open: go(() => openNote(it.id)), node: <><span className={'gs-ico gs-note c-' + it.color}><Icon name="note" size={16} /></span><span className="gs-main"><b><Mark text={it.title} words={words} /></b>{it.snippet && <small><Mark text={it.snippet} words={words} /></small>}</span></> });
  }
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(hits.length - 1, c + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === 'Enter' && hits[cursor]) { e.preventDefault(); hits[cursor].open(); }
  };
  const label = Object.fromEntries(TABS) as Record<Tab, string>;
  let index = -1;
  return createPortal(
    <div className="gs-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="gs" role="dialog" aria-modal="true" aria-label="Tìm kiếm" onKeyDown={keys}>
        <label className="gs-input"><Icon name="search" size={22} /><input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm thành viên, công việc, khách hàng, dự án, board, ghi chú…" aria-label="Tìm kiếm" />
          {q && <button className="gs-clear" onClick={() => { setQ(''); input.current?.focus(); }} aria-label="Xoá"><Icon name="x" size={14} /></button>}</label>
        <nav className="gs-tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}{tab === 'all' && k !== 'all' && data?.[k]?.total ? <small>{data[k].total}</small> : null}</button>)}</nav>
        <div className="gs-body">
          {q.trim().length < 2 ? <p className="gs-hint">Gõ ít nhất 2 ký tự. Kết quả chỉ gồm những gì bạn được quyền xem. Mở nhanh bằng Ctrl/⌘ K.</p>
            : error ? <p className="note err" role="alert">{error}</p>
            : !data ? <p className="gs-hint">{loading ? 'Đang tìm…' : ''}</p>
            : !hits.length ? <p className="gs-hint">{loading ? 'Đang tìm…' : `Không tìm thấy “${q.trim()}”${tab === 'all' ? '' : ` trong ${label[tab]}`}.`}</p>
            : groups.map((g) => (
              <section key={g} className="gs-group">
                {tab === 'all' && <h3>{label[g]}</h3>}
                {hits.filter((h) => h.group === g).map((h) => { index++; const i = index; return <button key={h.key} className={'gs-hit' + (i === cursor ? ' on' : '')} onMouseEnter={() => setCursor(i)} onClick={h.open}>{h.node}</button>; })}
                {tab === 'all' && data![g].total > data![g].items.length && <button className="gs-more" onClick={() => setTab(g)}>Xem thêm ({data![g].total})</button>}
              </section>
            ))}
        </div>
      </div>
    </div>, document.body);
}
