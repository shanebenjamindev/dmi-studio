// Hỗ trợ lập trình viên: nút bấm trên thanh điều hướng chính (ngay trên Nhắc việc) và hộp thoại gửi yêu cầu hỗ trợ.
// Thông tin người phát triển: Dylan - phone 0962099349 VN.
// Người dùng chỉ cần nhập nội dung cần nói; tên và email tự động được đính kèm theo phiên đăng nhập. Ảnh chụp màn hình
// (tối đa 3) dán thẳng vào ô nội dung (Ctrl/⌘ V) hoặc chọn từ máy; ảnh được thu nhỏ trước khi gửi.
import { useRef, useState } from 'react';
import { shrink } from './RichText';
import { api } from '../api';
import { toast, useStore } from '../store';
import { Sheet } from './Dialogs';
import { Icon } from './ui';

export function SupportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={'rail-item sp-button' + (open ? ' on' : '')}
        onClick={() => setOpen(true)}
        title="Hỗ trợ lập trình viên"
        aria-label="Hỗ trợ lập trình viên"
      >
        <span className="sp-icon-wrap"><Icon name="chat" size={20} /></span>
        <span>Hỗ trợ</span>
      </button>
      <SupportDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function SupportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useStore((s) => s.user);
  const [message, setMessage] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const addImages = async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith('image/'));
    if (!pics.length) return;
    if (images.length + pics.length > 3) toast('Tối đa 3 ảnh cho một yêu cầu', true);
    try {
      // Readable screenshots, small enough that three fit in one request.
      const made = await Promise.all(pics.slice(0, 3 - images.length).map((f) => shrink(f, 1600, 0.8)));
      setImages((had) => [...had, ...made].slice(0, 3));
    } catch { toast('Không đọc được ảnh này', true); }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const content = message.trim();
    if (!content && !images.length) return toast('Vui lòng nhập nội dung cần nói với người phát triển', true);

    setSending(true);
    try {
      await api.sendSupport(content, images);
      toast('Đã gửi yêu cầu hỗ trợ tới lập trình viên Dylan thành công!');
      setMessage('');
      setImages([]);
      onClose();
    } catch (err: any) {
      toast(err.message || 'Không thể gửi yêu cầu hỗ trợ', true);
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Hỗ trợ lập trình viên"
      footer={
        <>
          <button className="btn btn-gray" type="button" onClick={onClose} disabled={sending}>
            Đóng
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={(!message.trim() && !images.length) || sending}
            onClick={() => handleSend()}
          >
            {sending ? 'Đang gửi…' : 'Gửi yêu cầu'}
          </button>
        </>
      }
    >
      <div className="sp-dialog-body">
        {/* Developer Contact Card */}
        <div className="sp-dev-card">
          <div className="sp-dev-avatar">D</div>
          <div className="sp-dev-meta">
            <div className="sp-dev-header">
              <span className="sp-dev-name">Dylan</span>
              <span className="sp-dev-tag">Developer</span>
            </div>
            <div className="sp-dev-phone">
              Số điện thoại / Zalo: <a href="tel:0962099349">0962099349 (VN)</a>
            </div>
          </div>
          <div className="sp-dev-actions">
            <a href="tel:0962099349" className="btn btn-sm btn-gray" title="Gọi điện cho Dylan">
              <Icon name="phone" size={14} />
              <span>Gọi ngay</span>
            </a>
            <a
              href="https://zalo.me/0962099349"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm btn-primary"
              title="Nhắn tin qua Zalo cho Dylan"
            >
              <Icon name="chat" size={14} />
              <span>Nhắn Zalo</span>
            </a>
          </div>
        </div>

        {/* Support Message Form */}
        <form className="sp-form" onSubmit={handleSend}>
          <label className="sp-field">
            <span className="sp-field-label">Nội dung cần nói với người phát triển</span>
            <textarea
              className="sp-textarea"
              rows={5}
              autoFocus
              placeholder="Nhập câu hỏi, báo lỗi, góp ý hoặc yêu cầu hỗ trợ của bạn tại đây…"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onPaste={(e) => { const files = [...e.clipboardData.files]; if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); void addImages(files); } }}
              disabled={sending}
            />
          </label>
          <div className="sp-shots">
            {images.map((src, i) => (
              <span key={i} className="sp-shot"><img src={src} alt={`Ảnh ${i + 1}`} /><button type="button" onClick={() => setImages(images.filter((_, k) => k !== i))} aria-label={`Bỏ ảnh ${i + 1}`} disabled={sending}><Icon name="x" size={12} /></button></span>
            ))}
            {images.length < 3 && <button type="button" className="btn btn-gray btn-sm" disabled={sending} onClick={() => fileRef.current?.click()}><Icon name="photo" size={14} />Đính kèm ảnh</button>}
            <small>Dán ảnh chụp màn hình (Ctrl/⌘ V) vào ô trên, hoặc đính kèm. Tối đa 3 ảnh.</small>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addImages([...(e.target.files || [])]); e.target.value = ''; }} />
          </div>

          <div className="sp-auto-info">
            <Icon name="user" size={15} />
            <span>
              Người gửi: <b>{user?.name || 'Thành viên'}</b>
              {user?.email ? <small> ({user.email})</small> : ''}
              <em> · Tự động ghi nhận khi gửi</em>
            </span>
          </div>
        </form>
      </div>
    </Sheet>
  );
}

