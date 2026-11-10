import {TextLinks} from './TextLinks';
// Pieces shared by the Workspace board and the card window: label and cover colours, avatars, dates, the small pop-up
// windows (Trello's popovers) and the words for what happened on a board.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './ui';
import { langPref } from '../i18n';
import type { BoardActivity, CardAttachment } from '../types';

/** Label and cover colours, by the names the server keeps. */
export const COLOR: Record<string, string> = {
  green: '#4bce97', yellow: '#f5cd47', orange: '#fea362', red: '#f87168', purple: '#9f8fef',
  blue: '#579dff', sky: '#6cc3e0', lime: '#94c748', pink: '#e774bb', black: '#8590a2',
};
export const COLOR_NAME: Record<string, string> = {
  green: 'xanh lá', yellow: 'vàng', orange: 'cam', red: 'đỏ', purple: 'tím', blue: 'xanh dương', sky: 'xanh trời', lime: 'xanh chanh', pink: 'hồng', black: 'xám',
};
const AVATAR = ['#0c66e4', '#1f845a', '#c25100', '#ae2e24', '#6e5dc6', '#0055cc', '#206a83', '#4c6b1f', '#943d73', '#44546f'];

const avatarMap = new Map<string, number>();
let avatarLoaded = false;
const avatarListeners = new Set<() => void>();
function ensureAvatars() {
  if (avatarLoaded || typeof window === 'undefined') return;
  avatarLoaded = true;
  fetch('/api/avatars', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: Record<string, number> | null) => {
      if (!d) return;
      for (const [k, v] of Object.entries(d)) if (v) avatarMap.set(k, v);
      avatarListeners.forEach((fn) => fn());
    })
    .catch(() => {});
}
export function notifyAvatarChanged(userId: string, avatarAt: number | null) {
  if (avatarAt) avatarMap.set(userId, avatarAt);
  else avatarMap.delete(userId);
  avatarListeners.forEach((fn) => fn());
}
export function hasUserAvatar(userId: string | null | undefined) {
  return !!(userId && avatarMap.get(userId));
}
/** Resizes and center-crops an image file to a 240x240 square data URL under 300 KB. */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) {
    throw new Error('Hãy chọn ảnh định dạng PNG, JPEG, WebP hoặc GIF');
  }
  if (file.size <= 280 * 1024 && file.type === 'image/gif') {
    return await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('Không đọc được file ảnh'));
      r.readAsDataURL(file);
    });
  }
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('Không đọc được file ảnh'); });
  const side = Math.min(bmp.width, bmp.height), target = Math.min(240, side || 240);
  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d')!;
  const sx = Math.max(0, Math.floor((bmp.width - side) / 2));
  const sy = Math.max(0, Math.floor((bmp.height - side) / 2));
  ctx.drawImage(bmp, sx, sy, side, side, 0, 0, target, target);
  bmp.close?.();
  let out = canvas.toDataURL('image/webp', 0.86);
  if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', 0.86);
  return out;
}

/** A person's picture (when uploaded) or their initials in a coloured circle (the colour follows their id). */
export function Avatar({ m, size = 28 }: { m: { id: string; name: string; userId?: string | null; avatarAt?: number | null } | undefined; size?: number }) {
  const [, bump] = useState(0);
  const [failed, setFailed] = useState(false);
  const uid = m?.userId || (m?.id?.startsWith('u_') ? m.id : null);
  useEffect(() => {
    ensureAvatars();
    const fn = () => { setFailed(false); bump((x) => x + 1); };
    avatarListeners.add(fn);
    return () => { avatarListeners.delete(fn); };
  }, [uid]);
  if (!m) return null;
  if (uid && m.avatarAt) avatarMap.set(uid, m.avatarAt);
  const at = uid ? (m.avatarAt ?? avatarMap.get(uid) ?? null) : null;
  const n = [...(uid || m.id || m.name)].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const clean = m.name.replace(/\([^)]*\)/g, '').trim() || m.name;
  const words = clean.match(/[\p{L}\p{N}]+/gu) || [];
  const ini = words.length >= 2
    ? words.slice(-2).map((w) => w[0]).join('').toUpperCase()
    : (clean.slice(0, 2).toUpperCase() || '?');
  return (
    <span className="bk-av" title={m.name} style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: AVATAR[n % AVATAR.length], overflow: 'hidden', position: 'relative' }}>
      {uid && at && !failed ? (
        <img
          src={`/api/avatars/${encodeURIComponent(uid)}?v=${at}`}
          alt={m.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={() => setFailed(true)}
        />
      ) : ini}
    </span>
  );
}

