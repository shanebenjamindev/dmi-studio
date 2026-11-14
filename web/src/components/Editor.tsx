import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, closeProject, rebuildFromSheet, toast, fmt } from '../store';
import { api } from '../api';
import { Icon } from './ui';
import type { Hyperframes, Render, Source } from '../types';

// A video project, built by Claude Code with HyperFrames on the Mac (server/hyperframes.ts, server/video-mcp.ts):
//   bar: back · title · prompt for Claude · renders
//   footage / sheet / script / Claude (folds away) │ HyperFrames Studio (its preview and timeline), as large as it gets
const label = (i: number) => `s${i + 1}`;
const mb = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0.1, Math.round(b / 1e5) / 10)} MB`);
// HyperFrames' preview listens on the Mac only: it opens in the page when the page itself is open on the Mac.
const onMac = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => toast(`Đã chép ${what}`), () => toast('Không chép được, hãy chọn và chép tay', true));
const LS_SIDE = 'dms.editorSide';

/** The project's HyperFrames state and renders, read again every few seconds while the page is open (Claude works elsewhere). */
function useHyperframes(projectId: string) {
  const [hf, setHf] = useState<Hyperframes | null>(null);
  const [renders, setRenders] = useState<Render[]>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { const [h, r] = await Promise.all([api.hyperframes(projectId), api.renders(projectId)]); setHf(h); setRenders(r); setError(''); }
    catch (e: any) { setError(e.message); }
  }, [projectId]);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 8000);
    return () => clearInterval(t);
  }, [load]);
  return { hf, renders, error, load };
}

/** What to paste into Claude Code for this project. */
function promptFor(p: { id: string; title: string }, hf: Hyperframes | null) {
  return hf?.exists
    ? `Tiếp tục video của dự án DMI ${p.id} (“${p.title}”) trong thư mục ${hf.dir}. Dùng get_video_project để xem sheet và footage, rồi mở preview cho tôi xem. Yêu cầu: `
    : `Dựng video cho dự án DMI ${p.id} (“${p.title}”) bằng HyperFrames. Dùng get_video_project và prepare_hyperframes của DMI, đọc BRIEF.md, xem footage bằng view_footage, dựng theo kịch bản rồi mở preview cho tôi xem. Khi tôi duyệt thì render và gửi về bằng publish_render.`;
}

export function Editor() {
  const project = useStore((s) => s.project)!;
  const { hf, renders, error, load } = useHyperframes(project.id);
  const [side, setSide] = useState(() => { try { return localStorage.getItem(LS_SIDE) !== '0'; } catch { return true; } });
  const toggleSide = () => setSide((v) => { try { localStorage.setItem(LS_SIDE, v ? '0' : '1'); } catch { /* private mode */ } return !v; });
  return (
    <div className="ed hfed">
      <header className="ed-bar">
        <button className="ed-back" onClick={closeProject}><Icon name="left" size={16} />Dự án</button>
        <button className={'ed-btn hfed-side-btn' + (side ? ' on' : '')} onClick={toggleSide} title={side ? 'Ẩn cột footage' : 'Hiện cột footage'} aria-pressed={side}><Icon name="lines" size={15} /></button>
        <span className="ed-title" title={project.title}>{project.title}</span>
        <span className="ed-save">{project.aspect}</span>
        <span className="ed-gap" />
        {error && <span className="ed-proxy" title={error}>⚠ {error}</span>}
        <button className="hfed-cta" onClick={() => copy(promptFor(project, hf), 'lời nhắc, dán vào Claude Code')} title={promptFor(project, hf)}><Icon name="sparkle" size={14} />Chép lời nhắc cho Claude</button>
        <RendersMenu renders={renders} reload={load} />
        <button className="ed-btn" onClick={() => void load()} title="Đọc lại thư mục HyperFrames và các bản render"><Icon name="refresh" size={14} /></button>
      </header>
      <div className="hfed-body">
        {side && <SidePanel hf={hf} reload={load} />}
        <Stage hf={hf} renders={renders} reload={load} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the renders, from the bar
function RendersMenu({ renders, reload }: { renders: Render[]; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const remove = async (r: Render) => {
    if (!confirm('Xoá bản render này?')) return;
    try { await api.deleteRender(r.id); await reload(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="hfed-menu" ref={ref}>
      <button className={'ed-btn' + (open ? ' on' : '')} onClick={() => setOpen(!open)} aria-expanded={open}><Icon name="film" size={14} />Bản render{renders.length ? ` (${renders.length})` : ''}</button>
      {open && (
        <div className="hfed-pop" role="menu">
          {!renders.length && <p className="ed-empty">Chưa có bản render. Duyệt xong bản xem trước thì bảo Claude “render và gửi về DMI”.</p>}
          {renders.map((r, i) => (
            <div key={r.id} className="hfed-render">
              <span><b>{i === 0 ? 'Mới nhất' : `Bản ${renders.length - i}`}</b><small className="mono">{new Date(r.createdAt).toLocaleString('vi-VN')} · {mb(r.bytes)}</small></span>
              <a className="ed-btn" href={r.download} title="Tải về"><Icon name="download" size={13} /></a>
              <button className="ed-btn danger" onClick={() => void remove(r)} title="Xoá"><Icon name="trash" size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the side panel: footage, sheet, script, Claude
function SidePanel({ hf, reload }: { hf: Hyperframes | null; reload: () => Promise<void> }) {
  const project = useStore((s) => s.project)!;
  const [tab, setTab] = useState<'footage' | 'sheet' | 'script' | 'claude'>(() => (hf && !hf.exists ? 'claude' : 'footage'));
  const missing = project.sheet?.missing || [];
  return (
    <aside className="ed-panel hfed-side">
      <nav className="ed-tabs">
        <button className={tab === 'footage' ? 'on' : ''} onClick={() => setTab('footage')}>Footage</button>
        <button className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}>Sheet{missing.length > 0 && ' ⚠'}</button>
        <button className={tab === 'script' ? 'on' : ''} onClick={() => setTab('script')}>Kịch bản</button>
        <button className={tab === 'claude' ? 'on' : ''} onClick={() => setTab('claude')}>Claude</button>
      </nav>
      {tab === 'footage' ? <FootageTab /> : tab === 'sheet' ? <SheetTab /> : tab === 'script' ? <ScriptTab /> : <ClaudeTab hf={hf} reload={reload} />}
    </aside>
  );
}

function FootageTab() {
  const sources = useStore((s) => s.project?.sources) || [];
  const [q, setQ] = useState('');
  const shown = sources.map((s, i) => ({ s, i })).filter(({ s, i }) => !q.trim() || `${label(i)} ${s.name} ${s.folder}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="ed-media-body">
      <div className="ed-media-tools"><label className="ed-search"><Icon name="search" size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Tìm trong ${sources.length} footage`} /></label></div>
      <div className="ed-media-grid"><div className="hfed-tiles">
        {shown.map(({ s, i }) => <Tile key={s.id} s={s} n={i} />)}
        {!shown.length && <p className="ed-empty">{sources.length ? 'Không có footage nào khớp.' : 'Dự án chưa có footage từ Drive.'}</p>}
      </div></div>
      <p className="ed-hint">Nói với Claude theo nhãn: “cảnh mở bài dùng s3”.</p>
    </div>
  );
}

function Tile({ s, n }: { s: Source; n: number }) {
  return (
    <a className="ed-tile" href={s.url} target="_blank" rel="noreferrer" title={`${label(n)} · ${s.name}${s.folder ? `\n${s.folder}` : ''}\nBấm để xem file gốc`}>
      <span className="ed-tile-img" style={{ backgroundImage: `url("${s.thumb}")` }}>
        <i className="hfed-label">{label(n)}</i>
        {s.duration ? <em>{fmt(s.duration)}</em> : null}
      </span>
      <span className="ed-tile-name">{s.name}</span>
    </a>
  );
}

function SheetTab() {
  const busy = useStore((s) => s.busy);
  const project = useStore((s) => s.project)!;
  const missing = project.sheet?.missing || [];
  if (!project.sheet) return <div className="ed-media-body ed-sheet"><p className="ed-empty">Dự án này không có sheet.</p></div>;
  return (
    <div className="ed-media-body ed-sheet">
      <a className="ed-sheet-name" href={project.sheet.link} target="_blank" rel="noreferrer">📄 {project.sheet.title} <Icon name="share" size={12} /></a>
      <dl>
        <dt>Khách hàng</dt><dd>{project.sheet.form.customer || '—'}</dd>
        <dt>Khung hình</dt><dd>{project.sheet.form.aspect}</dd>
        <dt>Độ dài yêu cầu</dt><dd>{project.sheet.form.seconds ? `~${project.sheet.form.seconds}s` : '—'}</dd>
        <dt>Footage tìm được</dt><dd>{(project.sources || []).length}</dd>
      </dl>
      {project.sheet.warning && <div className="ed-warn"><b>⚠ Đọc theo mẫu form</b><ul><li>{project.sheet.warning}</li></ul></div>}
      {missing.length > 0 && <div className="ed-warn"><b>⚠ {missing.length} file trong sheet không tìm thấy trên Drive</b><ul>{missing.map((m) => <li key={m}>{m}</li>)}</ul></div>}
      {project.sheet.form.ignored_rows && <div className="ed-note"><b>Bỏ qua</b><p>{project.sheet.form.ignored_rows}</p></div>}
      <button className="ed-btn" disabled={!!busy} onClick={rebuildFromSheet} title="Đọc lại sheet (nếu đã sửa): kịch bản và footage cập nhật theo"><Icon name="refresh" size={14} />Đọc lại sheet</button>
    </div>
  );
}

function ScriptTab() {
  const project = useStore((s) => s.project)!;
  const script = project.sheet?.form.script || [];
  if (!script.length) return <div className="ed-scenes"><p className="ed-hint-box">{project.sheet ? 'Sheet không theo mẫu form nên chưa tách được kịch bản: Claude sẽ đọc thẳng sheet gốc khi dựng.' : 'Dự án này không có sheet.'}</p></div>;
  return (
    <div className="ed-scenes">
      {script.map((r, i) => (
        <article key={i} className="ed-scene">
          <header><b>{r.row}</b><span className="mono">{r.duration && <em>sheet {r.duration}</em>}</span></header>
          <Cell label="Voice over" text={r.voice_over} />
          <Cell label="Nội dung" text={r.visual} />
          <Cell label="Chữ trên hình" text={r.on_screen} />
          <Cell label="Source" text={r.source} />
          <Cell label="Ghi chú" text={r.note} />
        </article>
      ))}
    </div>
  );
}
const Cell = ({ label, text }: { label: string; text: string }) => (text?.trim() ? <div className="ed-cell"><span>{label}</span><p>{text.trim()}</p></div> : null);

/** Connecting Claude Code once, what to ask it, and the project's folder. */
function ClaudeTab({ hf, reload }: { hf: Hyperframes | null; reload: () => Promise<void> }) {
  const project = useStore((s) => s.project)!;
  const [busy, setBusy] = useState(false);
  const connect = `claude mcp add --transport http --scope user dmi ${location.origin}/api/mcp`;
  const ask = promptFor(project, hf);
  const prepare = async () => {
    setBusy(true);
    try {
      const r = await api.hyperframesPrepare(project.id);
      toast(`Đã chuẩn bị thư mục: ${r.downloaded.length} footage${r.failed.length ? ` · ${r.failed.length} file tải lỗi` : ''}`, r.failed.length > 0);
      await reload();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return (
    <div className="ed-claude-hf">
      <p className="ed-claude-intro">Chat với <b>Claude Code</b> trên máy Mac này (VS Code, tab Code trong app Claude hoặc Terminal). Claude đọc sheet, xem footage, dựng bằng HyperFrames và render ngay trên máy: không tốn phí API.</p>
      <div className="ed-steps">
        <section>
          <b>1. Kết nối Claude Code với DMI <span>(một lần)</span></b>
          <code>{connect}</code>
          <button className="ed-btn" onClick={() => copy(connect, 'lệnh kết nối')}><Icon name="copy" size={13} />Chép lệnh</button>
          <small>Rồi gõ <code>/mcp</code> trong Claude Code, chọn dmi, đăng nhập DMI và bấm Cho phép.</small>
        </section>
        <section>
          <b>2. Nhờ Claude</b>
          <code>{ask}</code>
          <button className="ed-btn" onClick={() => copy(ask, 'lời nhắc')}><Icon name="copy" size={13} />Chép lời nhắc</button>
          <small>Muốn chỉnh gì cứ chat tiếp: “rút còn 15 giây”, “chữ giá to hơn”, “dùng s4 cho cảnh 2”…</small>
        </section>
      </div>
      <div className="ed-note">
        <b>Thư mục HyperFrames</b>
        {hf ? <>
          <p className="mono ed-path">{hf.dir} <button className="ed-link" onClick={() => copy(hf.dir, 'đường dẫn')}>chép</button></p>
          <p>{hf.exists ? `Đã có video HyperFrames · ${hf.assets.length} file trong assets/` : 'Chưa tạo: Claude tự tạo khi bắt đầu, hoặc bấm nút dưới để tải sẵn footage.'}</p>
        </> : <p>Đang đọc…</p>}
        <button className="ed-btn" disabled={busy || !hf} onClick={prepare}><Icon name="download" size={13} />{busy ? 'Đang tải footage…' : hf?.exists ? 'Tải thêm footage mới' : 'Chuẩn bị thư mục và tải footage'}</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- HyperFrames Studio, as large as it gets
function Stage({ hf, renders, reload }: { hf: Hyperframes | null; renders: Render[]; reload: () => Promise<void> }) {
  const project = useStore((s) => s.project)!;
  const [starting, setStarting] = useState(false);
  const tried = useRef(false);
  const last = renders.find((r) => r.status === 'ready');
  const start = useCallback(async () => {
    setStarting(true);
    try { await api.hyperframesPreview(project.id); await reload(); } catch (e: any) { toast(e.message, true); } finally { setStarting(false); }
  }, [project.id, reload]);
  // On the Mac, a project that has its HyperFrames video opens straight into the Studio.
  useEffect(() => { if (onMac && hf?.exists && !hf.preview.running && !tried.current) { tried.current = true; void start(); } }, [hf, start]);
  if (onMac && hf?.preview.running && hf.preview.url) return <main className="hfed-stage"><iframe title="HyperFrames Studio" src={hf.preview.url} /></main>;
  return (
    <main className="hfed-stage hfed-stage-off">
      {!hf ? <p className="ed-empty">Đang đọc…</p>
        : !hf.exists ? (
          <div className="hfed-empty">
            <Icon name="sparkle" size={28} />
            <h2>Chưa có video HyperFrames</h2>
            <p>Chép lời nhắc rồi dán vào Claude Code: Claude đọc sheet, xem footage và dựng video. Bản xem trước hiện ở đây.</p>
            <button className="hfed-cta" onClick={() => copy(promptFor(project, hf), 'lời nhắc, dán vào Claude Code')}><Icon name="copy" size={14} />Chép lời nhắc cho Claude</button>
            <small>Lần đầu: kết nối Claude Code ở tab Claude bên trái.</small>
          </div>
        ) : !onMac ? (
          last ? <video key={last.id} src={last.url} controls playsInline /> : <div className="hfed-empty"><h2>Bản xem trước chỉ mở trên máy Mac</h2><p>Chưa có bản render để xem ở đây.</p></div>
        ) : (
          <div className="hfed-empty"><Icon name="play" size={28} /><h2>{starting ? 'Đang mở HyperFrames Studio…' : 'HyperFrames Studio đang tắt'}</h2>{!starting && <button className="ed-btn" onClick={() => void start()}>Mở HyperFrames Studio</button>}</div>
        )}
    </main>
  );
}
