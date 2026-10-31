import { useEffect, useRef, useState } from 'react';
import { useStore, generate, refine, setState, savePrefs, setAspect } from '../store';
import { ModelPicker } from './ModelPicker';
import { Icon, Segmented, Switch } from './ui';
import type { Aspect } from '../types';

const IDEAS = [
  'Giới thiệu Detailers Movement — cộng đồng do thành viên làm chủ',
  '5 mẹo giữ sơn xe bóng lâu sau khi rửa',
  'So sánh phủ ceramic và wax cho người mới',
];
const REFINES = ['Ngắn hơn', 'Sôi động hơn', 'Thêm cảnh số liệu', 'Dịch sang tiếng Anh'];

export function LeftPanel() {
  const busy = useStore((s) => s.busy);
  const brandMode = useStore((s) => s.brandMode);
  const project = useStore((s) => s.project);
  const chat = project?.chat || [];
  const hasVideo = !!project?.storyboard;
  const [prompt, setPrompt] = useState('');
  const [seconds, setSeconds] = useState(30);
  const [style, setStyle] = useState('');
  const [more, setMore] = useState(false);
  const [instr, setInstr] = useState('');
  const [aspectLocal, setAspectLocal] = useState<Aspect>('16:9');
  const aspect = (project?.aspect || aspectLocal) as Aspect;
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo(0, 1e6); }, [chat.length]);

  const go = () => { if (prompt.trim() && !busy) generate({ prompt, seconds, aspect, style }); };
  const send = () => { if (instr.trim() && !busy) { refine(instr.trim()); setInstr(''); } };

  return (
    <aside className="sidebar">
      <section className="create">
        <h1 className="side-title">Tạo video</h1>
        <div className="prompt-card">
          <textarea id="prompt" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') go(); }}
            placeholder="Bạn muốn làm video về điều gì?" aria-label="Mô tả video" />
          <ModelPicker kind="llm" id="llmPicker" />
        </div>

        {!prompt && !hasVideo && (
          <div className="ideas">
            {IDEAS.map((t) => <button key={t} className="idea" onClick={() => setPrompt(t)}><Icon name="sparkle" size={13} />{t}</button>)}
          </div>
        )}

        <div className="opt">
          <span className="opt-label">Khung hình</span>
          <Segmented<Aspect> full ariaLabel="Khung hình" value={aspect}
            onChange={(v) => (project ? setAspect(v) : setAspectLocal(v))}
            options={[['16:9', <><i className="ar ar-169" />Ngang</>], ['9:16', <><i className="ar ar-916" />Dọc</>], ['1:1', <><i className="ar ar-11" />Vuông</>]]} />
        </div>
        <div className="opt">
          <span className="opt-label">Độ dài</span>
          <Segmented<number> full ariaLabel="Độ dài" value={seconds} onChange={setSeconds}
            options={[[15, '15s'], [30, '30s'], [45, '45s'], [60, '60s']]} />
        </div>

        <button className="disclosure" onClick={() => setMore(!more)} aria-expanded={more}>
          <Icon name="chevron" size={14} className={more ? 'rot' : ''} />Tuỳ chọn khác
        </button>
        {more && (
          <div className="more">
            <input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Phong cách: tối giản, điện ảnh…" aria-label="Phong cách" />
            <Switch checked={brandMode} onChange={(v) => { setState({ brandMode: v }); savePrefs(); }} label="Theo nhận diện Detailers Movement" />
          </div>
        )}

        <button id="btnGenerate" className="btn btn-primary btn-lg" disabled={!!busy || !prompt.trim()} onClick={go}>
          <Icon name="sparkle" size={17} />{hasVideo ? 'Tạo video mới' : 'Tạo video'}
        </button>
        <p className="hint">⌘ + Enter để tạo nhanh</p>
      </section>

      <section className="assistant">
        <h2 className="side-sub">Chỉnh bằng lời</h2>
        <div className="chat-log" ref={logRef}>
          {!chat.length && <p className="empty-note">Sau khi có video, chỉ cần nói điều bạn muốn đổi.</p>}
          {chat.map((m, i) => <div key={i} className={'bubble ' + m.who}>{m.text}</div>)}
        </div>
        {hasVideo && (
          <div className="quick">
            {REFINES.map((t) => <button key={t} className="pill" disabled={!!busy} onClick={() => refine(t)}>{t}</button>)}
          </div>
        )}
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={instr} onChange={(e) => setInstr(e.target.value)} placeholder={hasVideo ? 'Ví dụ: đổi cảnh 2 thành con số…' : 'Tạo video trước đã'} disabled={!hasVideo} aria-label="Yêu cầu chỉnh sửa" />
          <button type="submit" className="send" disabled={!!busy || !instr.trim()} aria-label="Gửi"><Icon name="send" size={16} /></button>
        </form>
      </section>
    </aside>
  );
}
