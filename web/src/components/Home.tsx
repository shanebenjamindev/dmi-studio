// Trang chủ, Base-like: the person's day at a glance, in widgets that keep only what matters (no buttons but "see all"). Công việc cần làm (their open tasks, late first),
// Chờ tôi duyệt (tasks in REVIEW that they grade), and Tổng quan khách hàng (each customer's services' tasks: all,
// in progress, late, done). Each row opens its task or customer; the lists follow changes made elsewhere.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { quietly } from '../loading';
import { onLive } from '../live';
import { goto, openLink, openTask, useStore } from '../store';
import { Icon } from './ui';
import { Avatar, shortDate } from './boardkit';
import { Badge } from './taskkit';
import type { BrandServiceItem, TaskItem } from '../types';

type Data = { todo: TaskItem[]; review: TaskItem[]; services: BrandServiceItem[] };
const LIMIT = 30;

/** Late first, then by due date; those with no date last. */
const byDue = (a: TaskItem, b: TaskItem) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity);

async function load(): Promise<Data> {
  const [todo, review, services] = await Promise.all([
    api.tasks({ scope: 'mine', rel: 'assigned', state: 'open' }).then((r) => r.tasks),
    api.tasks({ scope: 'mine', rel: 'review', state: 'review' }).then((r) => r.tasks),
    api.brandServices().catch(() => [] as BrandServiceItem[]),
  ]);
  return { todo: todo.sort(byDue), review: review.sort((a, b) => (a.submittedAt ?? a.updatedAt) - (b.submittedAt ?? b.updatedAt)), services };
}

export function HomePage() {
  const user = useStore((s) => s.user)!;
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState('');
  const refresh = useCallback(() => load().then((d) => { setData(d); setError(''); }, (e) => setError(e.message)), []);
  // Several changes in a row (a drag, a form saving its fields) reload once.
  const later = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    refresh();
    const soon = () => { clearTimeout(later.current); later.current = setTimeout(() => quietly(refresh), 600); };
    window.addEventListener('dms:entities-changed', soon);
    const off = onLive('work', soon);
    return () => { off(); clearTimeout(later.current); window.removeEventListener('dms:entities-changed', soon); };
  }, [refresh]);

  const hour = new Date().getHours();
  return (
    <div className="home">
      <header className="home-h">
        <div>
          <h1>{hour < 11 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'}, {user.name.split(' ').pop()}</h1>
          <p>{new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
        </div>
      </header>
      {error && <p className="note err" role="alert">{error}</p>}
      <div className="home-grid">
        <Widget title="Công việc cần làm" count={data?.todo.length} onMore={() => goto('tasks')}>
          {!data ? <Loading /> : !data.todo.length ? <Empty text="Bạn không còn việc nào cần làm." /> : <TaskRows tasks={data.todo} who="creator" />}
        </Widget>
        <Widget title="Chờ tôi duyệt" count={data?.review.length} onMore={() => goto('tasks')}>
          {!data ? <Loading /> : !data.review.length ? <Empty text="Không có việc nào chờ bạn duyệt." /> : <TaskRows tasks={data.review} who="assignee" />}
        </Widget>
        <Widget wide title="Tổng quan khách hàng" onMore={() => goto('customers')}>
          {!data ? <Loading /> : <Overview services={data.services} />}
        </Widget>
      </div>
    </div>
  );
}

function Widget({ title, count, wide, onMore, children }: { title: string; count?: number; wide?: boolean; onMore: () => void; children: ReactNode }) {
  return (
    <section className={'home-w' + (wide ? ' wide' : '')}>
      <header>
        <h2>{title}{count ? <em>{count}</em> : null}</h2>
        <button type="button" className="bd-icon" onClick={onMore} title="Xem tất cả" aria-label={`Xem tất cả: ${title}`}><Icon name="right" size={16} /></button>
      </header>
      <div className="home-w-body">{children}</div>
    </section>
  );
}

const Loading = () => <p className="note">Đang tải…</p>;
const Empty = ({ text }: { text: string }) => <div className="home-empty"><Icon name="check" size={26} /><p>{text}</p></div>;

/** Tasks as rows: step badge, title, where it belongs, the due date (red when late) and who gave it or does it. */
function TaskRows({ tasks, who }: { tasks: TaskItem[]; who: 'creator' | 'assignee' }) {
  const now = Date.now();
  return (
    <ul className="home-tasks">
      {tasks.slice(0, LIMIT).map((t) => {
        const person = who === 'creator' ? t.createdBy : t.assignees[0], late = !!t.dueAt && t.dueAt < now;
        return (
          <li key={t.id}><button type="button" onClick={() => openTask(t.id)}>
            <span className="home-t-main">
              <b>{t.title}</b>
              <span className="home-t-sub"><Badge t={t} /><small>{[t.customer?.name, t.brandService?.name || t.project?.name].filter(Boolean).join(' · ') || 'Công việc'}</small></span>
            </span>
            {t.dueAt && <time className={late ? 'late' : ''}>{shortDate(t.dueAt)}</time>}
            {person && <span className="home-t-who" title={person.name}><Avatar m={person} size={26} /></span>}
          </button></li>
        );
      })}
      {tasks.length > LIMIT && <li className="home-more">… và {tasks.length - LIMIT} việc nữa</li>}
    </ul>
  );
}

/** Each customer's services added up, busiest first, with a bar of done / in progress / late. */
function Overview({ services }: { services: BrandServiceItem[] }) {
  const rows = new Map<string, { id: string | null; name: string; all: number; done: number; late: number }>();
  for (const s of services) {
    if (!s.tasks) continue;
    const key = s.customerId || '', r = rows.get(key) || { id: s.customerId, name: s.customerName || 'Chưa gắn khách hàng', all: 0, done: 0, late: 0 };
    r.all += s.tasks; r.done += s.completed || 0; r.late += s.overdue || 0;
    rows.set(key, r);
  }
  const list = [...rows.values()].sort((a, b) => b.all - a.all);
  if (!list.length) return <Empty text="Chưa có công việc nào trong các dịch vụ bạn xem được." />;
  const pct = (n: number, all: number) => `${(n / all) * 100}%`;
  return (
    <div className="home-ov-scroll">
      <table className="home-ov">
        <thead><tr><th>Khách hàng</th><th>Tất cả</th><th>Đang làm</th><th>Quá hạn</th><th>Hoàn thành</th></tr></thead>
        <tbody>
          {list.map((r) => {
            const doing = Math.max(0, r.all - r.done - r.late);
            return (
              <tr key={r.id || '-'} className={r.id ? 'go' : ''} onClick={r.id ? () => openLink(`#customers/${r.id}`) : undefined}>
                <th scope="row"><div>
                  <span className="home-ov-name">{r.name}</span>
                  <span className="home-ov-bar" aria-hidden="true"><i className="done" style={{ width: pct(r.done, r.all) }} /><i className="doing" style={{ width: pct(doing, r.all) }} /><i className="late" style={{ width: pct(r.late, r.all) }} /></span>
                </div></th>
                <td>{r.all}</td><td className="doing">{doing}</td><td className="late">{r.late}</td><td className="done">{r.done}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
