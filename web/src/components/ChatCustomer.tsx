// The customer of a brand's server in Tin nhắn, beside its chat: who they are, where their work stands and what is under
// way, then the same facts as the customer's page (contact, tags and source, Drive, members: CustomerTabs.tsx), so a
// brief can be read without leaving the conversation. Its width is dragged on its left edge and kept on this computer.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { openLink, openTask } from '../store';
import type { CustomerRecord, CustomerTaskRow } from '../types';
import { isClosedStage } from '../../../shared/task-flow';
import { BrandLoading } from './BrandLoading';
import { CustomerContext } from './CustomerTabs';
import { LogoImg } from './boardkit';
import { useCustomerStatuses } from './useCustomerStatuses';
import { Icon } from './ui';

const WIDTH = 'dms.chatCustomerWidth';
const MIN = 300, MAX = 760;
const savedWidth = () => { try { return Math.min(MAX, Math.max(MIN, Number(localStorage.getItem(WIDTH)) || 360)); } catch { return 360; } };
const day = (t: number) => new Date(t).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' });

export function ChatCustomerPanel({ customerId, logo, onClose }: { customerId: string; logo?: string | null; onClose: () => void }) {
  const [c, setC] = useState<CustomerRecord | null>(null), [error, setError] = useState('');
  const [tasks, setTasks] = useState<CustomerTaskRow[] | null>(null);
  const [width, setWidth] = useState(savedWidth);
  const statuses = useCustomerStatuses();
  const load = () => {
    api.customerRecord(customerId).then((r) => { setC(r); setError(''); }, (e) => setError(e.message));
    api.customerTaskList(customerId).then(setTasks, () => setTasks([]));
  };
  useEffect(() => { setC(null); setTasks(null); load(); }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dragging the left edge: wider to the left.
  const drag = useRef<{ x: number; w: number } | null>(null);
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = { x: e.clientX, w: width };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const resize = (e: React.PointerEvent) => { if (drag.current) setWidth(Math.min(MAX, Math.max(MIN, drag.current.w + drag.current.x - e.clientX))); };
  const endResize = () => {
    if (!drag.current) return;
    drag.current = null;
    try { localStorage.setItem(WIDTH, String(width)); } catch { /* private mode */ }
  };

  const status = c?.status ? statuses.find((s) => s.id === c.status) : null;
  const rows = tasks || [];
  const done = rows.filter((t) => isClosedStage(t.stage)).length;
  const late = rows.filter((t) => t.state === 'overdue' && !isClosedStage(t.stage)).length;
  const open = rows.filter((t) => !isClosedStage(t.stage)).sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)).slice(0, 5);
  const toPage = () => openLink(`#customers/${customerId}`);

  return (
    <aside className="dc-cust" style={{ width }} aria-label="Thông tin khách hàng">
      <div className="dc-cust-grip" role="separator" aria-orientation="vertical" aria-label="Kéo để đổi độ rộng" title="Kéo để đổi độ rộng · bấm đúp để về mặc định"
        onPointerDown={startResize} onPointerMove={resize} onPointerUp={endResize} onPointerCancel={endResize}
        onDoubleClick={() => { setWidth(360); try { localStorage.removeItem(WIDTH); } catch { /* private mode */ } }} />
      <header className="dc-cust-top">
        <span><Icon name="user" size={15} />Khách hàng</span>
        <button type="button" className="dc-icon-btn" onClick={onClose} aria-label="Đóng" title="Đóng"><Icon name="x" size={15} /></button>
      </header>
      <div className="dc-cust-body">
        {error ? <div className="dc-cust-empty"><Icon name="lock" size={26} /><p>{error}</p></div> : !c ? <BrandLoading compact /> : (
          <>
            <section className="dc-cust-hero">
              <span className="dc-cust-logo">{logo ? <LogoImg src={logo} /> : <b>{c.name.slice(0, 1).toUpperCase()}</b>}</span>
              <div className="dc-cust-id">
                <h3 title={c.name}>{c.name}</h3>
                <div className="dc-cust-meta">
                  {status && <span className="dc-cust-status" style={{ ['--c' as any]: status.color }}>{status.name}</span>}
                  {(c.manager || c.owner) && <small><Icon name="user" size={12} />{(c.manager || c.owner)!.name}</small>}
                </div>
              </div>
              <button type="button" className="btn btn-gray btn-sm" onClick={toPage} title="Mở trang khách hàng"><Icon name="arrow" size={13} />Mở</button>
            </section>

            <section className="dc-cust-stats">
              <div><b>{c.needs?.length ?? c.projects ?? 0}</b><span>Dịch vụ</span></div>
              <div><b>{tasks ? `${done}/${rows.length}` : '…'}</b><span>Việc xong</span></div>
              <div className={late ? 'is-late' : ''}><b>{tasks ? late : '…'}</b><span>Trễ hạn</span></div>
              <progress aria-label="Tiến độ hoàn thành công việc" max={rows.length || 1} value={done} />
            </section>

            {open.length > 0 && (
              <section className="dc-cust-card">
                <header><h4>Việc đang làm</h4><button type="button" className="dc-cust-link" onClick={toPage}>Tất cả <Icon name="right" size={12} /></button></header>
                <ul className="dc-cust-tasks">
                  {open.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => openTask(t.id)} title={t.title}>
                        <i style={{ background: `var(--stage-${t.stage}, #64748b)` }} />
                        <span><b>{t.title}</b><small>{[t.project?.name, t.assignees.map((a) => a.name).join(', ')].filter(Boolean).join(' · ') || 'Chưa giao'}</small></span>
                        {t.dueAt && <em className={t.state === 'overdue' ? 'is-late' : ''}>{day(t.dueAt)}</em>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="dc-cust-context">
              <CustomerContext c={c} onTab={toPage} onChanged={load} />
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
