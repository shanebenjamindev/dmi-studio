// Tổng quan (Drive ▸ My Drive): every customer folder and every editing project in one place: counts, what is due or
// urgent (deadline and "Gấp" read from each request sheet), what is missing footage, and quick ways in.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore, setState, openProject, fmt } from '../store';
import { Icon } from './ui';
import type { Customer, ProjectItem } from '../types';

const fold = (x: string) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
/** "30/10/2026" → time, or null. */
function due(d?: string) {
  const m = String(d || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : null;
}
const DAY = 864e5;
const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime(); };
const when = (ms: number) => { const d = new Date(ms); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };

export function Dashboard({ customers, onOpenCustomer }: { customers: Customer[]; onOpenCustomer: (id: string) => void }) {
  const editorOk = useStore((s) => s.pages.includes('editor') && s.editorAvailable);
  const [projects, setProjects] = useState<ProjectItem[] | null>(null);
  useEffect(() => { if (editorOk) api.listProjects().then(setProjects).catch(() => setProjects([])); else setProjects([]); }, [editorOk]);

  const t0 = today();
  const work = (projects || []).filter((p) => p.sheet).map((p) => {
    const d = due(p.sheet!.deadline);
    const late = d !== null && d < t0, soon = d !== null && d >= t0 && d - t0 <= 2 * DAY;
    return { p, d, late, soon, urgent: !!p.sheet!.urgent, missing: p.sheet!.missing || 0 };
  }).sort((a, b) => (+b.late - +a.late) || (+b.urgent - +a.urgent) || ((a.d ?? Infinity) - (b.d ?? Infinity)) || b.p.updatedAt - a.p.updatedAt);
  const videos = customers.reduce((a, c) => a + (c.videoCount || 0), 0);
  const hot = work.filter((w) => w.late || w.urgent || w.soon).length;
  const lacking = work.filter((w) => w.missing > 0).length;
  const projectsOf = (c: Customer) => (projects || []).filter((p) => { const a = fold(p.sheet?.customer || ''), b = fold(c.name); return !!a && (a.includes(b) || b.includes(a)); });
  const open = async (id: string) => { setState({ view: 'editor' }); await openProject(id); };

  return (
    <section className="ws-detail dash">
      <header className="dash-h">
        <h2>Tổng quan công việc</h2>
        <span>{new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
      </header>
      <div className="dash-stats">
        <div><b>{customers.length}</b><span>Khách hàng</span></div>
        <div><b>{videos}</b><span>Video trên Drive</span></div>
        {editorOk && <div><b>{work.length}</b><span>Dự án dựng</span></div>}
        {editorOk && <div className={hot ? 'warn' : ''}><b>{hot}</b><span>Gấp / sắp đến hạn</span></div>}
        {editorOk && <div className={lacking ? 'warn' : ''}><b>{lacking}</b><span>Thiếu file source</span></div>}
      </div>

      {editorOk && (
        <div className="dash-block">
          <h3>Việc cần làm</h3>
          {projects === null ? <p className="note">Đang tải…</p> : !work.length ? <p className="note">Chưa có dự án dựng nào. Vào Trình dựng và dán link sheet để tạo.</p> : (
            <div className="dash-table">
              <div className="dash-tr head"><span>Dự án</span><span>Khách</span><span>Deadline</span><span>Clip</span><span>Thiếu file</span><span>Sửa</span></div>
              {work.map(({ p, d, late, soon, urgent, missing }) => (
                <button key={p.id} className="dash-tr" onClick={() => open(p.id)} title="Mở trong Trình dựng">
                  <span className="dash-name">{urgent && <em className="tag hot">Gấp</em>}<b>{p.title}</b></span>
                  <span>{p.sheet!.customer || '—'}</span>
                  <span className={late ? 'late' : soon ? 'soon' : ''}>{d ? `${when(d)}${late ? ' · trễ' : soon ? ' · sắp đến' : ''}` : '—'}</span>
                  <span className="mono">{p.clips} · {fmt(p.duration)}</span>
                  <span className={missing ? 'soon' : ''}>{missing ? `${missing} file` : '✓'}</span>
                  <span>{when(p.updatedAt)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="dash-block">
        <h3>Khách hàng</h3>
        <div className="dash-grid">
          {customers.map((c) => {
            const ps = editorOk ? projectsOf(c) : [];
            return (
              <button key={c.id} className="dash-card" onClick={() => onOpenCustomer(c.id)}>
                <span className="dash-ico"><Icon name="folder" size={18} /></span>
                <b>{c.name}</b>
                <span>{c.videoCount == null ? 'Không đọc được thư mục' : `${c.folderCount || 0} thư mục · ${c.videoCount} video`}</span>
                {editorOk && <span className={ps.some((p) => p.sheet?.urgent) ? 'hot' : ''}>{ps.length ? `${ps.length} dự án dựng${ps.some((p) => p.sheet?.urgent) ? ' · có việc gấp' : ''}` : 'Chưa có dự án dựng'}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