const two = (n: number) => String(n).padStart(2, '0');
/** Due state of a card: done (green), over (red), soon (within a day, yellow), or '' (plain). */
export function dueState(due: number | null, done: boolean) {
  if (!due) return '';
  if (done) return 'done';
  const left = due - Date.now();
  return left < 0 ? 'over' : left < 864e5 ? 'soon' : '';
}
// "8 thg 11" has no accents for the English interface to know it by, so English gets its month names here ("8 Nov");
// changing language reloads the page.
const MONTHS = langPref() === 'en' ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] : null;
export const shortDate = (ms: number) => { const d = new Date(ms); return `${d.getDate()} ${MONTHS ? MONTHS[d.getMonth()] : `thg ${d.getMonth() + 1}`}${d.getFullYear() !== new Date().getFullYear() ? `, ${d.getFullYear()}` : ''}`; };
export const fullDate = (ms: number) => { const d = new Date(ms); return `${shortDate(ms)} lúc ${two(d.getHours())}:${two(d.getMinutes())}`; };
export function ago(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  return fullDate(ms);
}
/** `yyyy-mm-dd` and `hh:mm` of a time, for date and time inputs (local time). */
export const dateIn = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
export const timeIn = (ms: number) => { const d = new Date(ms); return `${two(d.getHours())}:${two(d.getMinutes())}`; };

/**
 * A small window below the element that opened it, with a title, a back arrow (`onBack`) and a close button. It
 * closes on a click outside or Escape (which then goes no further, so the card window stays open).
 */
export function Pop({ anchor, title, onClose, onBack, children, width = 304, className = '' }: { className?: string; anchor: HTMLElement | null; title: string; onClose: () => void; onBack?: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: 0, max: 0 });
  useLayoutEffect(() => {
    const el = ref.current, body = el?.lastElementChild as HTMLElement | undefined;
    if (!anchor || !el || !body) return;
    const place = () => {
      // Below the opener, or above it when there is clearly more room there. Taller than that side: moved up (over the
      // opener if need be) to show whole in the window; taller than the window: from its top, scrolling inside.
      const r = anchor.getBoundingClientRect(), h = (el.firstElementChild as HTMLElement).offsetHeight + body.scrollHeight;
      const below = window.innerHeight - r.bottom - 14, above = r.top - 14, room = window.innerHeight - 16;
      const up = h > below && below < 320 && above > below;
      let top = up ? Math.max(8, r.top - 6 - Math.min(h, above)) : r.bottom + 6, max = up ? above : below;
      if (h > max) { top = Math.max(8, Math.min(top, window.innerHeight - 8 - h)); max = room; }
      setPos({ left: Math.max(8, Math.min(window.innerWidth - width - 8, r.left)), top, max });
    };
    place();
    // Again when what is inside grows or shrinks (a list that loads, a section that opens).
    const watch = new ResizeObserver(place);
    for (const c of body.children) watch.observe(c);
    return () => watch.disconnect();
  }, [anchor, width, title]);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const off = (e: MouseEvent) => { if(e.target instanceof Element&&e.target.closest('dialog.qc-dialog'))return; if (!ref.current?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) close.current(); };
    const esc = (e: KeyboardEvent) => { if(document.querySelector('dialog.qc-dialog[open]'))return; if (e.key === 'Escape') { e.stopPropagation(); close.current(); } };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc, true); };
  }, [anchor]);
  return (
    <div ref={ref} className={'bk-pop '+className} style={{ left: pos.left, top: pos.top, width, maxHeight: pos.max || undefined }} role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
      <header>
        {onBack ? <button className="bk-x" onClick={onBack} aria-label="Quay lại"><Icon name="left" size={14} /></button> : <span className="bk-x-gap" />}
        <span>{title}</span>
        <button className="bk-x" onClick={onClose} aria-label="Đóng"><Icon name="x" size={14} /></button>
      </header>
      <div className="bk-pop-b">{children}</div>
    </div>
  );
}

