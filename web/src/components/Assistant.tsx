import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '../store';
import { Icon } from './ui';

// Trợ lý AI (server/assistant.ts): a chat drawer on every page. Claude's answer streams in; the tools it runs show as
// small lines; a change waits on an approval card (Duyệt / Từ chối). Opened from the top bar or with ⌘J / Ctrl+J.
type Item =
  | { role: 'user' | 'assistant'; text: string }
  | { role: 'tool'; id: string; name: string; title?: string; input?: any; ok: boolean | null; status?: string; message?: string };
interface Call { id: string; name: string; title: string; input: any }
interface Info { enabled: boolean; model: string; used: number; limit: number }
interface Conv { id: string; title: string; updatedAt: number; waiting: number }

const OPEN = 'dms:assistant';
export const openAssistant = () => window.dispatchEvent(new Event(OPEN));
// The assistant runs on the paid Claude API: without a key on the server it does not show at all (Claude works on DMI
// through the MCP connector in the person's own Claude app instead).
let ready: Promise<boolean> | null = null;
const available = () => (ready ||= fetch('/api/assistant').then((r) => (r.ok ? r.json() : null)).then((j) => !!j?.enabled, () => false));
export function AssistantButton() {
  const [on, setOn] = useState(false);
  useEffect(() => { void available().then(setOn); }, []);
  if (!on) return null;
  return <button className="tb-theme-btn" onClick={openAssistant} title="Trợ lý AI (⌘J)" aria-label="Mở Trợ lý AI"><Icon name="sparkle" size={18} /></button>;
}

const get = async <T,>(url: string): Promise<T> => { const r = await fetch(url); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j; };

/** Posts and reads the server-sent events of the answer as they come. */
async function stream(url: string, body: unknown, on: (event: string, data: any) => void, signal: AbortSignal) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || res.statusText); }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut: number;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, cut); buf = buf.slice(cut + 2);
      const ev = chunk.match(/^event: (.+)$/m)?.[1], data = chunk.match(/^data: (.+)$/m)?.[1];
      if (ev && data) on(ev, JSON.parse(data));
    }
  }
}

// ---------------------------------------------------------------- Claude's text: escaped, then a little markdown
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
function Markdown({ text }: { text: string }) {
  const html: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const close = () => { if (list) { html.push(`</${list}>`); list = null; } };
  for (const line of text.split('\n')) {
    const ul = line.match(/^\s*[-*•] (.*)$/), ol = line.match(/^\s*\d+[.)] (.*)$/), h = line.match(/^#{1,3} (.*)$/);
    if (ul || ol) { const kind = ul ? 'ul' : 'ol'; if (list !== kind) { close(); html.push(`<${kind}>`); list = kind; } html.push(`<li>${inline((ul || ol)![1])}</li>`); continue; }
    close();
    if (h) html.push(`<p><b>${inline(h[1])}</b></p>`);
    else if (line.trim()) html.push(`<p>${inline(line)}</p>`);
  }
  close();
  return <div className="as-md" dangerouslySetInnerHTML={{ __html: html.join('') }} />;
}

