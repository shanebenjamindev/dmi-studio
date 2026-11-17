import {useState} from 'react';
import {goto} from '../store';
import {Icon} from './ui';
import {stepCode} from './taskkit';
import type {TaskItem} from '../types';

// Hồ sơ › the person's tasks, in the order they need doing: overdue first, then open, then the finished and cancelled
// ones folded away. Each group shows its first few tasks; the counters on top pick one group, and a search shows up once
// there are enough tasks to need one.
type Group = 'late' | 'open' | 'done' | 'cancelled';
const GROUPS: {key: Group; label: string; open: boolean}[] = [
  {key: 'late', label: 'Quá hạn', open: true},
  {key: 'open', label: 'Đang mở', open: true},
  {key: 'done', label: 'Hoàn thành', open: false},
  {key: 'cancelled', label: 'Đã huỷ', open: false},
];
const FIRST = 5, SEARCH_FROM = 8;
const groupOf = (t: TaskItem): Group => t.state === 'overdue' ? 'late' : t.state === 'done' || t.state === 'done_late' ? 'done' : t.state === 'cancelled' ? 'cancelled' : 'open';
/** Soonest due first (no due date last); finished ones newest first. */
const order = (g: Group) => (a: TaskItem, b: TaskItem) => g === 'done' ? (b.doneAt || 0) - (a.doneAt || 0) : (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);
const date = (n: number) => new Date(n).toLocaleDateString('vi-VN', {timeZone: 'Asia/Ho_Chi_Minh'});

export function ProfileTasks({tasks, title, loading}: {tasks: TaskItem[]; title: string; loading: boolean}) {
  const [only, setOnly] = useState<Group | null>(null), [q, setQ] = useState('');
  const [shut, setShut] = useState<Record<string, boolean>>(() => Object.fromEntries(GROUPS.map((g) => [g.key, !g.open])));
  const [all, setAll] = useState<Record<string, boolean>>({});
  const term = q.trim().toLowerCase();
  const hit = (t: TaskItem) => !term || t.title.toLowerCase().includes(term) || (t.project?.name || '').toLowerCase().includes(term);
  const by = (g: Group) => tasks.filter((t) => groupOf(t) === g);
  const count = (g: Group) => (loading ? '—' : by(g).length);
  const pick = (g: Group | null) => { setOnly(only === g ? null : g); if (g) setShut((s) => ({...s, [g]: false})); };
  const open = (t: TaskItem) => { history.replaceState(null, '', `#tasks/${t.id}`); goto('tasks'); };
  const shown = GROUPS.filter((g) => !only || g.key === only).map((g) => ({...g, rows: by(g.key).filter(hit).sort(order(g.key))})).filter((g) => g.rows.length || g.key === only);
  return <>
    <div className="staff-stats profile-counters">
      <button className={'staff-stat-box' + (!only ? ' on' : '')} aria-pressed={!only} onClick={() => setOnly(null)}><span>Tổng công việc</span><b>{loading ? '—' : tasks.length}</b></button>
      <button className={'staff-stat-box is-open' + (only === 'open' ? ' on' : '')} aria-pressed={only === 'open'} onClick={() => pick('open')}><span>Đang mở</span><b>{count('open')}</b></button>
      <button className={'staff-stat-box is-done' + (only === 'done' ? ' on' : '')} aria-pressed={only === 'done'} onClick={() => pick('done')}><span>Hoàn thành</span><b>{count('done')}</b></button>
      <button className={'staff-stat-box is-late' + (only === 'late' ? ' on' : '')} aria-pressed={only === 'late'} onClick={() => pick('late')}><span>Quá hạn</span><b>{count('late')}</b></button>
    </div>
    <header className="profile-work-heading">
      <h2>{title}</h2>
      {tasks.length >= SEARCH_FROM && <label className="profile-task-search"><Icon name="search" size={13}/><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm việc hoặc dịch vụ" aria-label="Tìm công việc trong hồ sơ"/></label>}
    </header>
    {!tasks.length ? <p className="profile-empty">Chưa có công việc được giao.</p> : !shown.length ? <p className="profile-empty">Không có công việc khớp bộ lọc.</p> : <div className="profile-task-groups">
      {shown.map((g) => {
        const closed = shut[g.key] && !term, many = g.rows.length > FIRST && !all[g.key];
        return <section key={g.key} className={'profile-task-group is-' + g.key}>
          <button className="profile-task-group-head" aria-expanded={!closed} onClick={() => setShut({...shut, [g.key]: !closed})}>
            <Icon name={closed ? 'right' : 'down'} size={14}/><span>{g.label}</span><em>{g.rows.length}</em>
          </button>
          {!closed && (g.rows.length ? <div className="profile-tasks">
            {(many ? g.rows.slice(0, FIRST) : g.rows).map((t) => <button key={t.id} onClick={() => open(t)}>
              <div><b>{t.title}</b><span>{t.project?.name || 'Chưa có dịch vụ'}{t.dueAt ? ` · Hạn ${date(t.dueAt)}` : ''}</span></div>
              <span className={'profile-task-status ' + t.state}>{t.stage ? stepCode(t.stage) : t.status}</span><Icon name="right" size={15}/>
            </button>)}
            {g.rows.length > FIRST && <button className="profile-task-more" onClick={() => setAll({...all, [g.key]: many})}>{many ? `Xem thêm ${g.rows.length - FIRST} công việc` : 'Thu gọn'}</button>}
          </div> : <p className="profile-empty">Không có công việc.</p>)}
        </section>;
      })}
    </div>}
  </>;
}
