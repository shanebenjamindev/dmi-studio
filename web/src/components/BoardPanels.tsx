// The panels around a board, like Trello's: the person's Inbox (cards jotted down, then dragged onto a list to put them
// on a board), the Planner (their dated cards, a week at a time; a card dragged onto another day moves its due date,
// including a card dragged from the board), the dock at the bottom that shows or hides each, and "Switch boards".
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import { Icon } from './ui';
import { dueState } from './boardkit';
import type { BoardItem, PlannerCard, Workspace } from '../types';
import { useMessengerState } from './Messenger';
import { WEEKDAYS } from '../i18n';

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

// ---------------------------------------------------------------- planner
const DAY = 864e5;
/** Midnight on the Monday of the week of `t`. */
const monday = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime(); };
const addDays = (t: number, n: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
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
              <h3><span>{WEEKDAYS[new Date(d).getDay()]}</span><b>{new Date(d).getDate()}</b>{isToday && <em>Hôm nay</em>}</h3>
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
  const icon: Record<keyof Panels, string> = { inbox: 'messenger', planner: 'calendar', board: 'boards' };
  const msg = useMessengerState();
  const totalUnread = Object.values(msg.unreadMap).reduce((a, b) => a + b, 0);
  const isInboxOpen = msg.openWindows.length > 0;
  return (
    <nav className="bd-dock" aria-label="Bảng điều khiển">
      {(Object.keys(icon) as (keyof Panels)[]).map((k) => {
        const active = k === 'inbox' ? isInboxOpen : panels[k];
        return (
          <button key={k} className={active ? 'on' : ''} aria-pressed={active} onClick={() => onToggle(k)}>
            <Icon name={icon[k]} size={16} />
            {PANEL_NAME[k]}
            {k === 'inbox' && totalUnread > 0 && <span className="bd-dock-badge">{totalUnread > 9 ? '9+' : totalUnread}</span>}
          </button>
        );
      })}
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
