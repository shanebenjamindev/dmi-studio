// Hộp thư: the account's own Gmail inside DMI (server/mailbox.ts). Folders down the left, the threads of the folder in
// the middle, the open thread at the right; on a phone one at a time. Each person connects their own Gmail here; Gmail
// keeps the mail, so what is read, sent or starred here is the same in Gmail.
import { useEffect, useRef, useState } from 'react';
import { MailEditor, cleanHtml, textToHtml } from './MailEditor';
import { api } from '../api';
import { toast } from '../store';
import { Icon, IconButton } from './ui';
import { createPortal } from 'react-dom';
import { Sheet } from './Dialogs';
import { askConfirm } from './AskDialog';
import { BrandLoading } from './BrandLoading';
import type { MailboxStatus, MailThreadRow, MailThread, MailMessage, MailDraft } from '../types';

const FOLDERS: [string, string, string][] = [['inbox', 'Hộp thư đến', 'inbox'], ['starred', 'Có gắn sao', 'star'], ['important', 'Quan trọng', 'tag'], ['sent', 'Đã gửi', 'send'],
  ['all', 'Tất cả thư', 'archive'], ['spam', 'Thư rác', 'info'], ['trash', 'Thùng rác', 'trash']];
/** What may go with one message (the server's limit too). */
const ATTACH_MAX = 3.5 * 1024 * 1024;

const when = (at: number) => {
  const d = new Date(at), today = new Date();
  return d.toDateString() === today.toDateString() ? d.toLocaleTimeString('vi', { hour: '2-digit', minute: '2-digit' })
    : d.getFullYear() === today.getFullYear() ? d.toLocaleDateString('vi', { day: 'numeric', month: 'numeric' }) : d.toLocaleDateString('vi');
};
const size = (b: number) => (b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
const reSubject = (prefix: string, s: string) => (new RegExp(`^${prefix}:`, 'i').test(s.trim()) ? s : `${prefix}: ${s}`);
const readFile = (f: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(r.error); r.readAsDataURL(f); });

export function MailboxPage() {
  const [status, setStatus] = useState<MailboxStatus | null>(null);
  const load = () => api.mailbox().then(setStatus).catch((e) => toast(e.message, true));
  useEffect(() => {
    // Back from Google with a problem: say it, and keep the plain address.
    const error = new URLSearchParams(location.hash.split('?')[1] || '').get('error');
    if (error) { toast(error, true); history.replaceState(null, '', '#mail'); }
    void load();
  }, []);
  if (!status) return <BrandLoading />;
  if (!status.connected || status.reconnect) return <MailConnect status={status} />;
  return <Mailbox status={status} onChanged={load} />;
}

function MailConnect({ status }: { status: MailboxStatus }) {
  return (
    <main className="mb-page mb-connect">
      <div className="mb-connect-card">
        <span className="mb-connect-icon"><Icon name="mail" size={28} /></span>
        <h2>{status.reconnect ? 'Kết nối lại Gmail' : 'Kết nối Gmail của bạn'}</h2>
        {status.reconnect ? <p>{status.reconnect}</p> : <p>Đọc và gửi email từ Gmail của chính bạn ngay trong DMI. Chỉ bạn xem được hộp thư của mình; thư vẫn nằm trong Gmail như cũ.</p>}
        {status.googleConfigured
          ? <button className="btn btn-primary" onClick={() => location.assign('/api/mailbox/connect')}><Icon name="mail" size={15} />{status.reconnect ? 'Kết nối lại' : 'Kết nối Gmail'}</button>
          : <p className="note err">Quản trị viên chưa cấu hình Google cho DMI (Quản trị › Google). Hãy nhờ quản trị viên làm trước.</p>}
        <p className="note">Google sẽ hỏi quyền “đọc, soạn và gửi email”: hãy tích chọn quyền đó. Nếu Google báo “ứng dụng chưa được xác minh”, bấm <b>Advanced → Go to DMI Workspace</b>.</p>
      </div>
    </main>
  );
}

