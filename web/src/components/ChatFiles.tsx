// Pieces of Tin nhắn around files: the right-click menu, the folder of a conversation (with its breadcrumb, new folders,
// uploads and drag and drop) and the files shown under a message. Files are kept by the app, like Discord's, and open
// only for the people of the conversation (server/chat-files.ts).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api';
import { toast } from '../store';
import type { ChatAttachment, ChatFile, ChatFolder, FileKind } from '../types';
import { askConfirm, askText } from './AskDialog';
import { Breadcrumb } from './kit';
import { Icon } from './ui';

export const copy = (text: string, what: string) =>
  navigator.clipboard.writeText(text).then(() => toast(`Đã sao chép ${what}`), () => toast('Trình duyệt chặn clipboard', true));

// ---------------------------------------------------------------- right-click menu
// Discord's: one list of actions for whatever was clicked, in place of the browser's own.
export type CtxItem = { label: string; icon?: string; danger?: boolean; run: () => void } | 'sep';
export interface CtxState { x: number; y: number; items: CtxItem[]; react?: { emojis: string[]; pick: (emoji: string) => void } }
/** The menu for a right click, its optional items left out (no separator at either end or twice in a row). */
export function menuAt(e: React.MouseEvent, items: (CtxItem | false | null | undefined | '')[], react?: CtxState['react']): CtxState {
  e.preventDefault();
  e.stopPropagation();
  const clean: CtxItem[] = [];
  for (const it of items) if (it && (it !== 'sep' || (clean.length && clean.at(-1) !== 'sep'))) clean.push(it);
  if (clean.at(-1) === 'sep') clean.pop();
  return { x: e.clientX, y: e.clientY, items: clean, react };
}

export function ContextMenu({ menu, onClose }: { menu: CtxState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  useLayoutEffect(() => {
    const r = ref.current!.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, menu.y + r.height > window.innerHeight - 8 ? menu.y - r.height : menu.y),
    });
  }, [menu]);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    document.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="dc-ctx" role="menu" style={pos} onContextMenu={(e) => e.preventDefault()}>
      {menu.react && (
        <div className="dc-ctx-react">
          {menu.react.emojis.map((em) => (
            <button key={em} type="button" title={`Thả ${em}`} onClick={() => { onClose(); menu.react!.pick(em); }}>{em}</button>
          ))}
        </div>
      )}
      {menu.items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="dc-ctx-sep" />
        ) : (
          <button key={i} type="button" role="menuitem" className={`dc-ctx-item${it.danger ? ' is-danger' : ''}`} onClick={() => { onClose(); it.run(); }}>
            <span>{it.label}</span>
            {it.icon && <Icon name={it.icon} size={16} />}
          </button>
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------------- files
// Icons and colours as on the Drive page (Workspace.tsx).
const KIND_ICON: Record<FileKind, string> = { folder: 'folder', video: 'film', image: 'photo', audio: 'music', pdf: 'file', doc: 'doc', sheet: 'sheet', slides: 'slides', archive: 'zip', other: 'file' };
const KIND_COLOR: Record<FileKind, string> = { folder: '#5f6368', video: '#d93025', image: '#e37400', audio: '#9334e6', pdf: '#b31412', doc: '#1a73e8', sheet: '#188038', slides: '#f9ab00', archive: '#80868b', other: '#80868b' };
export const KindIcon = ({ kind, size = 20 }: { kind: FileKind; size?: number }) => <span className="dc-kind" style={{ color: KIND_COLOR[kind] }}><Icon name={KIND_ICON[kind]} size={size} /></span>;
export const bytes = (b: number) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b >= 1e3 ? Math.round(b / 1e3) + ' KB' : b + ' B');
/** Saves a file of this site under its own name (the `download` attribute works for same-site links). */
function download(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
}

/** Largest file sent in a chat (as the server's MAX_BYTES). */
const MAX_MB = 50;
export async function uploadTo(c: string, folder: string, file: File, onProgress: (k: number) => void) {
  if (file.size > MAX_MB * 1024 * 1024) throw new Error(`File tối đa ${MAX_MB} MB`);
  if (!file.size) throw new Error('File rỗng');
  return api.uploadChatFile(c, folder, file, onProgress);
}
/** Files carried by a drag (not text or a link dragged from the page). */
export const dragsFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes('Files');

