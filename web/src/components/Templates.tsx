// Car edit template gallery: browse looks, copy the prompt, render a sample clip, or open it as a project.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useStore, providerName, openProject, toast, setState, getState } from '../store';
import { TEMPLATES, CATEGORIES, DEFAULT_CAR, AI_SITES, type AiSite, type CarTemplate, type TplCategory } from '../templates';
import { mountMotion, recordMotion } from '../engine/motion';
import { Sheet } from './Dialogs';
import { Icon, Segmented } from './ui';
import type { Aspect, Job, Storyboard } from '../types';

const LS_CAR = 'dms.templateCar';
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export const fillPrompt = (t: CarTemplate, car: string) => t.prompt.replaceAll('{car}', car.trim() || DEFAULT_CAR);
const isActive = (j?: Job) => !!j && (j.status === 'queued' || j.status === 'running');

/** Newest sample clip and newest in-flight job per template. */
function indexPreviews(jobs: Job[]) {
  const done = new Map<string, Job>();
  const running = new Map<string, Job>();
  for (const j of jobs) {
    const id = j.sceneId.replace(/^tpl:/, '');
    if (j.status === 'succeeded' && j.result && !done.has(id)) done.set(id, j);
    if (isActive(j) && !running.has(id)) running.set(id, j);
  }
  return { done, running };
}

export function TemplatesPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [cat, setCat] = useState<TplCategory | 'all'>('all');
  const [q, setQ] = useState('');
  const [car, setCarState] = useState(() => lsGet(LS_CAR) || '');
  const [openId, setOpenId] = useState<string | null>(() => getState().tplFocus);
  useEffect(() => { if (getState().tplFocus) setState({ tplFocus: null }); }, []);
  const setCar = (v: string) => { setCarState(v); lsSet(LS_CAR, v); };

  const timer = useRef<any>(null);
  const load = async () => {
    clearTimeout(timer.current);
    try {
      const list = await api.templatePreviews();
      setJobs((prev) => {
        const before = new Map(prev.map((j) => [j.id, j.status]));
        list.filter((j) => j.status === 'failed' && before.get(j.id) && before.get(j.id) !== 'failed')
          .forEach((j) => toast(`${providerName(j.provider)}: ${j.error}`, true));
        return list;
      });
      if (list.some(isActive)) timer.current = setTimeout(load, 3000);
    } catch { timer.current = setTimeout(load, 6000); }
  };
  useEffect(() => { load(); return () => clearTimeout(timer.current); }, []);

  const { done, running } = useMemo(() => indexPreviews(jobs), [jobs]);
  const needle = q.trim().toLowerCase();
  const shown = TEMPLATES.filter((t) => (cat === 'all' || t.category === cat)
    && (!needle || [t.name, t.en, ...t.tags].some((s) => s.toLowerCase().includes(needle))));
  const open = TEMPLATES.find((t) => t.id === openId) || null;

  return (
    <main className="tpl-page">
      <header className="tpl-head">
        <div>
          <h1 className="tpl-title">Template video xe</h1>
          <p className="tpl-lead">{TEMPLATES.length} kiểu edit có sẵn prompt. Nhập xe của bạn, bấm vào template để sao chép prompt và mở thẳng Higgsfield, Kling, Hailuo… rồi đưa clip đã tạo về đây.</p>
        </div>
        <div className="tpl-tools">
          <label className="tpl-field">
            <Icon name="car" size={16} />
            <input value={car} onChange={(e) => setCar(e.target.value)} placeholder="Xe của bạn (tiếng Anh), vd. white Porsche 911" aria-label="Mẫu xe" />
          </label>
          <label className="tpl-field tpl-search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm: drift, neon, ceramic…" aria-label="Tìm template" />
          </label>
        </div>
      </header>

      <nav className="tpl-cats" aria-label="Nhóm template">
        {CATEGORIES.map(([id, label]) => (
          <button key={id} className={'pill' + (cat === id ? ' on' : '')} aria-pressed={cat === id} onClick={() => setCat(id)}>
            {label}<span className="tpl-count">{id === 'all' ? TEMPLATES.length : TEMPLATES.filter((t) => t.category === id).length}</span>
          </button>
        ))}
      </nav>

      {!shown.length && <p className="empty-note">Không có template nào khớp “{q}”.</p>}
      <div className="tpl-grid">
        {shown.map((t) => (
          <TemplateCard key={t.id} t={t} preview={done.get(t.id)} busy={running.has(t.id)} onOpen={() => setOpenId(t.id)} />
        ))}
      </div>

      <TemplateSheet t={open} car={car} setCar={setCar} preview={open ? done.get(open.id) : undefined}
        busy={open ? running.has(open.id) : false} onClose={() => setOpenId(null)} onQueued={load} />
    </main>
  );
}

