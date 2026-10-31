import { useEffect, useRef } from 'react';
import { useStore, setState, updateScene, updateSb, sceneOp, queueMedia, queueVoice, activeJob, cancelJob, fitToVoice, providerName, getState, toast } from '../store';
import { ModelPicker } from './ModelPicker';
import { api } from '../api';
import { Group, Row, Segmented, Popup, Icon, IconButton } from './ui';
import type { Scene, Palette, Layout } from '../types';

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
  const jobs = useStore((s) => s.jobs);
  const mediaKind = useStore((s) => s.defaults.mediaKind) || 'video';
  const sb = project?.storyboard;
  if (!sb?.scenes.length) return <Empty><Icon name="layers" size={28} /><p>Chưa có cảnh nào.<br />Mô tả video ở cột bên trái để bắt đầu.</p></Empty>;
  const s = sb.scenes[sel] as Scene;
  const set = (patch: Partial<Scene>) => updateScene(sel, patch);
  const mJob = activeJob(s.id, ['video', 'image']);
  const vJob = activeJob(s.id, ['tts']);
  const lastFail = jobs.find((j) => j.sceneId === s.id && j.status === 'failed');
  const voiceStale = s.voice?.text && s.voice.text !== s.caption;
  const setKind = (k: 'video' | 'image') => { setState({ defaults: { ...getState().defaults, mediaKind: k } }); api.setDefaults({ mediaKind: k }).catch(() => {}); };

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

      <Group title="Hình nền AI" action={s.media ? <span className="badge-soft">{providerName(s.media.provider || '')}</span> : null}>
        {s.media && (
          <div className="media-prev">
            {s.media.type === 'video' ? <video src={s.media.url} muted loop autoPlay playsInline /> : <img src={s.media.url} alt="" />}
            <button className="media-x" onClick={() => set({ media: null })} aria-label="Bỏ hình nền" title="Bỏ hình nền"><Icon name="x" size={14} /></button>
          </div>
        )}
        <textarea className="field" rows={3} value={s.visual_prompt || ''} onChange={(e) => set({ visual_prompt: e.target.value })}
          placeholder="Mô tả cảnh bằng tiếng Anh, vd. glossy black car, foam, blue rim light, slow dolly-in" aria-label="Mô tả hình ảnh" />
        <Segmented<'video' | 'image'> full small value={mediaKind} onChange={setKind} options={[['video', <><Icon name="film" size={14} />Video</>], ['image', <><Icon name="photo" size={14} />Ảnh</>]]} />
        <ModelPicker kind={mediaKind} />
        {mJob ? (
          <div className="progress-row"><div className="spinner sm" /><span>{providerName(mJob.provider)} đang tạo… thường mất 1–5 phút</span><button className="link" onClick={() => cancelJob(mJob.id)}>Huỷ</button></div>
        ) : (
          <button id="btnMedia" className="btn btn-tinted" disabled={!s.visual_prompt?.trim()} onClick={() => queueMedia([sel], mediaKind)}>
            <Icon name="wand" size={16} />{s.media ? 'Tạo lại' : mediaKind === 'video' ? 'Tạo clip video' : 'Tạo ảnh'}
          </button>
        )}
        {lastFail && !mJob && lastFail.kind !== 'tts' && <p className="note err">{lastFail.error}</p>}
        <Row label="Khi không có hình AI">
          <Popup value={s.background} onChange={(v) => set({ background: v })}>{BGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Popup>
        </Row>
      </Group>

      <Group title="Lời thoại" action={s.voice?.duration ? <span className="badge-soft">{s.voice.duration.toFixed(1)}s</span> : null}>
        <textarea className="field" rows={3} value={s.caption || ''} onChange={(e) => set({ caption: e.target.value })} placeholder="Câu thuyết minh — cũng dùng làm phụ đề" aria-label="Lời thoại" />
        {voiceStale && <p className="note warn">Lời thoại đã đổi — hãy đọc lại.</p>}
        {vJob ? (
          <div className="progress-row"><div className="spinner sm" /><span>Đang tạo giọng đọc…</span></div>
        ) : (
          <div className="btn-row">
            <button className="btn btn-tinted" disabled={!s.caption?.trim()} onClick={() => queueVoice([sel])}><Icon name="mic" size={16} />{s.voice ? 'Đọc lại' : 'Tạo giọng đọc'}</button>
            {s.voice && <button className="btn btn-gray" onClick={() => fitToVoice([sel])} title="Đặt thời lượng cảnh theo giọng đọc">Khớp thời lượng</button>}
          </div>
        )}
      </Group>
    </>
  );
}

function GlobalTab() {
  const project = useStore((s) => s.project);
  const jobs = useStore((s) => s.jobs);
  const mediaKind = useStore((s) => s.defaults.mediaKind) || 'video';
  const sb = project?.storyboard;
  if (!sb) return <Empty><Icon name="film" size={28} /><p>Chưa có video.</p></Empty>;
  const all = sb.scenes.map((_, i) => i);
  const missing = all.filter((i) => !sb.scenes[i].media);
  const running = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
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

      <Group title="Hình nền AI cho cả video" footer="Mỗi cảnh dùng mô tả hình ảnh của nó. Video AI thường mất 1–5 phút mỗi clip và tính phí theo nền tảng.">
        <Segmented<'video' | 'image'> full small value={mediaKind} onChange={(k) => { setState({ defaults: { ...getState().defaults, mediaKind: k } }); api.setDefaults({ mediaKind: k }).catch(() => {}); }}
          options={[['video', <><Icon name="film" size={14} />Video</>], ['image', <><Icon name="photo" size={14} />Ảnh</>]]} />
        <ModelPicker kind={mediaKind} id="batchMediaPicker" />
        <button id="btnAllMedia" className="btn btn-tinted" disabled={!missing.length} onClick={() => queueMedia(missing, mediaKind)}>
          <Icon name="wand" size={16} />{missing.length ? `Tạo cho ${missing.length} cảnh còn trống` : 'Mọi cảnh đã có hình nền'}
        </button>
      </Group>

      <Group title="Giọng đọc">
        <ModelPicker kind="tts" id="ttsPicker" />
        <input className="field" value={sb.voice_style || ''} onChange={(e) => updateSb((x) => { x.voice_style = e.target.value; }, true)} placeholder="Phong cách đọc: ấm áp, năng lượng…" aria-label="Phong cách đọc" />
        <div className="btn-row">
          <button id="btnAllVoice" className="btn btn-tinted" onClick={() => queueVoice(all)}><Icon name="mic" size={16} />Đọc tất cả</button>
          <button className="btn btn-gray" onClick={() => fitToVoice(all)}>Khớp thời lượng</button>
        </div>
      </Group>
      {running.length > 0 && <p className="note"><span className="dotspin" /> {running.length} tác vụ đang chạy trên máy chủ — có thể đóng trang, kết quả vẫn được lưu.</p>}
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
