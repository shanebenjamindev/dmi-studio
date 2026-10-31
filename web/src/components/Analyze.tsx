// Upload a reference video → in-browser analysis → prompts to recreate the edit.
import { useEffect, useMemo, useRef, useState } from 'react';
import { setState, getState, toast } from '../store';
import { analyzeVideo, buildPrompts, similarTemplates, contactSheet, tagsVi, colorName, bpmGuess, audioVi, MOVE_VI, TRANS_VI, STYLE, motionLevel, type Analysis } from '../engine/analyze';
import { AI_SITES } from '../templates';
import { Icon } from './ui';

const CHATBOTS = [
  { name: 'Gemini', url: 'https://gemini.google.com/app', note: 'Nhận video trực tiếp · miễn phí', video: true },
  { name: 'ChatGPT', url: 'https://chatgpt.com', note: 'Gửi ảnh khung hình', video: false },
  { name: 'Claude', url: 'https://claude.ai/new', note: 'Gửi ảnh khung hình', video: false },
];
const fmtS = (s: number) => s.toFixed(1) + 's';

async function copyText(text: string, ok = 'Đã sao chép') {
  try { await navigator.clipboard.writeText(text); toast(ok); }
  catch { toast('Trình duyệt chặn clipboard — hãy chọn và sao chép thủ công.', true); }
}
function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function AnalyzePage() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [res, setRes] = useState<Analysis | null>(null);
  const [car, setCar] = useState('');
  const [drag, setDrag] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const pick = async (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith('video/')) return toast('Hãy chọn file video (.mp4, .mov, .webm).', true);
    const u = URL.createObjectURL(f);
    setFile(f); setUrl(u); setRes(null); setProgress(0);
    try { setRes(await analyzeVideo(f, u, setProgress)); }
    catch (e: any) { toast(e.message, true); }
    finally { setProgress(null); }
  };
  // Opened from a customer's video in the Workspace: load that file from the server.
  useEffect(() => {
    const src = getState().analyzeSrc; if (!src) return;
    setState({ analyzeSrc: null });
    fetch(src.url).then((r) => { if (!r.ok) throw new Error(`Không tải được video (${r.status})`); return r.blob(); })
      .then((b) => pick(new File([b], src.name, { type: b.type.startsWith('video/') ? b.type : 'video/mp4' })))
      .catch((e) => toast(e.message, true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const prompts = useMemo(() => (res ? buildPrompts(res, car) : null), [res, car]);
  const similar = useMemo(() => (res ? similarTemplates(res) : []), [res]);
  // Editable copy of the generated prompt; regenerated whenever the analysis or car changes.
  const [text, setText] = useState('');
  useEffect(() => setText(prompts?.prompt || ''), [prompts]);
  const seek = (t: number) => { const v = videoRef.current; if (v) { v.currentTime = t; v.pause(); } };

  const openChatbot = async (b: typeof CHATBOTS[number]) => {
    if (!prompts || !res) return;
    navigator.clipboard.writeText(prompts.meta).then(() => toast(b.video ? `Đã sao chép prompt — dán vào ${b.name} rồi đính kèm video` : `Đã sao chép prompt và tải ảnh khung hình — đính kèm vào ${b.name}`), () => {});
    window.open(b.url, '_blank', 'noopener');
    if (!b.video && res.keyframes.length) saveBlob(await contactSheet(res), `khung-hinh-${res.name.replace(/\.\w+$/, '')}.png`);
  };
  const openSite = (s: typeof AI_SITES[number]) => {
    if (!prompts) return;
    navigator.clipboard.writeText(text).then(() => toast(`Đã sao chép prompt — dán vào ${s.name} (⌘V)`), () => {});
    window.open(s.url, '_blank', 'noopener');
  };

  return (
    <main className="tpl-page">
      <header className="tpl-head">
        <div>
          <h1 className="tpl-title">Phân tích video</h1>
          <p className="tpl-lead">Tải lên một video edit bạn thích. Trình duyệt sẽ đo nhịp cắt, chuyển động máy quay, speed ramp và màu sắc rồi viết prompt để tạo video giống vậy. Video không rời khỏi máy bạn.</p>
        </div>
        {file && <button className="btn btn-gray" onClick={() => inputRef.current?.click()}><Icon name="film" size={16} />Chọn video khác</button>}
      </header>
      <input ref={inputRef} type="file" accept="video/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />

      {!file && (
        <button className={'an-drop' + (drag ? ' on' : '')} onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}>
          <Icon name="film" size={34} />
          <b>Kéo thả video vào đây</b>
          <span>hoặc bấm để chọn file · .mp4 .mov .webm · tối đa 90 giây được phân tích</span>
        </button>
      )}

      {file && (
        <div className="an-grid">
          <section className="an-left">
            <div className={'an-video' + (res?.aspect === '9:16' ? ' tall' : '')}>
              <video ref={videoRef} src={url} controls playsInline muted loop />
            </div>
            {progress !== null && (
              <div className="an-progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /><em>Đang phân tích… {Math.round(progress * 100)}%</em></div>
            )}
            {res && <MotionChart a={res} video={videoRef} onSeek={seek} />}
            {res && (
              <div className="an-keys">
                {res.keyframes.map((k, i) => (
                  <button key={i} onClick={() => seek(k.t)} title={`Tới ${fmtS(k.t)}`}><img src={k.url} alt="" /><span>{fmtS(k.t)}</span></button>
                ))}
              </div>
            )}
          </section>

          {res && prompts && (
            <section className="an-right">
              <div className="an-stats">
                <Stat label="Thời lượng" value={fmtS(res.duration)} />
                <Stat label="Khung hình" value={res.aspect} />
                <Stat label="Số shot" value={String(res.shots.length)} />
                <Stat label="Nhịp" value={bpmGuess(res) ? `≈${bpmGuess(res)} BPM` : '—'} />
                <Stat label="Âm thanh" value={audioVi(res)} />
              </div>
              <div className="an-style"><span>Kiểu edit</span><b>{STYLE[res.style].vi}</b></div>
              <div className="an-tags">
                {tagsVi(res).map((t) => <span key={t} className="an-tag">{t}</span>)}
                {res.palette.map((c) => <span key={c} className="an-swatch" style={{ background: c }} title={`${c} · ${colorName(c)}`} />)}
              </div>

              <div className="an-shots">
                {res.shots.slice(0, 15).map((s, i) => (
                  <button key={i} onClick={() => seek(s.start + 0.01)}>
                    <b>#{i + 1}</b><span>{fmtS(s.start)}–{fmtS(s.end)}</span><span>{s.enter ? TRANS_VI[s.enter] + ' → ' : ''}{MOVE_VI[s.move]}</span><span>chuyển động {motionLevel(s.motion)}</span>
                  </button>
                ))}
              </div>

              <label className="opt">
                <span className="opt-label">Thay chủ thể / sản phẩm (tuỳ chọn, tiếng Anh)</span>
                <input className="tpl-input" value={car} onChange={(e) => setCar(e.target.value)} placeholder="Để trống = giữ như video gốc. Vd: a white Tesla Model Y" />
              </label>
              <div className="opt">
                <div className="an-box-h"><span className="opt-label">Prompt tạo video giống vậy (sửa thoải mái)</span><button className="link" onClick={() => copyText(text)}><Icon name="copy" size={13} />Sao chép</button></div>
                <textarea className="tpl-prompt" rows={14} value={text} onChange={(e) => setText(e.target.value)} />
              </div>
              <div className="opt">
                <span className="opt-label">Tạo trên web AI: bấm để sao chép prompt trên và mở trang</span>
                <div className="tpl-sites">
                  {AI_SITES.map((s) => <button key={s.name} className="tpl-site" onClick={() => openSite(s)}><b>{s.name}</b><span>{s.note}</span></button>)}
                </div>
              </div>

              <div className="opt">
                <span className="opt-label">Muốn mô tả chi tiết nội dung hơn? Nhờ chatbot xem video (miễn phí)</span>
                <div className="tpl-sites">
                  {CHATBOTS.map((b) => <button key={b.name} className="tpl-site" onClick={() => openChatbot(b)}><b>{b.name}</b><span>{b.note}</span></button>)}
                </div>
                <p className="note">Prompt phân tích (kèm số đo ở trên) được sao chép sẵn. Gemini nhận được cả video; với ChatGPT và Claude, trang sẽ tải về một ảnh gồm các khung hình để bạn đính kèm.</p>
              </div>

              {!!similar.length && (
                <div className="opt">
                  <span className="opt-label">Template có sẵn gần giống</span>
                  <div className="an-similar">
                    {similar.map((t) => <button key={t.id} className="pill" onClick={() => setState({ view: 'templates', tplFocus: t.id })}>{t.name}</button>)}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="an-stat"><span>{label}</span><b>{value}</b></div>;
}

/** Motion over time (single series) with cut markers, slow-motion bands, playhead and hover read-out. */
function MotionChart({ a, video, onSeek }: { a: Analysis; video: React.RefObject<HTMLVideoElement | null>; onSeek: (t: number) => void }) {
  const W = 600, H = 96;
  const max = Math.max(1, ...a.points.map((p) => p.motion));
  const x = (t: number) => (t / a.duration) * W, y = (m: number) => H - 4 - (m / max) * (H - 12);
  const line = a.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.motion).toFixed(1)}`).join('');
  const [hover, setHover] = useState<{ t: number; m: number; px: number } | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const v = video.current; if (!v) return;
    const f = () => setNow(v.currentTime);
    v.addEventListener('timeupdate', f);
    return () => v.removeEventListener('timeupdate', f);
  }, [video]);
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), k = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), t = k * a.duration;
    const p = a.points.reduce((b, q) => (Math.abs(q.t - t) < Math.abs(b.t - t) ? q : b), a.points[0]);
    setHover({ t: p.t, m: p.motion, px: k * r.width });
  };
  return (
    <figure className="an-chart">
      <figcaption>
        <b>Mức chuyển động theo thời gian</b>
        <span><i className="k-cut" />Cắt cảnh</span><span><i className="k-slow" />Đoạn chậm (speed ramp)</span>
      </figcaption>
      <div className="an-plot" onMouseMove={onMove} onMouseLeave={() => setHover(null)} onClick={() => hover && onSeek(hover.t)}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Biểu đồ mức chuyển động của video theo thời gian">
          {a.slowmo.map(([s, e], i) => <rect key={i} x={x(s)} y={0} width={Math.max(2, x(e) - x(s))} height={H} className="c-slow" />)}
          <line x1={0} x2={W} y1={H - 4} y2={H - 4} className="c-base" />
          <path d={line + `L${W},${H - 4}L0,${H - 4}Z`} className="c-area" />
          <path d={line} className="c-line" />
          {a.cuts.map((c) => <line key={c} x1={x(c)} x2={x(c)} y1={0} y2={H} className="c-cut" />)}
          <line x1={x(now)} x2={x(now)} y1={0} y2={H} className="c-head" />
          {hover && <line x1={x(hover.t)} x2={x(hover.t)} y1={0} y2={H} className="c-hover" />}
        </svg>
        {hover && <div className="an-tip" style={{ left: hover.px }}>{fmtS(hover.t)} · chuyển động {motionLevel(hover.m)}<em>Bấm để tua tới</em></div>}
      </div>
      <div className="an-axis"><span>0s</span><span>{fmtS(a.duration / 2)}</span><span>{fmtS(a.duration)}</span></div>
    </figure>
  );
}