function Thumb({ t, preview, playing }: { t: CarTemplate; preview?: Job; playing?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current; if (!v) return;
    if (playing) v.play().catch(() => {}); else { v.pause(); v.currentTime = 0.5; }
  }, [playing, preview?.result?.url]);
  if (preview?.result?.url) {
    return <video ref={ref} className="tpl-media" src={preview.result.url + '#t=0.5'} muted loop playsInline preload="metadata" />;
  }
  return <Motion id={t.id} />;
}

/** Code-drawn illustration of the template, shown until a real AI clip exists. */
function Motion({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => mountMotion(ref.current!, id), [id]);
  return <canvas ref={ref} className="tpl-media" aria-hidden="true" />;
}

function TemplateCard({ t, preview, busy, onOpen }: { t: CarTemplate; preview?: Job; busy: boolean; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button className="tpl-card" onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <div className="tpl-thumb">
        <Thumb t={t} preview={preview} playing={hover} />
        <span className="tpl-badge">{t.duration}s · {t.aspect}</span>
        {busy && <span className="tpl-badge tpl-busy"><span className="dotspin" />Đang tạo</span>}
        {!preview && <span className="tpl-poster-en">{t.en}</span>}
      </div>
      <div className="tpl-meta">
        <b>{t.name}</b>
        <span>{CATEGORIES.find(([c]) => c === t.category)?.[1]}</span>
      </div>
    </button>
  );
}

