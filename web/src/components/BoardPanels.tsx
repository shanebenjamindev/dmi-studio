// The panels around a board, like Trello's: the person's Inbox (cards jotted down, then dragged onto a list to put them
// on a board), the Planner (their dated cards, a week at a time; a card dragged onto another day moves its due date,
// including a card dragged from the board), the dock at the bottom that shows or hides each, and "Switch boards".
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import { Icon } from './ui';
import { Pop, dueState } from './boardkit';
import type { BoardItem, InboxItem, PlannerCard, Workspace } from '../types';

/** What is being dragged from one panel to another: an inbox item (onto a list) or a board card (onto a planner day). */
export const dragged: { inbox: { id: string; h: number } | null; card: { id: string; dueAt: number | null; startAt: number | null } | null } = { inbox: null, card: null };
type Topic = 'inbox' | 'planner' | 'board';
const subs = new Map<Topic, Set<() => void>>();
/** Tell the panels showing `what` to read it again. */
export function changed(what: Topic) { subs.get(what)?.forEach((f) => f()); }
export function useChanged(what: Topic, f: () => void) {
  const ref = useRef(f);
  ref.current = f;
  useEffect(() => {
    const g = () => ref.current();
    if (!subs.has(what)) subs.set(what, new Set());
    subs.get(what)!.add(g);
    return () => { subs.get(what)!.delete(g); };
  }, [what]);
}

export type Panels = { inbox: boolean; planner: boolean; board: boolean };
export const PANEL_NAME: Record<keyof Panels, string> = { inbox: 'Inbox', planner: 'Planner', board: 'Board' };

