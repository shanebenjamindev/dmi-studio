import { useEffect, useRef } from 'react';
import { useStore, setState, updateScene, updateSb, sceneOp, getState, toast, setSceneSource } from '../store';
import { api } from '../api';
import { Group, Row, Segmented, Popup, Icon, IconButton } from './ui';
import type { Scene, Palette, Layout, TextOverlay } from '../types';

const LAYOUTS: [Layout, string, string][] = [
  ['title', 'Tiêu đề', 'M4 9h16M7 13h10'], ['bullets', 'Danh sách', 'M5 7h.01M9 7h10M5 12h.01M9 12h10M5 17h.01M9 17h10'],
  ['stat', 'Con số', 'M7 17V9M12 17V5M17 17v-6'], ['quote', 'Trích dẫn', 'M7 9h3v4H6M14 9h3v4h-4'],
  ['split', 'Chia đôi', 'M4 5h7v14H4zM14 9h6M14 13h4'], ['outro', 'Kết', 'M8 10h8M9.5 14h5a2 2 0 0 1 0 0h-5z'],
];
const ANIMS: [string, string][] = [['fade', 'Mờ dần'], ['slide-up', 'Trượt lên'], ['zoom', 'Phóng to'], ['typewriter', 'Gõ chữ'], ['pop', 'Bật nảy']];
const BGS: [string, string][] = [['gradient', 'Chuyển màu'], ['blobs', 'Đốm sáng'], ['particles', 'Hạt bay'], ['grid', 'Lưới 3D'], ['waves', 'Sóng'], ['solid', 'Trơn']];
export const BRAND: Record<string, Palette & { name: string }> = {
  night: { name: 'Night', bg1: '#050a1f', bg2: '#0d2a8a', accent: '#16c3f6', text: '#ffffff' },
  blue: { name: 'Blue', bg1: '#1539e1', bg2: '#0b7df2', accent: '#9fe9ff', text: '#ffffff' },
  light: { name: 'Light', bg1: '#ffffff', bg2: '#e6f1ff', accent: '#0b7df2', text: '#0a0a0a' },
  ink: { name: 'Ink', bg1: '#000000', bg2: '#101826', accent: '#0b7df2', text: '#ffffff' },
};
const EXTRA: Palette[] = [
  { bg1: '#1c120d', bg2: '#4a2c1d', accent: '#f2b880', text: '#fff6ec' },
  { bg1: '#052e16', bg2: '#14532d', accent: '#a3e635', text: '#f0fdf4' },
  { bg1: '#2e1065', bg2: '#be185d', accent: '#fde047', text: '#ffffff' },
  { bg1: '#18181b', bg2: '#3f3f46', accent: '#f97316', text: '#fafafa' },
];
type Tab = 'scene' | 'global' | 'brand' | 'renders';

export function Inspector() {
  const tab = useStore((s) => s.tab);
  const sel = useStore((s) => s.sel);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [sel, tab]);
  return (
    <aside className="inspector">
      <div className="insp-head">
        <Segmented<Tab> full small ariaLabel="Bảng điều khiển" value={tab} onChange={(t) => setState({ tab: t })}
          options={[['scene', 'Cảnh'], ['global', 'Video'], ['brand', 'Thương hiệu'], ['renders', 'Bản xuất']]} />
      </div>
      <div className="insp-body" ref={body}>
        {tab === 'scene' && <SceneTab />}
        {tab === 'global' && <GlobalTab />}
        {tab === 'brand' && <BrandTab />}
        {tab === 'renders' && <RendersTab />}
      </div>
    </aside>
  );
}

const Empty = ({ children }: { children: any }) => <div className="insp-empty">{children}</div>;