function TemplateSheet({ t, car, setCar, preview, busy, onClose, onQueued }: {
  t: CarTemplate | null; car: string; setCar: (v: string) => void; preview?: Job; busy: boolean; onClose: () => void; onQueued: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<Aspect>('9:16');
  const [duration, setDuration] = useState(5);
  const [working, setWorking] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [site, setSite] = useState(AI_SITES[0].name);
  useStore((s) => s.defaults);

  useEffect(() => {
    if (!t) return;
    setPrompt(fillPrompt(t, car)); setAspect(t.aspect); setDuration(t.duration);
  }, [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;

  const changeCar = (v: string) => {
    // Keep the user's prompt edits: only swap the car name inside it.
    const prev = car.trim() || DEFAULT_CAR;
    setCar(v);
    setPrompt((p) => p.replaceAll(prev, v.trim() || DEFAULT_CAR));
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); toast('Đã sao chép prompt'); }
    catch { toast('Trình duyệt chặn clipboard — hãy chọn và sao chép thủ công.', true); }
  };
  const openSite = (site: AiSite) => {
    // Start the clipboard write while this click still counts as a user gesture, then open the site.
    navigator.clipboard.writeText(prompt).then(() => toast(`Đã sao chép prompt — dán vào ${site.name} (⌘V)`), () => {});
    window.open(site.url, '_blank', 'noopener');
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) return toast('Hãy chọn file video (.mp4, .mov, .webm).', true);
    setWorking(true);
    try {
      await api.uploadTemplateClip(t.id, file, prompt, site);
      toast('Đã lưu clip mẫu');
      onQueued();
    } catch (e: any) { toast(e.message, true); }
    finally { setWorking(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const download = async () => {
    setRecording(true);
    try {
      const blob = await recordMotion(t.id, aspect);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `minh-hoa-${t.id}-${aspect.replace(':', 'x')}.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e: any) { toast('Không ghi được video: ' + e.message, true); }
    finally { setRecording(false); }
  };
  // Reuse the sample clip when it was made from exactly this prompt and frame; otherwise render a fresh one.
  const reusable = preview?.result && preview.prompt === prompt ? preview.result : null;
  const use = async () => {
    setWorking(true);
    try {
      const storyboard: Storyboard = {
        title: t.name,
        palette: { bg1: '#000000', bg2: '#000000', accent: '#16c3f6', text: '#ffffff' },
        font: 'brand',
        music: { mood: 'epic', bpm: 120 },
        scenes: [{ id: '', layout: 'title', headline: '', icon: '', caption: '', visual_prompt: prompt, duration, animation: 'fade', background: 'solid', media: reusable }],
      };
      const p = await api.createProject({ title: t.name, aspect, storyboard });
      await openProject(p.id);
      onClose();
    } catch (e: any) { toast(e.message, true); }
    finally { setWorking(false); }
  };

  return (
    <Sheet open onClose={onClose} title={t.name} wide footer={<>
      <button className="btn btn-gray" onClick={copy}><Icon name="copy" size={16} />Sao chép prompt</button>
      <button className="btn btn-gray" disabled={recording} onClick={download}><Icon name="download" size={16} />{recording ? 'Đang ghi…' : 'Tải minh hoạ'}</button>
      <button className="btn btn-primary" disabled={working || !prompt.trim()} onClick={use}><Icon name="sparkle" size={16} />{reusable ? 'Dùng clip này' : 'Dùng template'}</button>
    </>}>
      <div className="tpl-detail">
        <div className={'tpl-big' + (aspect === '9:16' ? ' tall' : '')}>
          {preview?.result?.url
            ? <video src={preview.result.url} controls autoPlay muted loop playsInline />
            : <Motion id={t.id} />}
          {!preview && <span className="tpl-badge">Minh hoạ chuyển động · chưa phải clip AI</span>}
          {preview && <span className="tpl-badge">{providerName(preview.provider)}{preview.model ? ' · ' + preview.model.split('/').slice(-2).join('/') : ''}</span>}
        </div>
        <div className="tpl-form">
          <label className="opt">
            <span className="opt-label">Xe trong video</span>
            <input className="tpl-input" value={car} onChange={(e) => changeCar(e.target.value)} placeholder={DEFAULT_CAR} />
          </label>
          <label className="opt">
            <span className="opt-label">Prompt (tiếng Anh — sửa thoải mái)</span>
            <textarea className="tpl-prompt" rows={9} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <div className="tpl-row">
            <div className="opt">
              <span className="opt-label">Khung hình</span>
              <Segmented<Aspect> small ariaLabel="Khung hình" value={aspect} onChange={setAspect}
                options={[['9:16', 'Dọc'], ['16:9', 'Ngang'], ['1:1', 'Vuông']]} />
            </div>
            <div className="opt">
              <span className="opt-label">Độ dài</span>
              <Segmented<number> small ariaLabel="Độ dài" value={duration} onChange={setDuration} options={[[5, '5s'], [10, '10s']]} />
            </div>
          </div>
          <div className="opt">
            <span className="opt-label">Tạo trên web AI — bấm để sao chép prompt và mở trang</span>
            <div className="tpl-sites">
              {AI_SITES.map((x) => (
                <button key={x.name} className="tpl-site" onClick={() => openSite(x)} title={x.note}>
                  <b>{x.name}</b><span>{x.note}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="opt">
            <span className="opt-label">Đã tạo xong? Tải clip về máy rồi đưa lên đây làm clip mẫu</span>
            <div className="tpl-upload">
              <select className="tpl-input" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Clip tạo từ trang">
                {AI_SITES.map((x) => <option key={x.name}>{x.name}</option>)}
              </select>
              <button className="btn btn-tinted" disabled={working} onClick={() => fileRef.current?.click()}><Icon name="share" size={16} />{working ? 'Đang tải lên…' : 'Tải clip lên'}</button>
              <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
            </div>
          </div>
          {t.tip && <p className="note">💡 {t.tip}</p>}
          <button className="link" onClick={() => setPrompt(fillPrompt(t, car))}><Icon name="undo" size={13} />Khôi phục prompt gốc</button>
        </div>
      </div>
    </Sheet>
  );
}
