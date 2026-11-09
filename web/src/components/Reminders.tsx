// Nhắc việc: a round button at the bottom of the navigation with how much of the person's work is new, late or due
// today, and a panel listing it: Quan trọng (just given to them, late or due today, then the week ahead), Hôm nay, Muộn.
// Their tasks (assigned to them, not finished) and board cards (theirs, not done) with a due date; a card that is a
// task's shows once, as the task. What was just given to them comes from their unread notifications, as soon as the
// bell hears of it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { goto, openCard, openLink, openTask } from '../store';
import { Icon } from './ui';
import type { NotificationInbox } from '../types';

type Item = { id: string; title: string; where: string; dueAt: number; open: () => void };
type Given = NotificationInbox['items'][number];
/** Notifications that something was just given to the person: a task, or a place on a card. */
const GIVEN = new Set(['Bạn được giao công việc', 'Bạn được thêm vào thẻ']);
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'Vừa xong' : m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.round(m / 60)} giờ trước` : `${Math.round(m / 1440)} ngày trước`; };
type Tab = 'important' | 'today' | 'late';
const DAY = 864e5;
const dayStart = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const time = (t: number) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
/** When it is due, said the short way: "14:30", "Mai 09:00", "Th 5 · 17:00", "12/11 · 17:00". */
function due(t: number) {
  const today = dayStart(), d = dayStart(t);
  if (d === today) return time(t);
  if (d === today + DAY) return `Mai ${time(t)}`;
  if (d === today - DAY) return `Hôm qua ${time(t)}`;
  if (d > today && d < today + 7 * DAY) return `${new Date(t).toLocaleDateString('vi-VN', { weekday: 'short' })} · ${time(t)}`;
  return `${new Date(t).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} · ${time(t)}`;
}

async function loadItems(): Promise<Item[]> {
  const today = dayStart();
  const [{ tasks }, cards] = await Promise.all([
    api.tasks({ scope: 'mine', rel: 'assigned', state: 'open' }),
    // The planner reads at most two months: late ones of the last seven weeks and the week ahead.
    api.planner(today - 54 * DAY, today + 8 * DAY).catch(() => []),
  ]);
  const asTask = new Set(tasks.map((t) => t.boardLink?.cardId).filter(Boolean));
  return [
    ...tasks.filter((t) => t.dueAt).map((t) => ({ id: t.id, title: t.title, where: t.project?.name || 'Công việc', dueAt: t.dueAt!, open: () => openTask(t.id) })),
    ...cards.filter((c) => c.dueAt && !c.done && !asTask.has(c.id)).map((c) => ({ id: c.id, title: c.title, where: `${c.boardName} · ${c.listName}`, dueAt: c.dueAt!, open: () => openCard(c.boardId, c.id) })),
  ].sort((a, b) => a.dueAt - b.dueAt);
}

export function Reminders() {
  const [items, setItems] = useState<Item[] | null>(null), [error, setError] = useState('');
  const [open, setOpen] = useState(false), [tab, setTab] = useState<Tab>('important'), [given, setGiven] = useState<Given[]>([]);
  const load = useCallback(() => { loadItems().then((x) => { setItems(x); setError(''); }, (e) => setError(e.message)); }, []);
  // Several changes in a row (a drag, a form saving its fields) reload once.
  const later = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const soon = useCallback(() => { clearTimeout(later.current); later.current = setTimeout(load, 600); }, [load]);
  // What was just given: the bell's unread notifications (it checks every few seconds). Any news of the person's work
  // (given, done, moved, a new date) refreshes the lists as well, so the bell and Nhắc việc never disagree.
  useEffect(() => {
    let newest: number | null = null;
    const take = (d: NotificationInbox) => {
      const latest = Math.max(0, ...d.items.map((i) => i.createdAt));
      if (newest !== null && latest > newest) soon();
      newest = latest; setGiven(d.items.filter((i) => !i.read && GIVEN.has(i.title)));
    };
    // The bell loads the inbox as the page opens and passes it on; only if it has not within a few seconds is it asked here.
    const first = setTimeout(() => { if (newest === null) api.notificationInbox().then(take, () => {}); }, 3000);
    const on = (e: Event) => take((e as CustomEvent<NotificationInbox>).detail);
    window.addEventListener('dms:inbox', on);
    return () => { clearTimeout(first); window.removeEventListener('dms:inbox', on); };
  }, [soon]);
  useEffect(() => {
    load();
    // Fresh when the panel opens, after changes elsewhere, and every few minutes as time passes.
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 5 * 60e3);
    window.addEventListener('dms:entities-changed', soon);
    return () => { clearInterval(t); clearTimeout(later.current); window.removeEventListener('dms:entities-changed', soon); };
  }, [load, soon]);
  useEffect(() => { if (open) loadItems().then(setItems, () => {}); }, [open]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const off = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.rm-panel, .rm-button')) setOpen(false); };
    document.addEventListener('keydown', esc); document.addEventListener('mousedown', off);
    return () => { document.removeEventListener('keydown', esc); document.removeEventListener('mousedown', off); };
  }, [open]);

  const now = Date.now(), today = dayStart(), tomorrow = today + DAY;
  const all = items || [];
  const late = all.filter((x) => x.dueAt < now), dueToday = all.filter((x) => x.dueAt >= now && x.dueAt < tomorrow);
  const week = all.filter((x) => x.dueAt >= tomorrow && x.dueAt < today + 8 * DAY);
  const counted = new Set([...late, ...dueToday].map((x) => x.id)), fresh = given.filter((g) => !g.taskId || !counted.has(g.taskId));
  const count = late.length + dueToday.length + fresh.length;
  const openGiven = (g: Given) => {
    setOpen(false); setGiven((list) => list.filter((x) => x.id !== g.id));
    api.readNotifications(g.id).then(() => window.dispatchEvent(new Event('dms:notifications-changed')), () => {});
    if (g.taskId) openTask(g.taskId); else if (g.link) openLink(g.link);
  };
  // Each tab: what needs attention now (red), then what comes next.
  const view: Record<Tab, { alert: Item[]; alertText: string; next: Item[]; nextText: string; none: string }> = {
    important: { alert: [...late, ...dueToday], alertText: 'Một số điều bạn cần chú ý', next: week, nextText: 'Sắp tới', none: 'Không có việc nào trễ hạn hay đến hạn trong tuần này.' },
    today: { alert: all.filter((x) => x.dueAt >= today && x.dueAt < now), alertText: 'Đã qua giờ hạn hôm nay', next: dueToday, nextText: 'Còn lại hôm nay', none: 'Hôm nay không có việc nào đến hạn.' },
    late: { alert: late, alertText: 'Đã trễ hạn', next: [], nextText: '', none: 'Không có việc nào trễ hạn.' },
  };
  const v = view[tab];
  const row = (x: Item, alert: boolean) => (
    <li key={x.id}><button onClick={() => { setOpen(false); x.open(); }}>
      <span className={'rm-dot' + (alert ? ' alert' : '')} />
      <span className="rm-text"><b>{x.title}</b><small>{x.where}</small></span>
      <time className={alert ? 'alert' : ''}>{due(x.dueAt)}</time><Icon name="right" size={14} />
    </button></li>
  );
  return <>
    <button className={'rail-item rm-button' + (open ? ' on' : '') + (given.length ? ' has-new' : '')} onClick={() => { if (!open && given.length) setTab('important'); setOpen(!open); }} aria-expanded={open} title="Nhắc việc">
      <span className="rm-ring"><Icon name="clock" size={20} />{count > 0 && <em aria-label={`${count} việc mới được giao, trễ hoặc đến hạn hôm nay`}>{count > 99 ? '99+' : count}</em>}</span><span>Nhắc việc</span>
    </button>
    {open && createPortal(
      <aside className="rm-panel" role="dialog" aria-label="Nhắc việc">
        <header><b>Nhắc việc</b><button className="bd-icon" onClick={() => setOpen(false)} aria-label="Đóng"><Icon name="x" size={16} /></button></header>
        <nav className="rm-tabs" role="tablist">{([['important', 'Quan trọng'], ['today', 'Hôm nay'], ['late', 'Muộn']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}{k === 'late' && late.length > 0 && <em>{late.length}</em>}</button>
        ))}</nav>
        <div className="rm-body">
          {error ? <p className="note err" role="alert">{error}</p> : !items ? <p className="note">Đang tải…</p> : <>
            {tab === 'important' && given.length > 0 && <section className="rm-new"><h3>Mới được giao cho bạn<span>{given.length}</span></h3><ul>{given.map((g) => (
              <li key={g.id}><button onClick={() => openGiven(g)}>
                <span className="rm-dot new" />
                <span className="rm-text"><b>{g.body || g.title}</b><small>{g.title}{g.detail?.status ? ` · ${g.detail.status}` : ''}</small></span>
                <time>{g.detail?.dueAt ? due(g.detail.dueAt) : ago(g.createdAt)}</time><Icon name="right" size={14} />
              </button></li>
            ))}</ul></section>}
            {v.alert.length > 0 && <section className="rm-alert"><h3>{v.alertText}<span>{v.alert.length}</span></h3><ul>{v.alert.map((x) => row(x, true))}</ul></section>}
            {v.next.length > 0 && <section><h3>{v.nextText}<span>{v.next.length}</span></h3><ul>{v.next.map((x) => row(x, false))}</ul></section>}
            {!v.alert.length && !v.next.length && !(tab === 'important' && given.length) && <div className="rm-empty"><Icon name="check" size={26} /><p>{v.none}</p></div>}
          </>}
        </div>
        <footer><button onClick={() => { setOpen(false); goto('tasks'); }}>Mở danh sách công việc</button></footer>
      </aside>, document.body)}
  </>;
}
