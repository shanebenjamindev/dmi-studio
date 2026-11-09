// Formatted text for descriptions and comments: an editor with a toolbar (bold, italic, underline, strike, quote, code,
// alignment, headings, lists, sub/superscript, link, picture, text and highlight colour, clear) and a viewer. Where people
// can be mentioned (MentionPeople), @ suggests them by name; a mention is kept as <span data-mention="their id">. Stored as
// HTML, which is always cleaned to the few tags and styles the toolbar makes before it is shown or saved. Text written
// before (plain) shows as it always has.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import { Avatar, Rich } from './boardkit';
import { toast } from '../store';
import { isBlank, isRich } from '../../../shared/rich';

const TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SUB', 'SUP', 'CODE', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'P', 'DIV', 'BR', 'SPAN', 'FONT', 'OL', 'UL', 'LI', 'A', 'IMG']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'TEMPLATE', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO']);
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)|transparent)$/i;
const IMG = /^(data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+|https:\/\/[^\s"'<>]+)$/i;
const HREF = /^(https?:\/\/|mailto:)[^\s"'<>]+$/i;
/** Only what the toolbar makes stays: these tags; colours, highlight and alignment as styles; links out and pictures. */
export function cleanRich(html: string) {
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild as HTMLElement;
  const walk = (el: Element) => {
    for (const c of [...el.children]) {
      if (DROP.has(c.tagName)) { c.remove(); continue; }
      walk(c);
      if (!TAGS.has(c.tagName)) { c.replaceWith(...c.childNodes); continue; }
      const style = (c as HTMLElement).style, keep: string[] = [];
      if (style) {
        for (const [prop, ok] of [['color', COLOR], ['background-color', COLOR], ['text-align', /^(left|center|right|justify|start|end)$/]] as [string, RegExp][]) {
          const v = style.getPropertyValue(prop).trim();
          if (v && ok.test(v)) keep.push(`${prop}: ${v}`);
        }
      }
      const color = c.tagName === 'FONT' ? c.getAttribute('color') : null;
      for (const a of [...c.attributes]) {
        const ok = (c.tagName === 'A' && a.name === 'href' && HREF.test(a.value)) || (c.tagName === 'IMG' && ((a.name === 'src' && IMG.test(a.value)) || a.name === 'alt'))
          || (c.tagName === 'UL' && a.name === 'data-check') || (c.tagName === 'LI' && a.name === 'data-checked')
          || (c.tagName === 'SPAN' && a.name === 'data-mention' && /^[\w-]{1,64}$/.test(a.value));
        if (!ok) c.removeAttribute(a.name);
      }
      if (color && COLOR.test(color)) keep.push(`color: ${color}`);
      if (keep.length) c.setAttribute('style', keep.join('; '));
      if (c.tagName === 'A') { if (!c.getAttribute('href')) { c.replaceWith(...c.childNodes); continue; } c.setAttribute('target', '_blank'); c.setAttribute('rel', 'noopener noreferrer'); }
      if (c.tagName === 'IMG' && !c.getAttribute('src')) c.remove();
    }
  };
  walk(root);
  return root.innerHTML;
}
const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
/** What the editor starts with: formatted text as it is, plain text with its line breaks. */
const toHtml = (v: string) => (isRich(v) ? cleanRich(v) : escape(v).replace(/\n/g, '<br>'));
/** Plain addresses in formatted text become links when shown. */
function linkify(html: string) {
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild as HTMLElement;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!(n.parentElement?.closest('a,code,pre'))) texts.push(n as Text);
  for (const t of texts) {
    const parts = (t.nodeValue || '').split(/(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g);
    if (parts.length < 2) continue;
    t.replaceWith(...parts.map((p, i) => { if (i % 2 === 0) return document.createTextNode(p); const a = document.createElement('a'); a.href = p; a.textContent = p; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }));
  }
  return root.innerHTML;
}

/** Shows a description or comment: formatted (cleaned) or, if it was written plain, as before. */
export function RichView({ text }: { text: string }) {
  if (!isRich(text)) return <Rich text={text} />;
  return <div className="rt-view" dangerouslySetInnerHTML={{ __html: linkify(cleanRich(text)) }} />;
}

const PALETTE = ['#172b4d', '#5e6c84', '#d62828', '#e8590c', '#e6a700', '#2b8a3e', '#0b7df2', '#1098ad', '#7048e8', '#c2255c'];
const MARKS = ['#fff3bf', '#ffe066', '#d3f9d8', '#c5f6fa', '#d0ebff', '#e5dbff', '#ffdeeb', '#ffd8a8'];
/** A picture made small enough to keep in the text (longest side 900 px unless asked otherwise, JPEG). */
export async function shrink(file: File, side = 900, quality = 0.8) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, side / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

/** Who may be mentioned with @ in the editors inside (the people who see the card); none: no mentions. */
export type Mentionable = { id: string; name: string; avatarAt?: number | null };
export const MentionPeople = createContext<Mentionable[] | null>(null);
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();

/** The editor. `onChange` gets cleaned HTML ('' when nothing is written); ⌘/Ctrl+Enter calls `onSubmit`. */
export function RichEditor({ value, onChange, placeholder = '', autoFocus, onSubmit, compact, disabled }: { value: string; onChange: (html: string) => void; placeholder?: string; autoFocus?: boolean; onSubmit?: () => void; compact?: boolean; disabled?: boolean }) {
  const body = useRef<HTMLDivElement>(null), file = useRef<HTMLInputElement>(null), saved = useRef<Range | null>(null);
  const [empty, setEmpty] = useState(isBlank(value)), [menu, setMenu] = useState<'' | 'color' | 'mark' | 'align'>('');
  // @ and the words after it, being typed: where they are, and the people they match.
  const people = useContext(MentionPeople);
  const spot = useRef<{ node: Text; start: number; end: number } | null>(null);
  const [mention, setMention] = useState<{ q: string; x: number; y: number } | null>(null), [pick, setPick] = useState(0);
  const matches = mention && people ? people.filter((p) => fold(p.name).includes(fold(mention.q.trim()))).slice(0, 6) : [];
  const look = () => {
    const s = window.getSelection(), node = s?.anchorNode;
    if (!people?.length || !s?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !body.current?.contains(node) || node.parentElement?.closest('[data-mention]')) { setMention(null); return; }
    const before = (node.nodeValue || '').slice(0, s.anchorOffset);
    const m = /(^|[\s\u00a0(])@([^\s\u00a0@]*(?:[ \u00a0][^\s\u00a0@]*){0,2})$/.exec(before);
    if (!m) { setMention(null); return; }
    const r = s.getRangeAt(0).getBoundingClientRect(), box = body.current.getBoundingClientRect();
    spot.current = { node: node as Text, start: s.anchorOffset - m[2].length - 1, end: s.anchorOffset };
    setMention((was) => { if (!was || was.q !== m[2]) setPick(0); return { q: m[2], x: r.left || box.left, y: (r.bottom || box.top + 24) + 4 }; });
  };
  /** The @words become the person's name, kept whole, with a space after it to type on. */
  const mentionOf = (p: Mentionable) => {
    const at = spot.current;
    if (!at || !body.current?.contains(at.node)) return;
    const range = document.createRange();
    range.setStart(at.node, Math.min(at.start, at.node.length)); range.setEnd(at.node, Math.min(at.end, at.node.length));
    range.deleteContents();
    const tag = document.createElement('span'), gap = document.createTextNode('\u00a0');
    tag.setAttribute('data-mention', p.id); tag.contentEditable = 'false'; tag.textContent = '@' + p.name;
    range.insertNode(gap); range.insertNode(tag);
    const s = window.getSelection(), after = document.createRange();
    after.setStartAfter(gap); after.collapse(true); s?.removeAllRanges(); s?.addRange(after);
    setMention(null); spot.current = null; changed();
  };
  useEffect(() => {
    const el = body.current!;
    el.innerHTML = toHtml(value);
    el.querySelectorAll('[data-mention]').forEach((m) => { (m as HTMLElement).contentEditable = 'false'; });
    setEmpty(isBlank(el.innerHTML));
    if (autoFocus) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // What is saved always starts with a tag, so it never reads as plain text (words typed first stay outside any block).
  const changed = () => { const html = cleanRich(body.current!.innerHTML), blank = isBlank(html); setEmpty(blank); onChange(blank ? '' : /^\s*</.test(html) ? html : `<div>${html}</div>`); };
  // The selection is kept while a palette or prompt is open, and put back before a command.
  const keep = () => { const s = window.getSelection(); if (s?.rangeCount && body.current?.contains(s.anchorNode)) saved.current = s.getRangeAt(0).cloneRange(); };
  const restore = () => { body.current?.focus(); if (saved.current) { const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(saved.current); } };
  const cmd = (name: string, arg?: string) => { restore(); document.execCommand('styleWithCSS', false, 'true'); document.execCommand(name, false, arg); keep(); changed(); setMenu(''); };
  const block = (tag: string) => { restore(); const cur = String(document.queryCommandValue('formatBlock')).toUpperCase(); cmd('formatBlock', cur === tag ? 'P' : tag); };
  const code = () => { restore(); const t = window.getSelection()?.toString() || 'code'; cmd('insertHTML', `<code>${escape(t)}</code>&nbsp;`); };
  const link = () => {
    keep();
    const url = prompt('Địa chỉ liên kết (https://…)', 'https://')?.trim();
    if (!url || url === 'https://') return;
    if (!HREF.test(url)) return toast('Liên kết phải bắt đầu bằng https://, http:// hoặc mailto:', true);
    const s = saved.current && !saved.current.collapsed;
    if (s) cmd('createLink', url); else cmd('insertHTML', `<a href="${escape(url)}">${escape(url)}</a>&nbsp;`);
  };
  const picture = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Hãy chọn một ảnh', true);
    try { cmd('insertHTML', `<img src="${await shrink(f)}" alt="">`); } catch { toast('Không đọc được ảnh này', true); }
  };
  const paste = (e: React.ClipboardEvent) => {
    const img = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
    if (img) { e.preventDefault(); keep(); void picture(img); return; }
    const html = e.clipboardData.getData('text/html');
    if (html) { e.preventDefault(); document.execCommand('insertHTML', false, cleanRich(html)); changed(); }
  };
  const tool = (icon: string | null, label: string, run: () => void, text?: React.ReactNode) =>
    <button type="button" title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={run}>{icon ? <Icon name={icon} size={16} /> : text}</button>;
  return (
    <div className={'rt' + (compact ? ' compact' : '') + (disabled ? ' off' : '')}>
      <div className="rt-area">
        {empty && <span className="rt-placeholder">{placeholder}</span>}
        <div ref={body} className="rt-body rt-view" contentEditable={!disabled} suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={placeholder || 'Nội dung'}
          onInput={() => { changed(); look(); }} onPaste={paste} onKeyUp={(e) => { keep(); if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) look(); }} onMouseUp={() => { keep(); look(); }} onBlur={() => { keep(); setTimeout(() => setMention(null), 150); }}
          onKeyDown={(e) => {
            // The suggestions take the arrows, Enter and Tab while they are open; Escape closes them only.
            if (mention && matches.length) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setPick((pick + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); mentionOf(matches[Math.min(pick, matches.length - 1)]); return; }
            }
            if (mention && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null); return; }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) { e.preventDefault(); onSubmit(); }
          }} />
      </div>
      {mention && matches.length > 0 && createPortal(
        <ul className="rt-mentions" role="listbox" aria-label="Nhắc tên" style={{ left: Math.min(mention.x, window.innerWidth - 260), top: Math.min(mention.y, window.innerHeight - 240) }}>
          {matches.map((p, i) => <li key={p.id} role="option" aria-selected={i === pick} className={i === pick ? 'on' : ''}
            onMouseDown={(e) => { e.preventDefault(); mentionOf(p); }} onMouseEnter={() => setPick(i)}><Avatar m={p} size={24} /><span>{p.name}</span></li>)}
        </ul>, document.body)}
      <div className="rt-bar" role="toolbar" aria-label="Định dạng">
        <span>{tool('bold', 'Đậm (⌘B)', () => cmd('bold'))}{tool('italic', 'Nghiêng (⌘I)', () => cmd('italic'))}{tool('underline', 'Gạch chân (⌘U)', () => cmd('underline'))}{tool('strike', 'Gạch ngang', () => cmd('strikeThrough'))}</span>
        <span>{tool('quote', 'Trích dẫn', () => block('BLOCKQUOTE'))}{tool('code', 'Mã', code)}
          <span className="rt-pop-wrap">{tool('align', 'Căn lề', () => { keep(); setMenu(menu === 'align' ? '' : 'align'); })}
            {menu === 'align' && <span className="rt-pop rt-align">{([['justifyLeft', 'align', 'Căn trái'], ['justifyCenter', 'alignCenter', 'Căn giữa'], ['justifyRight', 'alignRight', 'Căn phải'], ['justifyFull', 'alignJustify', 'Căn đều']] as const).map(([c, i, l]) => tool(i, l, () => cmd(c)))}</span>}</span></span>
        <span>{tool(null, 'Tiêu đề 1', () => block('H1'), <b className="rt-h">H<sub>1</sub></b>)}{tool(null, 'Tiêu đề 2', () => block('H2'), <b className="rt-h">H<sub>2</sub></b>)}</span>
        <span>{tool('olist', 'Danh sách đánh số', () => cmd('insertOrderedList'))}{tool('list', 'Danh sách chấm', () => cmd('insertUnorderedList'))}</span>
        <span>{tool(null, 'Chỉ số dưới', () => cmd('subscript'), <b className="rt-h">x<sub>2</sub></b>)}{tool(null, 'Chỉ số trên', () => cmd('superscript'), <b className="rt-h">x<sup>2</sup></b>)}</span>
        <span>{tool('link', 'Chèn liên kết', link)}{tool('photo', 'Chèn ảnh', () => { keep(); file.current?.click(); })}</span>
        <span>
          <span className="rt-pop-wrap">{tool(null, 'Màu chữ', () => { keep(); setMenu(menu === 'color' ? '' : 'color'); }, <b className="rt-color">A</b>)}
            {menu === 'color' && <span className="rt-pop rt-swatches">{PALETTE.map((c) => <button key={c} type="button" style={{ background: c }} aria-label={`Màu ${c}`} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('foreColor', c)} />)}<button type="button" className="rt-none" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('foreColor', '#172b4d')}>Mặc định</button></span>}</span>
          <span className="rt-pop-wrap">{tool(null, 'Màu nền chữ', () => { keep(); setMenu(menu === 'mark' ? '' : 'mark'); }, <b className="rt-mark">A</b>)}
            {menu === 'mark' && <span className="rt-pop rt-swatches">{MARKS.map((c) => <button key={c} type="button" style={{ background: c }} aria-label={`Nền ${c}`} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('hiliteColor', c)} />)}<button type="button" className="rt-none" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('hiliteColor', 'transparent')}>Không màu</button></span>}</span>
        </span>
        <span>{tool('clear', 'Xoá định dạng', () => { cmd('removeFormat'); cmd('unlink'); })}</span>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void picture(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </div>
  );
}
