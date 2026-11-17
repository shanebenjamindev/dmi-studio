// The text of a message, formatted as in Gmail (components/Mailbox.tsx): font, size, bold, italic, underline, colours,
// alignment, lists, quotes, links and clearing it all, in a bar under the text. What is written is HTML, sent beside
// its plain text; it also writes the signature in Hộp thư's settings.
import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui';
import { Pop } from './boardkit';
import { askText } from './AskDialog';

const FONTS: [string, string][] = [['Arial, Helvetica, sans-serif', 'Sans Serif'], ['"Times New Roman", Times, serif', 'Serif'], ['"Courier New", Courier, monospace', 'Chữ đều'],
  ['"Arial Black", sans-serif', 'Rộng'], ['"Arial Narrow", sans-serif', 'Hẹp'], ['"Comic Sans MS", cursive', 'Comic Sans MS'], ['Garamond, serif', 'Garamond'],
  ['Georgia, serif', 'Georgia'], ['Tahoma, sans-serif', 'Tahoma'], ['"Trebuchet MS", sans-serif', 'Trebuchet MS'], ['Verdana, sans-serif', 'Verdana']];
const SIZES: [string, string][] = [['2', 'Nhỏ'], ['3', 'Bình thường'], ['5', 'Lớn'], ['6', 'Rất lớn']];
const COLORS = ['#000000', '#444444', '#666666', '#999999', '#cccccc', '#ffffff', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3d85c6', '#674ea7', '#a64d79',
  '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#9fc5e8', '#b4a7d6', '#d5a6bd', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#0b5394', '#351c75', '#741b47'];

/** Someone's HTML (a Gmail signature) made safe to put into the page: no scripts, frames, handlers or script links. */
export function cleanHtml(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,textarea,select').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action)$/i.test(a.name) && /^\s*(javascript|vbscript|data:text)/i.test(a.value))) el.removeAttribute(a.name);
    }
  });
  return doc.body.innerHTML;
}
/** Text typed or quoted as plain, for the editor. */
export const textToHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

