// The app's own questions, in place of the browser's confirm() and prompt(): a window over a dimmed page, like the review
// workflow's, that asks yes or no (`askConfirm`) or for some words (`askText`). Each returns a promise: the answer, or
// null / false when the window is closed or cancelled.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon } from './ui';

type Ask = {
  message: string; title?: string; confirmLabel?: string; danger?: boolean;
  /** Asks for words: what the box holds at first, its hint, whether it may be left empty, several lines. */
  input?: { initial?: string; placeholder?: string; required?: boolean; multiline?: boolean };
};

function AskWindow({ ask, done }: { ask: Ask; done: (answer: string | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null), [text, setText] = useState(ask.input?.initial ?? '');
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  const blocked = !!ask.input?.required && !text.trim();
  const ok = () => { if (!blocked) done(ask.input ? text : ''); };
  const field = ask.input && (ask.input.multiline
    ? <textarea className="bk-in" autoFocus rows={4} value={text} placeholder={ask.input.placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ok(); }} />
    : <input className="bk-in" autoFocus value={text} placeholder={ask.input.placeholder} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }} />);
  return (
    <dialog ref={ref} className="ask-modal" aria-label={ask.title || ask.message} onCancel={(e) => { e.preventDefault(); done(null); }}
      onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation(); }} onMouseDown={(e) => { if (e.target === e.currentTarget) done(null); }}>
      <form className="ask-in" onSubmit={(e) => { e.preventDefault(); ok(); }}>
        <header><b>{ask.title || (ask.danger ? 'Xác nhận xoá' : ask.input ? 'Nhập thông tin' : 'Xác nhận')}</b>
          <button type="button" className="bk-x" onClick={() => done(null)} aria-label="Đóng"><Icon name="x" size={16} /></button></header>
        <p className="ask-msg">{ask.message}</p>
        {field}
        <footer>
          <button type="button" className="btn btn-gray btn-sm" onClick={() => done(null)}>Huỷ</button>
          <button type="submit" className={'btn btn-sm ' + (ask.danger ? 'ask-danger' : 'btn-primary')} disabled={blocked} autoFocus={!ask.input}>{ask.confirmLabel || (ask.danger ? 'Xoá' : 'Đồng ý')}</button>
        </footer>
      </form>
    </dialog>
  );
}

/** Asks in the app's window; the answer ('' for a yes with no words), or null when cancelled. */
export function ask(question: Ask): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (answer: string | null) => { resolve(answer); setTimeout(() => { root.unmount(); host.remove(); }); };
    root.render(<AskWindow ask={question} done={done} />);
  });
}
/** Yes or no. A question that deletes something ("Xoá…") gets a red button. */
export const askConfirm = async (message: string, o: Partial<Ask> = {}) =>
  (await ask({ message, danger: /^\s*(xoá|xóa|gỡ|huỷ|hủy|bỏ)\b/i.test(message), ...o })) !== null;
/** Some words; null when cancelled. */
export const askText = (message: string, initial = '', o: Partial<Ask> & { required?: boolean; multiline?: boolean; placeholder?: string } = {}) =>
  ask({ message, ...o, input: { initial, required: o.required, multiline: o.multiline, placeholder: o.placeholder } });
