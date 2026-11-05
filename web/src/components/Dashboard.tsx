// Tổng quan (Drive ▸ the overview button): the customers and their videos, task by task. A task is a card on a board
// set to a customer (Khách hàng on the card); its videos are the files of that customer's folder put on the card.
// Editing projects and their reports live in the editor, not here.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { setState } from '../store';
import { Icon } from './ui';
import { dueState, shortDate, videoThumb } from './boardkit';
import type { Customer, CustomerTask } from '../types';

/** Open a card on its board. Switching pages writes the page's own address (and may show it at once), so the card's
 *  address goes in after, and the Workspace page is told to read it. */
function openCard(t: CustomerTask) {
  setState({ view: 'boards' });
  history.replaceState(null, '', `#boards/${t.boardId}/c/${t.id}`);
  setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 0);
}

export function Dashboard({ customers, onOpenCustomer }: { customers: Customer[]; onOpenCustomer: (id: string) => void }) {
  const [tasks, setTasks] = useState<CustomerTask[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setError(false);
    api.customerTasks().then((t) => { if (active) setTasks(t); }, () => { if (active) setError(true); });
    return () => { active = false; };
  }, [customers]);

  const of = (c: Customer) => (tasks || []).filter((t) => t.customerId === c.id)
    .sort((a, b) => +a.done - +b.done || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || b.updatedAt - a.updatedAt);
  const rows = customers.map((c) => ({ c, tasks: of(c) }));
  const busy = rows.filter((r) => r.tasks.length).sort((a, b) => Math.max(...b.tasks.map((t) => t.updatedAt)) - Math.max(...a.tasks.map((t) => t.updatedAt)));
  const idle = rows.filter((r) => !r.tasks.length);
  const taskCount = busy.reduce((n, r) => n + r.tasks.length, 0);
  const videoCount = busy.reduce((n, r) => n + r.tasks.reduce((m, t) => m + t.videos.length, 0), 0);

  return (
    <section className="ws-detail dash">
      <header className="dash-h">
        <h2>Tổng quan khách hàng</h2>
        <span>{new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
      </header>
      <div className="dash-stats">
        <div><b>{customers.length}</b><span>Khách hàng</span></div>
        <div><b>{tasks ? taskCount : '…'}</b><span>Task</span></div>
        <div><b>{tasks ? videoCount : '…'}</b><span>Video trong task</span></div>
      </div>

      {error ? <p className="note err">Không tải được task. Hãy tải lại.</p> : tasks === null ? <p className="note">Đang tải task…</p> : !busy.length ? (
        <p className="note">Chưa có task nào gắn khách hàng. Trên bảng Workspace, mở một thẻ, bấm “Khách hàng” để chọn khách rồi “Video” để gắn video của khách vào thẻ.</p>
      ) : busy.map(({ c, tasks: list }) => (
        <div key={c.id} className="dash-block dash-cust">
          <div className="dash-cust-h">
            <h3><Icon name="folder" size={17} />{c.name}</h3>
            <span>{list.length} task · {list.reduce((n, t) => n + t.videos.length, 0)} video</span>
            <button className="btn btn-gray btn-sm" onClick={() => onOpenCustomer(c.id)}>Mở thư mục</button>
          </div>
          {list.map((t) => {
            const due = dueState(t.dueAt, t.done);
            return (
              <div key={t.id} className={'dash-task' + (t.done ? ' done' : '')}>
                <button className="dash-task-h" onClick={() => openCard(t)} title="Mở thẻ trên bảng">
                  <span className={'dash-task-mark' + (t.done ? ' on' : '')}>{t.done && <Icon name="check" size={11} />}</span>
                  <b>{t.title}</b>
                  <span className="dash-task-where">{t.boardName} · {t.listName}</span>
                  {t.dueAt && <em className={'dash-task-due ' + (due || '')}>{shortDate(t.dueAt)}{due === 'over' ? ' · quá hạn' : due === 'soon' ? ' · sắp đến' : ''}</em>}
                </button>
                {t.videos.length ? (
                  <div className="dash-videos">
                    {t.videos.map((v) => (
                      <a key={v.id} className="dash-video" href={v.url} target="_blank" rel="noreferrer" title={v.name}>
                        <span className="dash-video-pic"><Icon name="film" size={20} /><img src={videoThumb(v)} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} /></span>
                        <span className="dash-video-name">{v.name}</span>
                      </a>
                    ))}
                  </div>
                ) : <p className="note dash-novideo">Chưa gắn video.</p>}
              </div>
            );
          })}
        </div>
      ))}

      {tasks && idle.length > 0 && (
        <div className="dash-block">
          <h3>Khách chưa có task</h3>
          <div className="dash-grid">
            {idle.map(({ c }) => (
              <button key={c.id} className="dash-card" onClick={() => onOpenCustomer(c.id)}>
                <span className="dash-ico"><Icon name="folder" size={18} /></span>
                <b>{c.name}</b>
                <span>{c.videoCount == null ? 'Không đọc được thư mục' : `${c.videoCount} video trên Drive`}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