const brief = (input: any) => Object.entries(input || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined)
  .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' · ');

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [conv, setConv] = useState<{ id: string; title: string } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [pending, setPending] = useState<Call[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const toggle = () => void available().then((on) => { if (on) setOpen((v) => !v); });
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); toggle(); } };
    window.addEventListener(OPEN, toggle); window.addEventListener('keydown', key);
    return () => { window.removeEventListener(OPEN, toggle); window.removeEventListener('keydown', key); };
  }, []);
  useEffect(() => { if (open) { get<Info>('/api/assistant').then(setInfo, () => {}); setTimeout(() => boxRef.current?.focus(), 50); } }, [open]);
  useEffect(() => { logRef.current?.scrollTo(0, 1e7); }, [items, pending]);
  // The chat bubbles would sit on the composer: they step aside while the assistant is open.
  useEffect(() => { document.body.classList.toggle('as-open', open); return () => document.body.classList.remove('as-open'); }, [open]);

  const load = async (id: string) => {
    try { const c = await get<{ id: string; title: string; items: Item[]; pending: Call[] }>(`/api/assistant/conversations/${id}`); setConv(c); setItems(c.items); setPending(c.pending); setConvs(null); }
    catch (e: any) { toast(e.message, true); }
  };
  const fresh = () => { abort.current?.abort(); setConv(null); setItems([]); setPending([]); setConvs(null); boxRef.current?.focus(); };

  // One streamed answer: text pieces join the last assistant bubble; tools become their own lines.
  const run = useCallback(async (url: string, body: unknown) => {
    setBusy(true);
    const ctl = new AbortController(); abort.current = ctl;
    try {
      await stream(url, body, (event, data) => {
        if (event === 'conversation') setConv(data);
        else if (event === 'text') setItems((xs) => { const last = xs[xs.length - 1]; return last?.role === 'assistant' ? [...xs.slice(0, -1), { ...last, text: last.text + data.delta }] : [...xs, { role: 'assistant', text: data.delta }]; });
        else if (event === 'tool') setItems((xs) => { const i = xs.findIndex((x) => x.role === 'tool' && x.id === data.id); const t = { role: 'tool' as const, id: data.id, name: data.name, title: data.title || data.name, input: data.input, ok: data.status === 'done' ? true : data.status === 'running' ? null : false, status: data.status, message: data.message };
          return i < 0 ? [...xs, t] : xs.map((x, k) => (k === i ? { ...x, ...t, input: (x as any).input ?? t.input } : x)); });
        else if (event === 'approval') setPending(data.calls);
        else if (event === 'error') setItems((xs) => [...xs, { role: 'assistant', text: `⚠ ${data.message}` }]);
      }, ctl.signal);
    } catch (e: any) { if (e.name !== 'AbortError') toast(e.message, true); }
    finally { setBusy(false); abort.current = null; get<Info>('/api/assistant').then(setInfo, () => {}); }
  }, []);

  const send = () => {
    const t = text.trim();
    if (!t || busy || pending.length) return;
    setText(''); setItems((xs) => [...xs, { role: 'user', text: t }]);
    void run(`/api/assistant/conversations/${conv?.id || 'new'}/messages`, { text: t });
  };
  const decide = (approve: boolean) => { if (!conv) return; setPending([]); void run(`/api/assistant/conversations/${conv.id}/decision`, { approve }); };
  const remove = async (id: string) => {
    await fetch(`/api/assistant/conversations/${id}`, { method: 'DELETE' });
    setConvs((cs) => cs?.filter((c) => c.id !== id) || null);
    if (conv?.id === id) fresh();
  };

  if (!open) return null;
  return (
    <aside className="as" aria-label="Trợ lý AI">
      <header className="as-head">
        <Icon name="sparkle" size={16} />
        <b title={conv?.title}>{conv?.title || 'Trợ lý AI'}</b>
        <button className="as-icon" onClick={() => (convs ? setConvs(null) : get<Conv[]>('/api/assistant/conversations').then(setConvs, (e) => toast(e.message, true)))} title="Các cuộc trò chuyện" aria-pressed={!!convs}><Icon name="clock" size={15} /></button>
        <button className="as-icon" onClick={fresh} title="Cuộc trò chuyện mới"><Icon name="plus" size={15} /></button>
        <button className="as-icon" onClick={() => setOpen(false)} title="Đóng (⌘J)"><Icon name="x" size={15} /></button>
      </header>
      {convs ? (
        <div className="as-list">
          {!convs.length && <p className="as-note">Chưa có cuộc trò chuyện nào.</p>}
          {convs.map((c) => (
            <div key={c.id} className={'as-conv' + (c.id === conv?.id ? ' on' : '')}>
              <button onClick={() => void load(c.id)}><span>{c.title}</span><small>{new Date(c.updatedAt).toLocaleString('vi-VN')}{c.waiting ? ' · chờ duyệt' : ''}</small></button>
              <button className="as-icon" onClick={() => void remove(c.id)} title="Xoá"><Icon name="trash" size={13} /></button>
            </div>
          ))}
        </div>
      ) : (
        <div className="as-log" ref={logRef}>
          {info && !info.enabled && <p className="as-note warn">Trợ lý AI chưa được bật: quản trị viên cần đặt khoá <code>ANTHROPIC_API_KEY</code> cho máy chủ.</p>}
          {!items.length && info?.enabled && (
            <div className="as-hello">
              <p>Hỏi hoặc nhờ làm việc trong DMI. Claude dùng đúng quyền của bạn; mọi thay đổi đều chờ bạn duyệt.</p>
              {['Hôm nay tôi có việc gì sắp tới hạn?', 'Việc nào đang chờ tôi duyệt?', 'Tóm tắt tình hình các khách hàng của tôi'].map((q) => (
                <button key={q} onClick={() => { setText(q); boxRef.current?.focus(); }}>{q}</button>
              ))}
            </div>
          )}
          {items.map((it, i) => it.role === 'tool'
            ? <div key={it.id + i} className={'as-tool ' + (it.status || (it.ok ? 'done' : it.ok === false ? 'error' : ''))} title={brief(it.input)}>
                {it.status === 'running' ? <span className="spinner sm" /> : <Icon name={it.ok ? 'check' : it.status === 'declined' ? 'x' : it.ok === false ? 'info' : 'check'} size={12} />}
                <span>{it.title || it.name}</span>{it.message && <em>{it.message}</em>}{it.status === 'declined' && <em>đã từ chối</em>}
              </div>
            : <div key={i} className={'as-msg ' + it.role}>{it.role === 'assistant' ? <Markdown text={it.text} /> : it.text}</div>)}
          {pending.length > 0 && (
            <div className="as-approve" role="group" aria-label="Thao tác chờ duyệt">
              <b>Claude muốn thực hiện {pending.length > 1 ? `${pending.length} thao tác` : 'thao tác'} này:</b>
              {pending.map((c) => <div key={c.id} className="as-call"><span>{c.title}</span><small>{brief(c.input)}</small></div>)}
              <div className="as-approve-btns"><button className="btn btn-gray" onClick={() => decide(false)}>Từ chối</button><button className="btn btn-primary" onClick={() => decide(true)}>Duyệt</button></div>
            </div>
          )}
          {busy && !pending.length && <div className="as-typing"><span className="spinner sm" />Claude đang làm…</div>}
        </div>
      )}
      <form className="as-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea ref={boxRef} value={text} rows={2} onChange={(e) => setText(e.target.value)} disabled={!info?.enabled}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
          placeholder={pending.length ? 'Hãy Duyệt hoặc Từ chối trước…' : 'Nhờ Claude… (Enter để gửi)'} aria-label="Tin nhắn cho Trợ lý AI" />
        {busy ? <button type="button" className="as-send stop" onClick={() => abort.current?.abort()} title="Dừng"><Icon name="x" size={15} /></button>
          : <button className="as-send" disabled={!text.trim() || !!pending.length || !info?.enabled} title="Gửi"><Icon name="send" size={15} /></button>}
      </form>
      {info?.enabled && <p className="as-usage">Tháng này: {Math.round(info.used / 1000).toLocaleString('vi-VN')}k / {Math.round(info.limit / 1000).toLocaleString('vi-VN')}k token</p>}
    </aside>
  );
}
