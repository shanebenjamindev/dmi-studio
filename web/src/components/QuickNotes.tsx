// Ghi chú nhanh: each account's own sticky notes. The top bar's button opens the list (search, several at once, a new
// one); a note opens as a small window that can be dragged and resized, in one of six colours, with bold, italic, code,
// headings, lists, checklists and pictures. Everything saves as it is typed; only its writer ever sees it.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { toast } from '../store';
import { Icon } from './ui';
import type { NoteColor, QuickNote } from '../types';

export const NOTE_COLORS: [NoteColor, string][] = [['yellow', 'Vàng'], ['green', 'Xanh lá'], ['pink', 'Hồng'], ['purple', 'Tím'], ['blue', 'Xanh dương'], ['dark', 'Tối']];

// ---------------------------------------------------------------- what is open (shared by the top bar button and the notes)
let panel = false, opened: string[] = [];
/** What is already known of a note being opened (from the list, or as just made), so its window starts in its own place. */
const known = new Map<string, QuickNote>();
const subs = new Set<() => void>();
const emit = () => { snapshot = { panel, opened }; subs.forEach((f) => f()); };
let snapshot = { panel, opened };
const useNotesState = () => useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb); }, () => snapshot);
export const toggleNotesPanel = (on = !panel) => { panel = on; emit(); };
export const openNote = (id: string, seen?: QuickNote) => { if (seen && !opened.includes(id)) known.set(id, seen); opened = [...opened.filter((x) => x !== id), id]; emit(); };
const closeNote = (id: string) => { opened = opened.filter((x) => x !== id); emit(); };
/** Brings a note in front of the others. */
const raise = (id: string) => { if (opened[opened.length - 1] !== id) { opened = [...opened.filter((x) => x !== id), id]; emit(); } };

/** The rail's note button starts a new note at once; the list opens from a note's ⋯ menu. */
export function QuickNotesButton() {
  return <button className="tb-theme-btn" onClick={() => window.dispatchEvent(new Event('dms:new-note'))} title="Ghi chú nhanh: tạo ghi chú mới" aria-label="Tạo ghi chú nhanh"><Icon name="note" size={18} /></button>;
}

