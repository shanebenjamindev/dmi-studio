// Quản trị: Danh sách yêu cầu hỗ trợ từ người dùng gửi tới lập trình viên.
// Thông tin người phát triển: Dylan - phone 0962099349 VN.
import { useEffect, useState } from 'react';
import { Icon } from '../../components/ui';
import { admin, type SupportTicket } from '../api';
import {
  PageHead,
  Toolbar,
  Select,
  Table,
  Pager,
  Drawer,
  Badge,
  Async,
  Empty,
  useLoad,
  useDebounced,
  act,
  fmtTime,
  fmtAgo,
  type Col,
} from '../kit';

export function SupportList() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'pending' | 'resolved'>('all');
  const [page, setPage] = useState(1);
  const term = useDebounced(q);
  const filter = { q: term, status: status === 'all' ? undefined : status, page, size: 25 };
  const load = useLoad(() => admin.supportTickets(filter), [JSON.stringify(filter), page]);
  const [open, setOpen] = useState<SupportTicket | null>(null);
  // The open request's screenshots, loaded when it opens (the list carries only how many there are).
  const [shots, setShots] = useState<string[]>([]);
  useEffect(() => {
    setShots([]);
    if (!open?.images) return;
    let on = true;
    admin.supportTicketImages(open.id).then((x) => { if (on) setShots(x); }, () => {});
    return () => { on = false; };
  }, [open?.id, open?.images]);

  const toggleStatus = async (item: SupportTicket, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const next = item.status === 'pending' ? 'resolved' : 'pending';
    const nextLabel = next === 'resolved' ? 'Đã xử lý' : 'Chờ xử lý';
    await act(
      () => admin.updateSupportTicket(item.id, { status: next }),
      `Đã chuyển trạng thái sang: ${nextLabel}`,
      () => {
        load.reload();
        if (open?.id === item.id) setOpen({ ...item, status: next });
      }
    );
  };

  const removeTicket = async (item: SupportTicket, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm(`Xoá yêu cầu hỗ trợ từ "${item.userName}"?`)) return;
    await act(
      () => admin.removeSupportTicket(item.id),
      'Đã xoá yêu cầu hỗ trợ',
      () => {
        load.reload();
        if (open?.id === item.id) setOpen(null);
      }
    );
  };

  const cols: Col<SupportTicket>[] = [
    {
      key: 'createdAt',
      label: 'Thời gian',
      render: (t) => (
        <span className="ax-stack">
          <b>{fmtTime(t.createdAt)}</b>
          <small>{fmtAgo(t.createdAt)}</small>
        </span>
      ),
    },
    {
      key: 'user',
      label: 'Người gửi',
      render: (t) => (
        <span className="ax-stack">
          <b>{t.userName}</b>
          <small>{t.userEmail || 'Chưa có email'}</small>
        </span>
      ),
    },
    {
      key: 'message',
      label: 'Nội dung cần hỗ trợ',
      render: (t) => (
        <div className="sp-msg-preview" title={t.message}>
          {t.images > 0 && <><Icon name="photo" size={13} /> {t.images} · </>}{t.message}
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Trạng thái',
      render: (t) =>
        t.status === 'resolved' ? (
          <Badge tone="ok">Đã xử lý</Badge>
        ) : (
          <Badge tone="warn">Chờ xử lý</Badge>
        ),
    },
    {
      key: 'actions',
      label: 'Thao tác',
      render: (t) => (
        <div className="ax-row-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className={`btn btn-sm ${t.status === 'pending' ? 'btn-primary' : 'btn-gray'}`}
            onClick={(e) => toggleStatus(t, e)}
            title={t.status === 'pending' ? 'Đánh dấu đã xử lý' : 'Đánh dấu chờ xử lý'}
          >
            {t.status === 'pending' ? 'Xong' : 'Mở lại'}
          </button>
          <button
            className="bd-icon text-danger"
            onClick={(e) => removeTicket(t, e)}
            title="Xoá yêu cầu"
            aria-label="Xoá yêu cầu"
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHead
        title="Yêu cầu hỗ trợ lập trình viên"
        sub="Danh sách câu hỏi, báo lỗi và phản hồi từ người dùng gửi tới người phát triển."
      />

      {/* Developer Banner */}
      <div className="sp-admin-banner">
        <div className="sp-admin-banner-left">
          <div className="sp-admin-banner-avatar">D</div>
          <div>
            <div className="sp-admin-banner-title">
              Lập trình viên phụ trách: <b>Dylan</b>
            </div>
            <div className="sp-admin-banner-desc">
              Hotline / Zalo: <b>0962099349 (VN)</b> · Sẵn sàng hỗ trợ kỹ thuật và giải quyết sự cố 24/7.
            </div>
          </div>
        </div>
        <div className="sp-admin-banner-right">
          <a href="tel:0962099349" className="btn btn-sm btn-gray">
            <Icon name="phone" size={14} /> Gọi Dylan
          </a>
          <a
            href="https://zalo.me/0962099349"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-sm btn-primary"
          >
            <Icon name="chat" size={14} /> Zalo: 0962099349
          </a>
        </div>
      </div>

      <Toolbar search={q} onSearch={setQ} placeholder="Tìm theo tên người gửi, email hoặc nội dung…">
        <Select
          value={status}
          onChange={(v) => {
            setStatus(v as any);
            setPage(1);
          }}
          label="Trạng thái"
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="pending">Chờ xử lý</option>
          <option value="resolved">Đã xử lý</option>
        </Select>
      </Toolbar>

      <div className="ax-card flush">
        <Async load={load}>
          {(d) => (
            <>
              <Table
                cols={cols}
                rows={d.items}
                onRow={setOpen}
                empty={
                  <Empty
                    icon="chat"
                    title="Chưa có yêu cầu hỗ trợ nào"
                    text="Khi người dùng gửi phản hồi hoặc báo lỗi qua nút Hỗ trợ, danh sách sẽ hiển thị tại đây."
                  />
                }
              />
              <Pager page={d.page} size={d.size} total={d.total} onPage={setPage} />
            </>
          )}
        </Async>
      </div>

      {open && (
        <Drawer
          open
          title={`Yêu cầu từ ${open.userName}`}
          sub={fmtTime(open.createdAt)}
          onClose={() => setOpen(null)}
          footer={
            <>
              <button
                className={`btn btn-sm ${open.status === 'pending' ? 'btn-primary' : 'btn-gray'}`}
                onClick={() => toggleStatus(open)}
              >
                {open.status === 'pending' ? 'Đánh dấu đã xử lý' : 'Đánh dấu chờ xử lý'}
              </button>
              <button className="btn btn-sm btn-danger" onClick={() => removeTicket(open)}>
                Xoá
              </button>
            </>
          }
        >
          <dl className="ax-facts">
            <dt>Người gửi</dt>
            <dd>{open.userName}</dd>
            <dt>Email</dt>
            <dd>
              {open.userEmail ? (
                <a href={`mailto:${open.userEmail}`} className="link">
                  {open.userEmail}
                </a>
              ) : (
                '—'
              )}
            </dd>
            <dt>Thời gian gửi</dt>
            <dd>
              {fmtTime(open.createdAt)} ({fmtAgo(open.createdAt)})
            </dd>
            <dt>Trạng thái</dt>
            <dd>
              {open.status === 'resolved' ? (
                <Badge tone="ok">Đã xử lý</Badge>
              ) : (
                <Badge tone="warn">Chờ xử lý</Badge>
              )}
            </dd>
          </dl>

          <div className="sp-detail-msg-box">
            <h4>Nội dung yêu cầu</h4>
            <div className="sp-detail-msg-body">{open.message}</div>
            {open.images > 0 && <div className="sp-detail-shots">{shots.length ? shots.map((src, i) => <a key={i} href={src} target="_blank" rel="noreferrer" download={`anh-ho-tro-${i + 1}.jpg`}><img src={src} alt={`Ảnh ${i + 1}`} /></a>) : <small>{`Đang tải ${open.images} ảnh…`}</small>}</div>}
          </div>

          <div className="sp-drawer-contact">
            <h5>Liên hệ người phát triển</h5>
            <p>Dylan: <b>0962099349 (VN)</b></p>
            <div className="sp-drawer-contact-btns">
              <a href="tel:0962099349" className="btn btn-sm btn-gray">
                <Icon name="phone" size={14} /> Gọi Dylan
              </a>
              <a
                href="https://zalo.me/0962099349"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm btn-primary"
              >
                <Icon name="chat" size={14} /> Nhắn Zalo Dylan
              </a>
            </div>
          </div>
        </Drawer>
      )}
    </>
  );
}