function Mailbox({ status, onChanged }: { status: MailboxStatus; onChanged: () => void }) {
  const [folder, setFolder] = useState('inbox');
  const [q, setQ] = useState(''), [search, setSearch] = useState('');
  const [threads, setThreads] = useState<MailThreadRow[] | null>(null), [next, setNext] = useState<string | null>(null), [more, setMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [error, setError] = useState(''), [sent, setSent] = useState(0), [settings, setSettings] = useState(false);
  const sig = status.signatureOn ? status.signature || '' : '';
  const asked = useRef(0);
  const list = async (page = '') => {
    const ask = ++asked.current;
    if (!page) { setThreads(null); setError(''); }
    try {
      const r = await api.mailThreads(folder, search, page);
      if (ask !== asked.current) return;
      setThreads((prev) => (page ? [...(prev || []), ...r.threads] : r.threads)); setNext(r.next);
    } catch (e: any) { if (ask === asked.current) { setError(e.message); setThreads([]); if (e.need === 'reconnect') onChanged(); } }
  };
  useEffect(() => { void list(); }, [folder, search]);
  const patch = (id: string, p: Partial<MailThreadRow>) => setThreads((prev) => prev?.map((t) => (t.id === id ? { ...t, ...p } : t)) || prev);
  const star = (t: MailThreadRow) => { patch(t.id, { starred: !t.starred }); api.markMailThread(t.id, { starred: !t.starred }).catch((e) => { patch(t.id, { starred: t.starred }); toast(e.message, true); }); };
  const disconnect = async () => {
    if (!await askConfirm(`Ngắt kết nối Gmail ${status.email}? Thư vẫn còn nguyên trong Gmail; bạn có thể kết nối lại bất cứ lúc nào.`)) return;
    try { await api.disconnectMailbox(); onChanged(); } catch (e: any) { toast(e.message, true); }
  };

  return (
    <main className={'mb-page' + (open ? ' mb-reading' : '')}>
      <aside className="mb-side">
        <button className="btn btn-primary mb-compose" onClick={() => setDraft({ to: '', subject: '', text: '' })}><Icon name="edit" size={15} />Soạn thư</button>
        <nav className="mb-folders" aria-label="Thư mục">
          {FOLDERS.map(([key, label, icon]) => (
            <button key={key} aria-current={folder === key ? 'page' : undefined} onClick={() => { setFolder(key); setOpen(null); }}>
              <Icon name={icon} size={16} /><span>{label}</span>{key === 'inbox' && !!status.unread && <b>{status.unread}</b>}
            </button>
          ))}
        </nav>
        <div className="mb-account">
          {status.picture ? <img src={status.picture} alt="" referrerPolicy="no-referrer" /> : <Icon name="user" size={16} />}
          <span title={status.email}>{status.email}</span>
          <IconButton icon="gear" label="Cài đặt Hộp thư (chữ ký)" size={14} onClick={() => setSettings(true)} />
          <IconButton icon="x" label="Ngắt kết nối Gmail" size={14} onClick={disconnect} />
        </div>
      </aside>

      <section className="mb-list" aria-label="Danh sách thư">
        <form className="mb-search" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); setOpen(null); }}>
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm thư (như ô tìm của Gmail)" aria-label="Tìm thư" />
          {search && <IconButton icon="x" label="Xoá tìm kiếm" size={14} onClick={() => { setQ(''); setSearch(''); }} />}
          <IconButton icon="refresh" label="Tải lại" size={15} onClick={() => { void list(); onChanged(); }} />
        </form>
        {error && <p className="note err mb-pad" role="alert">{error}</p>}
        {!threads ? <p className="note mb-pad">Đang tải thư…</p> : !threads.length && !error ? <p className="note mb-pad">{search ? 'Không có thư nào khớp.' : 'Không có thư.'}</p> : (
          <ul className="mb-threads">
            {threads.map((t) => (
              <li key={t.id} className={(t.unread ? 'unread' : '') + (open === t.id ? ' open' : '')}>
                <button className="mb-row" onClick={() => { setOpen(t.id); if (t.unread) { patch(t.id, { unread: false }); onChanged(); } }}>
                  <span className="mb-from">{t.from.join(', ') || '—'}{t.count > 1 && <small> {t.count}</small>}</span>
                  <time>{when(t.at)}</time>
                  <span className="mb-subject">{t.attachments && <Icon name="clip" size={13} />}{t.subject}</span>
                  <span className="mb-snippet">{decodeEntities(t.snippet)}</span>
                </button>
                <button className={'mb-star' + (t.starred ? ' on' : '')} aria-label={t.starred ? 'Bỏ gắn sao' : 'Gắn sao'} aria-pressed={t.starred} onClick={() => star(t)}><Icon name="star" size={15} /></button>
              </li>
            ))}
          </ul>
        )}
        {next && <button className="btn btn-gray btn-sm mb-more" disabled={more} onClick={async () => { setMore(true); await list(next); setMore(false); }}>{more ? 'Đang tải…' : 'Tải thêm'}</button>}
      </section>

      <section className="mb-read" aria-label="Thư đang mở">
        {open ? <ThreadView key={open + sent} id={open} me={status.email || ''} sig={sig} onBack={() => setOpen(null)} onSent={() => { setSent(sent + 1); if (folder === 'sent') void list(); }}
          onGone={() => { setThreads((prev) => prev?.filter((t) => t.id !== open) || prev); setOpen(null); onChanged(); }} />
          : <p className="mb-empty"><Icon name="mail" size={28} /><span>Chọn một thư để đọc</span></p>}
      </section>

      {draft && <Compose mode="window" draft={draft} from={status.email || ''} sig={sig} onClose={() => setDraft(null)} onSent={() => { setDraft(null); toast('Đã gửi thư'); if (folder === 'sent') void list(); }} />}
      {settings && <MailSettings status={status} onClose={() => setSettings(false)} onSaved={() => { setSettings(false); onChanged(); }} />}
    </main>
  );
}