/** The files under a message: pictures shown, other files as cards that open or download. */
export function Attachments({ items }: { items: ChatAttachment[] }) {
  const pics = items.filter((a) => a.thumb), files = items.filter((a) => !a.thumb);
  return (
    <div className="dc-atts">
      {pics.length > 0 && (
        <div className={`dc-att-pics${pics.length > 1 ? ' is-many' : ''}`}>
          {pics.map((a) => (
            <a key={a.key} href={a.url || undefined} target="_blank" rel="noopener noreferrer" title={a.name}>
              <img src={a.thumb!} alt={a.name} loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {files.map((a) => (
        <div key={a.key} className="dc-att-file">
          <KindIcon kind={a.kind} size={28} />
          <span className="dc-att-meta">
            <a href={a.url || undefined} target="_blank" rel="noopener noreferrer">{a.name}</a>
            <small>{bytes(a.bytes)}</small>
          </span>
          {a.url && <a className="dc-icon-btn" href={a.url} download={a.name} title="Tải xuống" aria-label={`Tải xuống ${a.name}`}><Icon name="download" size={16} /></a>}
        </div>
      ))}
    </div>
  );
}

interface Upload { id: number; name: string; progress: number; error?: string }
let uploadId = 0;

/** The folder of conversation `c` ("dm:<person>" or a channel id), browsed in place with a breadcrumb. Files dropped on
 *  it, or picked, go into the folder open at the time. `version` changes when files were sent in the chat. */
export function ChatFilesPanel({ c, version, onAttach, onClose }: { c: string; version: number; onAttach: (f: ChatAttachment) => void; onClose: () => void }) {
  const [folder, setFolder] = useState('');
  const [data, setData] = useState<ChatFolder | null>(null);
  const [error, setError] = useState('');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [over, setOver] = useState(false);
  const [ctx, setCtx] = useState<CtxState | null>(null);
  const closeCtx = useCallback(() => setCtx(null), []);
  const pick = useRef<HTMLInputElement>(null);
  const depth = useRef(0);

  useEffect(() => { setFolder(''); }, [c]);
  const load = useCallback(() => {
    setError('');
    return api.chatFiles(c, folder).then(setData, (e) => setError(e.message));
  }, [c, folder]);
  useEffect(() => { setData(null); void load(); }, [load]);
  useEffect(() => { if (version) void load(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (files: File[]) => {
    const at = folder;
    await Promise.all(files.map(async (file) => {
      const id = ++uploadId;
      setUploads((u) => [...u, { id, name: file.name, progress: 0 }]);
      try {
        await uploadTo(c, at, file, (k) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: k } : x))));
        setUploads((u) => u.filter((x) => x.id !== id));
      } catch (e: any) {
        setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: e.message } : x)));
      }
    }));
    void load();
  };
  const newFolder = async () => {
    const name = await askText('Tên thư mục mới', '', { required: true, placeholder: 'Ví dụ: Hợp đồng, Ảnh sản phẩm…' });
    if (!name) return;
    try { await api.createChatFolder(c, folder, name); void load(); } catch (e: any) { toast(e.message, true); }
  };
  const remove = async (f: ChatFile) => {
    const what = f.kind === 'folder' ? `thư mục “${f.name}”` : `“${f.name}”`;
    if (!(await askConfirm(`Xoá ${what}? Tin nhắn đã gửi kèm file này sẽ không mở được file nữa.`))) return;
    try { await api.deleteChatFile(f.key); void load(); } catch (e: any) { toast(e.message, true); }
  };
  const open = (f: ChatFile) => {
    if (f.kind === 'folder') return setFolder(f.key);
    if (f.url) window.open(f.url, '_blank', 'noopener');
  };
  const itemMenu = (e: React.MouseEvent, f: ChatFile) =>
    setCtx(menuAt(e, [
      { label: f.kind === 'folder' ? 'Mở thư mục' : 'Mở', icon: f.kind === 'folder' ? 'folder' : 'eye', run: () => open(f) },
      f.kind !== 'folder' && !!f.url && { label: 'Gửi vào cuộc trò chuyện', icon: 'send', run: () => onAttach(f) },
      f.kind !== 'folder' && !!f.url && { label: 'Tải xuống', icon: 'download', run: () => download(f.url!, f.name) },
      'sep',
      { label: 'Sao chép tên', icon: 'copy', run: () => void copy(f.name, 'tên') },
      'sep',
      { label: f.kind === 'folder' ? 'Xoá thư mục' : 'Xoá file', icon: 'trash', danger: true, run: () => void remove(f) },
    ]));
  const blankMenu = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.dc-file-row, input, a')) return;
    setCtx(menuAt(e, [
      { label: 'Thư mục mới', icon: 'folder', run: () => void newFolder() },
      { label: 'Tải file lên', icon: 'up', run: () => pick.current?.click() },
      { label: 'Làm mới', icon: 'refresh', run: () => void load() },
    ]));
  };

  const crumbs = [
    { label: data?.title || 'Thư mục', onClick: folder ? () => setFolder('') : undefined },
    ...(data?.crumbs || []).map((x, i, all) => ({ label: x.name, onClick: i < all.length - 1 ? () => setFolder(x.key) : undefined })),
  ];
  return (
    <aside
      className={`dc-files${over ? ' is-over' : ''}`}
      aria-label="Thư mục của cuộc trò chuyện"
      onContextMenu={blankMenu}
      onDragEnter={(e) => { if (!dragsFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth.current++; setOver(true); }}
      onDragOver={(e) => { if (!dragsFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave={(e) => { e.stopPropagation(); if (--depth.current <= 0) { depth.current = 0; setOver(false); } }}
      onDrop={(e) => {
        if (!dragsFiles(e)) return;
        e.preventDefault(); e.stopPropagation(); depth.current = 0; setOver(false);
        void upload([...e.dataTransfer.files]);
      }}
    >
      <header className="dc-files-head">
        <Icon name="folder" size={16} />
        <b>Thư mục</b>
        <button type="button" className="dc-icon-btn" onClick={onClose} title="Đóng" aria-label="Đóng thư mục"><Icon name="x" size={15} /></button>
      </header>
      <div className="dc-files-crumbs"><Breadcrumb items={crumbs} /></div>
      <div className="dc-files-tools">
        <button type="button" className="dc-files-btn" onClick={() => void newFolder()}><Icon name="plus" size={14} />Thư mục</button>
        <button type="button" className="dc-files-btn is-primary" onClick={() => pick.current?.click()}><Icon name="up" size={14} />Tải lên</button>
        <input ref={pick} type="file" multiple hidden onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) void upload(f); }} />
      </div>
      {uploads.length > 0 && (
        <ul className="dc-uploads">
          {uploads.map((u) => (
            <li key={u.id} className={u.error ? 'is-error' : ''}>
              <span>{u.name}</span>
              {u.error ? (
                <>
                  <small>{u.error}</small>
                  <button type="button" className="dc-clear-btn" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))} aria-label="Bỏ"><Icon name="x" size={12} /></button>
                </>
              ) : <i style={{ width: `${Math.round(u.progress * 100)}%` }} />}
            </li>
          ))}
        </ul>
      )}
      <div className="dc-files-list">
        {error ? (
          <p className="dc-files-empty">{error}</p>
        ) : !data ? (
          <p className="dc-files-empty">Đang mở thư mục…</p>
        ) : !data.items.length ? (
          <div className="dc-files-empty">
            <Icon name="up" size={28} />
            <p>Thư mục trống. Kéo file vào đây hoặc bấm Tải lên.</p>
            <small>Chỉ người trong cuộc trò chuyện xem được · tối đa {MAX_MB} MB một file</small>
          </div>
        ) : (
          data.items.map((f) => (
            <button key={f.key} type="button" className="dc-file-row" onDoubleClick={() => open(f)} onClick={() => f.kind === 'folder' && open(f)} onContextMenu={(e) => itemMenu(e, f)} title={f.name}>
              {f.thumb ? <img src={f.thumb} alt="" loading="lazy" /> : <KindIcon kind={f.kind} size={22} />}
              <span className="dc-file-meta">
                <b>{f.name}</b>
                <small>{[f.kind === 'folder' ? 'Thư mục' : bytes(f.bytes), f.uploadedBy, new Date(f.modifiedAt).toLocaleDateString('vi-VN')].filter(Boolean).join(' · ')}</small>
              </span>
            </button>
          ))
        )}
      </div>
      {over && <div className="dc-drop-hint"><Icon name="up" size={28} /><b>Thả để tải lên</b><small>{crumbs.map((x) => x.label).join(' › ')}</small></div>}
      {ctx && <ContextMenu menu={ctx} onClose={closeCtx} />}
    </aside>
  );
}