// ---------------------------------------------------------------- safe formatted text
const TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'CODE', 'PRE', 'H1', 'H2', 'OL', 'UL', 'LI', 'P', 'DIV', 'BR', 'SPAN', 'IMG', 'BLOCKQUOTE']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TEMPLATE', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);
const SAFE_IMG = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i;
/** Keeps only the formatting the editor makes; drops scripts, styles, handlers and links to elsewhere. */
export function cleanHtml(html: string) {
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild as HTMLElement;
  const walk = (el: Element) => {
    for (const c of [...el.children]) {
      if (DROP.has(c.tagName)) { c.remove(); continue; }
      walk(c);
      if (!TAGS.has(c.tagName)) { c.replaceWith(...c.childNodes); continue; }
      for (const a of [...c.attributes]) {
        const keep = (c.tagName === 'IMG' && a.name === 'src' && SAFE_IMG.test(a.value)) || (c.tagName === 'UL' && a.name === 'data-check') || (c.tagName === 'LI' && a.name === 'data-checked');
        if (!keep) c.removeAttribute(a.name);
      }
      if (c.tagName === 'IMG' && !c.getAttribute('src')) c.remove();
    }
  };
  walk(root);
  return root.innerHTML;
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
/** A picture made small enough to keep in a note (longest side 1000 px, JPEG). */
async function shrink(file: File) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1000 / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

/** Nothing in it at all: no words, pictures, list items or headings (an empty list still shows its bullet). */
const blankBody = (el: HTMLElement) => !el.textContent?.trim() && !el.querySelector('img,li,h1,h2,pre,blockquote');

// ---------------------------------------------------------------- the notes on screen
export function QuickNotes() {
  const s = useNotesState();
  // The notes left open last time come back, wherever the account signs in.
  useEffect(() => { api.quickNotes().then((all) => { const open = all.filter((n) => n.open); open.forEach((n) => known.set(n.id, n)); opened = open.map((n) => n.id).reverse(); emit(); }).catch(() => {}); }, []);
  const [listVersion, setListVersion] = useState(0);
  const changed = useCallback(() => setListVersion((v) => v + 1), []);
  // ✕ only hides a note; a blank hidden one is opened again rather than another blank one made.
  const create = async (near?: { x: number; y: number }) => {
    try {
      // A blank note already on screen comes to the front instead of another blank one stacking on it.
      const blank = !near && (await api.quickNotes()).find((n) => !n.title && !n.hasImage && (opened.includes(n.id) || !n.open));
      if (blank) { openNote(blank.id, blank); return; }
      // Beside the list when it is open, not on top of it.
      const k = opened.length % 6, x = near ? near.x + 28 : Math.max(16, window.innerWidth - (panel ? 800 : 420) - k * 30), y = near ? near.y + 28 : 80 + k * 30;
      const n = await api.createQuickNote({ x, y, w: 360, h: 340 });
      openNote(n.id, n); changed();
    } catch (e: any) { toast(e.message, true); }
  };
  useEffect(() => { const make = () => void create(); window.addEventListener('dms:new-note', make); return () => window.removeEventListener('dms:new-note', make); });
  return createPortal(<>
    {s.opened.map((id, i) => <NoteWindow key={id} id={id} z={1000 + i} onNew={create} onChanged={changed} />)}
    {s.panel && <NotesPanel version={listVersion} onNew={() => void create()} onChanged={changed} />}
  </>, document.body);
}

function NotesPanel({ version, onNew, onChanged }: { version: number; onNew: () => void; onChanged: () => void }) {
  const [q, setQ] = useState(''), [list, setList] = useState<QuickNote[] | null>(null), [error, setError] = useState('');
  const [selecting, setSelecting] = useState(false), [picked, setPicked] = useState<string[]>([]), [menuFor, setMenuFor] = useState<string | null>(null);
  useEffect(() => { if (!menuFor) return; const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.qn-card-menu, .qn-card-more')) setMenuFor(null); }; document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off); }, [menuFor]);
  const removeOne = async (n: QuickNote) => {
    setMenuFor(null);
    if (!confirm('Xoá ghi chú này? Không khôi phục được.')) return;
    try { await api.removeQuickNote(n.id); closeNote(n.id); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  const load = useCallback(() => api.quickNotes(q.trim()).then((l) => { if (!drag.current) setList(l); setError(''); }, (e) => setError(e.message)), [q]);
  // Dragging a card moves it in the list as it goes (past the middle of the next one); the order is kept when it is let go.
  // Not while searching (only some notes are shown) or picking several.
  const drag = useRef<{ id: string; from: string } | null>(null), listRef = useRef(list), [dragging, setDragging] = useState<string | null>(null);
  listRef.current = list;
  const sortable = !selecting && !q.trim() && (list?.length || 0) > 1;
  const over = (e: React.DragEvent<HTMLLIElement>, target: string) => {
    const d = drag.current, cur = listRef.current;
    if (!d || !cur) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const from = cur.findIndex((n) => n.id === d.id), to = cur.findIndex((n) => n.id === target);
    if (from < 0 || to < 0 || from === to) return;
    const r = e.currentTarget.getBoundingClientRect(), mid = r.top + r.height / 2;
    if ((from < to && e.clientY < mid) || (from > to && e.clientY > mid)) return;
    const next = [...cur]; next.splice(to, 0, ...next.splice(from, 1)); setList(next);
  };
  const dropped = () => {
    const d = drag.current, ids = (listRef.current || []).map((n) => n.id);
    drag.current = null; setDragging(null);
    if (!d || ids.join() === d.from) return;
    api.orderQuickNotes(ids).catch((e) => { toast(e.message, true); void load(); });
  };
  useEffect(() => { const t = setTimeout(() => void load(), q ? 250 : 0); return () => clearTimeout(t); }, [load, version]);
  useEffect(() => { const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.qn-win:focus-within')) toggleNotesPanel(false); }; document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc); }, []);
  const remove = async () => {
    if (!picked.length || !confirm(`Xoá ${picked.length} ghi chú? Không khôi phục được.`)) return;
    try { await api.removeQuickNotes(picked); picked.forEach(closeNote); setPicked([]); setSelecting(false); onChanged(); toast('Đã xoá ghi chú'); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <aside className="qn-panel" aria-label="Ghi chú nhanh">
      <header>
        <button className="bd-icon" onClick={onNew} aria-label="Ghi chú mới" title="Ghi chú mới"><Icon name="plus" size={18} /></button>
        <button className={'qn-link' + (selecting ? ' on' : '')} onClick={() => { setSelecting(!selecting); setPicked([]); }}>{selecting ? 'Xong' : 'Chọn nhiều'}</button>
        <button className="bd-icon" onClick={() => toggleNotesPanel(false)} aria-label="Đóng"><Icon name="x" size={18} /></button>
      </header>
      <h2>Ghi chú nhanh</h2>
      <label className="qn-search"><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void load(); }} placeholder="Tìm trong ghi chú…" aria-label="Tìm ghi chú" /><Icon name="search" size={16} /></label>
      {selecting && <div className="qn-bulk"><span>Đã chọn {picked.length}</span><button className="btn btn-sm btn-gray" onClick={() => setPicked(picked.length === (list || []).length ? [] : (list || []).map((n) => n.id))}>{picked.length === (list || []).length && picked.length ? 'Bỏ chọn' : 'Chọn tất cả'}</button><button className="btn btn-sm btn-danger" disabled={!picked.length} onClick={() => void remove()}><Icon name="trash" size={13} />Xoá</button></div>}
      {error ? <p className="note err" role="alert">{error}</p> : !list ? <p className="note">Đang tải…</p> : !list.length ? <div className="qn-empty"><Icon name="note" size={28} /><p>{q ? 'Không có ghi chú nào khớp.' : 'Chưa có ghi chú nào. Bấm + để viết ghi chú đầu tiên; chỉ mình bạn xem được.'}</p></div> : (
        <ul className="qn-list">{list.map((n) => (
          <li key={n.id} className={'qn-card c-' + n.color + (picked.includes(n.id) ? ' picked' : '') + (dragging === n.id ? ' dragging' : '')} draggable={sortable}
            title={sortable ? 'Kéo để sắp xếp' : undefined} onDragOver={(e) => over(e, n.id)} onDrop={(e) => e.preventDefault()} onDragEnd={dropped}
            onDragStart={(e) => { drag.current = { id: n.id, from: (list || []).map((x) => x.id).join() }; setMenuFor(null); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.title || n.id); requestAnimationFrame(() => setDragging(n.id)); }}>
            <button onClick={() => (selecting ? setPicked(picked.includes(n.id) ? picked.filter((x) => x !== n.id) : [...picked, n.id]) : openNote(n.id, n))}>
              {selecting && <input type="checkbox" readOnly checked={picked.includes(n.id)} tabIndex={-1} />}
              <span><b>{n.title || (n.hasImage ? 'Ảnh' : 'Ghi chú mới')}</b>{n.preview && <small>{n.preview}</small>}<em>{ago(n.updatedAt)}</em></span>
            </button>
            {!selecting && <button className={'qn-card-more' + (menuFor === n.id ? ' on' : '')} onClick={() => setMenuFor(menuFor === n.id ? null : n.id)} aria-label="Tuỳ chọn ghi chú" aria-expanded={menuFor === n.id}><Icon name="more" size={16} /></button>}
            {menuFor === n.id && <div className="qn-card-menu" role="menu">
              <button role="menuitem" onClick={() => { setMenuFor(null); openNote(n.id, n); }}><Icon name="share" size={16} />Mở ghi chú</button>
              <button role="menuitem" className="danger" onClick={() => void removeOne(n)}><Icon name="trash" size={16} />Xoá</button>
            </div>}
          </li>
        ))}</ul>
      )}
    </aside>
  );
}
function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'vài giây trước';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} phút trước`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
  if (s < 30 * 86400) return `${Math.round(s / 86400)} ngày trước`;
  return new Date(t).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

/** One note's window: drag it by its top, resize it from its corner; it saves its text, colour and place. */
function NoteWindow({ id, z, onNew, onChanged }: { id: string; z: number; onNew: (near: { x: number; y: number }) => void; onChanged: () => void }) {
  const [note, setNote] = useState<QuickNote | null>(() => known.get(id) || null), [menu, setMenu] = useState(false), [empty, setEmpty] = useState(true), [saving, setSaving] = useState<'' | 'saving' | 'error'>('');
  const box = useRef<HTMLDivElement>(null), body = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null);
  const timer = useRef<any>(null), last = useRef('');
  useEffect(() => {
    known.delete(id);
    api.quickNote(id).then((n) => {
      setNote(n);
      const html = cleanHtml(n.body || '');
      last.current = html;
      // A note with nothing written in it starts plain (not inside a list or heading left from before).
      if (body.current) { body.current.innerHTML = html; if (blankBody(body.current)) body.current.innerHTML = ''; setEmpty(!body.current.innerHTML); if (!body.current.innerHTML) body.current.focus(); }
      if (!n.open) void api.saveQuickNote(id, { open: true }).catch(() => {});
    }).catch((e) => { toast(e.message, true); closeNote(id); });
    return () => clearTimeout(timer.current);
  }, [id]);
  const save = (patch: Parameters<typeof api.saveQuickNote>[1]) => api.saveQuickNote(id, patch).then(() => { setSaving(''); onChanged(); }, (e) => { setSaving('error'); toast(e.message, true); });
  // The text saves a moment after the last keystroke, and right away when the note is closed.
  const changedText = () => {
    const el = body.current!; setEmpty(blankBody(el));
    clearTimeout(timer.current); setSaving('saving');
    timer.current = setTimeout(() => { const html = cleanHtml(el.innerHTML); if (html !== last.current) { last.current = html; void save({ body: html }); } else setSaving(''); }, 600);
  };
  const close = async () => {
    clearTimeout(timer.current);
    const html = body.current ? cleanHtml(body.current.innerHTML) : last.current;
    closeNote(id);
    await api.saveQuickNote(id, { open: false, ...(html !== last.current ? { body: html } : {}) }).then(onChanged, (e) => toast(e.message, true));
  };
  const remove = async () => {
    if (!confirm('Xoá ghi chú này? Không khôi phục được.')) return;
    clearTimeout(timer.current); closeNote(id);
    try { await api.removeQuickNote(id); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  // Dragging by the top bar; the place is kept when the pointer lets go.
  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button') || !box.current) return;
    raise(id);
    const el = box.current, sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
    const move = (m: PointerEvent) => { el.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, m.clientX - sx))}px`; el.style.top = `${Math.max(8, Math.min(window.innerHeight - 40, m.clientY - sy))}px`; };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); void save({ x: el.offsetLeft, y: el.offsetTop }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  // A new size is kept once the corner stops moving.
  useEffect(() => {
    const el = box.current; if (!el || !note) return;
    let t: any, first = true;
    const ro = new ResizeObserver(() => { if (first) { first = false; return; } clearTimeout(t); t = setTimeout(() => void save({ w: el.offsetWidth, h: el.offsetHeight }), 500); });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(t); };
  }, [!!note]); // eslint-disable-line react-hooks/exhaustive-deps

  const cmd = (name: string, value?: string) => { body.current?.focus(); document.execCommand(name, false, value); changedText(); };
  const block = (tag: 'H1' | 'H2') => { const cur = document.queryCommandValue('formatBlock').toUpperCase(); cmd('formatBlock', cur === tag ? 'P' : tag); };
  const code = () => { const sel = window.getSelection(); const text = sel?.toString() || ''; cmd('insertHTML', `<code>${escapeHtml(text || 'code')}</code>&nbsp;`); };
  const checklist = () => {
    cmd('insertUnorderedList');
    const sel = window.getSelection(), ul = sel?.anchorNode && (sel.anchorNode.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode.parentElement)?.closest('ul');
    if (ul && body.current?.contains(ul)) { if (ul.hasAttribute('data-check')) ul.removeAttribute('data-check'); else ul.setAttribute('data-check', ''); changedText(); }
  };
  const picture = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif|heic|heif)$/.test(f.type)) return toast('Hãy chọn ảnh PNG, JPEG, WebP hoặc GIF', true);
    try { const url = await shrink(f); cmd('insertHTML', `<img src="${url}" alt="">`); } catch { toast('Không đọc được ảnh này', true); }
  };
  // A checklist item is ticked by clicking its box (the space before its text).
  const click = (e: React.MouseEvent) => {
    const li = (e.target as HTMLElement).closest('ul[data-check] > li') as HTMLElement | null;
    if (!li || e.clientX - li.getBoundingClientRect().left > 22) return;
    e.preventDefault();
    if (li.hasAttribute('data-checked')) li.removeAttribute('data-checked'); else li.setAttribute('data-checked', '');
    changedText();
  };
  const paste = (e: React.ClipboardEvent) => {
    const img = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
    if (img) { e.preventDefault(); void picture(img); return; }
    const html = e.clipboardData.getData('text/html');
    if (html) { e.preventDefault(); document.execCommand('insertHTML', false, cleanHtml(html)); changedText(); }
  };
  const color = note?.color || 'yellow';
  const title = note && body.current ? (body.current.innerText.split('\n').find((l) => l.trim()) || '').trim() : '';
  // Unseen until its place is known (opened from search), rather than drawn elsewhere first and then jumping.
  return (
    <div ref={box} className={'qn-win c-' + color} style={{ zIndex: z, left: note?.x ?? 80, top: Math.max(8, note?.y ?? 90), width: note?.w ?? 360, height: note?.h ?? 340, ...(note ? {} : { opacity: 0, pointerEvents: 'none' as const }) }} onPointerDown={() => raise(id)} role="dialog" aria-label="Ghi chú">
      <header onPointerDown={drag}>
        <button className="qn-ico" onClick={() => onNew({ x: box.current?.offsetLeft || 80, y: box.current?.offsetTop || 90 })} aria-label="Ghi chú mới" title="Ghi chú mới"><Icon name="plus" size={16} /></button>
        <b>{title.slice(0, 40) || 'Ghi chú mới'}</b>
        {saving === 'saving' && <small>Đang lưu…</small>}{saving === 'error' && <small className="err">Chưa lưu</small>}
        <button className="qn-ico" onClick={() => setMenu(!menu)} aria-label="Tuỳ chọn" aria-expanded={menu}><Icon name="more" size={16} /></button>
        <button className="qn-ico" onClick={() => void close()} aria-label="Đóng ghi chú"><Icon name="x" size={16} /></button>
      </header>
      {menu && <div className="qn-menu" onPointerDown={(e) => e.stopPropagation()}>
        <div className="qn-swatches">{NOTE_COLORS.map(([c, label]) => <button key={c} className={'c-' + c} aria-label={`Màu ${label}`} aria-pressed={c === color} onClick={() => { setNote(note && { ...note, color: c }); setMenu(false); void save({ color: c }); }}>{c === color && <Icon name="check" size={16} />}</button>)}</div>
        <button onClick={() => { setMenu(false); toggleNotesPanel(true); }}><Icon name="list" size={16} />Danh sách ghi chú</button>
        <button className="danger" onClick={() => { setMenu(false); void remove(); }}><Icon name="trash" size={16} />Xoá</button>
      </div>}
      <div className="qn-body-wrap">
        {empty && <span className="qn-placeholder">Nhập ghi chú…</span>}
        <div ref={body} className="qn-body" contentEditable suppressContentEditableWarning onInput={changedText} onPaste={paste} onClick={click} onBlur={() => { if (timer.current) { clearTimeout(timer.current); const html = cleanHtml(body.current!.innerHTML); if (html !== last.current) { last.current = html; void save({ body: html }); } } }} aria-label="Nội dung ghi chú" />
      </div>
      <footer onMouseDown={(e) => e.preventDefault()}>
        <button onClick={() => cmd('bold')} title="Đậm" aria-label="Đậm"><Icon name="bold" size={16} /></button>
        <button onClick={() => cmd('italic')} title="Nghiêng" aria-label="Nghiêng"><Icon name="italic" size={16} /></button>
        <button onClick={code} title="Mã" aria-label="Mã"><Icon name="code" size={16} /></button>
        <button onClick={() => block('H1')} title="Tiêu đề 1" aria-label="Tiêu đề 1" className="qn-txt"><span>H<sub>1</sub></span></button>
        <button onClick={() => block('H2')} title="Tiêu đề 2" aria-label="Tiêu đề 2" className="qn-txt"><span>H<sub>2</sub></span></button>
        <button onClick={() => cmd('insertOrderedList')} title="Danh sách đánh số" aria-label="Danh sách đánh số"><Icon name="olist" size={16} /></button>
        <button onClick={() => cmd('insertUnorderedList')} title="Danh sách chấm" aria-label="Danh sách chấm"><Icon name="list" size={16} /></button>
        <button onClick={checklist} title="Danh sách việc cần làm" aria-label="Danh sách việc cần làm"><Icon name="checklist" size={16} /></button>
        <button onClick={() => file.current?.click()} title="Chèn ảnh" aria-label="Chèn ảnh"><Icon name="photo" size={16} /></button>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void picture(e.target.files?.[0]); e.target.value = ''; }} />
      </footer>
    </div>
  );
}
