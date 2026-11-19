import {TextLinks} from './TextLinks';
// Pieces shared by the Workspace board and the card window: label and cover colours, avatars, dates, the small pop-up
// windows (Trello's popovers) and the words for what happened on a board.
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './ui';
import { langPref } from '../i18n';
import type { BoardActivity, CardAttachment, CommentReaction, ReactionKind } from '../types';
import { api } from '../api';
import { toast } from '../store';

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

// Logos are often saved on a white or black square. The flat colour that reaches the edges of the picture is made
// transparent once per picture, in the browser, so old uploads lose it too.
const clearedLogos = new Map<string, Promise<string>>();
const near = (d: Uint8ClampedArray, i: number, c: number[], tol: number) =>
  Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]) <= tol;
async function clearBackdrop(src: string): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const w = Math.min(img.naturalWidth, 480), h = Math.round(img.naturalHeight * (w / img.naturalWidth));
  if (!w || !h) return src;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h), d = px.data;
  const corners = [0, w - 1, (h - 1) * w, h * w - 1].map((p) => p * 4);
  if (corners.some((i) => d[i + 3] < 250)) return src; // already transparent
  const bg = [0, 1, 2].map((k) => Math.round(corners.reduce((s, i) => s + d[i + k], 0) / 4));
  if (corners.filter((i) => near(d, i, bg, 60)).length < 3) return src; // no flat backdrop: a photo
  // Flood from every edge pixel of the backdrop colour; the logo's own white or black inside stays.
  const TOL = 90, seen = new Uint8Array(w * h), stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  let cleared = 0;
  while (stack.length) {
    const p = stack.pop()!;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!near(d, i, bg, TOL)) continue;
    // Close to the backdrop: gone; towards the edge of the shape: faded, so the outline stays smooth.
    const diff = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
    d[i + 3] = diff <= 30 ? 0 : Math.round(255 * (diff - 30) / (TOL - 30));
    cleared++;
    const x = p % w;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (p >= w) stack.push(p - w);
    if (p < w * (h - 1)) stack.push(p + w);
  }
  if (cleared > w * h * 0.97) return src; // the whole picture is one colour
  ctx.putImageData(px, 0, 0);
  return canvas.toDataURL('image/png');
}
/** A logo picture without the flat square it was saved on (the original shows until that is worked out). */
export function LogoImg({ src, className }: { src: string; className?: string }) {
  const [out, setOut] = useState(src);
  useEffect(() => {
    let live = true;
    setOut(src);
    if (!clearedLogos.has(src)) clearedLogos.set(src, clearBackdrop(src).catch(() => src));
    void clearedLogos.get(src)!.then((s) => { if (live) setOut(s); });
    return () => { live = false; };
  }, [src]);
  return <img src={out} alt="" className={className} />;
}

// ---------------------------------------------------------------- reactions on comments (as on Facebook)
export const REACTIONS: [ReactionKind, string, string][] = [['like', '👍', 'Thích'], ['love', '❤️', 'Yêu thích'], ['haha', '😆', 'Haha'], ['wow', '😮', 'Wow'], ['sad', '😢', 'Buồn'], ['care', '🥰', 'Thương thương'], ['angry', '😡', 'Phẫn nộ']];
const REACTION = Object.fromEntries(REACTIONS.map(([k, e, l]) => [k, { emoji: e, label: l }])) as Record<ReactionKind, { emoji: string; label: string }>;

