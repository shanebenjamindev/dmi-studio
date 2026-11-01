import { useEffect, useRef, useState } from 'react';
import { useStore, refine, buildFromSheet, rebuildFromSheet, addSourceAtPlayhead, fmt } from '../store';
import { Icon } from './ui';
import type { Source } from '../types';

const SHEET = /docs\.google\.com\/spreadsheets\/d\//;
type Filter = 'all' | 'used' | 'unused';

// Left column of the editor: the request sheet the assembly comes from, and the source library (CapCut's media panel).
export function LeftPanel() {
  const busy = useStore((s) => s.busy);
  const project = useStore((s) => s.project);
  const sb = project?.storyboard || null;
  const sheet = project?.sheet || null;
  const sources = project?.sources || [];
  const assembly = sb?.mode === 'edit';
  const shots = assembly ? sb!.scenes.flatMap((s) => s.shots || []) : [];
  const usedCount = new Map<string, number>();
  for (const sh of shots) usedCount.set(sh.media.assetId, (usedCount.get(sh.media.assetId) || 0) + 1);
  const total = shots.reduce((a, x) => a + x.dur, 0);

  const [link, setLink] = useState('');
  const [other, setOther] = useState(false); // "Sheet khác": show the link box again
  const [filter, setFilter] = useState<Filter>('all');
  const [showMissing, setShowMissing] = useState(false);
  const valid = SHEET.test(link);
  const build = () => { if (valid && !busy) buildFromSheet(link.trim()).then(() => { setLink(''); setOther(false); }); };
  const list = sources.filter((s) => filter === 'all' || (filter === 'used') === usedCount.has(s.id));
  const missing = sheet?.missing || [];

  return (
    <aside className="sidebar lp">
      <section className="lp-sec">
        <h1 className="lp-title">Ghép source từ sheet</h1>
        {(!sheet || other) ? (
          <form className="sheet-form" onSubmit={(e) => { e.preventDefault(); build(); }}>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Dán link Google Sheet…" aria-label="Link Google Sheet" autoFocus={other} />
            {link && !valid && <p className="note err">Cần link Google Sheet (docs.google.com/spreadsheets/…)</p>}
            <div className="lp-row">
              <button type="submit" className="btn btn-primary" disabled={!!busy || !valid}><Icon name="sparkle" size={16} />Ghép source</button>
              {other && <button type="button" className="btn btn-gray" onClick={() => { setOther(false); setLink(''); }}>Huỷ</button>}
            </div>
            {!sheet && <p className="lp-help">Tool đọc sheet, lấy video theo link và tên file trong cột Source, rồi xếp lên timeline đúng thứ tự từng hàng. Sheet và thư mục source cần chia sẻ cho tài khoản Google đã kết nối.</p>}
          </form>
        ) : (
          <div className="sheet-card">
            <a className="sheet-name" href={sheet.link} target="_blank" rel="noreferrer" title={sheet.title}>
              <span>📄</span><b>{sheet.title}</b><Icon name="share" size={13} />
            </a>
            <div className="sheet-meta">{sheet.form.customer} · {sheet.form.aspect}</div>
            {assembly && (
              <div className="sheet-stats">
                <div><b>{shots.length}</b><span>clip</span></div>
                <div><b>{fmt(total)}</b><span>độ dài</span></div>
                <div><b>{sources.length}</b><span>source</span></div>
              </div>
            )}
            {missing.length > 0 && (
              <div className="sheet-warn">
                <button onClick={() => setShowMissing(!showMissing)}>⚠ {missing.length} file trong sheet không tìm thấy trên Drive <Icon name="chevron" size={12} className={showMissing ? 'rot' : ''} /></button>
                {showMissing && <ul>{missing.map((m) => <li key={m}>{m}</li>)}</ul>}
              </div>
            )}
            <div className="lp-row">
              <button className="btn btn-gray btn-sm" disabled={!!busy} onClick={rebuildFromSheet} title="Đọc lại sheet (nếu đã sửa) và ghép lại từ đầu"><Icon name="refresh" size={14} />Đọc lại sheet</button>
            </div>
          </div>
        )}
      </section>

      {sources.length > 0 && (
        <section className="lp-sec lp-lib">
          <div className="lib-head">
            <h2>Source</h2>
            <div className="lib-tabs">
              {([['all', `Tất cả ${sources.length}`], ['used', `Đang dùng ${usedCount.size}`], ['unused', 'Chưa dùng']] as [Filter, string][]).map(([k, l]) => (
                <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
          </div>
          <p className="lp-help">Bấm vào một source để chèn vào timeline tại vạch phát.</p>
          <div className="lib-grid">
            {list.map((s) => <SourceTile key={s.id} s={s} uses={usedCount.get(s.id) || 0} onAdd={() => assembly && addSourceAtPlayhead(s)} disabled={!assembly || !!busy} />)}
          </div>
        </section>
      )}

      {sb && !assembly && <LegacyChat />}
    </aside>
  );
}

function SourceTile({ s, uses, onAdd, disabled }: { s: Source; uses: number; onAdd: () => void; disabled: boolean }) {
  return (
    <button className={'lib-tile' + (uses ? ' used' : '')} onClick={onAdd} disabled={disabled} title={`${s.name}${s.folder ? `\n${s.folder}` : ''}\nBấm để chèn vào timeline`}>
      <span className="lib-thumb" style={{ backgroundImage: `url("${s.thumb}")` }}>
        {s.duration ? <em>{fmt(s.duration)}</em> : null}
        {uses > 0 && <i>✓{uses > 1 ? ` ×${uses}` : ''}</i>}
        <b className="lib-add">＋</b>
      </span>
      <span className="lib-name">{s.name}</span>
    </button>
  );
}

/** Older projects made from a written brief keep their chat for edits. */
function LegacyChat() {
  const busy = useStore((s) => s.busy);
  const chat = useStore((s) => s.project?.chat || []);
  const [instr, setInstr] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => { logRef.current?.scrollTo(0, 1e6); }, [chat.length]);
  const send = () => { if (instr.trim() && !busy) { refine(instr.trim()); setInstr(''); } };
  return (
    <section className="assistant">
      <h2 className="side-sub">Chỉnh bằng lời</h2>
      <div className="chat-log" ref={logRef}>{chat.map((m, i) => <div key={i} className={'bubble ' + m.who}>{m.text}</div>)}</div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="Ví dụ: đổi cảnh 2…" aria-label="Yêu cầu chỉnh sửa" />
        <button type="submit" className="send" disabled={!!busy || !instr.trim()} aria-label="Gửi"><Icon name="send" size={16} /></button>
      </form>
    </section>
  );
}
