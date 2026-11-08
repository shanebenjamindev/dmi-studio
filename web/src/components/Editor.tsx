import {BrandLoading} from './BrandLoading';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { player } from '../engine/player';
import { proxies } from '../engine/proxies';
import { useStore, setState, getState, closeProject, rebuildFromSheet, addSourceAtPlayhead, flatShots, setShot, splitAt, deleteShot, flushSave, setOutro, toast, fmt } from '../store';
import { api } from '../api';
import { Sheet as Dialog } from './Dialogs';
import { ClipTimeline } from './ClipTimeline';
import { ClaudeChat } from './LeftPanel';
import { Icon, IconButton } from './ui';
import type { Aspect, OutroOpts, Source } from '../types';

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
          {busy ? <BrandLoading label={busy}/>
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
  const [tab, setTab] = useState<'source' | 'sheet' | 'outro' | 'claude'>('source');
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
        <button className={tab === 'outro' ? 'on' : ''} onClick={() => setTab('outro')}><Icon name="badge" size={18} />Outro</button>
        <button className={tab === 'claude' ? 'on' : ''} onClick={() => setTab('claude')} title="Nhờ Claude sửa bản dựng"><Icon name="sparkle" size={18} />Claude</button>
      </nav>
      {tab === 'claude' ? <div className="ed-media-body ed-claude"><ClaudeChat assembly /></div> : tab === 'outro' ? <OutroTab /> : tab === 'source' ? (
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
            {project.sheet.warning && <div className="ed-warn"><b>⚠ Chế độ dự phòng</b><ul><li>{project.sheet.warning}</li><li>Bấm “Đọc lại sheet” khi Claude dùng lại được để xếp clip theo nội dung.</li></ul></div>}
            {missing.length > 0 && <div className="ed-warn"><b>⚠ {missing.length} file trong sheet không tìm thấy trên Drive</b><ul>{missing.map((m) => <li key={m}>{m}</li>)}</ul></div>}
            {project.sheet.form.ignored_rows && <div className="ed-note"><b>Bỏ qua</b><p>{project.sheet.form.ignored_rows}</p></div>}
            <button className="ed-btn" disabled={!!busy} onClick={rebuildFromSheet} title="Đọc lại sheet (nếu đã sửa) và ghép lại từ đầu; các chỉnh sửa trên timeline sẽ mất"><Icon name="refresh" size={14} />Đọc lại sheet và ghép lại</button>
          </> : <p className="ed-empty">Dự án này không có sheet.</p>}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- logo outro
const LS_OUTRO = 'dms.outroOpts';
const OUTRO0: OutroOpts = { dur: 3, bg: 'auto', removeBg: true, holes: false, shine: true, size: 'M' };
const BG: Record<string, string> = { logo: 'Nền: gradient theo màu logo', 'logo-bg': 'Nền: gradient theo màu nền gốc của logo', black: 'Nền: đen', white: 'Nền: trắng' };
const REMOVED = { alpha: 'Logo đã có nền trong suốt.', key: 'Đã xoá nền trơn của logo.', vision: 'Đã tách logo khỏi nền bằng Vision của macOS.', none: '' };

/** Import a logo: the server cuts it out, fits it to the frame, adds the light sweep; the clip goes at the end. */
function OutroTab() {
  const project = useStore((s) => s.project)!;
  const o = project.outro || null;
  const [opts, setOpts] = useState<OutroOpts>(() => { try { return o?.opts || { ...OUTRO0, ...JSON.parse(localStorage.getItem(LS_OUTRO) || '{}') }; } catch { return o?.opts || OUTRO0; } });
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const set = (p: Partial<OutroOpts>) => setOpts((x) => ({ ...x, ...p }));
  const run = async (file?: File) => {
    if (busy) return;
    if (file && !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { setErr('Chọn ảnh PNG, JPG, WebP hoặc GIF.'); return; }
    setErr(''); setBusy(file ? 'Đang xoá nền, căn logo và tạo outro…' : 'Đang tạo lại outro…');
    try {
      const r = file ? await api.outroLogo(project.id, file, opts) : await api.outroRender(project.id, opts);
      setOutro(r.outro);
      try { localStorage.setItem(LS_OUTRO, JSON.stringify(opts)); } catch { /* private mode */ }
      toast('Đã gắn outro vào cuối timeline.');
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  };
  const onTimeline = !!project.storyboard && flatShots(project.storyboard).some((x) => x.sh.media.provider === 'outro');
  const stale = !!o && o.aspect !== project.aspect;
  const changed = !!o && JSON.stringify(o.opts) !== JSON.stringify(opts);
  const [vw, vh] = PREVIEW[project.aspect];
  const seg = <T extends string | number>(cur: T, list: [T, string][], pick: (v: T) => void) => (
    <div className="ed-seg">{list.map(([v, l]) => <button key={String(v)} className={cur === v ? 'on' : ''} onClick={() => pick(v)}>{l}</button>)}</div>
  );
  return (
    <div className="ed-media-body ed-outro">
      <p className="ed-outro-lead">Nhập logo: máy tự xoá nền, căn logo vào giữa vừa khung {project.aspect} (không bị cắt), thêm ánh sáng lướt qua rồi gắn outro vào cuối timeline. Outro có cùng độ phân giải với dự án và đi theo khi xuất CapCut.</p>
      {o && (
        <div className="ed-outro-view">
          <video key={o.media.url} className="ed-outro-video" style={{ aspectRatio: `${vw} / ${vh}` }} src={o.media.url} poster={o.media.url.replace('?', '/thumb?')} muted loop autoPlay playsInline />
          <div className="ed-outro-info">
            <img className="ed-outro-logo" src={o.logo} alt="Logo đã xử lý" />
            {REMOVED[o.removed] && <span>{REMOVED[o.removed]}</span>}
            {o.removed === 'none' && <span>{o.opts.removeBg ? 'Không tách được nền: giữ nguyên ảnh.' : 'Giữ nền gốc của logo.'}</span>}
            {o.bg === 'expand' ? <span>Nền: ảnh gốc mở rộng cho vừa khung (làm mờ phần thêm, không dùng AI tạo ảnh).</span>
              : o.colors?.length === 2 && <span className="ed-outro-bg"><i style={{ background: `radial-gradient(circle at 50% 45%, ${o.colors[0]}, ${o.colors[1]})` }} />{BG[o.bg] || 'Nền: màu đã chọn'}</span>}
            <span className="mono">{fmt(o.media.duration || 0)} · {o.aspect}{onTimeline ? ' · ở cuối timeline' : ''}</span>
          </div>
        </div>
      )}
      {o?.faint && <p className="ed-hint-box">⚠ Logo và nền gần màu nhau nên khó nhìn. Đổi màu nền rồi bấm “Áp dụng”.</p>}
      {o?.small && <p className="ed-hint-box">⚠ Ảnh logo nhỏ (dưới 400 px) nên outro có thể hơi mờ. Nên dùng file lớn hơn.</p>}
      {stale && <p className="ed-hint-box">⚠ Outro được tạo cho khung {o!.aspect}, dự án đang là {project.aspect}. Bấm “Tạo lại”.</p>}
      {o && !onTimeline && !stale && <p className="ed-hint-box">Outro không còn trên timeline. <button className="ed-link" onClick={() => setOutro(o)}>Gắn lại vào cuối</button></p>}
      <button className={'ed-drop' + (drag ? ' on' : '')} disabled={!!busy} onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); run(e.dataTransfer.files[0]); }}>
        {busy ? <><span className="spinner sm" />{busy}</> : <><Icon name="photo" size={22} /><b>{o ? 'Đổi logo' : 'Nhập logo'}</b><small>Kéo thả hoặc bấm để chọn · PNG, JPG, WebP</small></>}
      </button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { run(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="ed-opts">
        <div className="ed-opt"><span>Thời lượng</span>{seg(opts.dur, [[2, '2s'], [3, '3s'], [4, '4s'], [5, '5s']], (v) => set({ dur: v }))}</div>
        <div className="ed-opt"><span>Nền</span>
          <span className="ed-opt-row">
            {seg(opts.bg.startsWith('#') ? '#' : opts.bg, [['auto', 'Tự động'], ['black', 'Đen'], ['white', 'Trắng']], (v) => set({ bg: v }))}
            <label className={'ed-swatch' + (opts.bg.startsWith('#') ? ' on' : '')} title="Chọn màu nền">
              <input type="color" value={opts.bg.startsWith('#') ? opts.bg : '#1d4ed8'} onChange={(e) => set({ bg: e.target.value })} />
            </label>
          </span>
        </div>
        {!!o?.palette?.length && (
          <div className="ed-opt"><span>Màu từ logo</span>
            <span className="ed-opt-row">{o.palette.map((c) => <button key={c} className={'ed-swatch' + (opts.bg === c ? ' on' : '')} style={{ background: c }} title={`Nền gradient màu ${c}`} onClick={() => set({ bg: c })} />)}</span>
          </div>
        )}
        <div className="ed-opt"><span>Cỡ logo</span>{seg(opts.size, [['S', 'Nhỏ'], ['M', 'Vừa'], ['L', 'Lớn']], (v) => set({ size: v }))}</div>
        <label className="ed-check"><input type="checkbox" checked={opts.removeBg} onChange={(e) => set({ removeBg: e.target.checked })} />Xoá nền logo</label>
        <label className={'ed-check' + (opts.removeBg ? '' : ' off')}><input type="checkbox" disabled={!opts.removeBg} checked={opts.holes} onChange={(e) => set({ holes: e.target.checked })} />Xoá cả nền trong lòng chữ (O, A, D…)</label>
        <label className="ed-check"><input type="checkbox" checked={opts.shine} onChange={(e) => set({ shine: e.target.checked })} />Ánh sáng lướt qua logo</label>
        <p className="ed-outro-lead">Nền “Tự động” là gradient theo màu logo: logo vốn nằm trên nền màu thì lấy đúng màu đó; còn lại lấy màu chủ đạo của logo, nhạt sau logo tối và đậm sau logo sáng. Logo chỉ có đen trắng thì dùng nền trắng hoặc đen. Tắt xoá nền thì ảnh gốc được mở rộng cho vừa khung.</p>
      </div>
      {err && <p className="note err">{err}</p>}
      {o && (
        <div className="ed-row">
          {(changed || stale) && <button className="ed-btn primary" disabled={!!busy} onClick={() => run()}><Icon name="refresh" size={13} />{stale ? 'Tạo lại' : 'Áp dụng'}</button>}
          <button className="ed-btn danger" disabled={!!busy} onClick={() => setOutro(null)}><Icon name="trash" size={13} />Bỏ outro</button>
        </div>
      )}
    </div>
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

  const outro = sb.scenes.findIndex((sc) => sc.shots?.some((x) => x.media.provider === 'outro'));
  const rows = (script.length ? script : sb.scenes.filter((_, si) => si !== outro).map((sc) => ({ row: sc.headline, meaning: '', voice_over: '', visual: '', on_screen: '', source: '', duration: '', note: '' })));
  return (
    <div className="ed-scenes" ref={listRef}>
      {project.sheet?.warning && <p className="ed-hint-box">⚠ {project.sheet.warning} Bấm “Đọc lại sheet” (tab Sheet) khi Claude dùng lại được.</p>}
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
      {outro >= 0 && (() => {
        const pos = at.get(norm(sb.scenes[outro].headline))!;
        return (
          <article className={'ed-scene' + (curSi === outro ? ' cur' : '')} onClick={() => { player.seek(pos.start + 0.01); setState({ clip: null }); }}>
            <header><b>Outro logo</b><span className="mono">{fmt(pos.dur)}</span></header>
            <div className="ed-cell"><span>Nội dung</span><p>Logo khách hàng, ánh sáng lướt qua (tab Outro bên trái để đổi).</p></div>
          </article>
        );
      })()}
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
type Run = { job: string; phase: 'media' | 'pack' | 'done' | 'error'; to: 'capcut' | 'zip'; name: string; done: number; total: number; error: string | null; bytes: number };
const mb = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

function CapcutExport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const [run, setRun] = useState<Run | null>(null);
  const [err, setErr] = useState('');
  // CapCut's projects folder on the machine running DMI Workspace ('' when it has no CapCut): projects can go straight in.
  const [drafts, setDrafts] = useState('');
  const timer = useRef<any>(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (open) api.capcutLocal().then((r) => setDrafts(r.drafts)).catch(() => setDrafts('')); }, [open]);
  const download = (job: string) => { const a = document.createElement('a'); a.href = `/api/capcut/${job}/download`; a.click(); };
  const openCapcut = () => api.capcutOpen().catch((e) => setErr(e.message));
  const poll = (job: string) => {
    timer.current = setTimeout(async () => {
      try {
        const st = await api.capcutStatus(job);
        setRun({ job, ...st });
        if (st.phase === 'done') { if (st.to === 'zip') download(job); }
        else if (st.phase !== 'error') poll(job);
      } catch (e: any) { setErr(e.message); }
    }, 1500);
  };
  const start = async (to: 'capcut' | 'zip') => {
    setErr('');
    try {
      await flushSave(); // the server exports what is saved: the timeline as it is now
      const { job } = await api.capcutStart(getState().project!.id, to);
      setRun({ job, phase: 'media', to, name: '', done: 0, total: 0, error: null, bytes: 0 });
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
        {drafts ? <>
          <button className="btn btn-gray" onClick={() => start('zip')}><Icon name="download" size={15} />Tải .zip</button>
          <button className="btn btn-primary" onClick={() => start('capcut')}>Đưa vào CapCut</button>
        </> : <button className="btn btn-primary" onClick={() => start('zip')}>Tạo file CapCut</button>}
      </> : run.phase === 'done' ? run.to === 'capcut' ? <>
        <button className="btn btn-gray" onClick={close}>Xong</button>
        <button className="btn btn-primary" onClick={openCapcut}>Mở CapCut</button>
      </> : <>
        <button className="btn btn-gray" onClick={() => download(run.job)}><Icon name="download" size={15} />Tải lại</button>
        <button className="btn btn-primary" onClick={close}>Xong</button>
      </> : <button className="btn btn-gray" onClick={close}>Chạy nền, đóng cửa sổ</button>}>
      {!run && <>
        <p className="sheet-lead">Tạo một dự án CapCut với {clips} clip đúng thứ tự, điểm vào/ra như trên timeline. Mỗi clip được cắt từ file gốc trên Drive, giữ nguyên độ phân giải, có thêm 2 giây đệm mỗi đầu để chỉnh tiếp trong CapCut.</p>
        {drafts
          ? <p className="note">“Đưa vào CapCut” chép dự án thẳng vào CapCut trên máy này (<code>{drafts}</code>), nằm trong tài khoản CapCut đang đăng nhập ở đây. “Tải .zip” để mang sang máy khác.</p>
          : <p className="note">Máy chạy DMI Workspace không có CapCut, nên dự án được tải về dạng .zip.</p>}
        <p className="note">Thời gian tuỳ số clip và mạng, thường vài phút. Bạn có thể đóng cửa sổ này, việc xuất vẫn chạy.</p>
      </>}
      {busy && <div className="export-run">
        <div className="ring" style={{ ['--p' as any]: run!.phase === 'pack' ? 1 : p }}><span>{run!.phase === 'pack' ? '…' : `${Math.round(p * 100)}%`}</span></div>
        <p className="sheet-lead">{run!.phase === 'pack' ? (run!.to === 'capcut' ? 'Đang đưa vào CapCut…' : 'Đang đóng gói dự án CapCut…') : run!.total ? `Đang tải và cắt clip ${run!.done}/${run!.total}` : 'Đang chuẩn bị…'}</p>
      </div>}
      {run?.phase === 'done' && (run.to === 'capcut' ? <div className="cc-done">
        <p className="sheet-lead">✓ Đã thêm “{run.name}” vào CapCut.</p>
        <ol>
          <li>Bấm “Mở CapCut”: dự án nằm đầu danh sách Projects. Nếu CapCut đang mở mà chưa thấy, thoát hẳn CapCut (⌘Q) rồi mở lại.</li>
          <li>Muốn mở trên máy khác hoặc chia sẻ cho nhóm: trong CapCut, tải dự án lên Cloud/Space của tài khoản.</li>
        </ol>
      </div> : <div className="cc-done">
        <p className="sheet-lead">✓ Đã tạo xong ({mb(run.bytes)}). File .zip đang được tải về.</p>
        <ol>
          <li>Giải nén file .zip.</li>
          <li>Chép thư mục vừa giải nén vào thư mục dự án của CapCut (thường là <code>Documents/CAPCUT/CapCut Drafts</code>; xem trong CapCut ▸ Cài đặt ▸ Vị trí lưu bản nháp).</li>
          <li>Thoát hẳn CapCut rồi mở lại: dự án hiện trong danh sách Projects.</li>
        </ol>
      </div>)}
      {(err || run?.error) && <p className="note err">{err || run?.error}</p>}
    </Dialog>
  );
}