function SceneTab() {
  const project = useStore((s) => s.project);
  const sel = useStore((s) => s.sel);
  const sb = project?.storyboard;
  if (!sb?.scenes.length) return <Empty><Icon name="layers" size={28} /><p>Chưa có cảnh nào.<br />Mô tả video ở cột bên trái để bắt đầu.</p></Empty>;
  const s = sb.scenes[sel] as Scene;
  const sources = project?.sources || [];
  const set = (patch: Partial<Scene>) => updateScene(sel, patch);

  return (
    <>
      <div className="scene-head">
        <div>
          <span className="eyebrow">Cảnh {sel + 1} / {sb.scenes.length}</span>
          <h3 className="scene-title">{s.headline || 'Không tiêu đề'}</h3>
        </div>
        <div className="scene-actions">
          <IconButton icon="up" label="Đưa lên" size={16} onClick={() => sceneOp('up')} disabled={sel === 0} />
          <IconButton icon="down" label="Đưa xuống" size={16} onClick={() => sceneOp('down')} disabled={sel === sb.scenes.length - 1} />
          <IconButton icon="copy" label="Nhân bản cảnh" size={16} onClick={() => sceneOp('dup')} />
          <IconButton icon="trash" label="Xoá cảnh" size={16} danger onClick={() => sceneOp('del')} disabled={sb.scenes.length < 2} />
        </div>
      </div>

      {sb.mode === 'edit' ? <EditScene s={s} set={set} /> : <>
      <Group title="Bố cục">
        <div className="layouts">
          {LAYOUTS.map(([v, l, d]) => (
            <button key={v} className={'layout-tile' + (s.layout === v ? ' on' : '')} onClick={() => set({ layout: v })} aria-pressed={s.layout === v}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
              <span>{l}</span>
            </button>
          ))}
        </div>
      </Group>

      <Group title="Nội dung">
        <div className="field-row">
          <textarea className="field big" rows={2} value={s.headline} onChange={(e) => set({ headline: e.target.value })} placeholder="Tiêu đề" aria-label="Tiêu đề" />
          <input className="field emoji" value={s.icon || ''} maxLength={4} onChange={(e) => set({ icon: e.target.value })} aria-label="Biểu tượng" title="Biểu tượng (emoji)" />
        </div>
        {s.layout === 'bullets' && <textarea className="field" rows={4} value={(s.bullets || []).join('\n')} onChange={(e) => set({ bullets: e.target.value.split('\n') })} placeholder="Mỗi dòng một ý" aria-label="Các ý" />}
        {s.layout === 'outro' && <textarea className="field" rows={2} value={(s.bullets || []).join('\n')} onChange={(e) => set({ bullets: e.target.value.split('\n') })} placeholder="Dòng nhỏ trên nút, vd. hạn đăng ký (mỗi dòng một ý)" aria-label="Dòng nhỏ trên nút" />}
        {s.layout === 'stat' && (
          <div className="field-row">
            <input className="field" value={s.stat_value || ''} onChange={(e) => set({ stat_value: e.target.value })} placeholder="Con số, vd. 90%" aria-label="Con số" />
            <input className="field" value={s.stat_label || ''} onChange={(e) => set({ stat_label: e.target.value })} placeholder="Nhãn" aria-label="Nhãn" />
          </div>
        )}
        {s.layout !== 'bullets' && <input className="field" value={s.subtext || ''} onChange={(e) => set({ subtext: e.target.value })} aria-label="Dòng phụ"
          placeholder={s.layout === 'quote' ? 'Người nói' : s.layout === 'outro' ? 'Chữ trên nút, vd. Đặt lịch ngay' : 'Dòng phụ'} />}
        <Row label="Thời lượng">
          <div className="stepper">
            <button onClick={() => set({ duration: Math.max(1, s.duration - 0.5) })} aria-label="Giảm">−</button>
            <span className="mono">{s.duration.toFixed(1)}s</span>
            <button onClick={() => set({ duration: Math.min(15, s.duration + 0.5) })} aria-label="Tăng">+</button>
          </div>
        </Row>
        <Row label="Hiệu ứng chữ">
          <Popup value={s.animation} onChange={(v) => set({ animation: v })}>{ANIMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Popup>
        </Row>
      </Group>

      <Group title="Hình nền">
        {sources.length > 0 && (
          <Row label="Source">
            <Popup value={s.media?.provider === 'drive' ? s.media.assetId : ''} onChange={(v) => setSceneSource(sel, sources.find((x) => x.id === v) || null)}>
              <option value="">Không dùng</option>
              {sources.map((x) => <option key={x.id} value={x.id}>{x.kind === 'video' ? '🎬' : '🖼'} {x.folder ? x.folder + '/' : ''}{x.name}</option>)}
            </Popup>
          </Row>
        )}
        {s.media && (
          <div className="media-prev">
            {s.media.type === 'video' ? <video src={s.media.url} muted loop autoPlay playsInline /> : <img src={s.media.url} alt="" />}
            <button className="media-x" onClick={() => set({ media: null })} aria-label="Bỏ hình nền" title="Bỏ hình nền"><Icon name="x" size={14} /></button>
          </div>
        )}
        <Row label="Nền động">
          <Popup value={s.background} onChange={(v) => set({ background: v })}>{BGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Popup>
        </Row>
      </Group>

      <Group title="Lời thoại" footer="Hiện thành phụ đề trong video.">
        <textarea className="field" rows={3} value={s.caption || ''} onChange={(e) => set({ caption: e.target.value })} placeholder="Câu thuyết minh / phụ đề" aria-label="Lời thoại" />
      </Group>
      </>}
    </>
  );
}

const TEXT_STYLES: [TextOverlay['style'], string][] = [['price', 'Giá / offer'], ['title', 'Tiêu đề'], ['tag', 'Tag'], ['cta', 'CTA'], ['lower', 'Dòng dưới']];

/** Edit mode: the cuts of this beat and its timed on-screen text. */
function EditScene({ s, set }: { s: Scene; set: (patch: Partial<Scene>) => void }) {
  const shots = s.shots || [], texts = s.texts || [];
  const setText = (i: number, patch: Partial<TextOverlay>) => set({ texts: texts.map((t, k) => (k === i ? { ...t, ...patch } : t)) });
  const setShot = (i: number, dur: number) => {
    const next = shots.map((x, k) => (k === i ? { ...x, dur } : x));
    set({ shots: next, duration: Math.round(next.reduce((a, x) => a + x.dur, 0) * 100) / 100 });
  };
  return (
    <>
      <Group title={`Cảnh quay · ${shots.length} shot · ${s.duration.toFixed(1)}s`} footer={s.visual_prompt || undefined}>
        {shots.map((x, i) => (
          <div key={i} className="shot-row">
            <span className="shot-n">{i + 1}</span>
            <span className="shot-name" title={x.media.prompt}>{x.media.type === 'video' ? '🎬' : '🖼'} {x.media.prompt}{x.from ? ` · từ ${x.from}s` : ''}</span>
            <div className="stepper sm">
              <button onClick={() => setShot(i, Math.max(0.3, Math.round((x.dur - 0.2) * 10) / 10))} aria-label="Ngắn hơn">−</button>
              <span className="mono">{x.dur.toFixed(1)}s</span>
              <button onClick={() => setShot(i, Math.round((x.dur + 0.2) * 10) / 10)} aria-label="Dài hơn">+</button>
            </div>
          </div>
        ))}
      </Group>
      {texts.length > 0 && <Group title="Chữ trên hình">
        {texts.map((t, i) => (
          <div key={i} className="text-row">
            <textarea className="field" rows={2} value={t.text} onChange={(e) => setText(i, { text: e.target.value })} aria-label="Chữ trên hình" />
            <div className="text-meta">
              <Popup value={t.style} onChange={(v) => setText(i, { style: v as TextOverlay['style'] })}>{TEXT_STYLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Popup>
              <span className="mono">{t.at.toFixed(1)}s → {(t.at + t.dur).toFixed(1)}s</span>
            </div>
          </div>
        ))}
      </Group>}
      <Group title="Voice-over (tham khảo)" footer="Lời thoại trong sheet của nhịp này, để editor khớp hình với giọng.">
        <textarea className="field" rows={3} value={s.caption || ''} onChange={(e) => set({ caption: e.target.value })} aria-label="Voice-over" />
      </Group>
    </>
  );
}

function GlobalTab() {
  const project = useStore((s) => s.project);
  const sb = project?.storyboard;
  if (!sb) return <Empty><Icon name="film" size={28} /><p>Chưa có video.</p></Empty>;
  return (
    <>
      <Group title="Màu sắc">
        <div className="palettes">
          {[...Object.values(BRAND), ...EXTRA].map((p, i) => {
            const on = p.bg1 === sb.palette.bg1 && p.accent === sb.palette.accent;
            return (
              <button key={i} className={'palette' + (on ? ' on' : '')} title={(p as any).name ? 'Detailers Movement · ' + (p as any).name : 'Bảng màu'}
                onClick={() => updateSb((x) => { x.palette = { bg1: p.bg1, bg2: p.bg2, accent: p.accent, text: p.text }; })}>
                <span style={{ background: `linear-gradient(135deg, ${p.bg1}, ${p.bg2})` }}><i style={{ background: p.accent }} /></span>
              </button>
            );
          })}
        </div>
        <div className="colors">
          {(['bg1', 'bg2', 'accent', 'text'] as const).map((k) => (
            <label key={k} className="color">
              <input type="color" value={sb.palette[k].slice(0, 7)} onChange={(e) => updateSb((x) => { x.palette[k] = e.target.value; }, true)} />
              <span>{{ bg1: 'Nền', bg2: 'Nền 2', accent: 'Nhấn', text: 'Chữ' }[k]}</span>
            </label>
          ))}
        </div>
      </Group>

      <Group title="Chữ & nhạc">
        <Row label="Font chữ">
          <Popup value={sb.font} onChange={(v) => updateSb((x) => { x.font = v; })}>
            <option value="brand">Thương hiệu</option><option value="sans">Hiện đại</option><option value="serif">Sang trọng</option><option value="mono">Công nghệ</option><option value="display">Mạnh mẽ</option>
          </Popup>
        </Row>
        <Row label="Nhạc nền">
          <Popup value={sb.music.mood} onChange={(v) => updateSb((x) => { x.music.mood = v as any; })}>
            <option value="calm">Nhẹ nhàng</option><option value="upbeat">Sôi động</option><option value="epic">Hùng tráng</option><option value="none">Tắt</option>
          </Popup>
        </Row>
        <Row label="Nhịp">
          <div className="stepper">
            <button onClick={() => updateSb((x) => { x.music.bpm = Math.max(60, x.music.bpm - 4); }, true)} aria-label="Chậm hơn">−</button>
            <span className="mono">{sb.music.bpm} bpm</span>
            <button onClick={() => updateSb((x) => { x.music.bpm = Math.min(160, x.music.bpm + 4); }, true)} aria-label="Nhanh hơn">+</button>
          </div>
        </Row>
      </Group>

    </>
  );
}

function BrandTab() {
  const hasSb = useStore((s) => !!s.project?.storyboard);
  const copy = (hex: string) => navigator.clipboard?.writeText(hex).then(() => toast('Đã chép ' + hex));
  const apply = (k: string) => {
    if (!hasSb) return toast('Hãy tạo video trước đã.', true);
    const p = BRAND[k];
    updateSb((x) => { x.palette = { bg1: p.bg1, bg2: p.bg2, accent: p.accent, text: p.text }; x.font = 'brand'; });
    toast('Đã áp dụng ' + p.name);
  };
  return (
    <>
      <Group title="Logo">
        <div className="bk-logos">
          <div className="bk-logo"><img src="/brand/logo.png" alt="Logo trên nền sáng" /></div>
          <div className="bk-logo dark"><img src="/brand/logo-white.png" alt="Logo trên nền tối" /></div>
        </div>
      </Group>
      <Group title="Màu" footer="Bấm vào màu để chép mã.">
        <div className="swatches">
          {[['Deep Blue', '#1539E1'], ['Movement Blue', '#0B7DF2'], ['Cyan', '#16C3F6'], ['Night', '#050A1F'], ['Black', '#000000'], ['White', '#FFFFFF']].map(([n, h]) => (
            <button key={h} className="swatch" onClick={() => copy(h)}><i style={{ background: h }} /><b>{n}</b><span>{h}</span></button>
          ))}
        </div>
      </Group>
      <Group title="Chữ">
        <div className="bk-type"><div className="t1">DETAILERS MOVEMENT</div><div className="t2">OWNED BY YOU, DRIVEN BY US</div></div>
        <p className="note">Tiêu đề Montserrat ExtraBold · Slogan Montserrat Light giãn chữ · Phụ đề Inter.</p>
      </Group>
      <Group title="Áp dụng cho video">
        <div className="apply">
          {Object.entries(BRAND).map(([k, p]) => (
            <button key={k} className="apply-btn" onClick={() => apply(k)}><span style={{ background: `linear-gradient(135deg, ${p.bg1}, ${p.bg2})` }}><i style={{ background: p.accent }} /></span>{p.name}</button>
          ))}
        </div>
      </Group>
      <Group title="Quy tắc">
        <ul className="rules">
          <li>Nền sáng dùng logo chữ đen; nền tối hoặc xanh dùng logo chữ trắng.</li>
          <li>Biểu tượng luôn giữ gradient xanh, không kéo méo, không đổ bóng.</li>
          <li>Chừa khoảng trống quanh logo ít nhất bằng nét chữ “D”.</li>
          <li>Trong video: biểu tượng nhỏ ở góc, logo đầy đủ ở cảnh kết.</li>
        </ul>
      </Group>
    </>
  );
}

function RendersTab() {
  const renders = useStore((s) => s.renders);
  const del = async (id: string) => { await api.deleteRender(id); setState({ renders: getState().renders.filter((r) => r.id !== id) }); };
  return (
    <>
      <button className="btn btn-primary btn-lg" onClick={() => setState({ dialog: 'export', exp: { phase: 'setup', progress: 0, text: '' } })}><Icon name="share" size={16} />Xuất video mới</button>
      {!renders.length && <Empty><Icon name="download" size={28} /><p>Chưa có bản xuất nào.</p></Empty>}
      {renders.map((r) => (
        <div key={r.id} className="render">
          <video src={r.url + '#t=0.8'} controls playsInline preload="metadata" />
          <div className="render-meta">
            <div>
              <b>{new Date(r.createdAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</b>
              <span>{(r.bytes / 1048576).toFixed(1)} MB · {r.mime.split('/')[1].toUpperCase()}{r.status !== 'ready' ? ' · đang xử lý' : ''}</span>
            </div>
            <a className="btn btn-gray btn-sm" href={r.download}><Icon name="download" size={14} />Tải</a>
            <IconButton icon="trash" label="Xoá bản xuất" danger size={16} onClick={() => del(r.id)} />
          </div>
        </div>
      ))}
    </>
  );
}