// ---------------------------------------------------------------- inbox
export function InboxPanel({ onHide }: { onHide: () => void }) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [text, setText] = useState('');
  const [edit, setEdit] = useState<{ id: string; title: string } | null>(null);
  const [hideDone, setHideDone] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [ph, setPh] = useState<number | null>(null);
  const phRef = useRef<number | null>(null);
  const load = () => api.inbox().then(setItems).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []);
  useChanged('inbox', load);
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e: any) { toast(e.message, true); } load(); };
  const add = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    act(async () => { const x = await api.addInbox(t, true); setItems((l) => [x, ...(l || [])]); });
  };
  const save = () => {
    const e = edit, t = e?.title.trim();
    setEdit(null);
    if (!e || !t || t === items?.find((x) => x.id === e.id)?.title) return;
    setItems((l) => l && l.map((x) => (x.id === e.id ? { ...x, title: t } : x)));
    act(() => api.updateInbox(e.id, { title: t }));
  };
  const shown = (items || []).filter((x) => !hideDone || !x.done);
  const doneCount = (items || []).filter((x) => x.done).length;
  const end = () => { dragged.inbox = null; setDrag(null); setPh(null); phRef.current = null; };
  const over = (e: React.DragEvent<HTMLElement>) => {
    if (!dragged.inbox) return;
    e.preventDefault();
    const els = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-inbox]')].filter((el) => el.dataset.inbox !== dragged.inbox!.id);
    let i = els.findIndex((el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (i < 0) i = els.length;
    if (phRef.current !== i) { phRef.current = i; setPh(i); }
  };
  const drop = (e: React.DragEvent) => {
    const d = dragged.inbox, to = phRef.current;
    if (!d || to === null) return;
    e.preventDefault();
    end();
    // The place among the items shown becomes the place among all of them.
    const rest = (items || []).filter((x) => x.id !== d.id), anchor = rest.filter((x) => !hideDone || !x.done)[to];
    const index = anchor ? rest.indexOf(anchor) : rest.length;
    setItems((l) => { if (!l) return l; const x = l.find((y) => y.id === d.id)!, r = l.filter((y) => y.id !== d.id); r.splice(index, 0, x); return r; });
    act(() => api.updateInbox(d.id, { index }));
  };
  const rows = shown.map((x) => (
    <li key={x.id} data-inbox={x.id} className={'bp-item' + (x.done ? ' done' : '') + (drag === x.id ? ' dragging' : '')} draggable={edit?.id !== x.id}
      onDragStart={(e) => { dragged.inbox = { id: x.id, h: e.currentTarget.offsetHeight }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.title); setTimeout(() => setDrag(x.id), 0); }}
      onDragEnd={end}>
      <button className={'bp-mark' + (x.done ? ' on' : '')} onClick={() => { setItems((l) => l && l.map((y) => (y.id === x.id ? { ...y, done: !x.done } : y))); act(() => api.updateInbox(x.id, { done: !x.done })); }}
        aria-label={x.done ? 'Bỏ đánh dấu hoàn thành' : 'Đánh dấu hoàn thành'}>{x.done && <Icon name="check" size={11} />}</button>
      {edit?.id === x.id
        ? <textarea className="bp-edit" autoFocus rows={2} value={edit.title} onChange={(e) => setEdit({ id: x.id, title: e.target.value })} onBlur={save}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === 'Escape') setEdit(null); }} />
        : <span className="bp-title" onClick={() => setEdit({ id: x.id, title: x.title })} title="Sửa">{x.title}</span>}
      <button className="bp-x" onClick={() => { setItems((l) => l && l.filter((y) => y.id !== x.id)); act(() => api.deleteInbox(x.id)); }} aria-label="Xoá thẻ"><Icon name="x" size={13} /></button>
    </li>
  ));
  if (ph !== null) {
    let seen = 0, at = rows.length;
    for (let i = 0; i < shown.length; i++) { if (shown[i].id === drag) continue; if (seen === ph) { at = i; break; } seen++; }
    rows.splice(at, 0, <li key="ph" className="bp-ph" style={{ height: dragged.inbox?.h || 40 }} />);
  }
  return (
    <aside className="bp-panel bp-inbox" aria-label="Inbox">
      <header className="bp-head">
        <Icon name="inbox" size={18} /><h2>Inbox</h2>
        <button className={'bd-icon' + (hideDone ? ' on' : '')} onClick={() => setHideDone(!hideDone)} aria-pressed={hideDone} title={hideDone ? 'Hiện thẻ đã xong' : 'Ẩn thẻ đã xong'}><Icon name="filter" size={15} /></button>
        <button className="bd-icon" onClick={(e) => setMenu(menu ? null : e.currentTarget)} aria-label="Thao tác với Inbox"><Icon name="more" size={15} /></button>
      </header>
      <form className="bp-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Thêm thẻ" aria-label="Thêm thẻ vào Inbox" />
      </form>
      <ul className="bp-list" onDragOver={over} onDrop={drop}>
        {items === null ? <li className="bp-note">Đang tải…</li> : rows}
        {items && !shown.length && ph === null && <li className="bp-note">{items.length ? 'Mọi thẻ đã xong.' : 'Ghi nhanh việc cần làm ở đây, rồi kéo thẻ sang một danh sách để đưa lên board.'}</li>}
      </ul>
      <p className="bp-foot"><Icon name="info" size={13} />Kéo thẻ sang danh sách trên board để giao việc.</p>
      {menu && (
        <Pop anchor={menu} title="Inbox" onClose={() => setMenu(null)}>
          <div className="bk-menu">
            <button disabled={!doneCount} onClick={() => { setMenu(null); const done = (items || []).filter((x) => x.done); setItems((l) => l && l.filter((x) => !x.done)); act(() => Promise.all(done.map((x) => api.deleteInbox(x.id)))); }}>
              <Icon name="trash" size={15} />Xoá {doneCount || ''} thẻ đã xong
            </button>
            <button onClick={() => { setMenu(null); onHide(); }}><Icon name="left" size={15} />Ẩn Inbox</button>
          </div>
        </Pop>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------- planner
const DAY = 864e5;
/** Midnight on the Monday of the week of `t`. */
const monday = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime(); };
const addDays = (t: number, n: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const two = (n: number) => String(n).padStart(2, '0');
const hm = (t: number) => { const d = new Date(t); return `${two(d.getHours())}:${two(d.getMinutes())}`; };

export function PlannerPanel({ bgOf, onOpen, onHide }: { bgOf: (k: string) => string; onOpen: (board: string, card: string) => void; onHide: () => void }) {
  const [week, setWeek] = useState(() => monday(Date.now()));
  const [cards, setCards] = useState<PlannerCard[] | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const own = useRef<PlannerCard | null>(null);
  const end = addDays(week, 7), days = Array.from({ length: 7 }, (_, i) => addDays(week, i)), today = monday(Date.now()) === week ? new Date().getDay() : -1;
  const load = () => api.planner(week, end).then(setCards).catch((e) => toast(e.message, true));
  useEffect(() => {
    setCards(null); load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 15000);
    return () => clearInterval(t);
  }, [week]); // eslint-disable-line react-hooks/exhaustive-deps
  useChanged('planner', load);
  const when = (c: PlannerCard) => c.dueAt ?? c.startAt!;
  const dropOn = async (e: React.DragEvent, day: number) => {
    const c = own.current || dragged.card;
    setOver(null);
    if (!c) return;
    e.preventDefault();
    own.current = null;
    // The same time of day on the new day (17:00 for a card without a due time).
    const old = c.dueAt ? new Date(c.dueAt) : null;
    const due = new Date(day).setHours(old ? old.getHours() : 17, old ? old.getMinutes() : 0);
    if (due === c.dueAt) return;
    try {
      await api.updateCard(c.id, { dueAt: due, ...(c.startAt && c.startAt > due ? { startAt: null } : {}) });
      changed('board');
    } catch (err: any) { toast(err.message, true); }
    load();
  };
  const range = `${new Date(week).getDate()}/${new Date(week).getMonth() + 1} – ${new Date(end - DAY).getDate()}/${new Date(end - DAY).getMonth() + 1}`;
  return (
    <aside className="bp-panel bp-planner" aria-label="Planner">
      <header className="bp-head">
        <Icon name="calendar" size={18} /><h2>Planner</h2>
        <button className="bd-icon" onClick={onHide} aria-label="Ẩn Planner" title="Ẩn Planner"><Icon name="x" size={15} /></button>
      </header>
      <div className="bp-week">
        <button className="bd-icon" onClick={() => setWeek(addDays(week, -7))} aria-label="Tuần trước"><Icon name="left" size={15} /></button>
        <b>{range}</b>
        <button className="bd-icon" onClick={() => setWeek(addDays(week, 7))} aria-label="Tuần sau"><Icon name="right" size={15} /></button>
        <span className="bd-gap" />
        <button className="btn btn-gray btn-sm" disabled={today >= 0} onClick={() => setWeek(monday(Date.now()))}>Tuần này</button>
      </div>
      <div className="bp-days">
        {days.map((d, i) => {
          const list = (cards || []).filter((c) => { const t = when(c); return t >= d && t < addDays(d, 1); });
          const isToday = new Date(d).getDay() === today;
          return (
            <section key={d} className={'bp-day' + (isToday ? ' today' : '') + (over === i ? ' over' : '')}
              onDragOver={(e) => { if (own.current || dragged.card) { e.preventDefault(); if (over !== i) setOver(i); } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
              onDrop={(e) => dropOn(e, d)}>
              <h3><span>{WEEKDAY[new Date(d).getDay()]}</span><b>{new Date(d).getDate()}</b>{isToday && <em>Hôm nay</em>}</h3>
              {list.map((c) => {
                const due = dueState(c.dueAt, c.done);
                return (
                  <button key={c.id} className={'bp-card' + (c.done ? ' done' : '')} draggable={c.canEdit} onClick={() => onOpen(c.boardId, c.id)}
                    onDragStart={(e) => { own.current = c; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.title); }} onDragEnd={() => { own.current = null; setOver(null); }}>
                    <i style={{ background: bgOf(c.boardBg) }} />
                    <span><b>{c.title}</b><small>{c.boardName} · {c.listName}</small></span>
                    {c.dueAt && <em className={'bp-time ' + (due || '')}>{c.done ? <Icon name="check" size={11} /> : null}{hm(c.dueAt)}</em>}
                  </button>
                );
              })}
            </section>
          );
        })}
        {cards !== null && !cards.length && <p className="bp-note">Tuần này chưa có thẻ nào của bạn có ngày. Kéo một thẻ trên board vào một ngày để đặt hạn.</p>}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- the dock and "Switch boards"
export function Dock({ panels, onToggle, onSwitch, switching }: { panels: Panels; onToggle: (k: keyof Panels) => void; onSwitch: () => void; switching: boolean }) {
  const icon: Record<keyof Panels, string> = { inbox: 'inbox', planner: 'calendar', board: 'boards' };
  return (
    <nav className="bd-dock" aria-label="Bảng điều khiển">
      {(Object.keys(icon) as (keyof Panels)[]).map((k) => (
        <button key={k} className={panels[k] ? 'on' : ''} aria-pressed={panels[k]} onClick={() => onToggle(k)}><Icon name={icon[k]} size={16} />{PANEL_NAME[k]}</button>
      ))}
      <span className="bd-dock-sep" />
      <button className={switching ? 'on' : ''} onClick={onSwitch}><Icon name="grid" size={16} />Đổi board</button>
    </nav>
  );
}

export function SwitchBoards({ boards, spaces, recent, current, bgOf, onOpen, onHome, onCreate, onClose }: {
  boards: BoardItem[]; spaces: Workspace[]; recent: BoardItem[]; current: string | null; bgOf: (k: string) => string;
  onOpen: (id: string) => void; onHome: () => void; onCreate: () => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const tabs: [string, string][] = [['all', 'Tất cả'], ['recent', 'Gần đây'], ['starred', 'Đã gắn sao'], ...spaces.map((w) => [w.id, w.name] as [string, string])];
  const from = tab === 'recent' ? recent : tab === 'starred' ? boards.filter((b) => b.starred) : tab === 'all' ? boards : boards.filter((b) => b.workspaceId === tab);
  const list = from.filter((b) => b.name.toLowerCase().includes(q.trim().toLowerCase()));
  const wsName = new Map(spaces.map((w) => [w.id, w.name]));
  return (
    <div className="bd-modal bd-switch-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bd-switch" role="dialog" aria-label="Đổi board">
        <header>
          <label className="bd-switch-search"><Icon name="search" size={16} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm board của bạn" /></label>
          <button className="bd-icon" onClick={onClose} aria-label="Đóng"><Icon name="x" size={16} /></button>
        </header>
        <div className="bd-switch-tabs" role="tablist">
          {tabs.map(([k, name]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{name}</button>)}
        </div>
        <div className="bd-switch-grid">
          {list.map((b) => (
            <button key={b.id} className={'bd-switch-tile' + (b.id === current ? ' on' : '')} style={{ background: bgOf(b.bg) }} onClick={() => onOpen(b.id)}>
              <b>{b.name}</b><small>{wsName.get(b.workspaceId) || ''}</small>{b.starred && <Icon name="star" size={13} />}
            </button>
          ))}
          {!list.length && <p className="note">{q ? 'Không có board nào khớp.' : tab === 'starred' ? 'Gắn sao cho board để tìm lại nhanh.' : tab === 'recent' ? 'Chưa mở board nào.' : 'Chưa có board nào.'}</p>}
        </div>
        <footer>
          <button className="btn btn-gray btn-sm" onClick={onHome}><Icon name="grid" size={14} />Tất cả workspace và board</button>
          <button className="btn btn-primary btn-sm" onClick={onCreate}><Icon name="plus" size={14} />Tạo board</button>
        </footer>
      </div>
    </div>
  );
}