/** Gmail's snippets come with HTML entities (&#39;, &amp;): as text. */
function decodeEntities(s: string) { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; }

function ThreadView({ id, me, sig, onBack, onSent, onGone }: { id: string; me: string; sig: string; onBack: () => void; onSent: () => void; onGone: () => void }) {
  const [t, setT] = useState<MailThread | null>(null), [error, setError] = useState('');
  // As in Gmail: a reply or forward is written at the foot of the conversation, not in a window of its own.
  const [reply, setReply] = useState<MailDraft | null>(null);
  const foot = useRef<HTMLDivElement>(null);
  useEffect(() => { api.mailThread(id).then(setT, (e) => setError(e.message)); }, [id]);
  useEffect(() => { if (reply) foot.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [!!reply]);
  if (error) return <div className="mb-thread"><button className="link mb-back" onClick={onBack}><Icon name="back" size={14} />Quay lại</button><p className="note err">{error}</p></div>;
  if (!t) return <p className="note mb-pad">Đang mở thư…</p>;
  const last = t.messages.at(-1)!;
  const answer = (all: boolean) => {
    // Answering one's own last message goes to whoever it was sent to.
    const to = last.mine ? last.to : `${last.from.name} <${last.from.email}>`;
    const cc = all ? [last.mine ? '' : last.to, last.cc].join(',').split(',').map((s) => s.trim()).filter((s) => s && !s.toLowerCase().includes(me.toLowerCase())).join(', ') : '';
    setReply({ to, cc, subject: reSubject('Re', t.subject), text: '', threadId: t.id, inReplyTo: last.messageId, references: last.references });
  };
  const forward = () => setReply({ to: '', subject: reSubject('Fwd', t.subject),
    text: `\n\n---------- Thư chuyển tiếp ----------\nTừ: ${last.from.name} <${last.from.email}>\nNgày: ${new Date(last.at).toLocaleString('vi')}\nTiêu đề: ${last.subject}\nĐến: ${last.to}\n\n${last.text || htmlToText(last.html)}` });
  // Moved out of the folder being read (archived, reported, binned, or back from spam or the bin): off the list.
  const move = async (change: Parameters<typeof api.markMailThread>[1], done: string) => { try { await api.markMailThread(t.id, change); toast(done); onGone(); } catch (e: any) { toast(e.message, true); } };
  const unread = async () => { try { await api.markMailThread(t.id, { unread: true }); onBack(); } catch (e: any) { toast(e.message, true); } };
  return (
    <div className="mb-thread">
      <header className="mb-thread-head">
        <button className="link mb-back" onClick={onBack}><Icon name="back" size={14} />Quay lại</button>
        <h2>{t.subject}</h2>
        <div className="mb-actions">
          <IconButton icon="undo" label="Trả lời" size={15} onClick={() => answer(false)} />
          <IconButton icon="fwd" label="Chuyển tiếp" size={15} onClick={forward} />
          {!t.spam && !t.trash && <IconButton icon="archive" label="Lưu trữ (bỏ khỏi Hộp thư đến)" size={15} onClick={() => move({ archive: true }, 'Đã lưu trữ thư')} />}
          {t.spam ? <button className="btn btn-gray btn-sm" onClick={() => move({ spam: false }, 'Đã chuyển về Hộp thư đến')}>Không phải thư rác</button>
            : !t.trash && <IconButton icon="info" label="Báo cáo thư rác" size={15} onClick={() => move({ spam: true }, 'Đã chuyển vào Thư rác')} />}
          {t.trash ? <button className="btn btn-gray btn-sm" onClick={() => move({ trash: false }, 'Đã khôi phục thư')}>Khôi phục</button>
            : <IconButton icon="trash" label="Xoá (chuyển vào Thùng rác)" size={15} onClick={() => move({ trash: true }, 'Đã chuyển vào Thùng rác')} />}
          <IconButton icon="mail" label="Đánh dấu là chưa đọc" size={15} onClick={unread} />
        </div>
      </header>
      {t.messages.map((m, i) => <MessageView key={m.id} m={m} startOpen={i === t.messages.length - 1 || m.unread} />)}
      <div ref={foot}>
        {reply ? <Compose key={reply.subject + reply.to} mode="inline" draft={reply} from={me} sig={sig} onClose={() => setReply(null)} onSent={() => { setReply(null); toast('Đã gửi thư'); onSent(); }} />
          : <div className="mb-answer">
              <button className="mb-answer-b" onClick={() => answer(false)}><Icon name="undo" size={15} />Trả lời</button>
              <button className="mb-answer-b" onClick={() => answer(true)}><Icon name="undo" size={15} />Trả lời tất cả</button>
              <button className="mb-answer-b" onClick={forward}><Icon name="fwd" size={15} />Chuyển tiếp</button>
            </div>}
      </div>
    </div>
  );
}

function htmlToText(html: string) { return new DOMParser().parseFromString(html, 'text/html').body.innerText || ''; }

function MessageView({ m, startOpen }: { m: MailMessage; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen), [images, setImages] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const remote = /<img[^>]+src=["']?https?:/i.test(m.html);
  // Someone else's HTML: in a frame that runs no script and cannot reach this page; pictures from other sites (which
  // tell the sender the mail was opened) only when asked for.
  const doc = m.html && `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:${images ? ' https: http:' : ''}"><base target="_blank"><style>body{margin:0;font:14px/1.5 -apple-system,system-ui,sans-serif;color:#1d1d1f;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>${m.html}`;
  const fit = () => { const d = frame.current?.contentDocument; if (d && frame.current) frame.current.style.height = d.documentElement.scrollHeight + 4 + 'px'; };
  const fileUrl = (a: MailMessage['attachments'][number], download = false) => `/api/mailbox/messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(a.id)}?${new URLSearchParams({ name: a.name, type: a.type, ...(download ? { download: '1' } : {}) })}`;
  return (
    <article className={'mb-msg' + (open ? ' open' : '')}>
      <button className="mb-msg-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <b>{m.from.name}</b><span className="mb-msg-email">&lt;{m.from.email}&gt;</span><time>{new Date(m.at).toLocaleString('vi')}</time>
        {!open && <span className="mb-snippet">{(m.text || htmlToText(m.html)).slice(0, 140)}</span>}
      </button>
      {open && <>
        <p className="mb-msg-to">Đến: {m.to}{m.cc && <> · Cc: {m.cc}</>}</p>
        {remote && !images && <p className="note mb-images">Ảnh từ trang khác đang ẩn để người gửi không biết bạn đã mở thư. <button className="link" onClick={() => setImages(true)}>Hiện ảnh</button></p>}
        {m.html ? <iframe ref={frame} key={String(images)} className="mb-html" title={`Thư từ ${m.from.name}`} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} onLoad={fit} />
          : <pre className="mb-text">{m.text}</pre>}
        {!!m.attachments.length && (
          <ul className="mb-files">
            {m.attachments.map((a) => (
              <li key={a.id}><a href={fileUrl(a)} target="_blank" rel="noreferrer"><Icon name="clip" size={14} /><span>{a.name}</span><small>{size(a.size)}</small></a>
                <a href={fileUrl(a, true)} aria-label={`Tải ${a.name}`}><Icon name="download" size={14} /></a></li>
            ))}
          </ul>
        )}
      </>}
    </article>
  );
}

/** Writing a message, as Gmail does. `window`: a new message, in a window docked at the bottom right that folds down to
 *  its bar, opens up large or closes, with the page usable around it. `inline`: a reply or forward, at the foot of the
 *  conversation. Plain fields with no boxes (Người nhận, Tiêu đề), the text below, and Gửi with the attachments under it. */
function Compose({ mode, draft, from, sig, onClose, onSent }: { mode: 'window' | 'inline'; draft: MailDraft; from: string; sig: string; onClose: () => void; onSent: (threadId: string) => void }) {
  // The text starts with the signature under it (as Gmail's "--" block), and whatever is quoted (a forward) under that.
  const [start] = useState(() => `<div><br></div>${sig ? `<div><br></div><div class="gmail_signature">--<br>${cleanHtml(sig)}</div>` : ''}${draft.text.trim() ? `<div><br></div>${textToHtml(draft.text.trim())}` : ''}`);
  const [d, setD] = useState({ ...draft, html: start }), [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [cc, setCc] = useState(!!draft.cc), [bcc, setBcc] = useState(false), [formatting, setFormatting] = useState(true), [size_, setSize] = useState<'normal' | 'min' | 'max'>('normal');
  const picker = useRef<HTMLInputElement>(null);
  const total = files.reduce((n, f) => n + f.size, 0);
  const reply = !!draft.threadId;
  const written = d.html !== start || files.length > 0 || (!reply && (d.to.trim() || d.subject.trim()));
  const discard = async () => { if (busy) return; if (written && !await askConfirm('Bỏ thư đang viết?')) return; onClose(); };
  const send = async () => {
    if (busy) return;
    if (!d.to.trim()) { setError('Hãy nhập người nhận'); return; }
    if (total > ATTACH_MAX) { setError('Tệp đính kèm tối đa 3,5 MB mỗi thư; tệp lớn hơn hãy gửi link Drive.'); return; }
    setBusy(true); setError('');
    try {
      const attachments = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, data: await readFile(f) })));
      const r = await api.sendMail({ ...d, attachments });
      onSent(r.threadId);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const title = d.subject.trim() || (reply ? 'Trả lời' : 'Thư mới');
  const body = (
    <fieldset className="mb-c-body" disabled={busy}>
      <div className="mb-c-row">
        <span>{reply ? <Icon name="undo" size={14} /> : 'Đến'}</span>
        <input autoFocus={!d.to} value={d.to} onChange={(e) => setD({ ...d, to: e.target.value })} placeholder="Người nhận" aria-label="Người nhận" />
        {!cc && <button type="button" className="mb-c-link" onClick={() => setCc(true)}>Cc</button>}
        {!bcc && <button type="button" className="mb-c-link" onClick={() => setBcc(true)}>Bcc</button>}
      </div>
      {cc && <div className="mb-c-row"><span>Cc</span><input value={d.cc || ''} onChange={(e) => setD({ ...d, cc: e.target.value })} aria-label="Cc" /></div>}
      {bcc && <div className="mb-c-row"><span>Bcc</span><input value={d.bcc || ''} onChange={(e) => setD({ ...d, bcc: e.target.value })} aria-label="Bcc" /></div>}
      {!reply && <div className="mb-c-row"><input value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} maxLength={500} placeholder="Tiêu đề" aria-label="Tiêu đề" /></div>}
      <MailEditor html={start} bar={formatting} autoFocus={!!d.to} onChange={(html, text) => setD((x) => ({ ...x, html, text }))} onSend={() => void send()} minHeight={mode === 'inline' ? 160 : undefined} />
      {!!files.length && <div className="mb-c-files">
        {files.map((f, i) => <span key={i} className="mb-c-file"><Icon name="clip" size={13} /><b>{f.name}</b><small>({size(f.size)})</small><button type="button" aria-label={`Bỏ ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="x" size={13} /></button></span>)}
        {total > ATTACH_MAX && <small className="err">Quá 3,5 MB</small>}
      </div>}
      {error && <p className="note err mb-c-error" role="alert">{error}</p>}
      <div className="mb-c-bar">
        <button type="button" className="mb-c-send" onClick={send} disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi'}</button>
        <button type="button" className={'mb-c-tool' + (formatting ? ' on' : '')} onClick={() => setFormatting(!formatting)} aria-pressed={formatting} aria-label="Tuỳ chọn định dạng" title="Tuỳ chọn định dạng"><span className="me-a">A</span></button>
        <button type="button" className="mb-c-tool" onClick={() => picker.current?.click()} aria-label="Đính kèm tệp" title="Đính kèm tệp"><Icon name="clip" size={17} /></button>
        <input ref={picker} type="file" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files || [])].slice(0, 10)); e.target.value = ''; }} />
        <span className="mb-c-from" title={`Gửi từ ${from}`}>{from}</span>
        <button type="button" className="mb-c-tool" onClick={discard} aria-label="Huỷ thư nháp" title="Huỷ thư nháp"><Icon name="trash" size={17} /></button>
      </div>
    </fieldset>
  );
  if (mode === 'inline') return <section className="mb-c mb-c-inline" aria-label={title}>{body}</section>;
  return createPortal(
    <section className={'mb-c mb-c-window ' + size_} role="dialog" aria-label={title}>
      <header className="mb-c-head" onClick={() => size_ === 'min' && setSize('normal')}>
        <b>{title}</b>
        <button type="button" onClick={(e) => { e.stopPropagation(); setSize(size_ === 'min' ? 'normal' : 'min'); }} aria-label={size_ === 'min' ? 'Mở rộng' : 'Thu nhỏ'} title={size_ === 'min' ? 'Mở rộng' : 'Thu nhỏ'}><Icon name="minus" size={14} /></button>
        <button type="button" onClick={(e) => { e.stopPropagation(); setSize(size_ === 'max' ? 'normal' : 'max'); }} aria-label={size_ === 'max' ? 'Thoát toàn màn hình' : 'Toàn màn hình'} title={size_ === 'max' ? 'Thoát toàn màn hình' : 'Toàn màn hình'}><Icon name="expand" size={14} /></button>
        <button type="button" onClick={(e) => { e.stopPropagation(); void discard(); }} aria-label="Lưu và đóng" title="Đóng"><Icon name="x" size={15} /></button>
      </header>
      {size_ !== 'min' && body}
    </section>, document.body);
}

/** Mailbox beside the Planner on Workspace (BoardPanels' dock): the inbox of the account's Gmail, a thread opened in place,
 *  replies and new mail in the same window as on Hộp thư. The whole mailbox is a click away (#mail). */
export function MailPanel({ onHide, onUnread }: { onHide: () => void; onUnread?: (n: number) => void }) {
  const [status, setStatus] = useState<MailboxStatus | null>(null);
  const [threads, setThreads] = useState<MailThreadRow[] | null>(null), [next, setNext] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null), [draft, setDraft] = useState<MailDraft | null>(null), [sent, setSent] = useState(0), [error, setError] = useState('');
  const loadStatus = () => api.mailbox().then((s) => { setStatus(s); onUnread?.(s.unread || 0); return s; }, (e) => { setError(e.message); return null; });
  const list = async (page = '') => {
    try { const r = await api.mailThreads('inbox', '', page); setThreads((prev) => (page ? [...(prev || []), ...r.threads] : r.threads)); setNext(r.next); setError(''); }
    catch (e: any) { setError(e.message); setThreads([]); if (e.need === 'reconnect') void loadStatus(); }
  };
  useEffect(() => { void loadStatus().then((s) => { if (s?.connected && !s.reconnect) void list(); }); }, []);
  const ready = status?.connected && !status.reconnect;
  return (
    <aside className="bp-panel bp-mail" aria-label="Mailbox">
      <header className="bp-head">
        <Icon name="mail" size={18} /><h2>Mailbox</h2>
        {ready && <button className="bd-icon" onClick={() => setDraft({ to: '', subject: '', text: '' })} aria-label="Soạn thư" title="Soạn thư"><Icon name="edit" size={15} /></button>}
        {ready && <button className="bd-icon" onClick={() => { setOpen(null); void list(); void loadStatus(); }} aria-label="Tải lại" title="Tải lại"><Icon name="refresh" size={15} /></button>}
        <a className="bd-icon" href="#mail" aria-label="Mở Hộp thư đầy đủ" title="Mở Hộp thư đầy đủ"><Icon name="expand" size={15} /></a>
        <button className="bd-icon" onClick={onHide} aria-label="Ẩn Mailbox" title="Ẩn Mailbox"><Icon name="x" size={15} /></button>
      </header>
      <div className="bp-mail-body">
        {!status ? <p className="bp-note">{error || 'Đang tải…'}</p>
          : !ready ? (
            <div className="bp-mail-connect">
              <p>{status.reconnect || 'Kết nối Gmail của bạn để đọc và gửi thư ngay bên cạnh board.'}</p>
              {status.googleConfigured ? <button className="btn btn-primary btn-sm" onClick={() => location.assign('/api/mailbox/connect')}><Icon name="mail" size={14} />{status.reconnect ? 'Kết nối lại' : 'Kết nối Gmail'}</button>
                : <p className="bp-note">Quản trị viên chưa cấu hình Google cho DMI.</p>}
            </div>
          ) : open ? <ThreadView key={open + sent} id={open} me={status.email || ''} sig={status.signatureOn ? status.signature || '' : ''} onBack={() => setOpen(null)} onSent={() => setSent(sent + 1)}
              onGone={() => { setThreads((prev) => prev?.filter((t) => t.id !== open) || prev); setOpen(null); void loadStatus(); }} />
          : <>
            {error && <p className="note err" role="alert">{error}</p>}
            {!threads ? <p className="bp-note">Đang tải thư…</p> : !threads.length ? <p className="bp-note">Không có thư.</p> : (
              <ul className="mb-threads">
                {threads.map((t) => (
                  <li key={t.id} className={t.unread ? 'unread' : ''}>
                    <button className="mb-row" onClick={() => { setOpen(t.id); if (t.unread) { setThreads((prev) => prev?.map((x) => (x.id === t.id ? { ...x, unread: false } : x)) || prev); void loadStatus(); } }}>
                      <span className="mb-from">{t.from.join(', ') || '—'}{t.count > 1 && <small> {t.count}</small>}</span>
                      <time>{when(t.at)}</time>
                      <span className="mb-subject">{t.attachments && <Icon name="clip" size={13} />}{t.subject}</span>
                      <span className="mb-snippet">{decodeEntities(t.snippet)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {next && <button className="btn btn-gray btn-sm mb-more" onClick={() => void list(next)}>Tải thêm</button>}
          </>}
      </div>
      {draft && <Compose mode="window" draft={draft} from={status?.email || ''} sig={status?.signatureOn ? status.signature || '' : ''} onClose={() => setDraft(null)} onSent={() => { setDraft(null); toast('Đã gửi thư'); }} />}
    </aside>
  );
}

/** Hộp thư's settings, as Gmail's: the signature added under what one writes (and whether it is), written here with the
 *  same formatting or taken from the one set in Gmail. */
function MailSettings({ status, onClose, onSaved }: { status: MailboxStatus; onClose: () => void; onSaved: () => void }) {
  const [sig, setSig] = useState(status.signature || ''), [on, setOn] = useState(status.signatureOn !== false), [busy, setBusy] = useState(false), [version, setVersion] = useState(0);
  const fromGmail = async () => {
    setBusy(true);
    try {
      const r = await api.gmailSignature();
      if (!r.signature) toast('Gmail của bạn chưa có chữ ký');
      else { setSig(cleanHtml(r.signature)); setVersion(version + 1); }
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try { await api.mailSettings({ signature: cleanHtml(sig), signatureOn: on }); toast('Đã lưu cài đặt'); onSaved(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={onClose} title="Cài đặt Hộp thư" wide footer={<>
      <button className="btn btn-gray" disabled={busy} onClick={onClose}>Huỷ</button>
      <button className="btn btn-primary" disabled={busy} onClick={save}>Lưu thay đổi</button>
    </>}>
      <div className="mb-settings">
        <div className="mb-settings-h"><b>Chữ ký</b><button type="button" className="btn btn-gray btn-sm" disabled={busy} onClick={fromGmail}><Icon name="download" size={14} />Lấy chữ ký từ Gmail</button></div>
        <p className="note">Thêm vào cuối thư mới, thư trả lời và thư chuyển tiếp, sau dòng “--”, như Gmail. Định dạng được như khi viết thư (phông, màu, liên kết…).</p>
        <MailEditor key={version} html={sig} label="Chữ ký" placeholder="Họ tên · Chức vụ · Số điện thoại · Detailers Movement" minHeight={120} onChange={(html) => setSig(html)} />
        <label className="mb-settings-check"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />Tự thêm chữ ký vào thư mới, trả lời và chuyển tiếp</label>
      </div>
    </Sheet>
  );
}