// Facebook-style reaction glyphs: Thích is a white thumb on a blue disc, Yêu a white heart on a red disc, the rest the
// coloured face emoji as the browser draws them. Generic shapes and standard emoji, not Facebook's own artwork.
const THUMB = <path d="M7.5 10.2v8.3h-2a1 1 0 0 1-1-1v-6.3a1 1 0 0 1 1-1h2Zm2 0 3.1-6.4a1.6 1.6 0 0 1 3 .95l-.6 3.35h3.35a1.8 1.8 0 0 1 1.78 2.12l-1 5.3a2 2 0 0 1-1.97 1.63H9.5v-7Z" fill="currentColor" stroke="none" />;
const HEART = <path d="M12 20.3S3.3 15.5 3.3 9.6C3.3 6.9 5.2 5 7.6 5c1.8 0 3.3 1.1 4.4 2.6C13.1 6.1 14.6 5 16.4 5c2.4 0 4.3 1.9 4.3 4.6 0 5.9-8.7 10.7-8.7 10.7Z" fill="currentColor" stroke="none" />;
const GLYPH: Record<ReactionKind, { bg?: string; svg?: ReactNode; emoji?: string }> = {
  like: { bg: 'linear-gradient(150deg, #58a7ff, #1877f2)', svg: THUMB },
  love: { bg: 'linear-gradient(150deg, #ff6a86, #f33e58)', svg: HEART },
  haha: { emoji: '😆' }, wow: { emoji: '😮' }, sad: { emoji: '😢' }, care: { emoji: '🥰' }, angry: { emoji: '😡' },
};
export function ReactionGlyph({ kind, size = 20 }: { kind: ReactionKind; size?: number }) {
  const g = GLYPH[kind];
  if (g.svg) return <span className="rx-glyph" style={{ width: size, height: size, background: g.bg }}><svg viewBox="0 0 24 24" width={Math.round(size * 0.64)} height={Math.round(size * 0.64)} aria-hidden="true">{g.svg}</svg></span>;
  return <span className="rx-face" style={{ fontSize: Math.round(size * 0.94) }}>{g.emoji}</span>;
}
// Loaded only when the picker opens (lottie-web is heavy); the animation plays over the static glyph once it is ready.
const ReactionLottie = lazy(() => import('./ReactionLottie'));
/** A comment's reactions: "Thích" likes it or takes one's reaction back, resting on it opens the seven to choose from;
 *  beside it the most given ones and how many, the names on hover. One reaction per person (server/comment-reactions.ts). */
export function Reactions({ commentId, meId, initial }: { commentId: string; meId: string; initial?: CommentReaction[] }) {
  const [list, setList] = useState<CommentReaction[]>(initial || []);
  const [open, setOpen] = useState(false), [at, setAt] = useState({ left: 0, top: 0 });
  const timer = useRef<any>(null), btn = useRef<HTMLButtonElement>(null);
  useEffect(() => setList(initial || []), [initial]);
  // Above the button, kept on screen: comments sit in narrow columns that would cut it off.
  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setAt({ left: Math.max(8, Math.min(r.left - 6, window.innerWidth - 300)), top: r.top < 64 ? r.bottom + 6 : r.top - 54 });
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const mine = list.find((x) => x.userId === meId)?.r || null;
  const give = async (r: ReactionKind | null) => {
    setOpen(false); clearTimeout(timer.current);
    const before = list;
    setList([...list.filter((x) => x.userId !== meId), ...(r ? [{ r, userId: meId, name: 'Bạn' }] : [])]);
    try { setList((await api.reactComment(commentId, r)).reactions); } catch (e: any) { setList(before); toast(e.message, true); }
  };
  const later = (on: boolean, ms: number) => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(on), ms); };
  const counts = REACTIONS.map(([k]) => [k, list.filter((x) => x.r === k).length] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const names = counts.map(([k]) => `${REACTION[k].emoji} ${list.filter((x) => x.r === k).map((x) => (x.userId === meId ? 'Bạn' : x.name)).join(', ')}`).join('\n');
  return (
    <span className="rx" onMouseLeave={() => later(false, 300)}>
      <button ref={btn} type="button" className={'bk-link rx-btn' + (mine ? ` rx-on rx-${mine}` : '')} onMouseEnter={() => later(true, 450)} onClick={() => void give(mine ? null : 'like')} aria-label={mine ? `Bỏ ${REACTION[mine].label}` : 'Thích'}>
        {mine && <span className="rx-emoji"><ReactionGlyph kind={mine} size={16} /></span>}{mine ? REACTION[mine].label : 'Thích'}
      </button>
      {open && (
        <span className="rx-pick" role="menu" style={at} onMouseEnter={() => clearTimeout(timer.current)}>
          {REACTIONS.map(([k, , l]) => (
            <button key={k} type="button" role="menuitem" className={mine === k ? 'on' : ''} title={l} aria-label={l} onClick={() => void give(k)}>
              <ReactionGlyph kind={k} size={34} />
              <Suspense fallback={null}><span className="rx-anim"><ReactionLottie kind={k} size={38} /></span></Suspense>
            </button>
          ))}
        </span>
      )}
      {counts.length > 0 && <span className="rx-sum" title={names}>{counts.slice(0, 3).map(([k]) => <i key={k}><ReactionGlyph kind={k} size={16} /></i>)}<b>{list.length}</b></span>}
    </span>
  );
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

/** Board backgrounds, by the names the server keeps. */
export const BG: Record<string, string> = {
  ocean: '#0c66e4',
  sky: '#0055cc',
  forest: '#1f845a',
  lime: '#4c6b1f',
  sunset: '#c9372c',
  rose: '#ae2e24',
  berry: '#943d73',
  grape: '#5e4db2',
  slate: '#44546f',
  night: '#1d2125',
};