/** `bar`: the formatting bar shown (the writer's "A" button shows or hides it). */
export function MailEditor({ html, onChange, autoFocus, placeholder, minHeight, onSend, label = 'Nội dung thư', bar = true, allowCode = true }: {
  html: string; onChange: (html: string, text: string) => void; autoFocus?: boolean; placeholder?: string; minHeight?: number; onSend?: () => void; label?: string; bar?: boolean; allowCode?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null), range = useRef<Range | null>(null);
  const [pop, setPop] = useState<{ kind: 'color' | 'align'; el: HTMLElement } | null>(null), [, tick] = useState(0);
  const [codeMode, setCodeMode] = useState(false);
  const [rawHtml, setRawHtml] = useState(html);
  useEffect(() => {
    const el = box.current!;
    el.innerHTML = html;
    setRawHtml(html);
    onChange(el.innerHTML, el.innerText); // what it starts with is sent as it is if nothing is typed
    if (autoFocus) { el.focus(); const r = document.createRange(); r.setStart(el, 0); r.collapse(true); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); range.current = r; }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { const el = box.current!; setRawHtml(el.innerHTML); onChange(el.innerHTML, el.innerText); };
  const toggleCode = () => {
    if (codeMode) {
      const cleaned = cleanHtml(rawHtml);
      setCodeMode(false);
      if (box.current) { box.current.innerHTML = cleaned; onChange(cleaned, box.current.innerText); }
    } else {
      if (box.current) setRawHtml(box.current.innerHTML);
      setCodeMode(true);
    }
  };
  const onCodeInput = (val: string) => {
    setRawHtml(val);
    const cleaned = cleanHtml(val);
    if (box.current) { box.current.innerHTML = cleaned; onChange(cleaned, box.current.innerText); }
    else { onChange(cleaned, val.replace(/<[^>]+>/g, ' ')); }
  };
  // The place being written at, kept while a button or list of the bar has the focus.
  const keep = () => { const s = getSelection(); if (s?.rangeCount && box.current?.contains(s.anchorNode)) range.current = s.getRangeAt(0); tick((n) => n + 1); };
  const run = (cmd: string, value?: string) => {
    const el = box.current!;
    el.focus();
    if (range.current) { const s = getSelection(); s?.removeAllRanges(); s?.addRange(range.current); }
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(cmd, false, value);
    keep(); changed();
  };
  const on = (cmd: string) => { try { return document.queryCommandState(cmd); } catch { return false; } };
  const btn = (cmd: string, icon: string, title: string, value?: string) => (
    <button type="button" className={'me-b' + (on(cmd) ? ' on' : '')} title={title} aria-label={title} aria-pressed={on(cmd)} onMouseDown={(e) => e.preventDefault()} onClick={() => run(cmd, value)}><Icon name={icon} size={15} /></button>
  );
  const link = async () => {
    const saved = range.current;
    const url = await askText('Địa chỉ liên kết', '', { placeholder: 'https://…', required: true });
    if (!url) return;
    range.current = saved;
    const href = /^(https?:|mailto:|tel:)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    if (saved && !saved.collapsed) run('createLink', href);
    else run('insertHTML', `<a href="${href.replace(/"/g, '&quot;')}">${textToHtml(url.trim())}</a>`);
  };
  return (
    <div className="me">
      <div ref={box} className="me-text" contentEditable={!codeMode} role="textbox" aria-multiline aria-label={label} data-placeholder={placeholder}
        style={{ display: codeMode ? 'none' : undefined, ...(minHeight ? { minHeight } : {}) }}
        onInput={changed} onKeyUp={keep} onMouseUp={keep} onBlur={keep}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSend) { e.preventDefault(); onSend(); } }} />
      {codeMode && (
        <textarea className="me-code" value={rawHtml} onChange={(e) => onCodeInput(e.target.value)}
          placeholder="Nhập hoặc dán mã code HTML vào đây..."
          style={minHeight ? { minHeight } : undefined}
          spellCheck={false} autoCapitalize="off" autoCorrect="off" />
      )}
      {bar && (
        <div className="me-bar" role="toolbar" aria-label="Định dạng">
          <button type="button" className="me-b" title="Hoàn tác" aria-label="Hoàn tác" onMouseDown={(e) => e.preventDefault()} onClick={() => run('undo')}><Icon name="undo" size={15} /></button>
          <button type="button" className="me-b me-flip" title="Làm lại" aria-label="Làm lại" onMouseDown={(e) => e.preventDefault()} onClick={() => run('redo')}><Icon name="undo" size={15} /></button>
          <span className="me-sep" />
          <select className="me-sel" aria-label="Phông chữ" title="Phông chữ" value="" onChange={(e) => e.target.value && run('fontName', e.target.value)}>
            <option value="">Phông chữ</option>{FONTS.map(([v, n]) => <option key={v} value={v} style={{ fontFamily: v }}>{n}</option>)}
          </select>
          <select className="me-sel" aria-label="Cỡ chữ" title="Cỡ chữ" value="" onChange={(e) => e.target.value && run('fontSize', e.target.value)}>
            <option value="">Cỡ chữ</option>{SIZES.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select>
          <span className="me-sep" />
          {btn('bold', 'bold', 'Đậm (Ctrl+B)')}{btn('italic', 'italic', 'Nghiêng (Ctrl+I)')}{btn('underline', 'underline', 'Gạch dưới (Ctrl+U)')}
          <button type="button" className="me-b" title="Màu chữ" aria-label="Màu chữ" onMouseDown={(e) => e.preventDefault()} onClick={(e) => setPop({ kind: 'color', el: e.currentTarget })}><span className="me-a">A</span></button>
          <span className="me-sep" />
          <button type="button" className="me-b" title="Căn lề" aria-label="Căn lề" onMouseDown={(e) => e.preventDefault()} onClick={(e) => setPop({ kind: 'align', el: e.currentTarget })}><Icon name="align" size={15} /></button>
          {btn('insertOrderedList', 'olist', 'Danh sách đánh số')}{btn('insertUnorderedList', 'list', 'Danh sách dấu đầu dòng')}
          <button type="button" className="me-b" title="Thụt lề ít hơn" aria-label="Thụt lề ít hơn" onMouseDown={(e) => e.preventDefault()} onClick={() => run('outdent')}><span className="me-t">⇤</span></button>
          <button type="button" className="me-b" title="Thụt lề nhiều hơn" aria-label="Thụt lề nhiều hơn" onMouseDown={(e) => e.preventDefault()} onClick={() => run('indent')}><span className="me-t">⇥</span></button>
          <button type="button" className="me-b" title="Trích dẫn" aria-label="Trích dẫn" onMouseDown={(e) => e.preventDefault()} onClick={() => run('formatBlock', 'blockquote')}><Icon name="quote" size={15} /></button>
          {btn('strikeThrough', 'strike', 'Gạch ngang')}
          <button type="button" className="me-b" title="Chèn liên kết" aria-label="Chèn liên kết" onMouseDown={(e) => e.preventDefault()} onClick={link}><Icon name="link" size={15} /></button>
          <button type="button" className="me-b" title="Xoá định dạng" aria-label="Xoá định dạng" onMouseDown={(e) => e.preventDefault()} onClick={() => { run('removeFormat'); run('unlink'); }}><Icon name="clear" size={15} /></button>
          {allowCode && (
            <>
              <span className="me-sep" />
              <button type="button" className={'me-b' + (codeMode ? ' on' : '')} title={codeMode ? 'Chuyển sang soạn thảo trực quan' : 'Mã code HTML'} aria-label="Mã HTML" onMouseDown={(e) => e.preventDefault()} onClick={toggleCode}><Icon name="code" size={15} /></button>
            </>
          )}
        </div>
      )}
      {pop?.kind === 'color' && (
        <Pop anchor={pop.el} title="Màu" onClose={() => setPop(null)}>
          <div className="me-colors">
            <b>Màu nền</b>
            <div>{COLORS.map((c) => <button key={c} type="button" style={{ background: c }} aria-label={`Màu nền ${c}`} onMouseDown={(e) => e.preventDefault()} onClick={() => { setPop(null); run('hiliteColor', c); }} />)}</div>
            <b>Màu chữ</b>
            <div>{COLORS.map((c) => <button key={c} type="button" style={{ background: c }} aria-label={`Màu chữ ${c}`} onMouseDown={(e) => e.preventDefault()} onClick={() => { setPop(null); run('foreColor', c); }} />)}</div>
          </div>
        </Pop>
      )}
      {pop?.kind === 'align' && (
        <Pop anchor={pop.el} title="Căn lề" onClose={() => setPop(null)}>
          <div className="bk-menu">
            {([['justifyLeft', 'Căn trái'], ['justifyCenter', 'Căn giữa'], ['justifyRight', 'Căn phải']] as const).map(([cmd, name]) => (
              <button key={cmd} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setPop(null); run(cmd); }}>{name}{on(cmd) && <Icon name="check" size={14} />}</button>
            ))}
          </div>
        </Pop>
      )}
    </div>
  );
}