/** What happened, in words (`onCard`: shown on the card itself, so the card's name is left out). */
/** A card video's picture: Drive's thumbnail, through the customer's folder (none for folders on a Mac's disk). */
export const fileThumb = (a: Pick<CardAttachment, 'customerId' | 'key'>) => (a.customerId && a.key ? `/api/customers/${a.customerId}/files/${encodeURIComponent(a.key)}/thumb` : '');

export function activityText(a: BoardActivity, onCard: boolean, openCard?: (id: string) => void): ReactNode {
  const d = a.data || {};
  const card = onCard ? 'thẻ này' : a.cardTitle ? (openCard && a.cardId ? <button className="bk-link" onClick={() => openCard(a.cardId!)}>{a.cardTitle}</button> : <b>{a.cardTitle}</b>) : 'một thẻ';
  switch (a.action) {
    case 'card.add': return <>đã thêm {card} vào <b>{d.list}</b></>;
    case 'card.move': return <>đã chuyển {card} từ <b>{d.from}</b> sang <b>{d.to}</b></>;
    case 'card.done': return d.done ? <>đã đánh dấu {card} là hoàn thành</> : <>đã bỏ đánh dấu hoàn thành {card}</>;
    case 'card.archive': return <>đã lưu trữ {card}</>;
    case 'card.restore': return <>đã khôi phục {card}</>;
    case 'card.due': return d.due ? <>đã đặt hạn {fullDate(d.due)} cho {card}</> : <>đã gỡ hạn của {card}</>;
    case 'card.member': return d.on ? (d.self ? <>đã tham gia {card}</> : <>đã thêm <b>{d.name}</b> vào {card}</>) : (d.self ? <>đã rời {card}</> : <>đã gỡ <b>{d.name}</b> khỏi {card}</>);
    case 'card.copy': return <>đã sao chép {card} từ <b>{d.from}</b></>;
    case 'attach': return <>đã đính kèm <b>{d.name}</b> vào {card}</>;
    case 'card.customer': return d.name ? <>đã đặt khách hàng <b>{d.name}</b> cho {card}</> : <>đã bỏ khách hàng của {card}</>;
    case 'item.done': return <>đã hoàn thành <b>{d.text}</b> trên {card}</>;
    case 'list.add': return <>đã thêm danh sách <b>{d.name}</b></>;
    case 'list.archive': return <>đã lưu trữ danh sách <b>{d.name}</b></>;
    case 'list.restore': return <>đã khôi phục danh sách <b>{d.name}</b></>;
    case 'list.archive-cards': return <>đã lưu trữ mọi thẻ trong <b>{d.name}</b></>;
    case 'board.member': return d.level
      ? <>đã cho <b>{d.name}</b> quyền <b>{({ admin: 'Admin', normal: 'Thành viên', observer: 'Chỉ xem' } as Record<string, string>)[d.level] || d.level}</b> trên board</>
      : d.self ? <>đã rời board</> : <>đã gỡ <b>{d.name}</b> khỏi board</>;
    case 'board.member-edit': return d.on ? <>đã cho thành viên sửa board (danh sách, nhãn, tên, hình nền)</> : <>đã chỉ cho admin sửa board</>;
    default: return <>đã cập nhật {card}</>;
  }
}

/** Plain text with links made clickable and "- " lines as a bullet list (descriptions and comments). */
export function Rich({ text }: { text: string }) {
  const link = (s:string,k:number)=><TextLinks key={k} text={s}/>;
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => { if (bullets.length) blocks.push(<ul key={`u${blocks.length}`}>{bullets.map((b, i) => <li key={i}>{link(b, i)}</li>)}</ul>); bullets = []; };
  text.split('\n').forEach((line, i) => {
    if (/^\s*[-*•]\s+/.test(line)) { bullets.push(line.replace(/^\s*[-*•]\s+/, '')); return; }
    flush();
    blocks.push(line.trim() ? <p key={`p${i}`}>{link(line, i)}</p> : <br key={`b${i}`} />);
  });
  flush();
  return <div className="bk-rich">{blocks}</div>;
}
