import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { player } from '../engine/player';
import { proxies } from '../engine/proxies';
import { useStore, setState, getState, closeProject, rebuildFromSheet, addSourceAtPlayhead, flatShots, setShot, splitAt, deleteShot, flushSave, fmt } from '../store';
import { api } from '../api';
import { Sheet as Dialog } from './Dialogs';
import { ClipTimeline } from './ClipTimeline';
import { Icon, IconButton } from './ui';
import type { Aspect, Source } from '../types';

// A project built from a request sheet, laid out like a desktop video editor:
//   media (sources / sheet) │ properties of the selected clip │ player (full height)
//   timeline ─────────────────────────────────────────────── │
const PREVIEW: Record<Aspect, [number, number]> = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [960, 960] };
function usePlayer<T>(sel: () => T) { return useSyncExternalStore((cb) => player.subscribe(cb), sel); }

export function Editor() {
  const title = useStore((s) => s.project?.title || '');
  const hasSb = useStore((s) => !!s.project?.storyboard?.scenes.length);
  const [capcut, setCapcut] = useState(false);
  const busy = useStore((s) => s.busy);
  const save = useStore((s) => s.save);
  const px = useSyncExternalStore((cb) => proxies.subscribe(cb), () => { const p = proxies.progress(); return p.ready * 100000 + p.total; });
  const pxReady = Math.floor(px / 100000), pxTotal = px % 100000;
  return (
    <div className="ed">
      <header className="ed-bar">
        <button className="ed-back" onClick={closeProject}><Icon name="left" size={16} />Dự án</button>
        <span className="ed-title" title={title}>{title}</span>
        <span className="ed-save">{save === 'saving' ? 'Đang lưu…' : save === 'dirty' ? 'Chưa lưu' : save === 'error' ? 'Lỗi lưu' : 'Đã lưu'}</span>
        <span className="ed-gap" />
        {pxTotal > 0 && (pxReady < pxTotal
          ? <span className="ed-proxy" title="Bản xem nhẹ 720p để phát mượt; clip chưa có sẽ phát chậm từ file gốc trên Drive"><span className="spinner sm" />Chuẩn bị bản xem {pxReady}/{pxTotal}</span>
          : <span className="ed-proxy ok">✓ Sẵn sàng phát mượt</span>)}
        <button className="ed-export" onClick={() => { player.pause(); setCapcut(true); }}><Icon name="share" size={15} />Xuất video</button>
      </header>
      <CapcutExport open={capcut} onClose={() => setCapcut(false)} />
      {hasSb ? (
        <div className="ed-grid">
          <MediaPanel />
          <PropsPanel />
          <PlayerPanel />
          <div className="ed-tl"><ClipTimeline /></div>
        </div>
      ) : (
        // The project exists before its assembly does (the sheet is still being read), or the sheet found no video.
        <div className="ed-wait">
          {busy ? <><span className="spinner" /><p>{busy}</p></>
            : <><Icon name="film" size={30} /><p>Chưa ghép được video nào từ sheet này. Kiểm tra cột Source trong sheet và quyền chia sẻ của thư mục, rồi bấm đọc lại.</p>
              <button className="ed-btn" onClick={rebuildFromSheet}><Icon name="refresh" size={14} />Đọc lại sheet</button></>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- media: sources and the sheet
type Filter = 'all' | 'used' | 'unused';
function MediaPanel() {
  const busy = useStore((s) => s.busy);
  const project = useStore((s) => s.project)!;
  const [tab, setTab] = useState<'source' | 'sheet'>('source');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const sources = project.sources || [];
  const uses = new Map<string, number>();
  for (const sh of (project.storyboard?.scenes || []).flatMap((s) => s.shots || [])) uses.set(sh.media.assetId, (uses.get(sh.media.assetId) || 0) + 1);
  const list = sources.filter((s) => (filter === 'all' || (filter === 'used') === uses.has(s.id)) && (!q.trim() || `${s.name} ${s.folder}`.toLowerCase().includes(q.trim().toLowerCase())));
  const missing = project.sheet?.missing || [];
  // Grouped by the script row that asked for each clip, in the script's order (not by file name).
  const order = (project.sheet?.form.script || []).map((r) => r.row);
  const groups: [string, Source[]][] = [];
  for (const src of list) {
    const row = src.row || 'Khác';
    const g = groups.find(([r]) => r === row);
    if (g) g[1].push(src); else groups.push([row, [src]]);
  }
  const rank = (r: string) => { const i = order.indexOf(r); return i < 0 ? order.length + (r === 'Khác' ? 1 : 0) : i; };
  groups.sort((a, b) => rank(a[0]) - rank(b[0]));
  return (
    <section className="ed-panel ed-media">
      <nav className="ed-nav">
        <button className={tab === 'source' ? 'on' : ''} onClick={() => setTab('source')}><Icon name="film" size={18} />Source</button>
        <button className={tab === 'sheet' ? 'on' : ''} onClick={() => setTab('sheet')}><Icon name="text" size={18} />Sheet{missing.length > 0 && <i className="ed-dot" />}</button>
      </nav>
      {tab === 'source' ? (
        <div className="ed-media-body">
          <div className="ed-media-tools">
            <label className="ed-search"><Icon name="search" size={13} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm source" /></label>
            <div className="ed-seg">
              {([['all', `Tất cả ${sources.length}`], ['used', `Đang dùng ${uses.size}`], ['unused', 'Chưa dùng']] as [Filter, string][]).map(([k, l]) => (
                <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="ed-media-grid">
            {groups.map(([row, items]) => (
              <div key={row} className="ed-group">
                <h4>{row}<span>{items.length}</span></h4>
                <div className="ed-group-grid">{items.map((s) => <Tile key={s.id} s={s} uses={uses.get(s.id) || 0} disabled={!!busy} />)}</div>
              </div>
            ))}
            {!list.length && <p className="ed-empty">Không có source nào{q ? ' khớp' : ''}.</p>}
          </div>
          <p className="ed-hint">Bấm một source để chèn vào timeline ngay sau clip ở vạch phát.</p>
        </div>
      ) : (
        <div className="ed-media-body ed-sheet">
          {project.sheet ? <>
            <a className="ed-sheet-name" href={project.sheet.link} target="_blank" rel="noreferrer">📄 {project.sheet.title} <Icon name="share" size={12} /></a>
            <dl>
              <dt>Khách hàng</dt><dd>{project.sheet.form.customer || '—'}</dd>
              <dt>Khung hình</dt><dd>{project.sheet.form.aspect}</dd>
              <dt>Độ dài yêu cầu</dt><dd>~{project.sheet.form.seconds}s</dd>
              <dt>Source tìm được</dt><dd>{sources.length}</dd>
            </dl>
            {missing.length > 0 && <div className="ed-warn"><b>⚠ {missing.length} file trong sheet không tìm thấy trên Drive</b><ul>{missing.map((m) => <li key={m}>{m}</li>)}</ul></div>}
            {project.sheet.form.ignored_rows && <div className="ed-note"><b>Bỏ qua</b><p>{project.sheet.form.ignored_rows}</p></div>}
            <button className="ed-btn" disabled={!!busy} onClick={rebuildFromSheet} title="Đọc lại sheet (nếu đã sửa) và ghép lại từ đầu; các chỉnh sửa trên timeline sẽ mất"><Icon name="refresh" size={14} />Đọc lại sheet và ghép lại</button>
          </> : <p className="ed-empty">Dự án này không có sheet.</p>}
        </div>
      )}
    </section>
  );
}

function Tile({ s, uses, disabled }: { s: Source; uses: number; disabled: boolean }) {
  return (
    <button className="ed-tile" onClick={() => addSourceAtPlayhead(s)} disabled={disabled} title={`${s.name}${s.folder ? `\n${s.folder}` : ''}\nBấm để chèn vào timeline`}>
      <span className="ed-tile-img" style={{ backgroundImage: `url("${s.thumb}")` }}>
        {uses > 0 && <i>Đang dùng{uses > 1 ? ` ×${uses}` : ''}</i>}
        {s.duration ? <em>{fmt(s.duration)}</em> : null}
        <b>＋</b>
      </span>
      <span className="ed-tile-name">{s.name}</span>
    </button>
  );
}

// ---------------------------------------------------------------- the sheet's scenes / the selected clip
const norm = (r: string) => r.toLowerCase().replace(/\s+/g, ' ').trim();

function PropsPanel() {
  const sel = useStore((s) => s.clip);
  const [tab, setTab] = useState<'scenes' | 'clip'>('scenes');
  // Picking a clip on the timeline shows its details; the scenes tab stays one click away.
  useEffect(() => { if (sel !== null) setTab('clip'); }, [sel]);
  return (
    <section className="ed-panel ed-props">
      <div className="ed-tabs">
        <button className={tab === 'scenes' ? 'on' : ''} onClick={() => setTab('scenes')}>Cảnh trong sheet</button>
        <button className={tab === 'clip' ? 'on' : ''} onClick={() => setTab('clip')}>Clip{sel !== null ? ` ${sel + 1}` : ''}</button>
      </div>
      {tab === 'scenes' ? <ScenesTab /> : <ClipTab />}
    </section>
  );
}

/** Every scene of the sheet's script with its cells, the one under the playhead (or selected clip) highlighted. */
function ScenesTab() {
  const project = useStore((s) => s.project)!;
  const sel = useStore((s) => s.clip);
  const time = usePlayer(() => Math.floor(player.time * 4) / 4);
  const sb = project.storyboard!;
  const flat = flatShots(sb);
  const script = project.sheet?.form.script || [];
  // Where each row sits on the timeline.
  const at = new Map<string, { start: number; dur: number; clips: number; si: number }>();
  let t = 0;
  sb.scenes.forEach((sc, si) => { at.set(norm(sc.headline || ''), { start: t, dur: sc.duration, clips: sc.shots?.length || 0, si }); t += sc.duration; });
  const curSi = sel !== null && flat[sel] ? flat[sel].si : player.sceneIndexAt(time);
  const curRow = norm(sb.scenes[curSi]?.headline || '');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.querySelector('.ed-scene.cur')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [curRow]);

  const rows = script.length ? script : sb.scenes.map((sc) => ({ row: sc.headline, meaning: '', voice_over: '', visual: '', on_screen: '', source: '', duration: '', note: '' }));
  return (
    <div className="ed-scenes" ref={listRef}>
      {!script.length && <p className="ed-hint-box">Dự án này được ghép trước khi tool đọc đầy đủ kịch bản. Mở tab <b>Sheet</b> bên trái và bấm “Đọc lại sheet” để hiện voice-over, nội dung, chữ trên hình của từng cảnh.</p>}
      {rows.map((r, i) => {
        const pos = at.get(norm(r.row));
        const cur = norm(r.row) === curRow;
        return (
          <article key={i} className={'ed-scene' + (cur ? ' cur' : '') + (pos ? '' : ' empty')} onClick={() => { if (pos) { player.seek(pos.start + 0.01); setState({ clip: null }); } }}>
            <header>
              <b>{r.row}</b>
              <span className="mono">{r.duration && <em>sheet {r.duration}</em>}{pos ? `${pos.clips} clip · ${fmt(pos.dur)}` : ''}</span>
            </header>
            {!pos && <p className="ed-scene-warn">⚠ Chưa có clip nào cho cảnh này (không tìm thấy source trên Drive).</p>}
            <Cell label="Voice over" text={r.voice_over} />
            <Cell label="Nội dung" text={r.visual} />
            <Cell label="Chữ trên hình" text={r.on_screen} />
            <Cell label="Source" text={r.source} />
            <Cell label="Ghi chú" text={r.note} />
          </article>
        );
      })}
    </div>
  );
}
const Cell = ({ label, text }: { label: string; text: string }) => (text?.trim() ? <div className="ed-cell"><span>{label}</span><p>{text.trim()}</p></div> : null);

function ClipTab() {
  const sb = useStore((s) => s.project?.storyboard)!;
  const sel = useStore((s) => s.clip);
  const flat = flatShots(sb);
  const x = sel !== null ? flat[sel] : null;
  if (!x) return <div className="ed-props-empty"><Icon name="film" size={26} /><p>Chọn một clip trên timeline để xem và chỉnh điểm vào, độ dài.</p></div>;
  const sh = x.sh, from = sh.from || 0, len = sh.media.duration;
  const start = flat.slice(0, sel!).reduce((a, y) => a + y.sh.dur, 0);
  return (
    <div className="ed-props-body">
      <div className="ed-clip-head">
        <span className="ed-clip-img" style={{ backgroundImage: `url("${sh.media.url.replace('?', '/thumb?')}")` }} />
        <div>
          <b title={sh.media.prompt}>{sh.media.prompt}</b>
          <span>{sb.scenes[x.si].headline || `Hàng ${x.si + 1}`} · clip {sel! + 1} / {flat.length}</span>
        </div>
      </div>
      <div className="ed-fields">
        <NumField label="Điểm vào" value={from} max={len ? len - 0.3 : undefined} onChange={(v) => setShot(sel!, { from: v })} />
        <NumField label="Độ dài" value={sh.dur} max={len ? len - from : undefined} onChange={(v) => setShot(sel!, { dur: v })} />
        <NumField label="Điểm ra" value={from + sh.dur} max={len} onChange={(v) => setShot(sel!, { dur: v - from })} />
        <div className="ed-field"><span>Độ dài gốc</span><b className="mono">{len ? `${len.toFixed(1)}s` : '—'}</b></div>
        <div className="ed-field"><span>Trên timeline</span><b className="mono">{fmt(start)} → {fmt(start + sh.dur)}</b></div>
      </div>
      <div className="ed-row">
        <button className="ed-btn" onClick={() => player.seek(start + 0.01)}><Icon name="play" size={13} />Tới clip</button>
        <button className="ed-btn" onClick={() => { player.seek(Math.max(start + 0.01, Math.min(player.time, start + sh.dur - 0.01))); const i = splitAt(player.time); if (i >= 0) setState({ clip: i }); }}>✂ Tách tại vạch phát</button>
        <button className="ed-btn danger" onClick={() => { deleteShot(sel!); setState({ clip: null }); }}><Icon name="trash" size={13} />Xoá</button>
      </div>
    </div>
  );
}

/** Seconds with one decimal; commits on Enter or blur. */
function NumField({ label, value, max, onChange }: { label: string; value: number; max?: number; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null) { const v = Number(draft.replace(',', '.')); if (isFinite(v)) onChange(max !== undefined ? Math.min(v, max) : v); setDraft(null); } };
  return (
    <label className="ed-field">
      <span>{label}</span>
      <span className="ed-num">
        <input className="mono" value={draft ?? value.toFixed(1)} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setDraft(null); }} />
        <em>s</em>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- player
function PlayerPanel() {
  const project = useStore((s) => s.project)!;
  const busy = useStore((s) => s.busy);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const aspect = (project.aspect || '9:16') as Aspect;
  const time = usePlayer(() => Math.round(player.time * 10) / 10);
  const playing = usePlayer(() => player.playing);
  const waiting = usePlayer(() => player.waiting);
  const total = player.total;
  useEffect(() => {
    const c = canvasRef.current!; const [w, h] = PREVIEW[aspect];
    c.width = w; c.height = h; player.attach(c);
  }, [aspect]);
  const flat = project.storyboard ? flatShots(project.storyboard) : [];
  const jump = (d: number) => {
    let s = 0; const starts = flat.map((x) => { const v = s; s += x.sh.dur; return v; });
    let cur = 0; starts.forEach((v, k) => { if (v <= player.time + 0.01) cur = k; });
    const i = Math.max(0, Math.min(flat.length - 1, cur + d));
    player.seek((starts[i] ?? 0) + 0.01);
  };
  return (
    <section className="ed-panel ed-player">
      <div className="ed-tabs"><span className="on">Xem trước</span><span className="ed-aspect">{aspect}</span></div>
      <div className="ed-screen">
        <canvas ref={canvasRef} className={'ed-canvas a' + aspect.replace(':', '')} />
        {busy && <div className="hud"><div className="spinner" /><span>{busy}</span></div>}
        {!busy && waiting && <div className="hud small"><div className="spinner" /><span>Đang tải clip…</span></div>}
      </div>
      <div className="ed-transport">
        <span className="mono"><b>{fmt(time)}</b> / {fmt(total)}</span>
        <div className="ed-play">
          <IconButton icon="back" label="Clip trước" size={16} onClick={() => jump(-1)} />
          <button className="ed-play-btn" onClick={() => player.toggle()} aria-label={playing ? 'Tạm dừng' : 'Phát'}><Icon name={playing ? 'pause' : 'play'} size={18} /></button>
          <IconButton icon="fwd" label="Clip sau" size={16} onClick={() => jump(1)} />
        </div>
        <span />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- export as a CapCut project
type Run = { job: string; phase: 'media' | 'pack' | 'done' | 'error'; done: number; total: number; error: string | null; bytes: number };
const mb = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

function CapcutExport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const [run, setRun] = useState<Run | null>(null);
  const [err, setErr] = useState('');
  const timer = useRef<any>(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const download = (job: string) => { const a = document.createElement('a'); a.href = `/api/capcut/${job}/download`; a.click(); };
  const poll = (job: string) => {
    timer.current = setTimeout(async () => {
      try {
        const st = await api.capcutStatus(job);
        setRun({ job, ...st });
        if (st.phase === 'done') download(job);
        else if (st.phase !== 'error') poll(job);
      } catch (e: any) { setErr(e.message); }
    }, 1500);
  };
  const start = async () => {
    setErr('');
    try {
      await flushSave(); // the server exports what is saved: the timeline as it is now
      const { job } = await api.capcutStart(getState().project!.id);
      setRun({ job, phase: 'media', done: 0, total: 0, error: null, bytes: 0 });
      poll(job);
    } catch (e: any) { setErr(e.message); }
  };
  const busy = run && (run.phase === 'media' || run.phase === 'pack');
  const close = () => { if (!busy) { setRun(null); setErr(''); } onClose(); };
  const p = run?.total ? run.done / run.total : 0;
  const clips = (project.storyboard?.scenes || []).reduce((a, s) => a + (s.shots?.length || 0), 0);
  return (
    <Dialog open={open} onClose={close} title="Xuất dự án CapCut" footer={
      !run || run.phase === 'error' ? <>
        <button className="btn btn-plain" onClick={() => { close(); setState({ dialog: 'export', exp: { phase: 'setup', progress: 0, text: '' } }); }}>Xuất MP4 xem nhanh</button>
        <button className="btn btn-primary" onClick={start}>Tạo file CapCut</button>
      </> : run.phase === 'done' ? <>
        <button className="btn btn-gray" onClick={() => download(run.job)}><Icon name="download" size={15} />Tải lại</button>
        <button className="btn btn-primary" onClick={close}>Xong</button>
      </> : <button className="btn btn-gray" onClick={close}>Chạy nền, đóng cửa sổ</button>}>
      {!run && <>
        <p className="sheet-lead">Tạo một dự án CapCut (.zip) với {clips} clip đúng thứ tự, điểm vào/ra như trên timeline. Mỗi clip được cắt từ file gốc trên Drive, giữ nguyên độ phân giải, có thêm 2 giây đệm mỗi đầu để chỉnh tiếp trong CapCut.</p>
        <p className="note">Thời gian tuỳ số clip và mạng, thường vài phút. Bạn có thể đóng cửa sổ này, việc xuất vẫn chạy.</p>
      </>}
      {busy && <div className="export-run">
        <div className="ring" style={{ ['--p' as any]: run!.phase === 'pack' ? 1 : p }}><span>{run!.phase === 'pack' ? '…' : `${Math.round(p * 100)}%`}</span></div>
        <p className="sheet-lead">{run!.phase === 'pack' ? 'Đang đóng gói dự án CapCut…' : run!.total ? `Đang tải và cắt clip ${run!.done}/${run!.total}` : 'Đang chuẩn bị…'}</p>
      </div>}
      {run?.phase === 'done' && <div className="cc-done">
        <p className="sheet-lead">✓ Đã tạo xong ({mb(run.bytes)}). File .zip đang được tải về.</p>
        <ol>
          <li>Giải nén file .zip.</li>
          <li>Chép thư mục vừa giải nén vào thư mục dự án của CapCut (thường là <code>Documents/CAPCUT/CapCut Drafts</code>; xem trong CapCut ▸ Cài đặt ▸ Vị trí lưu bản nháp).</li>
          <li>Thoát hẳn CapCut rồi mở lại: dự án hiện trong danh sách Projects.</li>
        </ol>
      </div>}
      {(err || run?.error) && <p className="note err">{err || run?.error}</p>}
    </Dialog>
  );
}
